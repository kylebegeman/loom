import { NonNegativeInt } from "@t3tools/contracts";
import {
  type ReachBlocked,
  ReachError,
  ReachPrepared,
  type ReachStatus,
  type ReachWarning,
} from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type * as RelayClient from "@t3tools/shared/relayClient";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as FiberHandle from "effect/FiberHandle";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import {
  identityConfigured,
  identityResource,
  passkeyRequired,
} from "../../auth/identityPolicy.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { forkParked } from "../../serverActivation.ts";
import { loopbackUrlHostForAddress } from "../../startupAccess.ts";
import type { CloudflaredStatus, RunCloudflaredOptions } from "../cloudflared/connector.ts";
import { ForkRuntime } from "../ForkRuntime.ts";
import { resolveLibraryConnection } from "../project-library/LibraryConnection.ts";
import { withoutParentSpan } from "../tracing/withoutParentSpan.ts";
import {
  makeReachLibraryClient,
  type ReachLibraryClient,
  type ReachLibraryFailure,
  type ReachLibraryOutcome,
} from "./libraryClient.ts";
import { ReachPublicRoute } from "./publicRoute.ts";
import { runReachTunnel } from "./tunnel.ts";

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
/** A refused sign-in or key changes only on the Library's side, so it is asked again this rarely. */
const STOPPED_RETRY_MS = 15 * 60_000;

const MESSAGES = {
  unreachable: "Your Library could not be reached. Loom keeps trying.",
  signedOut:
    "Your Library refused this computer's sign-in. Sign it in to its Library again, then restart Loom.",
  keyChanged:
    "Your Library knows this computer by a different key. Retire this computer's reach address in the Library to start over.",
  notInDirectory: "Waiting for this computer to appear in your Library's directory.",
  limited: "Your Library is busy. Loom tries again shortly.",
  setup: "Your Library could not set up this address. Loom keeps trying.",
  unverified: "Your Library could not verify this computer's request. Loom keeps trying.",
  invalid: "Your Library sent an answer this computer cannot use. Loom keeps trying.",
  storage: "This computer could not save its reach settings. Loom keeps trying.",
  noOrigin:
    "Reach needs Loom's server to listen on 127.0.0.1, ::1 or every address on this computer.",
  // The Library sign-in is read once at start, so a new one needs a restart to take effect.
  removeSignedOut:
    "Sign this computer in to its Library again, then restart Loom to finish removing reach.",
  removeOutdated: "Update Loom on your Library to finish removing reach.",
  removeNotReady: "Your Library is not set up for reach, so it cannot remove this address yet.",
  retired:
    "Your Library retired this computer's address, or another copy of this computer took it over. Turn reach on to get an address again.",
} as const;

/**
 * The computer's reach record. It never holds the connector token: every ensure returns a fresh
 * one, which lives in memory and in a token file only while its connector runs.
 */
const Sidecar = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  removing: Schema.Boolean,
  hostname: Schema.NullOr(Schema.String),
  /** The last request `seq` signed, so a restart never repeats one. */
  lastSeq: NonNegativeInt,
  prepared: Schema.NullOr(ReachPrepared),
  /**
   * Set when the edge refused the connector token for good, until reach is turned on, off or
   * forgotten. Optional so an older Loom still reads the record.
   */
  retired: Schema.optionalKey(Schema.Literal(true)),
});
type Sidecar = typeof Sidecar.Type;
const sidecarJson = Schema.fromJsonString(Sidecar);
const OFF: Sidecar = {
  version: 1,
  enabled: false,
  removing: false,
  hostname: null,
  lastSeq: 0,
  prepared: null,
};
/** Every change a person makes ends a retirement's notice. */
const withoutRetired = ({ retired: _retired, ...rest }: Sidecar): Sidecar => rest;

type LearnedBlock = Extract<ReachBlocked, "library-not-ready" | "library-outdated" | "is-library">;

export interface ReachGuardState {
  /** Lowercase, or null while the Library has assigned none. */
  readonly hostname: string | null;
  /** True only while this run's connector exists; the guard answers 404 for the host otherwise. */
  readonly serving: boolean;
}

export class ReachService extends Context.Service<
  ReachService,
  {
    readonly status: Effect.Effect<ReachStatus>;
    readonly changes: Stream.Stream<ReachStatus>;
    /** Answers once the intent is stored; provisioning continues and `changes` shows it. */
    readonly setEnabled: (enabled: boolean) => Effect.Effect<ReachStatus, ReachError>;
    /** Answers once removal is stored; it finishes in the background and resumes after a restart. */
    readonly remove: () => Effect.Effect<ReachStatus, ReachError>;
    /**
     * Clears reach on this computer without its Library, ending any removal in progress. The
     * Library keeps the tunnel and address until they are retired there.
     */
    readonly forget: () => Effect.Effect<ReachStatus, ReachError>;
    readonly guardState: () => ReachGuardState;
    /** cloudflared metrics ports, including connectors still shutting down. */
    readonly ownPorts: () => ReadonlyArray<number>;
  }
>()("t3/fork/reach/ReachService") {}

export interface ReachServiceDependencies {
  /** Keeps one connector running until interrupted, as `runReachTunnel` does. */
  readonly runTunnel: (options: RunCloudflaredOptions) => Effect.Effect<never>;
  /** This server's bound loopback origin, or null when it does not listen on one. */
  readonly ingressOrigin: Effect.Effect<string | null>;
}

/**
 * The origin the Library points the tunnel at: the forms the shared ingress check accepts. Null
 * unless the server listens there, on a wildcard or that exact loopback address. A server bound to
 * one LAN or tailnet address does not, and whatever else listens on that loopback port must never
 * be published.
 */
export const reachIngressOrigin = (address: NetAddress.SocketAddress): string | null => {
  if (!("port" in address)) return null;
  const ip = address.address;
  const onLoopbackHost =
    NetAddress.isUnspecified(ip) ||
    Equal.equals(ip, NetAddress.ipv4Loopback) ||
    Equal.equals(ip, NetAddress.ipv6Loopback);
  return onLoopbackHost ? `http://${loopbackUrlHostForAddress(address)}:${address.port}` : null;
};

const backoff = (failures: number) =>
  Math.min(RETRY_BASE_MS * 2 ** Math.max(failures - 1, 0), RETRY_MAX_MS);

interface Retry {
  readonly message: string;
  readonly warning: ReachWarning | null;
  readonly delayMs: number;
}

/** How a failed ensure or remove is shown and when it is tried again. */
const retryFor = (outcome: ReachLibraryFailure, failures: number): Retry => {
  const later = (message: string, warning: ReachWarning | null = null): Retry => ({
    message,
    warning,
    delayMs: backoff(failures),
  });
  switch (outcome.kind) {
    case "io":
      return later(MESSAGES.unreachable, "library-unreachable");
    case "signed-out":
      return {
        message: MESSAGES.signedOut,
        warning: "library-signed-out",
        delayMs: STOPPED_RETRY_MS,
      };
    case "storage":
      return later(MESSAGES.storage);
    case "invalid":
      return later(MESSAGES.invalid);
    case "outdated":
      return { message: MESSAGES.removeOutdated, warning: null, delayMs: STOPPED_RETRY_MS };
    case "refused":
      switch (outcome.reason) {
        case "key-changed":
          return { message: MESSAGES.keyChanged, warning: null, delayMs: STOPPED_RETRY_MS };
        case "not-configured":
        case "not-authority":
        case "is-library":
          return { message: MESSAGES.removeNotReady, warning: null, delayMs: STOPPED_RETRY_MS };
        case "not-in-directory":
          return later(MESSAGES.notInDirectory);
        case "too-many-requests":
        case "cloudflare-limited":
          return {
            message: MESSAGES.limited,
            warning: null,
            delayMs: Math.max(backoff(failures), (outcome.retryAfterSeconds ?? 0) * 1000),
          };
        case "unverified":
        case "wrong-environment":
        case "stale-request":
        case "invalid":
        case "too-large":
          return later(MESSAGES.unverified);
        case "edge-failed":
        case "cloudflare-denied":
        case "cloudflare-unavailable":
        case "hostname-unavailable":
        case "tunnel-busy":
        case "io":
          return later(MESSAGES.setup);
      }
  }
};

/** Answers that will not change by asking again soon. An ensure stops on them. */
const learnedFrom = (outcome: ReachLibraryOutcome<unknown>): LearnedBlock | null => {
  if (outcome.kind === "outdated") return "library-outdated";
  if (outcome.kind !== "refused") return null;
  if (outcome.reason === "not-configured" || outcome.reason === "not-authority") {
    return "library-not-ready";
  }
  return outcome.reason === "is-library" ? "is-library" : null;
};

interface ConnectorRuntime {
  readonly scope: Scope.Closeable;
  /** Completes once the child and its token file are gone. */
  readonly stopped: Deferred.Deferred<void>;
  status: CloudflaredStatus;
}

export const makeReachService = Effect.fn("ReachService.make")(function* (
  dependencies: ReachServiceDependencies,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const route = yield* ReachPublicRoute;
  const environment = yield* HostProcess.Environment;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const rootScope = yield* Effect.scope;
  // Read once, as the directory reporter does: a new Library sign-in needs a restart.
  const connection = yield* resolveLibraryConnection.pipe(
    Effect.orElseSucceed(() => ({ kind: "unavailable" }) as const),
  );

  const directory = path.join(config.stateDir, "fork", "reach");
  const sidecarPath = path.join(directory, "state.json");
  const tokenFile = path.join(directory, "connector-token");

  let saved: Sidecar = yield* fs.readFileString(sidecarPath).pipe(
    Effect.flatMap(Schema.decodeEffect(sidecarJson)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(OFF)),
    // No cause: a decode issue would print the file.
    Effect.catch(() =>
      Effect.logWarning("Ignoring unreadable reach state; reach starts off", {
        path: sidecarPath,
      }).pipe(Effect.as(OFF)),
    ),
  );
  // A hard crash leaves the last connector's token file behind, and that token works until the
  // next ensure rotates it. No connector of this run has used the file yet.
  yield* fs
    .remove(tokenFile, { force: true })
    .pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not remove a leftover reach connector token file", { cause }),
      ),
    );

  const writeLock = yield* Semaphore.make(1);
  /** Applies `update` to the latest record, so a saved `seq` and a mutation never undo each other. */
  const persist = (update: (current: Sidecar) => Sidecar) =>
    writeLock.withPermit(
      Effect.suspend(() => {
        const next = update(saved);
        return Schema.encodeEffect(sidecarJson)(next).pipe(
          Effect.flatMap((contents) =>
            writeFileStringAtomically({ filePath: sidecarPath, contents: `${contents}\n` }),
          ),
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.tapError((cause) =>
            Effect.logWarning("Could not save reach state", { path: sidecarPath, cause }),
          ),
          Effect.mapError(() => new ReachError({ reason: "storage" })),
          Effect.andThen(
            Effect.sync(() => {
              saved = next;
            }),
          ),
        );
      }),
    );
  /**
   * For steps that must hold for this run even when the disk refuses them, such as off. The next
   * save that works writes them too.
   */
  const persistOrRemember = (update: (current: Sidecar) => Sidecar) =>
    persist(update).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          saved = update(saved);
        }),
      ),
      Effect.result,
    );

  const connectionBlock: ReachBlocked | null =
    connection.kind === "none"
      ? "no-library"
      : connection.kind === "authority"
        ? "is-library"
        : connection.kind === "unavailable"
          ? "library-signed-out"
          : null;
  let learned: LearnedBlock | null = null;
  let failure: { readonly message: string; readonly warning: ReachWarning | null } | null = null;
  let connector: ConnectorRuntime | null = null;
  const runtimes = new Set<ConnectorRuntime>();
  const lock = yield* Semaphore.make(1);
  const provisioning = yield* FiberHandle.make<void, never>();

  const identityWarnings = (prepared: Sidecar["prepared"]): Array<ReachWarning> => {
    if (!identityConfigured(environment)) return ["identity-off"];
    const warnings: Array<ReachWarning> = [];
    if (prepared !== null && identityResource(environment) !== prepared.resource) {
      warnings.push("identity-resource-differs");
    }
    if (!passkeyRequired(environment)) warnings.push("passkey-not-required");
    return warnings;
  };

  const view = (): ReachStatus => {
    const blocked = connectionBlock ?? learned;
    const warnings = new Set<ReachWarning>();
    if (connection.kind === "unavailable") warnings.add("library-signed-out");
    if (failure?.warning) warnings.add(failure.warning);
    if (saved.retired) warnings.add("retired");
    if (saved.enabled)
      for (const warning of identityWarnings(saved.prepared)) warnings.add(warning);
    const base = {
      enabled: saved.enabled,
      blocked,
      url: saved.hostname === null ? null : `https://${saved.hostname}/`,
      warnings: [...warnings],
      prepared: saved.prepared,
    };
    if (saved.removing) return { ...base, state: "removing", message: failure?.message ?? null };
    // While a fresh ensure fails, its reason says more than the down connector's last line.
    if (connector !== null && (connector.status.state !== "error" || failure === null)) {
      const { state, message } = connector.status;
      return { ...base, state, message: state === "connected" ? null : message };
    }
    if (blocked !== null) return { ...base, state: "unavailable", message: null };
    if (!saved.enabled) {
      return { ...base, state: "off", message: saved.retired ? MESSAGES.retired : null };
    }
    if (failure !== null) return { ...base, state: "error", message: failure.message };
    return { ...base, state: "provisioning", message: null };
  };

  let published = view();
  const state = yield* SubscriptionRef.make(published);
  const publishLock = yield* Semaphore.make(1);
  const publish = publishLock.withPermit(
    Effect.suspend(() => {
      const next = view();
      if (Equal.equals(next, published)) return Effect.void;
      published = next;
      return SubscriptionRef.set(state, next);
    }),
  );

  const client: ReachLibraryClient | null =
    connection.kind === "remote"
      ? makeReachLibraryClient({
          library: connection,
          environmentId,
          secrets,
          lastSeq: () => saved.lastSeq,
          saveSeq: (seq) =>
            persist((current) => ({ ...current, lastSeq: Math.max(current.lastSeq, seq) })),
        })
      : null;

  const stopConnector = Effect.suspend(() => {
    const runtime = connector;
    if (runtime === null) return Effect.void;
    connector = null;
    // Closed in the background: the answer to "off" still leaves through this connector, which
    // drains open requests before it exits.
    return Ref.set(route.url, Option.none()).pipe(
      Effect.andThen(
        Effect.forkIn(
          Scope.close(runtime.scope, Exit.void).pipe(
            Effect.ensuring(
              Effect.suspend(() => {
                runtimes.delete(runtime);
                return Deferred.succeed(runtime.stopped, undefined);
              }),
            ),
          ),
          rootScope,
        ),
      ),
      Effect.asVoid,
    );
  });

  /** Every connector this run started is gone, its token file with it. */
  const connectorsStopped = Effect.suspend(() =>
    Effect.forEach([...runtimes], (runtime) => Deferred.await(runtime.stopped), {
      discard: true,
    }),
  );

  /**
   * Only this computer's own ensure rotates its tunnel token, and it replaces the connector when
   * it does. So a token the edge refuses for good means the Library retired the address or another
   * copy of this computer took it over. Ensuring again would undo a Retire, so reach turns off,
   * across restarts too, until a person turns it on.
   */
  const retireConnector = Effect.fn("ReachService.retire")(
    function* (runtime: ConnectorRuntime) {
      // A newer ensure, started while this connector was down, replaces it anyway.
      if (connector !== runtime || Option.isSome(FiberHandle.getUnsafe(provisioning))) return;
      yield* persistOrRemember((current) => ({
        ...current,
        enabled: false,
        hostname: null,
        retired: true,
      }));
      failure = null;
      learned = null;
      yield* stopConnector;
      yield* publish;
    },
    Effect.uninterruptible,
    lock.withPermit,
  );

  const startConnector = Effect.fn("ReachService.startConnector")(function* (
    token: string,
    url: string,
  ) {
    const scope = yield* Scope.fork(rootScope, "sequential");
    const runtime: ConnectorRuntime = {
      scope,
      stopped: yield* Deferred.make<void>(),
      status: { state: "starting", message: null, metricsPort: null },
    };
    // Captured before this runtime joins the set, so it waits only for older connectors, which
    // share the token file path.
    const older = [...runtimes];
    connector = runtime;
    runtimes.add(runtime);
    // A connector orphaned by a hard crash of an earlier server keeps forwarding with its token
    // until an ensure rotates the tunnel secret and clears its connections, as this one just did,
    // or until Remove. Nothing here looks for it by process name: preview links run cloudflared too.
    yield* forkParked(
      Effect.forEach(older, (previous) => Deferred.await(previous.stopped), {
        discard: true,
      }).pipe(
        Effect.andThen(
          dependencies.runTunnel({
            token,
            tokenFile,
            onStatus: (status) =>
              Effect.suspend(() => {
                runtime.status = status;
                return connector === runtime ? publish : Effect.void;
              }),
            onTokenRefused: retireConnector(runtime),
          }),
        ),
      ),
    ).pipe(Scope.provide(scope));
    yield* Ref.set(route.url, Option.some(url));
  });

  /** One ensure and its result. Returns when to try again, or null when done. */
  const ensureOnce = Effect.fn("ReachService.ensure")(function* (
    library: ReachLibraryClient,
    tentative: boolean,
    failures: number,
  ) {
    const origin = yield* dependencies.ingressOrigin;
    if (origin === null) {
      failure = { message: MESSAGES.noOrigin, warning: null };
      yield* publish;
      return null;
    }
    const outcome = yield* library.ensure(origin);
    // Off and remove hold the permit while they interrupt this fiber, so a slow ensure can never
    // start a connector after them.
    return yield* lock.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (outcome.kind === "ok") {
            const { reply } = outcome;
            const hostname = reply.hostname.toLowerCase();
            const { identity } = reply;
            yield* persistOrRemember((current) => ({
              ...current,
              hostname,
              prepared:
                identity.state === "ready"
                  ? {
                      issuer: identity.issuer,
                      resource: identity.resource,
                      nativeClientId: identity.nativeClientId,
                    }
                  : current.prepared,
            }));
            learned = null;
            failure = null;
            yield* stopConnector;
            yield* startConnector(reply.connectorToken, `https://${hostname}/`);
            yield* publish;
            return null;
          }
          const block = learnedFrom(outcome);
          if (block !== null) {
            // A refusal right after turning reach on means it cannot be on. At start the intent
            // stays, and turning reach on again asks the Library again. Stored before the block
            // shows, so no status reads blocked yet still on.
            if (tentative) yield* persistOrRemember((current) => ({ ...current, enabled: false }));
            learned = block;
            failure = null;
            // Turning reach on again while its connector was down asks first, so that connector
            // still runs here. It must not outlive an intent the Library just refused.
            yield* stopConnector;
            yield* publish;
            return null;
          }
          const retry = retryFor(outcome, failures);
          if (failure === null) {
            yield* Effect.logWarning("Reach could not be set up through the Library. Retrying.", {
              outcome: outcome.kind,
              ...(outcome.kind === "refused" ? { reason: outcome.reason } : {}),
            });
          }
          failure = { message: retry.message, warning: retry.warning };
          yield* publish;
          return retry.delayMs;
        }),
      ),
    );
  });

  // Untraced: this loop can wait for hours, and each attempt already has its own span.
  const provision = Effect.fnUntraced(function* (library: ReachLibraryClient, tentative: boolean) {
    for (let failures = 1; ; failures += 1) {
      const delayMs = yield* ensureOnce(library, tentative, failures);
      if (delayMs === null) return;
      yield* Effect.sleep(Duration.millis(delayMs));
    }
  });

  const removeOnce = Effect.fn("ReachService.finishRemoval")(function* (
    library: ReachLibraryClient,
    failures: number,
  ) {
    const outcome = yield* library.remove();
    return yield* lock.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (outcome.kind === "ok") {
            // A record left marked removing resumes after a restart, and the Library answers a
            // second remove the same way.
            yield* persistOrRemember((current) => ({ ...OFF, lastSeq: current.lastSeq }));
            failure = null;
            learned = null;
            yield* publish;
            return null;
          }
          const retry: Retry =
            outcome.kind === "signed-out"
              ? {
                  message: MESSAGES.removeSignedOut,
                  warning: "library-signed-out",
                  delayMs: STOPPED_RETRY_MS,
                }
              : retryFor(outcome, failures);
          if (failure === null) {
            yield* Effect.logWarning("Reach removal could not reach the Library. Retrying.", {
              outcome: outcome.kind,
              ...(outcome.kind === "refused" ? { reason: outcome.reason } : {}),
            });
          }
          failure = { message: retry.message, warning: retry.warning };
          yield* publish;
          return retry.delayMs;
        }),
      ),
    );
  });

  const finishRemoval = Effect.gen(function* () {
    // The Library rotates the tunnel secret and deletes the tunnel, so the child and its token
    // file go first.
    yield* connectorsStopped;
    if (client === null) {
      failure = {
        message: MESSAGES.removeSignedOut,
        warning: connection.kind === "unavailable" ? "library-signed-out" : null,
      };
      return yield* publish;
    }
    for (let failures = 1; ; failures += 1) {
      const delayMs = yield* removeOnce(client, failures);
      if (delayMs === null) return;
      yield* Effect.sleep(Duration.millis(delayMs));
    }
  });

  // The resume below waits for server activation. A person who turned reach on or off, or removed
  // it, before then already chose, and the resume must not replace what they started.
  let decided = false;
  const runInBackground = (effect: Effect.Effect<void>) =>
    FiberHandle.clear(provisioning).pipe(
      Effect.andThen(FiberHandle.run(provisioning, withoutParentSpan(effect))),
      Effect.asVoid,
    );

  const turnOn = Effect.gen(function* () {
    if (saved.removing) return yield* new ReachError({ reason: "busy" });
    if (client === null) return yield* new ReachError({ reason: "unavailable" });
    decided = true;
    const settled =
      (connector !== null && connector.status.state !== "error") ||
      (failure === null && Option.isSome(FiberHandle.getUnsafe(provisioning)));
    if (saved.enabled && settled) return view();
    if (!saved.enabled)
      yield* persist((current) => ({ ...withoutRetired(current), enabled: true }));
    learned = null;
    failure = null;
    yield* runInBackground(provision(client, true));
    yield* publish;
    return view();
  });

  const turnOff = Effect.gen(function* () {
    if (saved.removing) return view();
    decided = true;
    // Stored before the connector stops, so no crash after this point brings it back.
    const written = yield* persistOrRemember((current) => ({
      ...withoutRetired(current),
      enabled: false,
    }));
    yield* FiberHandle.clear(provisioning);
    failure = null;
    yield* stopConnector;
    yield* publish;
    if (Result.isFailure(written)) return yield* written.failure;
    return view();
  });

  const setEnabled = Effect.fn("ReachService.setEnabled")(function* (enabled: boolean) {
    return yield* enabled ? turnOn : turnOff;
  }, lock.withPermit);

  const remove = Effect.fn("ReachService.remove")(function* () {
    // Nothing this computer knows of to remove, and no Library to ask.
    if (client === null && saved.hostname === null && !saved.removing) return yield* turnOff;
    decided = true;
    if (!saved.removing) {
      yield* persist((current) => ({ ...withoutRetired(current), enabled: false, removing: true }));
    }
    failure = null;
    yield* FiberHandle.clear(provisioning);
    yield* stopConnector;
    yield* runInBackground(finishRemoval);
    yield* publish;
    return view();
  }, lock.withPermit);

  const forget = Effect.fn("ReachService.forget")(function* () {
    decided = true;
    // Interrupts a removal still waiting on the Library, which never gets to finish it.
    yield* FiberHandle.clear(provisioning);
    // Stored before the connector stops, so no crash after this point brings it back.
    const written = yield* persistOrRemember((current) => ({ ...OFF, lastSeq: current.lastSeq }));
    failure = null;
    learned = null;
    yield* stopConnector;
    yield* publish;
    if (Result.isFailure(written)) return yield* written.failure;
    return view();
  }, lock.withPermit);

  yield* forkParked(
    lock.withPermit(
      Effect.gen(function* () {
        if (decided) return;
        if (saved.removing) return yield* runInBackground(finishRemoval);
        // F1: the connector starts only after this run's ensure returns a fresh token.
        if (saved.enabled && client !== null) yield* runInBackground(provision(client, false));
      }),
    ),
  );

  return ReachService.of({
    status: Effect.sync(view),
    changes: SubscriptionRef.changes(state),
    setEnabled,
    remove,
    forget,
    guardState: () => ({
      hostname: saved.hostname,
      serving: connector !== null,
    }),
    ownPorts: () =>
      [...runtimes].flatMap((runtime) =>
        runtime.status.metricsPort === null ? [] : [runtime.status.metricsPort],
      ),
  });
});

export const layer = Layer.effect(
  ReachService,
  Effect.gen(function* () {
    const tunnelContext = yield* Effect.context<
      | RelayClient.RelayClient
      | ChildProcessSpawner.ChildProcessSpawner
      | FileSystem.FileSystem
      | Path.Path
    >();
    // Read when an ensure runs, after activation, so it is the address the server really bound.
    const server = yield* Effect.serviceOption(HttpServer.HttpServer);
    return yield* makeReachService({
      runTunnel: (options) => runReachTunnel(options).pipe(Effect.provideContext(tunnelContext)),
      ingressOrigin: Effect.sync(() =>
        Option.isNone(server) ? null : reachIngressOrigin(server.value.address),
      ),
    });
  }),
);

/**
 * The service ForkLayer installed, for transports built outside its requirements: the guard on
 * every request and the MCP tools. None where reach is not installed.
 */
export const installedReachService = Effect.map(ForkRuntime, (runtime) =>
  runtime === undefined
    ? Option.none<ReachService["Service"]>()
    : Context.getOption(runtime, ReachService),
);
