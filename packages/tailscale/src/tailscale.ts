import { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isLocalLoopbackHost, normalizeHostname } from "@t3tools/shared/hostClassification";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
// fork: tailnet-ownership
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

// fork: tailnet-ownership -- these candidates replace tailscaleCommandForPlatform
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
  // fork: tailnet-ownership
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
  "not-running",
  "permission-denied",
  "unknown",
]);
export type TailscaleStderrDiagnostic = typeof TailscaleStderrDiagnostic.Type;

const STDERR_DIAGNOSTIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, Exclude<TailscaleStderrDiagnostic, "unknown">]
> = [
  [/handler does not exist/i, "no-existing-handler"],
  [/not logged in|logged out|needs? login/i, "not-logged-in"],
  // Only answers that confirm no daemon; a dial can also fail for want of permission. Windows
  // reports a missing service as its pipe not being found, without the usual prefix.
  [
    /doesn't appear to be running|tailscaled\.service not running|tailscale is stopped|tailscaled: the system cannot find the file specified|failed to connect to local tailscale[\s\S]*(connection refused|no such file or directory|cannot find the file)/i,
    "not-running",
  ],
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

// fork: tailnet-ownership
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
  | TailscaleCliUnavailableError // fork: tailnet-ownership
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
  BackendState: Schema.optional(Schema.Unknown), // fork: tailnet-ownership
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
  // fork: tailnet-ownership
  /** `null` when the CLI reports no backend state. */
  readonly loggedIn: boolean | null;
}

// fork: tailnet-ownership
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
        // fork: tailnet-ownership
        loggedIn:
          typeof parsed.BackendState === "string"
            ? !LOGGED_OUT_BACKEND_STATES.has(parsed.BackendState)
            : null,
      };
    }),
  );

// fork: tailnet-ownership -- spawnTailscale and runTailscale replace readTailscaleOutput
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

// fork: tailnet-ownership: untraced because runTailscale owns the span.
const spawnTailscale = Effect.fnUntraced(function* (
  subcommand: TailscaleSubcommand,
  args: readonly string[],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // fork: tailnet-ownership
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

// fork: tailnet-ownership
const runTailscale = Effect.fn("tailscale.runTailscale")(function* (
  subcommand: TailscaleSubcommand,
  args: readonly string[],
  timeout: Duration.Duration,
): Effect.fn.Return<string, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const commandContext = {
    // fork: tailnet-ownership
    executable: (
      resolvedExecutables.get(spawner) ?? tailscaleExecutableCandidates(platform, "")[0]!
    ).label,
    subcommand,
    argumentCount: args.length,
  };
  // fork: tailnet-ownership -- spawnTailscale makes the command for each CLI candidate
  return yield* Effect.gen(function* () {
    // fork: tailnet-ownership
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
      const stderrDiagnostic = stderrDiagnosticOf(stderr); // fork: tailnet-ownership
      return yield* new TailscaleCommandExitError({
        ...commandContext,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        // fork: tailnet-ownership
        ...(stderrDiagnostic !== undefined ? { stderrDiagnostic } : {}),
      });
    }
    return stdout;
  }).pipe(
    Effect.scoped,
    Effect.timeout(timeout), // fork: tailnet-ownership
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(
          new TailscaleCommandTimeoutError({
            ...commandContext,
            timeoutMs: Duration.toMillis(timeout), // fork: tailnet-ownership
            cause,
          }),
        ),
    }),
  );
});

// fork: tailnet-ownership
const readTailscaleOutput = (subcommand: "status" | "serve" | "debug", args: readonly string[]) =>
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

// fork: tailnet-ownership -- runTailscale above replaces runTailscaleCommand
const runTailscaleServeCommand = (args: readonly string[]) =>
  runTailscale("serve", args, TAILSCALE_SERVE_TIMEOUT).pipe(Effect.asVoid);

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> => {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  // fork: tailnet-ownership
  return runTailscaleServeCommand([
    "serve",
    "--bg",
    `--https=${servePort}`,
    `http://${localHost}:${input.localPort}`,
  ]);
};

/** A Serve route: a web handler at `mount` on `servePort`, or a TCP forward without one. */
export interface TailscaleServeRoute {
  readonly servePort: number;
  readonly mount?: string;
  /** The machine name a web route serves under. */
  readonly host?: string;
  /** A target, such as a name, that may dial this server or another service on the same port. */
  readonly ambiguous?: string;
  /** The Tailscale Service it belongs to, or `foreground` for a `tailscale serve` still running. */
  readonly owner?: string;
}

/**
 * The `tailscale` arguments that turn `route` off; a foreground route has none, since it ends with
 * its command. A web route names its path: without one the CLI removes every handler on the port,
 * and answers its own confirmation prompt with yes when nobody is there to answer.
 */
export const tailscaleServeOffArgs = (
  route: TailscaleServeRoute,
): ReadonlyArray<string> | undefined =>
  route.owner === "foreground"
    ? undefined
    : [
        "serve",
        ...(route.owner === undefined ? [] : [`--service=${route.owner}`]),
        ...(route.mount === undefined
          ? [`--tcp=${route.servePort}`]
          : [`--https=${route.servePort}`, `--set-path=${route.mount}`]),
        "off",
      ];

/** Removes the web handler at `mount` on `servePort`, the root one `ensureTailscaleServe` adds by default. */
export const disableTailscaleServe = Effect.fn("tailscale.disableTailscaleServe")(function* (
  input: {
    readonly servePort?: number;
    readonly mount?: string;
  } = {},
): Effect.fn.Return<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> {
  // fork: tailnet-ownership
  return yield* runTailscaleServeCommand(
    tailscaleServeOffArgs({
      servePort: input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT,
      mount: input.mount ?? "/",
    })!,
  );
});

/** Removes a TCP forward on `servePort`; one port holds one forward, so nothing else goes. */
export const disableTailscaleServeTcp = (servePort: number) =>
  runTailscaleServeCommand(tailscaleServeOffArgs({ servePort })!); // fork: tailnet-ownership

const TailscaleServeConfigJson = Schema.Struct({
  TCP: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ TCPForward: Schema.optional(Schema.String) })),
  ),
  Web: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        Handlers: Schema.optional(
          Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.optional(Schema.String) })),
        ),
      }),
    ),
  ),
});
const TailscaleServeStatusJson = Schema.Struct({
  ...TailscaleServeConfigJson.fields,
  // A Tailscale Service's routes, and those of each `tailscale serve` still running in the foreground.
  Services: Schema.optional(Schema.Record(Schema.String, TailscaleServeConfigJson)),
  Foreground: Schema.optional(Schema.Record(Schema.String, TailscaleServeConfigJson)),
});
// A node without any Serve configuration prints `null`.
const decodeTailscaleServeStatusJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.NullOr(TailscaleServeStatusJson)),
);

/**
 * Whether a proxy to `hostname` dials `bindHost`. `0.0.0.0` reaches 127.0.0.1. `[::]` may reach
 * either loopback, since Go dials `::` and then 0.0.0.0 (golang/go#18806), and a name such as
 * `localhost` may resolve to whatever the server binds.
 */
const reaches = (hostname: string, bindHost: string): "exact" | "either" | undefined => {
  let address = normalizeHostname(hostname);
  // Compare IPv6 by value: 0:0:0:0:0:ffff:7f00:1 is ::ffff:7f00:1.
  if (address.includes(":") && URL.canParse(`http://[${address}]`)) {
    address = normalizeHostname(new URL(`http://[${address}]`).hostname);
  }
  // An IPv4-mapped address can be written as hex, such as ::ffff:7f00:1 for 127.0.0.1.
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u.exec(address);
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    address = [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
  } else if (address.startsWith("::ffff:")) {
    address = address.slice("::ffff:".length);
  }
  // Strict, as Go's ParseIP is; anything else, such as `127.1` or `box.1`, goes to the resolver.
  const literal =
    address.includes(":") ||
    /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?!$)|$)){4}$/u.test(address);
  if (!literal) return "either";
  if (address === "::")
    return bindHost === "127.0.0.1" || bindHost === "::1" ? "either" : undefined;
  return (address === "0.0.0.0" ? "127.0.0.1" : address) === bindHost ? "exact" : undefined;
};

/** The URL Tailscale's proxy dials for a handler's `Proxy`, expanded as its `expandProxyArg` does. */
const expandProxy = (proxy: string) =>
  /^\d+$/u.test(proxy)
    ? `http://127.0.0.1:${proxy}`
    : proxy.startsWith("https+insecure://")
      ? `https://${proxy.slice("https+insecure://".length)}`
      : /^(?:https?:\/\/|unix:)/u.test(proxy)
        ? proxy
        : `http://${proxy}`;

/**
 * The host and port a proxy target dials, read as Go's url.Parse reads it rather than as a WHATWG
 * URL, which rejects `box.1` and rewrites `127.1`; none for a Unix socket.
 */
const dialedHostPort = (url: string) => {
  const match = /^(https?|tcp):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/?#:]*)(?::(\d*))?/iu.exec(url);
  if (match === null) return undefined;
  const [, scheme = "", host = "", port] = match;
  return { host, port: port || (scheme.toLowerCase() === "https" ? "443" : "80") };
};

const reachesTarget = (url: string, target: { readonly host: string; readonly port: number }) => {
  const dialed = dialedHostPort(url);
  // Go reads the port as a decimal number, so 03773 is 3773.
  if (dialed === undefined || Number(dialed.port) !== target.port) return undefined;
  const reach = reaches(dialed.host, target.host);
  return reach === undefined ? undefined : { reach, hostname: dialed.host };
};

/**
 * The Serve routes that forward to the server bound at `target`, or undefined when the status
 * cannot be read.
 */
export const parseTailscaleServeRoutesTo = (
  rawServeStatusJson: string,
  target: { readonly host: string; readonly port: number },
): ReadonlyArray<TailscaleServeRoute> | undefined => {
  const status = decodeTailscaleServeStatusJson(rawServeStatusJson);
  if (Option.isNone(status)) return undefined;
  const routesIn = (
    config: typeof TailscaleServeConfigJson.Type | undefined,
    owner?: string,
  ): ReadonlyArray<TailscaleServeRoute> => {
    const scope = owner === undefined ? {} : { owner };
    const reached = (url: string) => {
      const found = reachesTarget(url, target);
      if (found === undefined) return undefined;
      return found.reach === "either" ? { ambiguous: found.hostname } : {};
    };
    const tcp = Object.entries(config?.TCP ?? {}).flatMap(([port, handler]) => {
      const reach =
        handler.TCPForward === undefined || handler.TCPForward.startsWith("unix:")
          ? undefined
          : reached(`tcp://${handler.TCPForward}`);
      return reach !== undefined && Number.isInteger(Number(port))
        ? [{ servePort: Number(port), ...reach, ...scope }]
        : [];
    });
    const web = Object.entries(config?.Web ?? {}).flatMap(([hostPort, site]) => {
      const separator = hostPort.lastIndexOf(":");
      const servePort = Number(hostPort.slice(separator + 1));
      if (!Number.isInteger(servePort)) return [];
      const host = hostPort.slice(0, separator);
      return Object.entries(site.Handlers ?? {}).flatMap(([mount, handler]) => {
        const reach = handler.Proxy === undefined ? undefined : reached(expandProxy(handler.Proxy));
        return reach === undefined ? [] : [{ servePort, mount, host, ...reach, ...scope }];
      });
    });
    return [...tcp, ...web];
  };
  return [
    ...routesIn(status.value ?? undefined),
    ...Object.entries(status.value?.Services ?? {}).flatMap(([name, service]) =>
      routesIn(service, name),
    ),
    ...Object.values(status.value?.Foreground ?? {}).flatMap((session) =>
      routesIn(session, "foreground"),
    ),
  ];
};

/** The Serve routes that forward to the server bound at `target` on this machine. */
export const readTailscaleServeRoutesTo = (target: {
  readonly host: string;
  readonly port: number;
}) =>
  readTailscaleOutput("serve", ["serve", "status", "--json"]).pipe(
    Effect.flatMap((status) => {
      const routes = parseTailscaleServeRoutesTo(status, target);
      return routes === undefined
        ? Effect.fail(new TailscaleStatusParseError({ cause: "unreadable serve status" }))
        : Effect.succeed(routes);
    }),
  );

/** A handler at the root of a Serve port: this server's, or another with the loopback port it dials. */
export type TailscaleServeRootHolder =
  | { readonly ours: true }
  | { readonly ours: false; readonly loopback?: { readonly host: string; readonly port: number } };

/**
 * What answers at the root of `servePort` outside any Tailscale Service, where
 * `ensureTailscaleServe` publishes, or undefined when the status cannot be read.
 */
export const parseTailscaleServeRootHolders = (
  rawServeStatusJson: string,
  servePort: number,
  target: { readonly host: string; readonly port: number },
): ReadonlyArray<TailscaleServeRootHolder> | undefined => {
  const status = decodeTailscaleServeStatusJson(rawServeStatusJson);
  if (Option.isNone(status)) return undefined;
  const config = status.value ?? undefined;
  const tcp: ReadonlyArray<TailscaleServeRootHolder> =
    config?.TCP?.[String(servePort)]?.TCPForward === undefined ? [] : [{ ours: false }];
  const web = Object.entries(config?.Web ?? {}).flatMap(
    ([hostPort, site]): ReadonlyArray<TailscaleServeRootHolder> => {
      const root = site.Handlers?.["/"];
      if (Number(hostPort.slice(hostPort.lastIndexOf(":") + 1)) !== servePort || root === undefined)
        return [];
      if (root.Proxy === undefined) return [{ ours: false }];
      const url = expandProxy(root.Proxy);
      if (reachesTarget(url, target) !== undefined) return [{ ours: true }];
      const dialed = dialedHostPort(url);
      return [
        dialed !== undefined && isLocalLoopbackHost(dialed.host)
          ? {
              ours: false,
              loopback: { host: normalizeHostname(dialed.host), port: Number(dialed.port) },
            }
          : { ours: false },
      ];
    },
  );
  return [...tcp, ...web];
};

export const readTailscaleServeRootHolders = (
  servePort: number,
  target: { readonly host: string; readonly port: number },
) =>
  readTailscaleOutput("serve", ["serve", "status", "--json"]).pipe(
    Effect.flatMap((status) => {
      const holders = parseTailscaleServeRootHolders(status, servePort, target);
      return holders === undefined
        ? Effect.fail(new TailscaleStatusParseError({ cause: "unreadable serve status" }))
        : Effect.succeed(holders);
    }),
  );

// fork: tailnet-ownership
export const readTailscaleServeStatusJson = runTailscale(
  "serve",
  ["serve", "status", "--json"],
  TAILSCALE_STATUS_TIMEOUT,
);

const EnvironmentIdentityJson = Schema.Struct({
  environmentId: ExecutionEnvironmentDescriptor.fields.environmentId,
});

/** The environment a T3 server at `baseUrl` reports, or none when nothing answers as one. */
export const readEnvironmentIdentity = Effect.fn("tailscale.readEnvironmentIdentity")(
  function* (input: { readonly baseUrl: string; readonly timeout?: Duration.Input }) {
    const client = yield* HttpClient.HttpClient;
    // fork: tailnet-ownership
    const url = new URL("/.well-known/t3/environment", input.baseUrl);
    const identity = yield* client
      .execute(HttpClientRequest.get(url.toString()))
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(EnvironmentIdentityJson)),
        Effect.timeoutOption(input.timeout ?? TAILSCALE_PROBE_TIMEOUT),
      );
    return Option.map(identity, (descriptor): string => descriptor.environmentId);
  },
  Effect.orElseSucceed(() => Option.none<string>()),
);

// fork: tailnet-ownership
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
  // fork: tailnet-ownership -- readEnvironmentIdentity above already falls back to none
);
