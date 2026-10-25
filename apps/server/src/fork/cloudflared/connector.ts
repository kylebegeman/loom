import * as RelayClient from "@t3tools/shared/relayClient";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

export interface CloudflaredStatus {
  readonly state: "starting" | "connected" | "error";
  /** Human-readable cause or progress. Never contains the token. */
  readonly message: string | null;
  /** cloudflared's metrics listener, which nothing may share while it is known. */
  readonly metricsPort: number | null;
}

export interface RunCloudflaredOptions {
  readonly token: string;
  readonly onStatus: (status: CloudflaredStatus) => Effect.Effect<void>;
  /**
   * An absolute path to hand the token over through `--token-file` instead of `TUNNEL_TOKEN`,
   * keeping it out of an environment the child's descendants inherit. The runner writes it
   * owner-only before each start and removes it once that child has stopped.
   */
  readonly tokenFile?: string;
}

export interface CloudflaredRunnerNames {
  /** Such as `Effect.fn("PreviewTunnel.run")`, passed in so every span name stays a literal. */
  readonly run: Effect.fn.Traced;
  readonly preferPinned: Effect.fn.Traced;
  /** Starts the warning logged each time the connector stops, such as "Preview tunnel". */
  readonly label: string;
}

/**
 * Loopback ports held by cloudflared connectors that preview links do not run themselves, such as
 * reach's metrics listener. Preview links never share them. `ports` is read on every check, since
 * a restarted connector listens on a new port.
 */
export class CloudflaredExtraPorts extends Context.Reference<{
  readonly ports: () => ReadonlyArray<number>;
}>("t3/fork/cloudflared/CloudflaredExtraPorts", { defaultValue: () => ({ ports: () => [] }) }) {}

// Same pacing as the cloud connector: a binary that fails instantly must not respawn in a tight
// loop, and a connector that ran for a while starts over from the shortest delay.
const RESTART_STABLE_UPTIME_MS = 30_000;
const RESTART_BACKOFF_BASE_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 60_000;
// Output can trail the exit by a moment; a grandchild holding the pipe must not stall a restart.
const OUTPUT_DRAIN_TIMEOUT = Duration.seconds(2);
const MAX_MESSAGE_LENGTH = 300;
// Same as the cloud connector: a download that failed is not tried again on every restart.
const PINNED_INSTALL_RETRY_MS = 10 * 60_000;
// A download over a slow link can take minutes. The older binary meets the minimum, so the tunnel
// waits this long and then runs it while the install finishes for the next start.
const PINNED_INSTALL_WAIT = Duration.seconds(30);
// cloudflared drains open requests for its 30 second default grace period after SIGTERM. Without
// a bound, a child that never exits would hold its scope open, and every stop, every later
// connector and reach removal wait on that scope.
const STOP_FORCE_KILL_AFTER = Duration.seconds(35);
const TOKEN_FILE_MODE = 0o600;
const TOKEN_DIRECTORY_MODE = 0o700;

const CONNECTOR_ARGS = [
  "tunnel",
  "--no-autoupdate",
  "--loglevel",
  "info",
  "--output",
  "default",
  "--metrics",
  "127.0.0.1:0",
  "run",
];

const METRICS_LINE = /\bStarting metrics server on 127\.0\.0\.1:(\d+)\/metrics\b/u;
const REGISTERED_LINE = /\bRegistered tunnel connection\b/u;
const UNREGISTERED_LINE = /\bUnregistered tunnel connection\b/u;
const CONNECTION_INDEX = /\bconnIndex=(\d+)/u;
// cloudflared's default output is `<timestamp> <LVL> <message>`; lines without a level are
// usually command-line errors printed before its logger starts.
const LEVELED_LINE = /^(?:\S+\s+)?(DBG|INF|WRN|ERR|FTL|PNC)\s+(.*)$/u;
// Follows a command-line error; the line before it says what went wrong.
const HELP_POINTER_LINE = /^See 'cloudflared\b.*--help'\.?$/u;

const CONNECTING_MESSAGE = "Connecting to Cloudflare";

const sameStatus = (left: CloudflaredStatus, right: CloudflaredStatus) =>
  left.state === right.state &&
  left.message === right.message &&
  left.metricsPort === right.metricsPort;

const shorten = (text: string) =>
  text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : text;

/** The message an error-worthy line contributes, or null for routine output. */
const errorText = (line: string): string | null => {
  const leveled = LEVELED_LINE.exec(line);
  if (leveled === null) return HELP_POINTER_LINE.test(line) ? null : shorten(line);
  const [, level, message = ""] = leveled;
  return level === "ERR" || level === "FTL" || level === "PNC" ? shorten(message) : null;
};

const installFailureMessage = (error: RelayClient.RelayClientInstallError) => {
  switch (error.reason) {
    case "install_locked":
      return "Waiting for another cloudflared install to finish";
    case "override_missing":
      return error.message;
    default:
      return "Could not install cloudflared";
  }
};

/** cloudflared prefers `TUNNEL_TOKEN` over `--token-file`, so an inherited one must not reach it. */
const environmentWithoutToken = () => {
  const env = { ...process.env };
  delete env.TUNNEL_TOKEN;
  return env;
};

/**
 * Writes the token for one child, removed when the connector's scope closes: after the child's
 * own finalizer has stopped it, or at once when writing or spawning fails. A file a crash left
 * behind is replaced rather than rewritten, so it never keeps wider permissions. Untraced: it
 * runs once per connector attempt, inside the runner's own span.
 */
const writeTokenFile = Effect.fnUntraced(function* (file: string, token: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* Effect.addFinalizer(() =>
    fs
      .remove(file, { force: true })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not remove the cloudflared token file", { cause }),
        ),
      ),
  );
  yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: TOKEN_DIRECTORY_MODE });
  yield* fs.remove(file, { force: true });
  // `wx` will not follow anything that appeared at this path since the removal.
  yield* fs.writeFileString(file, token, { flag: "wx", mode: TOKEN_FILE_MODE });
});

/**
 * Runs one connector until it exits and returns why it stopped. Closing its scope, including on
 * interruption, kills the child; only this child is ever signalled.
 */
const runConnector = (
  executablePath: string,
  options: RunCloudflaredOptions,
  redact: (text: string) => string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      let status: CloudflaredStatus = {
        state: "starting",
        message: CONNECTING_MESSAGE,
        metricsPort: null,
      };
      const report = (next: CloudflaredStatus) => {
        if (sameStatus(status, next)) return Effect.void;
        status = next;
        return options.onStatus(next);
      };

      const { tokenFile } = options;
      if (tokenFile !== undefined) {
        const written = yield* Effect.result(writeTokenFile(tokenFile, options.token));
        if (Result.isFailure(written)) return "Could not write the cloudflared token file";
      }
      const spawned = yield* Effect.result(
        spawner.spawn(
          ChildProcess.make(
            executablePath,
            // `--token-file` arrived in cloudflared 2025.4.0, older than any RelayClient runs.
            tokenFile === undefined
              ? CONNECTOR_ARGS
              : [...CONNECTOR_ARGS, "--token-file", tokenFile],
            {
              detached: false,
              // `env` replaces the inherited environment unless it is spread in.
              env:
                tokenFile === undefined
                  ? { ...process.env, TUNNEL_TOKEN: options.token }
                  : environmentWithoutToken(),
              forceKillAfter: STOP_FORCE_KILL_AFTER,
              shell: false,
              stderr: "pipe",
              stdout: "pipe",
            },
          ),
        ),
      );
      if (Result.isFailure(spawned)) return "Could not start cloudflared";
      const child = spawned.success;
      yield* options.onStatus(status);

      let lastError: string | null = null;
      const connections = new Set<string>();
      const handleLine = (line: string) => {
        const metricsPort = METRICS_LINE.exec(line)?.[1];
        if (metricsPort !== undefined) {
          return report({ ...status, metricsPort: Number(metricsPort) });
        }
        const connection = CONNECTION_INDEX.exec(line)?.[1] ?? "unknown";
        if (REGISTERED_LINE.test(line)) {
          connections.add(connection);
          return report({ state: "connected", message: null, metricsPort: status.metricsPort });
        }
        if (UNREGISTERED_LINE.test(line)) {
          connections.delete(connection);
          return connections.size > 0
            ? Effect.void
            : report({
                state: "starting",
                message: lastError ?? CONNECTING_MESSAGE,
                metricsPort: status.metricsPort,
              });
        }
        const error = errorText(line);
        if (error === null) return Effect.void;
        lastError = error;
        return status.state === "connected"
          ? Effect.void
          : report({ state: "starting", message: error, metricsPort: status.metricsPort });
      };

      const observer = yield* child.all.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.map((line) => redact(line.trim())),
        Stream.filter((line) => line.length > 0),
        Stream.runForEach(handleLine),
        Effect.ignore,
        Effect.forkScoped,
      );
      const exit = yield* Effect.result(child.exitCode);
      yield* Fiber.join(observer).pipe(Effect.timeoutOption(OUTPUT_DRAIN_TIMEOUT));

      if (lastError !== null) return lastError;
      if (Result.isFailure(exit)) return "cloudflared stopped unexpectedly";
      return exit.success === 0
        ? "cloudflared stopped"
        : `cloudflared stopped with exit code ${exit.success}`;
    }),
  );

/**
 * Builds a runner that keeps one cloudflared connector running until interrupted. It never
 * completes and never fails; problems surface through `onStatus` and the connector restarts with
 * backoff. The token reaches only the child and is redacted from every message. Each runner
 * stops only the child it started, so several can run side by side.
 */
export const makeCloudflaredRunner = (names: CloudflaredRunnerNames) =>
  names.run(function* (options: RunCloudflaredOptions) {
    const relayClient = yield* RelayClient.RelayClient;
    const redact = (text: string) =>
      options.token.length > 0 ? text.replaceAll(options.token, "<redacted>") : text;

    let pinnedInstallFailedAt: number | null = null;
    let pinnedInstalling = false;
    /**
     * A cloudflared older than the pin, from PATH or an earlier managed install, gives way to the
     * pinned release. Until that installs, the older one still runs: it meets the minimum.
     */
    const preferPinned = names.preferPinned(function* (resolved: RelayClient.AvailableRelayClient) {
      if (
        pinnedInstalling ||
        resolved.source === "override" ||
        RelayClient.compareCloudflaredVersions(resolved.version, RelayClient.CLOUDFLARED_VERSION) >=
          0
      ) {
        return resolved.executablePath;
      }
      const nowMs = yield* Clock.currentTimeMillis;
      if (
        pinnedInstallFailedAt !== null &&
        nowMs - pinnedInstallFailedAt < PINNED_INSTALL_RETRY_MS
      ) {
        return resolved.executablePath;
      }
      yield* options.onStatus({
        state: "starting",
        message: "Installing cloudflared",
        metricsPort: null,
      });
      pinnedInstalling = true;
      // A child of the tunnel's fiber, so a slow download outlives this attempt but not the tunnel.
      const install = yield* relayClient.install.pipe(
        Effect.map((installed): string | null => installed.executablePath),
        Effect.catchTags({
          RelayClientInstallError: (error) =>
            Effect.gen(function* () {
              pinnedInstallFailedAt = yield* Clock.currentTimeMillis;
              yield* Effect.logWarning("Could not install the pinned cloudflared", {
                reason: error.reason,
                using: resolved.version,
                pinned: RelayClient.CLOUDFLARED_VERSION,
              });
              return null;
            }),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            pinnedInstalling = false;
          }),
        ),
        Effect.forkChild,
      );
      const installed = yield* Fiber.join(install).pipe(Effect.timeoutOption(PINNED_INSTALL_WAIT));
      return Option.getOrNull(installed) ?? resolved.executablePath;
    });

    const resolveExecutable = Effect.gen(function* () {
      const resolved = yield* relayClient.resolve;
      if (resolved.status === "available") return yield* preferPinned(resolved);
      if (resolved.status === "unsupported") {
        yield* options.onStatus({
          state: "error",
          message: `cloudflared does not run on ${resolved.platform} ${resolved.arch}`,
          metricsPort: null,
        });
        return yield* Effect.never;
      }
      yield* options.onStatus({
        state: "starting",
        message: "Installing cloudflared",
        metricsPort: null,
      });
      return yield* relayClient.install.pipe(
        Effect.map((installed) => installed.executablePath),
        Effect.catchTags({
          RelayClientInstallError: (error) => Effect.fail(installFailureMessage(error)),
        }),
      );
    });

    let restartDelayMillis = RESTART_BACKOFF_BASE_MS;
    const attempt = Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const message = yield* resolveExecutable.pipe(
        Effect.flatMap((executablePath) => runConnector(executablePath, options, redact)),
        Effect.catch(Effect.succeed),
      );
      yield* Effect.logWarning(`${names.label} connector stopped`, { message: redact(message) });
      yield* options.onStatus({ state: "error", message: redact(message), metricsPort: null });
      if ((yield* Clock.currentTimeMillis) - startedAt >= RESTART_STABLE_UPTIME_MS) {
        restartDelayMillis = RESTART_BACKOFF_BASE_MS;
      }
      yield* Effect.sleep(Duration.millis(restartDelayMillis));
      restartDelayMillis = Math.min(restartDelayMillis * 2, RESTART_BACKOFF_MAX_MS);
    });

    return yield* Effect.forever(attempt);
  });
