import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Result from "effect/Result";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;
/**
 * Bounds `tailscale status` and `tailscale debug prefs`. Allows the 1.8-2.6 s
 * `tailscale status` has been measured at when T3 Code spawns it on Windows.
 * A CLI that never answers takes longer than this to fail, because the kill
 * that follows the timeout also takes time (`taskkill` on Windows).
 */
const TAILSCALE_STATUS_TIMEOUT = Duration.millis(3_500);
/**
 * How long a probe killed on timeout gets to exit after SIGTERM before its
 * process group is SIGKILLed. Without it the spawner never escalates, so a group
 * member that ignores SIGTERM outlives the call. Short because the timeout error
 * only surfaces once cleanup finishes, and a healthy `tailscale` exits at once.
 */
const TAILSCALE_KILL_GRACE = Duration.millis(500);
const TAILSCALE_SERVE_TIMEOUT = Duration.seconds(10);
const TAILSCALE_PROBE_TIMEOUT = Duration.millis(2_500);

/** Labels, not paths: the per-user bundle path would put the username in logs. */
const TailscaleExecutable = Schema.Literals([
  "tailscale",
  "tailscale.exe",
  "/Applications/Tailscale.app",
  "~/Applications/Tailscale.app",
]);
type TailscaleExecutable = typeof TailscaleExecutable.Type;

const TailscaleSubcommand = Schema.Literals(["status", "serve", "debug"]);
type TailscaleSubcommand = typeof TailscaleSubcommand.Type;

export interface TailscaleExecutableCandidate {
  readonly label: TailscaleExecutable;
  readonly path: string;
}

const MAC_APP_BUNDLE_CLI = "Applications/Tailscale.app/Contents/MacOS/Tailscale";

/**
 * A macOS GUI app inherits a PATH where the CLI symlink may be missing or in a
 * directory it cannot search (`spawn tailscale EACCES`), so the app bundle's
 * own CLI is the fallback there.
 */
const tailscaleExecutableCandidates = (
  platform: NodeJS.Platform,
  homeDirectory: string,
): ReadonlyArray<TailscaleExecutableCandidate> => {
  if (platform === "win32") return [{ label: "tailscale.exe", path: "tailscale.exe" }];
  const onPath = { label: "tailscale", path: "tailscale" } as const;
  if (platform !== "darwin") return [onPath];
  return [
    onPath,
    { label: "/Applications/Tailscale.app", path: `/${MAC_APP_BUNDLE_CLI}` },
    {
      label: "~/Applications/Tailscale.app",
      path: `${homeDirectory.replace(/\/+$/u, "")}/${MAC_APP_BUNDLE_CLI}`,
    },
  ];
};

const TailscaleCommandContext = {
  executable: TailscaleExecutable,
  subcommand: TailscaleSubcommand,
  argumentCount: Schema.Number,
};

/**
 * Failure kinds we can name without quoting the CLI. Anything unrecognized
 * becomes "unknown" rather than falling back to raw text — stderr can contain
 * auth keys (`tskey-…`) and node names, and these labels are logged.
 */
export const TailscaleStderrDiagnostic = Schema.Literals([
  "no-existing-handler",
  "not-logged-in",
  "permission-denied",
  "unknown",
]);
export type TailscaleStderrDiagnostic = typeof TailscaleStderrDiagnostic.Type;

const STDERR_DIAGNOSTIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, Exclude<TailscaleStderrDiagnostic, "unknown">]
> = [
  [/handler does not exist/i, "no-existing-handler"],
  [/not logged in|logged out|needs? login/i, "not-logged-in"],
  [/permission denied|access denied|must be root|operation not permitted/i, "permission-denied"],
];

const stderrDiagnosticOf = (stderr: string): TailscaleStderrDiagnostic | undefined => {
  if (stderr.trim().length === 0) {
    return undefined;
  }
  return STDERR_DIAGNOSTIC_PATTERNS.find(([pattern]) => pattern.test(stderr))?.[1] ?? "unknown";
};

export class TailscaleCommandSpawnError extends Schema.TaggedError<TailscaleCommandSpawnError>()(
  "TailscaleCommandSpawnError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to spawn tailscale ${this.subcommand}.`;
  }
}

class TailscaleCommandOutputError extends Schema.TaggedError<TailscaleCommandOutputError>()(
  "TailscaleCommandOutputError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read output from tailscale ${this.subcommand}.`;
  }
}

export class TailscaleCommandExitError extends Schema.TaggedError<TailscaleCommandExitError>()(
  "TailscaleCommandExitError",
  {
    ...TailscaleCommandContext,
    exitCode: Schema.Number,
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.Number,
    stderrDiagnostic: Schema.optional(TailscaleStderrDiagnostic),
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} exited with code ${this.exitCode}.`;
  }
}

export class TailscaleCommandTimeoutError extends Schema.TaggedError<TailscaleCommandTimeoutError>()(
  "TailscaleCommandTimeoutError",
  {
    ...TailscaleCommandContext,
    timeoutMs: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} timed out after ${this.timeoutMs}ms.`;
  }
}

const TailscaleLookupFailureCode = Schema.Literals(["ENOENT", "EACCES"]);

export class TailscaleCliUnavailableError extends Schema.TaggedError<TailscaleCliUnavailableError>()(
  "TailscaleCliUnavailableError",
  {
    subcommand: TailscaleSubcommand,
    attempts: Schema.Array(
      Schema.Struct({ executable: TailscaleExecutable, code: TailscaleLookupFailureCode }),
    ),
  },
) {
  override get message(): string {
    return "Could not run the Tailscale CLI. Install Tailscale, or put `tailscale` on PATH.";
  }
}

export type TailscaleCommandError =
  | TailscaleCliUnavailableError
  | TailscaleCommandSpawnError
  | TailscaleCommandOutputError
  | TailscaleCommandExitError
  | TailscaleCommandTimeoutError;

export class TailscaleStatusParseError extends Schema.TaggedError<TailscaleStatusParseError>()(
  "TailscaleStatusParseError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to decode tailscale status JSON.";
  }
}

const TailscaleStatusSelf = Schema.Struct({
  DNSName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
  CapMap: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  BackendState: Schema.optional(Schema.Unknown),
  Self: Schema.optional(TailscaleStatusSelf),
});

export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
  /**
   * `tailscale serve --https` needs the `https` capability, which the control
   * plane grants once the tailnet enables HTTPS certificates. `null` when the
   * CLI reports no capability map (older CLI), so callers still attempt serve.
   */
  readonly httpsServeEnabled: boolean | null;
  /** `null` when the CLI reports no backend state. */
  readonly loggedIn: boolean | null;
}

const LOGGED_OUT_BACKEND_STATES: ReadonlySet<string> = new Set(["NeedsLogin", "NeedsMachineAuth"]);

const collectStdout = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const collectStderr = collectStdout;

const decodeTailscaleStatusJson = Schema.decodeEffect(Schema.fromJsonString(TailscaleStatusJson));

function normalizeMagicDnsName(status: TailscaleStatusJson): string | null {
  const dnsName = status.Self?.DNSName;
  if (typeof dnsName !== "string") {
    return null;
  }

  const normalized = dnsName.trim().replace(/\.$/u, "");
  return normalized.length > 0 ? normalized : null;
}

export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [first, second, third, fourth] = parts.map((part) => Number.parseInt(part, 10));
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    [first, second, third, fourth].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return first === 100 && second >= 64 && second <= 127;
}

export const parseTailscaleStatus = (
  rawStatusJson: string,
): Effect.Effect<TailscaleStatus, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      const rawIps = parsed.Self?.TailscaleIPs;
      const tailnetIpv4Addresses: Array<string> = [];
      if (Array.isArray(rawIps)) {
        for (const address of rawIps) {
          if (typeof address === "string" && isTailscaleIpv4Address(address)) {
            tailnetIpv4Addresses.push(address);
          }
        }
      }

      const capMap = parsed.Self?.CapMap;
      return {
        magicDnsName: normalizeMagicDnsName(parsed),
        tailnetIpv4Addresses,
        httpsServeEnabled:
          typeof capMap === "object" && capMap !== null && !Array.isArray(capMap)
            ? Object.hasOwn(capMap, "https")
            : null,
        loggedIn:
          typeof parsed.BackendState === "string"
            ? !LOGGED_OUT_BACKEND_STATES.has(parsed.BackendState)
            : null,
      };
    }),
  );

const errnoCodeOf = (cause: unknown, depth = 0): string | undefined => {
  if (depth > 3 || typeof cause !== "object" || cause === null) return undefined;
  if ("code" in cause && typeof cause.code === "string") return cause.code;
  return "cause" in cause ? errnoCodeOf(cause.cause, depth + 1) : undefined;
};

const lookupFailureCodeOf = (cause: unknown): "ENOENT" | "EACCES" | undefined => {
  const code = errnoCodeOf(cause);
  return code === "ENOENT" || code === "EACCES" ? code : undefined;
};

/** Keyed by spawner so each runtime resolves once and tests never share a result. */
const resolvedExecutables = new WeakMap<object, TailscaleExecutableCandidate>();

const spawnTailscale = Effect.fnUntraced(function* (
  subcommand: TailscaleSubcommand,
  args: readonly string[],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const candidates = tailscaleExecutableCandidates(
    yield* HostProcess.Platform,
    yield* HostProcess.HomeDirectory,
  );
  const resolved = resolvedExecutables.get(spawner);
  const ordered = resolved
    ? [resolved, ...candidates.filter((candidate) => candidate.path !== resolved.path)]
    : candidates;
  const attempts: Array<{ executable: TailscaleExecutable; code: "ENOENT" | "EACCES" }> = [];
  for (const candidate of ordered) {
    const commandContext = {
      executable: candidate.label,
      subcommand,
      argumentCount: args.length,
    };
    const spawned = yield* spawner
      .spawn(ChildProcess.make(candidate.path, [...args], { forceKillAfter: TAILSCALE_KILL_GRACE }))
      .pipe(
        Effect.mapError((cause) => new TailscaleCommandSpawnError({ ...commandContext, cause })),
        // A non-directory entry on PATH makes node throw ENOTDIR synchronously,
        // which arrives as a defect that `mapError` would never see.
        Effect.catchDefect((cause) =>
          Effect.fail(new TailscaleCommandSpawnError({ ...commandContext, cause })),
        ),
        Effect.result,
      );
    if (Result.isSuccess(spawned)) {
      resolvedExecutables.set(spawner, candidate);
      return { child: spawned.success, commandContext };
    }
    const code = lookupFailureCodeOf(spawned.failure.cause);
    if (code === undefined) {
      return yield* spawned.failure;
    }
    attempts.push({ executable: candidate.label, code });
  }
  return yield* new TailscaleCliUnavailableError({ subcommand, attempts });
});

const runTailscale = Effect.fn("tailscale.runTailscale")(function* (
  subcommand: TailscaleSubcommand,
  args: readonly string[],
  timeout: Duration.Duration,
): Effect.fn.Return<string, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const commandContext = {
    executable: (
      resolvedExecutables.get(spawner) ?? tailscaleExecutableCandidates(platform, "")[0]!
    ).label,
    subcommand,
    argumentCount: args.length,
  };
  return yield* Effect.gen(function* () {
    const { child, commandContext } = yield* spawnTailscale(subcommand, args);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStdout(child.stdout),
        collectStderr(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
    );
    if (exitCode !== 0) {
      const stderrDiagnostic = stderrDiagnosticOf(stderr);
      return yield* new TailscaleCommandExitError({
        ...commandContext,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        ...(stderrDiagnostic !== undefined ? { stderrDiagnostic } : {}),
      });
    }
    return stdout;
  }).pipe(
    Effect.scoped,
    Effect.timeout(timeout),
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(
          new TailscaleCommandTimeoutError({
            ...commandContext,
            timeoutMs: Duration.toMillis(timeout),
            cause,
          }),
        ),
    }),
  );
});

const readTailscaleOutput = (subcommand: "status" | "debug", args: readonly string[]) =>
  runTailscale(subcommand, args, TAILSCALE_STATUS_TIMEOUT);

export const readTailscaleStatus = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscaleStatus),
);

const TailscaleExitNodeJson = Schema.Struct({
  ExitNodeStatus: Schema.optional(Schema.Struct({ Online: Schema.optional(Schema.Unknown) })),
  Peer: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        ExitNode: Schema.optional(Schema.Unknown),
        HostName: Schema.optional(Schema.Unknown),
        DNSName: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
});

const decodeTailscaleExitNodeJson = Schema.decodeEffect(
  Schema.fromJsonString(TailscaleExitNodeJson),
);

export interface TailscaleExitNode {
  readonly name: string | null;
  readonly online: boolean;
}

/**
 * `ExitNodeStatus` is present only while an exit node is in use, but it has no
 * name. The name comes from the peer marked `ExitNode: true`.
 */
export const parseTailscaleExitNode = (
  rawStatusJson: string,
): Effect.Effect<TailscaleExitNode | null, TailscaleStatusParseError> =>
  decodeTailscaleExitNodeJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      if (parsed.ExitNodeStatus === undefined) return null;
      const peer = Object.values(parsed.Peer ?? {}).find(
        (candidate) => candidate.ExitNode === true,
      );
      // The DNS label is the tailnet machine name; HostName is the OS name and ignores renames.
      const dnsLabel = typeof peer?.DNSName === "string" ? (peer.DNSName.split(".")[0] ?? "") : "";
      const hostName = typeof peer?.HostName === "string" ? peer.HostName.trim() : "";
      return {
        name: dnsLabel || hostName || null,
        online: parsed.ExitNodeStatus.Online === true,
      };
    }),
  );

export const readTailscaleExitNode = readTailscaleOutput("status", ["status", "--json"]).pipe(
  Effect.flatMap(parseTailscaleExitNode),
);

const TailscalePrefsJson = Schema.Struct({
  RunSSH: Schema.optional(Schema.Unknown),
  WantRunning: Schema.optional(Schema.Unknown),
});

const decodeTailscalePrefsJson = Schema.decodeEffect(Schema.fromJsonString(TailscalePrefsJson));

/**
 * `tailscale status --json` does not report this for the local node. `tailscale
 * down` clears WantRunning but keeps RunSSH, so check both.
 */
export const parseTailscaleSshEnabled = (
  rawPrefsJson: string,
): Effect.Effect<boolean, TailscaleStatusParseError> =>
  decodeTailscalePrefsJson(rawPrefsJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((prefs) => prefs.RunSSH === true && prefs.WantRunning !== false),
  );

export const readTailscaleSshEnabled = readTailscaleOutput("debug", ["debug", "prefs"]).pipe(
  Effect.flatMap(parseTailscaleSshEnabled),
);

export function buildTailscaleHttpsBaseUrl(input: {
  readonly magicDnsName: string;
  readonly servePort?: number;
}): string {
  const url = new URL(`https://${input.magicDnsName}`);
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  if (servePort !== DEFAULT_TAILSCALE_SERVE_PORT) {
    url.port = String(servePort);
  }
  url.pathname = "/";
  return url.toString();
}

const runTailscaleServeCommand = (args: readonly string[]) =>
  runTailscale("serve", args, TAILSCALE_SERVE_TIMEOUT).pipe(Effect.asVoid);

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> => {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  return runTailscaleServeCommand([
    "serve",
    "--bg",
    `--https=${servePort}`,
    `http://${localHost}:${input.localPort}`,
  ]);
};

/**
 * Removes only the `/` mount. Without `--set-path` the CLI deletes every mount
 * on the port, other apps' included, because its confirmation prompt defaults
 * to yes when there is no terminal.
 */
export const disableTailscaleServe = Effect.fn("tailscale.disableTailscaleServe")(function* (
  input: {
    readonly servePort?: number;
  } = {},
): Effect.fn.Return<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  return yield* runTailscaleServeCommand(["serve", `--https=${servePort}`, "--set-path=/", "off"]);
});

export const readTailscaleServeStatusJson = runTailscale(
  "serve",
  ["serve", "status", "--json"],
  TAILSCALE_STATUS_TIMEOUT,
);

const EnvironmentIdentityJson = Schema.Struct({ environmentId: Schema.String });

/** The environment a T3 server at `baseUrl` reports, or none when nothing answers as one. */
export const readEnvironmentIdentity = Effect.fn("tailscale.readEnvironmentIdentity")(
  function* (input: { readonly baseUrl: string; readonly timeout?: Duration.Input }) {
    const client = yield* HttpClient.HttpClient;
    const url = new URL("/.well-known/t3/environment", input.baseUrl);
    const identity = yield* client
      .execute(HttpClientRequest.get(url.toString()))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(EnvironmentIdentityJson)),
        Effect.timeoutOption(input.timeout ?? TAILSCALE_PROBE_TIMEOUT),
      );
    return Option.map(identity, (descriptor) => descriptor.environmentId);
  },
  Effect.orElseSucceed(() => Option.none<string>()),
);

/** Any HTTP server can answer 2xx; only a matching environment ID proves it is this one. */
export const probeTailscaleHttpsEndpoint = Effect.fn("tailscale.probeTailscaleHttpsEndpoint")(
  function* (input: {
    readonly baseUrl: string;
    readonly environmentId: string;
    readonly timeout?: Duration.Input;
  }) {
    const identity = yield* readEnvironmentIdentity(input);
    return Option.contains(identity, input.environmentId);
  },
);
