import * as RelayClient from "@t3tools/shared/relayClient";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type { PreviewTunnelStatus, RunPreviewTunnelOptions } from "./types.ts";

// Same pacing as the cloud connector: a binary that fails instantly must not respawn in a tight
// loop, and a connector that ran for a while starts over from the shortest delay.
const RESTART_STABLE_UPTIME_MS = 30_000;
const RESTART_BACKOFF_BASE_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 60_000;
// Output can trail the exit by a moment; a grandchild holding the pipe must not stall a restart.
const OUTPUT_DRAIN_TIMEOUT = Duration.seconds(2);
const MAX_MESSAGE_LENGTH = 300;

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

const sameStatus = (left: PreviewTunnelStatus, right: PreviewTunnelStatus) =>
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

/**
 * Runs one connector until it exits and returns why it stopped. Closing its scope, including on
 * interruption, kills the child; only this child is ever signalled.
 */
const runConnector = (
  executablePath: string,
  options: RunPreviewTunnelOptions,
  redact: (text: string) => string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      let status: PreviewTunnelStatus = {
        state: "starting",
        message: CONNECTING_MESSAGE,
        metricsPort: null,
      };
      const report = (next: PreviewTunnelStatus) => {
        if (sameStatus(status, next)) return Effect.void;
        status = next;
        return options.onStatus(next);
      };

      const spawned = yield* Effect.result(
        spawner.spawn(
          ChildProcess.make(executablePath, CONNECTOR_ARGS, {
            detached: false,
            // `env` replaces the inherited environment unless it is spread in.
            env: { ...process.env, TUNNEL_TOKEN: options.token },
            shell: false,
            stderr: "pipe",
            stdout: "pipe",
          }),
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
 * Keeps one cloudflared connector for the preview tunnel running until interrupted. It never
 * completes and never fails; problems surface through `onStatus` and the connector restarts with
 * backoff. The token reaches only the child's environment and is redacted from every message.
 */
export const runPreviewTunnel = (options: RunPreviewTunnelOptions) =>
  Effect.gen(function* () {
    const relayClient = yield* RelayClient.RelayClient;
    const redact = (text: string) =>
      options.token.length > 0 ? text.replaceAll(options.token, "<redacted>") : text;

    const resolveExecutable = Effect.gen(function* () {
      const resolved = yield* relayClient.resolve;
      if (resolved.status === "available") return resolved.executablePath;
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
      yield* Effect.logWarning("Preview tunnel connector stopped", { message: redact(message) });
      yield* options.onStatus({ state: "error", message: redact(message), metricsPort: null });
      if ((yield* Clock.currentTimeMillis) - startedAt >= RESTART_STABLE_UPTIME_MS) {
        restartDelayMillis = RESTART_BACKOFF_BASE_MS;
      }
      yield* Effect.sleep(Duration.millis(restartDelayMillis));
      restartDelayMillis = Math.min(restartDelayMillis * 2, RESTART_BACKOFF_MAX_MS);
    });

    return yield* Effect.forever(attempt);
  });
