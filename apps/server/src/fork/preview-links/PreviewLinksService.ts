import type { AuthClientSession, ServerAuthSessionMethod, ThreadId } from "@t3tools/contracts";
import {
  PreviewLink,
  PreviewLinksError,
  PreviewLinksSettings,
  PREVIEW_CONTAINER_DEFAULT_MINUTES,
  isCurrentPreviewHost,
  type PreviewContainerShareInput,
  type PreviewFolderShareInput,
  type PreviewLinkBacking,
  type PreviewLinkEntry,
  type PreviewLinkLifetime,
  type PreviewLinkLifetimeInput,
  type PreviewLinkOpenInput,
  type PreviewLinkShareInput,
  type PreviewLinksConfigureInput,
  type PreviewLinksErrorReason,
  type PreviewLinksSetup,
  type PreviewLinksSnapshot,
} from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type * as RelayClient from "@t3tools/shared/relayClient";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import * as ServerConfig from "../../config.ts";
import { PortDiscovery } from "../../preview/PortScanner.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { forkParked, forkParkedFiber } from "../../serverActivation.ts";
import { CloudflaredExtraPorts } from "../cloudflared/connector.ts";
import { isContained } from "../model-preview-3d/signedFiles.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { PORT_BLOCK } from "../project-lifecycle/policy.ts";
import { ProjectLifecycleService } from "../project-lifecycle/ProjectLifecycleService.ts";
import {
  DOCKER_MISSING_MESSAGE,
  makePreviewContainerOps,
  makePreviewDockerLocator,
  previewPortFree,
  servePreviewFolder,
} from "./backings.ts";
import { startPreviewGateway } from "./gateway.ts";
import {
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  PREVIEW_ENTRY_CODE_TTL_MS,
  defaultPreviewGatewayPort,
  endPreviewLink,
  formatPreviewHost,
  isLanePort,
  isPreviewPortDenied,
  isPreviewReady,
  isoAt,
  nextPreviewDeadline,
  parseLibraryPreviewAccess,
  previewAccessKey,
  previewEntryUrl,
  previewExpiry,
  previewMachineSlug,
  previewReferenceUrl,
  randomCookieKey,
  randomEntryCode,
  randomPreviewLinkId,
  randomShareSegment,
  sanitizeEntryPath,
  signPreviewCookie,
  sweepPreviewLinks,
  verifyPreviewCookie,
  type PreviewTicketIssuer,
} from "./policy.ts";
import {
  PREVIEW_NONCE_MAX_AGE_SECONDS,
  isPreviewNonce,
  previewTicketAudience,
  verifyPreviewTicket,
} from "./ticket.ts";
import { runPreviewTunnel } from "./tunnel.ts";
import * as BackgroundChecks from "../background-checks/BackgroundChecks.ts";
import type {
  PreviewGatewayHandle,
  PreviewGatewayView,
  PreviewTunnelStatus,
  RunPreviewTunnelOptions,
  ServePreviewFolder,
  StartPreviewGateway,
} from "./types.ts";

export type PreviewLinkActor =
  | { readonly _tag: "Owner" }
  | { readonly _tag: "Agent"; readonly threadId: ThreadId };

export class PreviewLinksService extends Context.Service<
  PreviewLinksService,
  {
    /** The current snapshot first, then each distinct change. */
    readonly changes: Stream.Stream<PreviewLinksSnapshot>;
    readonly snapshot: Effect.Effect<PreviewLinksSnapshot>;
    readonly configure: (
      input: PreviewLinksConfigureInput,
    ) => Effect.Effect<PreviewLinksSetup, PreviewLinksError>;
    readonly share: (
      input: PreviewLinkShareInput,
      actor: PreviewLinkActor,
    ) => Effect.Effect<PreviewLink, PreviewLinksError>;
    /** Mints a single-use entry URL bound to the caller's browser session. Never offered to agents. */
    readonly open: (
      input: PreviewLinkOpenInput,
      session: PreviewLinksSession,
    ) => Effect.Effect<PreviewLinkEntry, PreviewLinksError>;
    readonly extend: (
      input: PreviewLinkLifetimeInput,
    ) => Effect.Effect<PreviewLink, PreviewLinksError>;
    readonly revoke: (
      linkId: string,
      actor: PreviewLinkActor,
    ) => Effect.Effect<PreviewLink, PreviewLinksError>;
    readonly restore: (
      input: PreviewLinkLifetimeInput,
    ) => Effect.Effect<PreviewLink, PreviewLinksError>;
    readonly revokeAll: Effect.Effect<void, PreviewLinksError>;
    /** Serves a built folder from the thread's workspace on one of its lane ports. Agents only. */
    readonly shareFolder: (
      input: PreviewFolderShareInput,
      threadId: ThreadId,
    ) => Effect.Effect<PreviewLink, PreviewLinksError>;
    /** Runs an image on one of the thread's lane ports until its time is up. Agents only. */
    readonly shareContainer: (
      input: PreviewContainerShareInput,
      threadId: ThreadId,
    ) => Effect.Effect<PreviewLink, PreviewLinksError>;
    /** Rotates the cookie key, so every browser has to enter from Loom again. */
    readonly signOutBrowsers: Effect.Effect<void, PreviewLinksError>;
    readonly listForThread: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<PreviewLink>>;
  }
>()("t3/fork/preview-links/PreviewLinksService") {}

export const PREVIEW_COOKIE_KEY_SECRET = "loom-preview-links-cookie-key";
export const PREVIEW_TUNNEL_TOKEN_SECRET = "loom-preview-links-tunnel-token";

const MAX_ENTRY_CODES = 256;
// Sleeping longer than this risks timer overflow; the loop simply re-arms.
const MAX_TIMER_WAIT_MS = 24 * 60 * 60 * 1000;

const Sidecar = Schema.Struct({
  version: Schema.Literal(1),
  settings: PreviewLinksSettings,
  links: Schema.Array(PreviewLink),
  revokedKeys: Schema.optionalKey(
    Schema.Array(Schema.Struct({ key: Schema.String, revokedAt: Schema.String })),
  ),
  libraryKeys: Schema.optionalKey(
    Schema.Array(Schema.Struct({ key: Schema.String, until: Schema.String })),
  ),
  /** A folder link's backing keeps only its path within the workspace, which can move. */
  folderRoots: Schema.optionalKey(
    Schema.Array(Schema.Struct({ linkId: Schema.String, root: Schema.String })),
  ),
});
const sidecarJson = Schema.fromJsonString(Sidecar);
const isSettings = Schema.is(PreviewLinksSettings);

const fail = (reason: PreviewLinksErrorReason, message: string) =>
  new PreviewLinksError({ reason, message });

const CONTAINER_TIME_MESSAGE =
  "Container links end when the container stops; share it again for more time.";
const ENDED_MESSAGE =
  "This link ended. Restore it in Settings > Sharing & access > Preview links, or Settings > Previews on mobile.";
const NOT_FOUND_MESSAGE = "That preview link was not found.";

/** The Loom session asking to open a link, as the RPC layer verified it. */
export interface PreviewLinksSession {
  readonly sessionId: string;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
}

const PREVIEW_COOKIE_MAX_AGE_MS = PREVIEW_COOKIE_MAX_AGE_SECONDS * 1000;
/**
 * How long a DPoP session still counts after it runs out. Its client asks for the next session
 * only once the server closes its socket at expiry, so the subject has no session for the few
 * seconds the reconnect takes.
 */
const DPOP_RENEWAL_GRACE_MS = 5 * 60 * 1000;
/**
 * A revoke from another process, such as `t3 auth session revoke`, sends this server no change,
 * so the store is listed again this often. That also lets sessions in after a failed list.
 */
const SESSION_RELIST_INTERVAL = Duration.minutes(1);

/** Access keys of browsers that signed in through the Library rather than a Loom session. */
const LIBRARY_KEY_PREFIX = "library:";
// The Library's key or origin may change, and a computer offline at startup should still learn it.
const LIBRARY_ACCESS_REFRESH_INTERVAL = Duration.minutes(30);
/** How long saving settings waits on the Library before leaving the rest to the background. */
const LIBRARY_ACCESS_SAVE_WAIT = Duration.seconds(5);
/** The hosts one registration asks the Library to sign browsers in for. */
const previewHosts = (settings: PreviewLinksSettings) => `${settings.machine}.${settings.suffix}`;
/** Tickets and nonces kept as spent. Full means a flood of fresh tickets, so new ones fail. */
const MAX_SPENT_TICKETS = 1024;
// A ticket still verifies this long past its expiry, so it has to stay spent until then. The
// check compares whole seconds, which adds up to one more.
const TICKET_STILL_VALID_MS = 31 * 1000;
// No browser still holds the nonce cookie after its max age, so it cannot come back after that.
const NONCE_SPENT_MS = PREVIEW_NONCE_MAX_AGE_SECONDS * 1000;

interface EntryCode {
  readonly host: string;
  readonly path: string;
  /** See `previewAccessKey`. */
  readonly key: string;
  readonly sub: string;
  readonly expiresAtMs: number;
}

interface OpenRoute {
  readonly linkId: string;
  readonly port: number;
  readonly expiresAtMs: number;
}

interface GatewayRuntime {
  readonly scope: Scope.Closeable;
  readonly port: number;
  /** Ends once the gateway listens or has failed to. */
  starting: Fiber.Fiber<void> | null;
  handle: PreviewGatewayHandle | null;
  failure: string | null;
}

interface TunnelRuntime {
  readonly scope: Scope.Closeable;
  readonly token: string;
  status: PreviewTunnelStatus;
}

interface FolderServerRuntime {
  readonly scope: Scope.Closeable;
  readonly port: number;
}

/** How often open container links are checked for a container that stopped on its own. */
const CONTAINER_CHECK_INTERVAL = Duration.minutes(1);
/** How long removing a container that no link covers is retried, such as while Docker is down. */
const STRAY_CONTAINER_RETRY_MS = 24 * 60 * 60 * 1000;
/** Shutdown waits this long for Docker to remove containers, so a stuck Docker never holds it. */
const SHUTDOWN_CONTAINER_REMOVAL_TIMEOUT = Duration.seconds(5);

export interface PreviewLinksServiceDependencies {
  readonly startGateway: StartPreviewGateway;
  /** Never completes; interrupting it stops the connector. */
  readonly runTunnel: (options: RunPreviewTunnelOptions) => Effect.Effect<never>;
  readonly serveFolder: ServePreviewFolder;
  /** Whether nothing answers on the loopback port and it binds right now. */
  readonly portFree: (port: number) => Effect.Effect<boolean>;
  /** The docker binary, or null when this computer has none. */
  readonly dockerPath: Effect.Effect<string | null>;
}

/** Builds the service with injected gateway, tunnel and backing starters, so tests bind no ports. */
export const makePreviewLinksService = Effect.fn("PreviewLinksService.make")(function* (
  dependencies: PreviewLinksServiceDependencies,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore;
  const sessions = yield* SessionStore;
  const discovery = yield* PortDiscovery;
  const lifecycle = yield* ProjectLifecycleService;
  const publisher = yield* LibraryPublisher;
  const clock = yield* Clock.Clock;
  const hostname = yield* HostProcess.Hostname;
  const containers = yield* makePreviewContainerOps;
  const otherConnectors = yield* CloudflaredExtraPorts;
  const rootScope = yield* Effect.scope;

  const sidecarPath = path.join(config.stateDir, "fork", "preview-links", "state.json");
  const now = () => clock.currentTimeMillisUnsafe();
  // Spent tickets are memory only, so tickets signed before this run are never redeemed.
  const startedAtMs = now();
  const devPort = config.devUrl === undefined ? null : Number(config.devUrl.port) || null;

  const defaults: PreviewLinksSettings = {
    enabled: false,
    suffix: null,
    machine: previewMachineSlug(hostname),
    defaultLifetime: "12h",
    gatewayPort: defaultPreviewGatewayPort(config.devUrl === undefined ? null : config.port),
  };
  const fresh = {
    settings: defaults,
    links: [],
    revokedKeys: [],
    libraryKeys: [],
    folderRoots: [],
  };
  const saved = yield* fs.readFileString(sidecarPath).pipe(
    Effect.flatMap(Schema.decodeEffect(sidecarJson)),
    Effect.map((sidecar) => ({
      settings: sidecar.settings,
      links: sidecar.links,
      revokedKeys: sidecar.revokedKeys ?? [],
      libraryKeys: sidecar.libraryKeys ?? [],
      folderRoots: sidecar.folderRoots ?? [],
    })),
    Effect.catchIf(
      (cause) => "reason" in cause && cause.reason._tag === "NotFound",
      () => Effect.succeed(fresh),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Ignoring unreadable preview link state", {
        path: sidecarPath,
        cause,
      }).pipe(Effect.as(fresh)),
    ),
  );

  let cookieKey = yield* secrets.getOrCreateRandom(PREVIEW_COOKIE_KEY_SECRET, 32).pipe(
    Effect.catch((cause) =>
      // Browsers just enter again after a restart; a missing key must not take the server down.
      Effect.logWarning("Using a temporary preview cookie key", { cause }).pipe(
        Effect.as(randomCookieKey()),
      ),
    ),
  );
  let tunnelToken = yield* secrets.get(PREVIEW_TUNNEL_TOKEN_SECRET).pipe(
    Effect.map(
      Option.match({ onNone: () => null, onSome: (bytes) => new TextDecoder().decode(bytes) }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Could not read the preview tunnel token", { cause }).pipe(Effect.as(null)),
    ),
  );

  let settings = saved.settings;
  let links: ReadonlyArray<PreviewLink> = saved.links;
  let openByHost = new Map<string, OpenRoute>();
  let gateway: GatewayRuntime | null = null;
  let tunnel: TunnelRuntime | null = null;
  const entryCodes = new Map<string, EntryCode>();
  /**
   * Loom sessions by id, with the access key their cookies carry and when they stop counting.
   * Seeded from the session store at start, so a device removed while this server was down never
   * gets back in.
   */
  const sessionKeys = new Map<
    string,
    { readonly key: string; readonly expiresAtMs: number; readonly liveUntilMs: number }
  >();
  /** Access keys with a session that still counts, each until the latest one stops. */
  let liveKeys = new Map<string, number>();
  /** Sessions removed while running, so an upsert that arrives late cannot bring one back. */
  const removedSessions = new Map<string, number>();
  /**
   * When each access key last lost a session to removal. Cookies minted until then stay out.
   * Saved, because a DPoP subject's other sessions are listed again after a restart.
   */
  const revokedKeys = new Map<string, number>();
  for (const { key, revokedAt } of saved.revokedKeys) {
    const atMs = Date.parse(revokedAt);
    if (atMs > now() - PREVIEW_COOKIE_MAX_AGE_MS) revokedKeys.set(key, atMs);
  }
  /**
   * Access keys of browsers that signed in through the Library, each until its latest cookie runs
   * out. No Loom session stands behind them, so this is all that ends what they have running.
   * Saved, so a restart does not sign them out.
   */
  const libraryKeys = new Map<string, number>();
  for (const { key, until } of saved.libraryKeys) {
    const untilMs = Math.min(Date.parse(until), now() + PREVIEW_COOKIE_MAX_AGE_MS);
    if (key.startsWith(LIBRARY_KEY_PREFIX) && untilMs > now()) libraryKeys.set(key, untilMs);
  }
  let libraryKeysDirty = false;
  /** Ticket ids and nonces already traded for a cookie, each until it could no longer verify. */
  const spentTickets = new Map<string, number>();
  /** The Library that signs cold browsers in, or null while none has said it will. */
  let libraryIssuer: PreviewTicketIssuer | null = null;
  /** The last registration answer, for the machine and suffix it was asked about. */
  let libraryAnswer: {
    readonly hosts: string;
    readonly status: NonNullable<PreviewLinksSetup["library"]>;
  } | null = null;
  /** The realpath each folder link serves, by link id. */
  const folderRoots = new Map(saved.folderRoots.map(({ linkId, root }) => [linkId, root]));
  /** Running folder servers by link id. Only the backing reconcile closes them. */
  const folderServers = new Map<string, FolderServerRuntime>();
  /** Ended container links whose container is known to be gone. */
  const removedContainers = new Set<string>();
  /**
   * Containers no listed link covers that may still exist, by link id, removed by label: a start
   * that failed or was cancelled, or a link dropped before its removal was confirmed. Each counts
   * as gone after a removal that ran from `settleAtMs`, and is given up at `untilMs`.
   */
  const strayContainers = new Map<
    string,
    { readonly settleAtMs: number; readonly untilMs: number }
  >();
  /** Container links listed at the last check, starting with the saved ones the sweep may drop. */
  let listedContainers = new Set(
    saved.links.filter((link) => link.backing?.kind === "container").map((link) => link.id),
  );
  /** Lane ports held for a container still starting, so a second share cannot take them. */
  const pendingPorts = new Set<number>();

  const rebuildIndex = () => {
    openByHost = new Map(
      links
        .filter((link) => link.state === "open")
        .map((link) => [
          link.host,
          { linkId: link.id, port: link.port, expiresAtMs: Date.parse(link.expiresAt) },
        ]),
    );
  };

  const isLive = (key: string, nowMs: number) =>
    (liveKeys.get(key) ?? 0) > nowMs || (libraryKeys.get(key) ?? 0) > nowMs;

  const purgeEntryCodes = (nowMs: number) => {
    for (const [code, entry] of entryCodes) {
      if (entry.expiresAtMs <= nowMs || !openByHost.has(entry.host)) entryCodes.delete(code);
    }
  };

  const ownPorts = () => [
    config.port,
    devPort,
    settings.gatewayPort,
    gateway?.port,
    tunnel?.status.metricsPort,
    ...otherConnectors.ports(),
  ];

  const view: PreviewGatewayView = {
    route: (host) => {
      const open = openByHost.get(host);
      if (open !== undefined && open.expiresAtMs > now()) {
        return { _tag: "Link", linkId: open.linkId, port: open.port };
      }
      return isCurrentPreviewHost(host, settings) ? { _tag: "Ended" } : { _tag: "Foreign" };
    },
    redeem: (host, code) => {
      const nowMs = now();
      purgeEntryCodes(nowMs);
      const entry = entryCodes.get(code);
      if (entry === undefined) return null;
      // Any presentation spends the code, so one seen on the wrong host cannot be replayed.
      entryCodes.delete(code);
      if (entry.host !== host || !isLive(entry.key, nowMs)) return null;
      return {
        cookieValue: signPreviewCookie(
          {
            sub: entry.sub,
            key: entry.key,
            host,
            iat: nowMs,
            exp: Math.floor(nowMs / 1000) + PREVIEW_COOKIE_MAX_AGE_SECONDS,
          },
          cookieKey,
        ),
        maxAgeSeconds: PREVIEW_COOKIE_MAX_AGE_SECONDS,
        path: entry.path,
      };
    },
    authorize: (host, cookieValue) => {
      const nowMs = now();
      const cookie = verifyPreviewCookie(cookieValue, cookieKey, host, nowMs);
      if (cookie === null || !isLive(cookie.key, nowMs)) return null;
      const revokedAtMs = revokedKeys.get(cookie.key);
      if (revokedAtMs !== undefined && cookie.issuedAtMs <= revokedAtMs) return null;
      return { key: cookie.key, sub: cookie.sub };
    },
    portAllowed: (port) => !isPreviewPortDenied(port, ownPorts()),
    libraryAccess: () =>
      libraryIssuer === null
        ? null
        : { origin: libraryIssuer.origin, ticketPath: libraryIssuer.ticketPath },
    redeemTicket: (host, ticket, nonce, path) => {
      const issuer = libraryIssuer;
      if (issuer === null || !isPreviewNonce(nonce)) return null;
      const nowMs = now();
      const verified = verifyPreviewTicket(ticket, {
        publicKey: issuer.publicKey,
        keyId: issuer.keyId,
        issuer: issuer.issuer,
        audience: previewTicketAudience(host),
        nonce,
        nowMs,
        notBeforeMs: startedAtMs,
      });
      if (verified === null) return null;
      for (const [spent, untilMs] of spentTickets) {
        if (untilMs <= nowMs) spentTickets.delete(spent);
      }
      const ticketId = `jti:${verified.ticketId}`;
      const nonceId = `nonce:${nonce}`;
      if (
        spentTickets.has(ticketId) ||
        spentTickets.has(nonceId) ||
        spentTickets.size >= MAX_SPENT_TICKETS
      ) {
        return null;
      }
      spentTickets.set(ticketId, verified.expiresAtMs + TICKET_STILL_VALID_MS);
      spentTickets.set(nonceId, nowMs + NONCE_SPENT_MS);
      const key = `${LIBRARY_KEY_PREFIX}${verified.subject}`;
      const exp = Math.floor(nowMs / 1000) + PREVIEW_COOKIE_MAX_AGE_SECONDS;
      libraryKeys.set(key, Math.max(libraryKeys.get(key) ?? 0, exp * 1000));
      libraryKeysDirty = true;
      // Saves the key and moves the timer to its expiry.
      timerWake.openUnsafe();
      return {
        cookieValue: signPreviewCookie(
          { sub: verified.subject, key, host, iat: nowMs, exp },
          cookieKey,
        ),
        maxAgeSeconds: PREVIEW_COOKIE_MAX_AGE_SECONDS,
        path: sanitizeEntryPath(path),
      };
    },
  };

  const tunnelSetup = (): PreviewLinksSetup["tunnel"] => {
    if (!isPreviewReady(settings)) return { state: "off", message: null };
    if (tunnelToken === null) {
      return {
        state: "needs-token",
        message: "Add the tunnel token from Cloudflare to connect.",
      };
    }
    return tunnel === null
      ? { state: "starting", message: null }
      : { state: tunnel.status.state, message: tunnel.status.message };
  };

  const gatewaySetup = (): PreviewLinksSetup["gateway"] => {
    if (gateway === null) return { state: "off", message: null };
    if (gateway.failure !== null) return { state: "error", message: gateway.failure };
    return gateway.handle === null
      ? { state: "off", message: "Starting." }
      : { state: "listening", message: null };
  };

  const librarySetup = (): NonNullable<PreviewLinksSetup["library"]> => {
    if (!isPreviewReady(settings)) return { state: "off", message: null };
    if (!publisher.enabled) return { state: "not-connected", message: null };
    return libraryAnswer?.hosts === previewHosts(settings)
      ? libraryAnswer.status
      : { state: "registering", message: null };
  };

  const currentSetup = (): PreviewLinksSetup => ({
    settings,
    tokenStored: tunnelToken !== null,
    ready: isPreviewReady(settings),
    tunnel: tunnelSetup(),
    gateway: gatewaySetup(),
    library: librarySetup(),
  });
  const currentSnapshot = (): PreviewLinksSnapshot => ({ setup: currentSetup(), links });

  const swept = sweepPreviewLinks(links, now());
  links = swept.links;
  rebuildIndex();

  let published = currentSnapshot();
  const state = yield* SubscriptionRef.make(published);
  const publishLock = yield* Semaphore.make(1);
  const publish = publishLock.withPermit(
    Effect.suspend(() => {
      const next = currentSnapshot();
      if (Equal.equals(next, published)) return Effect.void;
      published = next;
      return SubscriptionRef.set(state, next);
    }),
  );

  const lock = yield* Semaphore.make(1);
  const timerWake = yield* Latch.make(false);
  const backingWake = yield* Latch.make(false);
  /** A failed or cancelled start, whose container may appear after it was removed by label. */
  const addFailedStart = (linkId: string) => {
    const nowMs = now();
    strayContainers.set(linkId, {
      settleAtMs: nowMs + Duration.toMillis(CONTAINER_CHECK_INTERVAL),
      untilMs: nowMs + STRAY_CONTAINER_RETRY_MS,
    });
    // The backing loop waits on no timer while nothing else needs Docker.
    backingWake.openUnsafe();
  };

  const persist = (next: {
    readonly settings: PreviewLinksSettings;
    readonly links: ReadonlyArray<PreviewLink>;
  }) =>
    Effect.suspend(() => {
      libraryKeysDirty = false;
      return Schema.encodeEffect(sidecarJson)({
        version: 1,
        ...next,
        revokedKeys: [...revokedKeys].map(([key, atMs]) => ({ key, revokedAt: isoAt(atMs) })),
        libraryKeys: [...libraryKeys].map(([key, untilMs]) => ({ key, until: isoAt(untilMs) })),
        folderRoots: [...folderRoots]
          .filter(([linkId]) => next.links.some((link) => link.id === linkId))
          .map(([linkId, root]) => ({ linkId, root })),
      });
    }).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({ filePath: sidecarPath, contents: `${contents}\n` }),
      ),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.tapError((cause) =>
        Effect.logWarning("Could not save preview link state", { path: sidecarPath, cause }),
      ),
      Effect.mapError(() => fail("storage", "Could not save preview link settings.")),
    );

  const dropConnections = (
    match: (connection: { readonly host: string; readonly key: string }) => boolean,
  ) => gateway?.handle?.destroyConnections(match);

  /** Swaps in new state; callers persist first when the change must survive a restart. */
  const apply = (next: {
    readonly settings?: PreviewLinksSettings;
    readonly links: ReadonlyArray<PreviewLink>;
  }) =>
    Effect.suspend(() => {
      const before = new Set(openByHost.keys());
      if (next.settings !== undefined) settings = next.settings;
      links = next.links;
      rebuildIndex();
      const closed = new Set([...before].filter((host) => !openByHost.has(host)));
      if (closed.size > 0) {
        purgeEntryCodes(now());
        dropConnections((connection) => closed.has(connection.host));
      }
      timerWake.openUnsafe();
      backingWake.openUnsafe();
      return publish;
    });

  // Uninterruptible: a change saved to disk but never applied would be live only after a restart.
  const commit = (next: {
    readonly settings: PreviewLinksSettings;
    readonly links: ReadonlyArray<PreviewLink>;
  }) => Effect.uninterruptible(persist(next).pipe(Effect.andThen(apply(next))));

  /** For changes the server makes on its own: the link ends now even if saving fails. */
  const commitBackground = (nextLinks: ReadonlyArray<PreviewLink>) =>
    Effect.uninterruptible(
      persist({ settings, links: nextLinks }).pipe(
        Effect.ignore,
        Effect.andThen(apply({ links: nextLinks })),
      ),
    );

  const stopGateway = Effect.suspend(() => {
    const runtime = gateway;
    if (runtime === null) return Effect.void;
    gateway = null;
    return Scope.close(runtime.scope, Exit.void);
  });

  const startGateway = Effect.fn("PreviewLinksService.startGateway")(function* (port: number) {
    const scope = yield* Scope.fork(rootScope, "sequential");
    const runtime: GatewayRuntime = { scope, port, starting: null, handle: null, failure: null };
    gateway = runtime;
    const report = (update: () => void) =>
      Effect.suspend(() => {
        if (gateway !== runtime) return Effect.void;
        update();
        return publish;
      });
    runtime.starting = yield* forkParkedFiber(
      dependencies.startGateway({ port, view }).pipe(
        Effect.flatMap((handle) =>
          report(() => {
            runtime.handle = handle;
          }),
        ),
        Effect.catchTags({
          PreviewGatewayListenError: (error) =>
            report(() => {
              runtime.failure = error.message;
            }),
        }),
        Effect.catchDefect((defect) =>
          Effect.logError("The preview gateway failed to start", { defect }).pipe(
            Effect.andThen(
              report(() => {
                runtime.failure = "The preview gateway could not start.";
              }),
            ),
          ),
        ),
      ),
    ).pipe(Scope.provide(scope));
  });

  const stopTunnel = Effect.suspend(() => {
    const runtime = tunnel;
    if (runtime === null) return Effect.void;
    tunnel = null;
    return Scope.close(runtime.scope, Exit.void);
  });

  const startTunnel = Effect.fn("PreviewLinksService.startTunnel")(function* (token: string) {
    const scope = yield* Scope.fork(rootScope, "sequential");
    const runtime: TunnelRuntime = {
      scope,
      token,
      status: { state: "starting", message: null, metricsPort: null },
    };
    tunnel = runtime;
    yield* forkParked(
      dependencies.runTunnel({
        token,
        onStatus: (status) =>
          Effect.suspend(() => {
            if (tunnel !== runtime) return Effect.void;
            runtime.status = status;
            return publish;
          }),
      }),
    ).pipe(Scope.provide(scope));
  });

  /** Starts, stops or restarts only what the current settings and token call for. */
  const reconcileRuntime = Effect.gen(function* () {
    const ready = isPreviewReady(settings);
    const gatewayPort = ready ? settings.gatewayPort : null;
    if (gateway !== null && (gateway.port !== gatewayPort || gateway.failure !== null)) {
      yield* stopGateway;
    }
    if (gatewayPort !== null && gateway === null) yield* startGateway(gatewayPort);
    const token = ready ? tunnelToken : null;
    if (tunnel !== null && tunnel.token !== token) yield* stopTunnel;
    if (token !== null && tunnel === null) yield* startTunnel(token);
    yield* publish;
  });

  const requireReady = Effect.suspend(() => {
    if (!settings.enabled) {
      return Effect.fail(
        fail(
          "not-configured",
          "Preview links are off. Turn them on in Settings > Sharing & access > Preview links in the desktop or web app.",
        ),
      );
    }
    if (settings.suffix === null) {
      return Effect.fail(
        fail(
          "not-configured",
          "Preview links need a domain. Add one in Settings > Sharing & access > Preview links in the desktop or web app.",
        ),
      );
    }
    return Effect.succeed(settings.suffix);
  });

  const requirePortAllowed = (port: number) =>
    isPreviewPortDenied(port, ownPorts())
      ? Effect.fail(fail("port-denied", `Port ${port} is reserved and cannot be shared.`))
      : Effect.void;

  /** Resolves to the lane id when the lane check passed, or null for a terminal-owned server. */
  const checkAgentPort = Effect.fn("PreviewLinksService.checkAgentPort")(function* (
    threadId: ThreadId,
    port: number,
  ) {
    // Any lane failure, including lanes being off, just means this thread has no lane ports.
    const lane = yield* lifecycle.ensureForThread(threadId).pipe(Effect.option);
    if (Option.isSome(lane) && isLanePort(port, lane.value.portBase)) return lane.value.id;
    const servers = yield* discovery.scan();
    if (servers.some((server) => server.port === port && server.terminal?.threadId === threadId)) {
      return null;
    }
    return yield* fail(
      "port-not-in-lane",
      `Port ${port} is not one of this thread's lane ports, and no server from this thread's terminals is listening on it.`,
    );
  });

  const uniqueHost = (port: number, suffix: string) => {
    for (;;) {
      const host = formatPreviewHost({
        port,
        share: randomShareSegment(),
        machine: settings.machine,
        suffix,
      });
      if (!links.some((link) => link.host === host)) return host;
    }
  };

  const findLink = (linkId: string) => links.find((link) => link.id === linkId);

  const replaceLink = (updated: PreviewLink) =>
    links.map((link) => (link.id === updated.id ? updated : link));

  const newLink = (options: {
    readonly id: string;
    readonly suffix: string;
    readonly port: number;
    readonly actor: PreviewLinkActor;
    readonly laneId: string | null;
    readonly lifetime: PreviewLinkLifetime;
    readonly nowMs: number;
    /** Defaults to the end of `lifetime`. */
    readonly expiresAtMs?: number;
    readonly backing?: PreviewLinkBacking;
  }): PreviewLink => {
    const host = uniqueHost(options.port, options.suffix);
    return {
      id: options.id,
      kind: "port",
      port: options.port,
      host,
      url: `https://${host}/`,
      createdBy: options.actor._tag === "Agent" ? "agent" : "owner",
      threadId: options.actor._tag === "Agent" ? options.actor.threadId : null,
      laneId: options.laneId,
      state: "open",
      lifetime: options.lifetime,
      createdAt: isoAt(options.nowMs),
      expiresAt:
        options.expiresAtMs === undefined
          ? previewExpiry(options.nowMs, options.lifetime)
          : isoAt(options.expiresAtMs),
      endedAt: null,
      restorableUntil: null,
      ...(options.backing === undefined ? {} : { backing: options.backing }),
    };
  };

  /** The lane a folder or container link goes on, which must have ports. */
  const threadLane = Effect.fn("PreviewLinksService.threadLane")(function* (threadId: ThreadId) {
    const lanesOff = fail(
      "port-not-in-lane",
      "Folder and container links need lanes on. Turn them on in Settings > Worktrees > Lanes.",
    );
    // With lanes off, ensureForThread still hands back a lane the thread already had.
    if (!(yield* lifecycle.getSettings).enabled) return yield* lanesOff;
    const lane = yield* lifecycle
      .ensureForThread(threadId)
      .pipe(
        Effect.mapError((error) =>
          error.reason === "disabled"
            ? lanesOff
            : fail(
                "port-not-in-lane",
                `Folder and container links need this thread's lane. ${error.message}`,
              ),
        ),
      );
    if (lane.portBase === null) {
      return yield* fail(
        "port-not-in-lane",
        "This thread's lane has no ports, so folder and container links cannot be shared from it.",
      );
    }
    return { id: lane.id, checkoutPath: lane.checkoutPath, portBase: lane.portBase };
  });

  /**
   * Hands the first lane port no open link uses and nothing listens on to `claim`, which returns
   * null when it lost the port after all. Runs under the lock, so two shares never pick one port.
   */
  const claimLanePort = Effect.fn("PreviewLinksService.claimLanePort")(function* <A>(
    portBase: number,
    claim: (port: number) => Effect.Effect<A | null, PreviewLinksError>,
  ) {
    for (let port = portBase; port < portBase + PORT_BLOCK; port++) {
      if (isPreviewPortDenied(port, ownPorts()) || pendingPorts.has(port)) continue;
      if (links.some((link) => link.state === "open" && link.port === port)) continue;
      if (!(yield* dependencies.portFree(port))) continue;
      const claimed = yield* claim(port);
      if (claimed !== null) return claimed;
    }
    return yield* fail(
      "invalid",
      `Ports ${portBase} to ${portBase + PORT_BLOCK - 1} of this thread's lane are all in use or shared. Stop a server on one of them or end one of this thread's links, then try again.`,
    );
  });

  /**
   * Whether the server is listening now. A failure leaves nothing running. Listening takes one
   * bind, and an interruption midway would leave a server no map entry can close.
   */
  const startFolderServer = (linkId: string, root: string, port: number) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const scope = yield* Scope.fork(rootScope, "sequential");
        const started = yield* Effect.exit(
          dependencies.serveFolder({ root, port }).pipe(Scope.provide(scope)),
        );
        if (Exit.isFailure(started)) {
          yield* Scope.close(scope, Exit.void);
          return false;
        }
        folderServers.set(linkId, { scope, port });
        return true;
      }),
    );

  const closeFolderServer = (linkId: string) =>
    Effect.suspend(() => {
      const server = folderServers.get(linkId);
      if (server === undefined) return Effect.void;
      folderServers.delete(linkId);
      return Scope.close(server.scope, Exit.void);
    });

  const isDirectory = (target: string) =>
    fs.stat(target).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  /** The folder's realpath and its path within the workspace, which must contain it. */
  const resolveFolder = Effect.fn("PreviewLinksService.resolveFolder")(function* (
    checkoutPath: string,
    requested: string,
  ) {
    const workspace = yield* fs
      .realPath(checkoutPath)
      .pipe(
        Effect.mapError(() => fail("invalid", "This thread's workspace folder was not found.")),
      );
    const root = yield* fs
      .realPath(path.resolve(workspace, requested))
      .pipe(
        Effect.mapError(() =>
          fail("invalid", `${requested} was not found in this thread's workspace.`),
        ),
      );
    // Compared after resolving symlinks, so a link inside the workspace cannot reach out of it.
    if (!isContained(workspace, root)) {
      return yield* fail(
        "invalid",
        "Folder links can only share a folder inside this thread's workspace.",
      );
    }
    if (!(yield* isDirectory(root))) {
      return yield* fail(
        "invalid",
        `${requested} is not a folder. Share the built folder that holds the site, such as dist.`,
      );
    }
    return { root, relativePath: path.relative(workspace, root) || "." };
  });

  const libraryLock = yield* Semaphore.make(1);
  const checks = yield* BackgroundChecks.recorder;
  /** Whether the Library may still hold this computer's hosts from a registration this run. */
  let libraryRegistered = false;
  /**
   * Tells the Library which hosts to sign cold browsers in for, or that previews are off. A
   * Library that cannot be reached keeps its last answer, so a blip signs nobody out.
   */
  const refreshLibraryAccess = libraryLock.withPermit(
    Effect.suspend(() => {
      if (!publisher.enabled) return checks.clear("preview-registration");
      const suffix = isPreviewReady(settings) ? settings.suffix : null;
      if (suffix === null) {
        libraryIssuer = null;
        libraryAnswer = null;
        if (!libraryRegistered) return checks.clear("preview-registration");
        const unregistered = Effect.sync(() => void (libraryRegistered = false)).pipe(
          Effect.andThen(checks.clear("preview-registration")),
        );
        return publisher.registerPreviews(null).pipe(
          Effect.matchEffect({
            onSuccess: () => unregistered,
            onFailure: (error) =>
              error.reason === "not-found"
                ? unregistered
                : Effect.logWarning("Could not tell the Library that previews are off", {
                    reason: error.reason,
                  }).pipe(
                    Effect.andThen(
                      checks.fail(
                        "preview-registration",
                        "Could not tell the Library that this computer's previews are off.",
                      ),
                    ),
                  ),
          }),
        );
      }
      libraryRegistered = true;
      const hosts = previewHosts(settings);
      const answered = (status: NonNullable<PreviewLinksSetup["library"]>) =>
        Effect.sync(() => {
          libraryAnswer = { hosts, status };
        }).pipe(Effect.andThen(publish));
      return publisher.registerPreviews({ machine: settings.machine, suffix }).pipe(
        Effect.matchEffect({
          onSuccess: (access) => {
            libraryIssuer = parseLibraryPreviewAccess(access);
            return libraryIssuer === null
              ? Effect.logWarning("Ignoring the Library's preview sign-in, which is not usable", {
                  origin: access.origin,
                }).pipe(
                  Effect.andThen(
                    checks.fail(
                      "preview-registration",
                      "The Library answered with a preview sign-in Loom cannot use.",
                    ),
                  ),
                  Effect.andThen(
                    answered({
                      state: "error",
                      message: "The Library answered with a preview sign-in Loom cannot use.",
                    }),
                  ),
                )
              : checks
                  .clear("preview-registration")
                  .pipe(Effect.andThen(answered({ state: "registered", message: null })));
          },
          onFailure: (error) => {
            // An older Library has no preview sign-in, so browsers keep entering from Loom.
            if (error.reason === "not-found") {
              libraryIssuer = null;
              libraryRegistered = false;
              return checks
                .clear("preview-registration")
                .pipe(Effect.andThen(answered({ state: "unsupported", message: null })));
            }
            return Effect.logWarning("Could not refresh preview sign-in with the Library", {
              reason: error.reason,
            }).pipe(
              Effect.andThen(
                checks.fail(
                  "preview-registration",
                  error.reason === "blocked"
                    ? "Could not register previews: this computer's Library sign-in is missing or refused."
                    : error.reason === "io"
                      ? "Could not reach the Library to register this computer's previews."
                      : `The Library refused this computer's preview registration (${error.reason}).`,
                ),
              ),
              Effect.andThen(
                answered({
                  state: "error",
                  // Only a refusal carries a reason written for people; the rest did not reach it.
                  message:
                    error.reason === "blocked"
                      ? error.message
                      : "Loom could not reach the Library to register these preview hosts. It tries again on its own.",
                }),
              ),
            );
          },
        }),
      );
    }),
  );

  const saveSettings = Effect.fn("PreviewLinksService.configure")(
    function* (input: PreviewLinksConfigureInput) {
      if (!isSettings(input.settings)) {
        return yield* fail("invalid", "Those preview link settings are not valid.");
      }
      const next = input.settings;
      if (input.tunnelToken !== undefined) {
        const token = input.tunnelToken === null ? null : input.tunnelToken.trim();
        if (token === null) {
          yield* secrets
            .remove(PREVIEW_TUNNEL_TOKEN_SECRET)
            .pipe(Effect.mapError(() => fail("storage", "Could not remove the tunnel token.")));
        } else {
          yield* secrets
            .set(PREVIEW_TUNNEL_TOKEN_SECRET, new TextEncoder().encode(token))
            .pipe(Effect.mapError(() => fail("storage", "Could not save the tunnel token.")));
        }
        tunnelToken = token;
      }
      const identityChanged = next.suffix !== settings.suffix || next.machine !== settings.machine;
      const nowMs = now();
      // A new domain or name moves every address, so links on the old one end rather than linger.
      const nextLinks = identityChanged
        ? links.map((link) =>
            link.state === "open" ? endPreviewLink(link, "revoked", nowMs) : link,
          )
        : links;
      yield* commit({ settings: next, links: nextLinks }).pipe(Effect.ensuring(reconcileRuntime));
      return currentSetup();
    },
    Effect.uninterruptible,
    lock.withPermit,
  );

  // The bind waits for this server to become the active one, so it runs apart from the save.
  const gatewayStarted = Effect.suspend(() => {
    const starting = gateway?.starting ?? null;
    return starting === null ? Effect.void : Fiber.await(starting);
  });

  // Waits for the gateway, so a port that cannot listen comes back from the save itself. Also
  // waits briefly, so a browser can sign in as soon as the save returns; a slow Library still
  // finishes in the background.
  const configure = (input: PreviewLinksConfigureInput) =>
    saveSettings(input).pipe(
      Effect.andThen(gatewayStarted),
      Effect.andThen(
        Effect.forkIn(refreshLibraryAccess, rootScope).pipe(
          Effect.flatMap((fiber) =>
            Fiber.await(fiber).pipe(Effect.timeoutOption(LIBRARY_ACCESS_SAVE_WAIT)),
          ),
        ),
      ),
      Effect.map(() => currentSetup()),
    );

  const share = Effect.fn("PreviewLinksService.share")(function* (
    input: PreviewLinkShareInput,
    actor: PreviewLinkActor,
  ) {
    yield* requireReady;
    yield* requirePortAllowed(input.port);
    const laneId =
      actor._tag === "Agent" ? yield* checkAgentPort(actor.threadId, input.port) : null;
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const suffix = yield* requireReady;
        yield* requirePortAllowed(input.port);
        const existing = links.find((link) => link.state === "open" && link.port === input.port);
        if (existing !== undefined) return existing;
        // The container share commits its own link on this port once Docker is done.
        if (pendingPorts.has(input.port)) {
          return yield* fail(
            "invalid",
            `A container is still starting on port ${input.port}. Its link appears when it is ready.`,
          );
        }
        const link = newLink({
          id: randomPreviewLinkId(),
          suffix,
          port: input.port,
          actor,
          laneId,
          lifetime: input.lifetime ?? settings.defaultLifetime,
          nowMs: now(),
        });
        yield* commit({ settings, links: [...links, link] });
        return link;
      }),
    );
  });

  const shareFolder = Effect.fn("PreviewLinksService.shareFolder")(function* (
    input: PreviewFolderShareInput,
    threadId: ThreadId,
  ) {
    yield* requireReady;
    const lane = yield* threadLane(threadId);
    const folder = yield* resolveFolder(lane.checkoutPath, input.path);
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const suffix = yield* requireReady;
        const existing = links.find(
          (link) =>
            link.state === "open" &&
            link.threadId === threadId &&
            link.backing?.kind === "folder" &&
            folderRoots.get(link.id) === folder.root,
        );
        if (existing !== undefined) return existing;
        const id = randomPreviewLinkId();
        return yield* Effect.gen(function* () {
          const port = yield* claimLanePort(lane.portBase, (port) =>
            startFolderServer(id, folder.root, port).pipe(
              Effect.map((started) => (started ? port : null)),
            ),
          );
          folderRoots.set(id, folder.root);
          const link = newLink({
            id,
            suffix,
            port,
            actor: { _tag: "Agent", threadId },
            laneId: lane.id,
            lifetime: input.lifetime ?? settings.defaultLifetime,
            nowMs: now(),
            backing: { kind: "folder", path: folder.relativePath },
          });
          yield* commit({ settings, links: [...links, link] });
          return link;
        }).pipe(
          Effect.onError(() =>
            // An interruption can also land after the commit, when the server is the link's.
            findLink(id) === undefined
              ? closeFolderServer(id).pipe(
                  Effect.andThen(Effect.sync(() => folderRoots.delete(id))),
                )
              : Effect.void,
          ),
        );
      }),
    );
  });

  const shareContainer = Effect.fn("PreviewLinksService.shareContainer")(function* (
    input: PreviewContainerShareInput,
    threadId: ThreadId,
  ) {
    yield* requireReady;
    const lane = yield* threadLane(threadId);
    const docker = yield* dependencies.dockerPath;
    if (docker === null) return yield* fail("invalid", DOCKER_MISSING_MESSAGE);
    const id = randomPreviewLinkId();
    // Held outside the lock while Docker pulls and starts, which can take minutes.
    return yield* Effect.acquireUseRelease(
      lock.withPermit(
        claimLanePort(lane.portBase, (port) =>
          Effect.sync(() => {
            pendingPorts.add(port);
            return port;
          }),
        ),
      ),
      (port) => {
        const start = { laneId: lane.id, linkId: id, port, input };
        // A pull that fails or is cancelled leaves no container, so it has nothing to clean up.
        return containers.pull(docker, start).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const containerId = yield* containers.run(docker, start);
              return yield* lock.withPermit(
                Effect.gen(function* () {
                  const suffix = yield* requireReady;
                  const nowMs = now();
                  const minutes = input.minutes ?? PREVIEW_CONTAINER_DEFAULT_MINUTES;
                  const stopsAtMs = nowMs + Duration.toMillis(Duration.minutes(minutes));
                  const link = newLink({
                    id,
                    suffix,
                    port,
                    actor: { _tag: "Agent", threadId },
                    laneId: lane.id,
                    // Never extended, so this only has to cover the container's time.
                    lifetime: minutes <= 60 ? "1h" : "12h",
                    nowMs,
                    expiresAtMs: stopsAtMs,
                    backing: {
                      kind: "container",
                      image: input.image,
                      containerId,
                      containerPort: input.containerPort,
                      stopsAt: isoAt(stopsAtMs),
                    },
                  });
                  yield* commit({ settings, links: [...links, link] });
                  return link;
                }),
              );
            }).pipe(
              // Removing by label also catches a container Docker created before it failed or was
              // cut off. One whose create was still landing shows up later, so the minute check
              // removes by label again. An interruption can land after the commit too, when the
              // container is the link's.
              Effect.onError(() =>
                findLink(id) === undefined
                  ? Effect.suspend(() => {
                      addFailedStart(id);
                      return containers.removeLabelled(docker, id);
                    })
                  : Effect.void,
              ),
            ),
          ),
        );
      },
      (port) => Effect.sync(() => pendingPorts.delete(port)),
    );
  });

  const open = Effect.fn("PreviewLinksService.open")(function* (
    input: PreviewLinkOpenInput,
    session: PreviewLinksSession,
  ) {
    yield* requireReady;
    const reference = previewReferenceUrl(input.link);
    const candidates =
      reference === null
        ? links.filter((link) => link.id === input.link)
        : links.filter((link) => link.host === reference.hostname.toLowerCase());
    const link = candidates.find((candidate) => candidate.state === "open") ?? candidates[0];
    if (link === undefined) return yield* fail("not-found", NOT_FOUND_MESSAGE);
    if (link.state !== "open") return yield* fail("not-found", ENDED_MESSAGE);
    const nowMs = now();
    purgeEntryCodes(nowMs);
    while (entryCodes.size >= MAX_ENTRY_CODES) {
      const oldest = entryCodes.keys().next().value;
      if (oldest === undefined) break;
      entryCodes.delete(oldest);
    }
    const code = randomEntryCode();
    entryCodes.set(code, {
      host: link.host,
      path: sanitizeEntryPath(
        input.path ??
          (reference === null ? "/" : `${reference.pathname}${reference.search}${reference.hash}`),
      ),
      key: previewAccessKey(session),
      sub: session.subject,
      expiresAtMs: nowMs + PREVIEW_ENTRY_CODE_TTL_MS,
    });
    return { url: previewEntryUrl(link.host, code), link };
  });

  const extend = Effect.fn("PreviewLinksService.extend")(function* (
    input: PreviewLinkLifetimeInput,
  ) {
    const link = findLink(input.linkId);
    if (link === undefined) return yield* fail("not-found", NOT_FOUND_MESSAGE);
    if (link.backing?.kind === "container") return yield* fail("invalid", CONTAINER_TIME_MESSAGE);
    if (link.state !== "open") return yield* fail("not-found", ENDED_MESSAGE);
    const lifetime = input.lifetime ?? link.lifetime;
    const extended: PreviewLink = { ...link, lifetime, expiresAt: previewExpiry(now(), lifetime) };
    yield* commit({ settings, links: replaceLink(extended) });
    return extended;
  }, lock.withPermit);

  const revoke = Effect.fn("PreviewLinksService.revoke")(function* (
    linkId: string,
    actor: PreviewLinkActor,
  ) {
    const link = findLink(linkId);
    if (actor._tag === "Agent" && (link === undefined || link.threadId !== actor.threadId)) {
      return yield* fail("not-found", "That preview link was not found in this thread.");
    }
    if (link === undefined) return yield* fail("not-found", NOT_FOUND_MESSAGE);
    if (link.state !== "open") return link;
    const ended = endPreviewLink(link, "revoked", now());
    yield* commit({ settings, links: replaceLink(ended) });
    return ended;
  }, lock.withPermit);

  /** Brings an ended folder link's server back on the port its address names. */
  const restartFolderServer = Effect.fn("PreviewLinksService.restartFolderServer")(function* (
    link: PreviewLink,
  ) {
    const root = folderRoots.get(link.id);
    if (root === undefined || !(yield* isDirectory(root))) {
      return yield* fail(
        "not-restorable",
        "The folder this link served is gone. Share the folder again.",
      );
    }
    // The backing reconcile may not have closed it yet.
    if (folderServers.get(link.id)?.port === link.port) return;
    yield* closeFolderServer(link.id);
    // A pending port is a container still starting, which nothing listens on yet.
    const started =
      !pendingPorts.has(link.port) &&
      (yield* dependencies.portFree(link.port)) &&
      (yield* startFolderServer(link.id, root, link.port));
    if (!started) {
      return yield* fail(
        "not-restorable",
        `Port ${link.port} is in use now, so this folder link cannot come back at its address. Share the folder again.`,
      );
    }
  });

  /** A folder link's port is its lane's, so it can come back only while that lane still owns it. */
  const requireFolderLane = Effect.fn("PreviewLinksService.requireFolderLane")(function* (
    link: PreviewLink,
  ) {
    const status = Option.getOrNull(yield* Stream.runHead(lifecycle.changes));
    if (status?.enabled === false) {
      return yield* fail(
        "not-restorable",
        "Folder links need lanes on to come back. Turn them on in Settings > Worktrees > Lanes.",
      );
    }
    const lane = status?.lanes.find((each) => each.id === link.laneId);
    if (lane === undefined) {
      return yield* fail(
        "not-restorable",
        "The lane this folder was shared from is gone, so its port may belong to something else now. Share the folder again.",
      );
    }
    if (!isLanePort(link.port, lane.ports?.first ?? null)) {
      return yield* fail(
        "not-restorable",
        `The lane this folder was shared from no longer uses port ${link.port}, so it may belong to something else now. Share the folder again.`,
      );
    }
  });

  const restore = Effect.fn("PreviewLinksService.restore")(function* (
    input: PreviewLinkLifetimeInput,
  ) {
    yield* requireReady;
    const link = findLink(input.linkId);
    if (link === undefined) return yield* fail("not-found", NOT_FOUND_MESSAGE);
    if (link.state === "open") return link;
    if (link.backing?.kind === "container") {
      return yield* fail("not-restorable", CONTAINER_TIME_MESSAGE);
    }
    const nowMs = now();
    if (!isCurrentPreviewHost(link.host, settings)) {
      return yield* fail(
        "not-restorable",
        "This link was made for a different domain or computer name, so it cannot be restored.",
      );
    }
    if (link.restorableUntil === null || Date.parse(link.restorableUntil) <= nowMs) {
      return yield* fail("not-restorable", "This link ended too long ago to restore.");
    }
    yield* requirePortAllowed(link.port);
    // Share reuses a port's open link, so a second one would leave two addresses for one port.
    if (links.some((each) => each.state === "open" && each.port === link.port)) {
      return yield* fail(
        "not-restorable",
        `Port ${link.port} already has an open link. End it first, then restore this one.`,
      );
    }
    const folder = link.backing?.kind === "folder";
    if (folder) yield* requireFolderLane(link);
    const lifetime = input.lifetime ?? link.lifetime;
    const restored: PreviewLink = {
      ...link,
      state: "open",
      lifetime,
      expiresAt: previewExpiry(nowMs, lifetime),
      endedAt: null,
      restorableUntil: null,
      // A folder link still ends with its lane, which owns its port. For any other link the owner
      // vouches for the port now, so it no longer ends with the lane it came from.
      laneId: folder ? link.laneId : null,
    };
    yield* Effect.gen(function* () {
      if (folder) yield* restartFolderServer(link);
      yield* commit({ settings, links: replaceLink(restored) });
    }).pipe(
      Effect.onError(() =>
        // An interruption can also land after the commit, when the server is the link's.
        folder && findLink(link.id)?.state !== "open" ? closeFolderServer(link.id) : Effect.void,
      ),
    );
    return restored;
  }, lock.withPermit);

  const revokeAll = lock
    .withPermit(
      Effect.gen(function* () {
        if (!links.some((link) => link.state === "open")) return;
        const nowMs = now();
        yield* commit({
          settings,
          links: links.map((link) =>
            link.state === "open" ? endPreviewLink(link, "revoked", nowMs) : link,
          ),
        });
      }),
    )
    .pipe(Effect.withSpan("PreviewLinksService.revokeAll"));

  const signOutBrowsers = lock
    .withPermit(
      // Uninterruptible: a key saved but never applied would keep every browser in until a restart.
      Effect.uninterruptible(
        Effect.gen(function* () {
          const key = randomCookieKey();
          yield* secrets
            .set(PREVIEW_COOKIE_KEY_SECRET, key)
            .pipe(Effect.mapError(() => fail("storage", "Could not sign out browsers.")));
          cookieKey = key;
          entryCodes.clear();
          libraryKeys.clear();
          dropConnections(() => true);
          yield* persist({ settings, links }).pipe(Effect.ignore);
        }),
      ),
    )
    .pipe(Effect.withSpan("PreviewLinksService.signOutBrowsers"));

  /**
   * Rebuilds which access keys are live and ends what keys that ran out, plus `alsoEnd`, still
   * have running. A session that runs out while its Loom client is away sends no change, so its
   * expiry alone has to end what its browsers still have running.
   */
  const refreshSessions = (nowMs: number, alsoEnd?: string) => {
    const forgetUntil = nowMs - PREVIEW_COOKIE_MAX_AGE_MS;
    for (const [sid, untilMs] of removedSessions) if (untilMs <= nowMs) removedSessions.delete(sid);
    for (const [key, atMs] of revokedKeys) if (atMs <= forgetUntil) revokedKeys.delete(key);
    const next = new Map<string, number>();
    for (const [sid, { key, liveUntilMs }] of sessionKeys) {
      if (liveUntilMs <= nowMs) sessionKeys.delete(sid);
      else next.set(key, Math.max(next.get(key) ?? 0, liveUntilMs));
    }
    const ended = new Set([...liveKeys.keys()].filter((key) => !next.has(key)));
    if (alsoEnd !== undefined) ended.add(alsoEnd);
    for (const [key, untilMs] of libraryKeys) {
      if (untilMs > nowMs) continue;
      libraryKeys.delete(key);
      ended.add(key);
    }
    liveKeys = next;
    if (ended.size > 0) dropConnections((connection) => ended.has(connection.key));
  };

  // An upsert read just before a revoke committed can arrive after its removal; the removal wins.
  const admitSession = (session: AuthClientSession, nowMs: number) => {
    if (removedSessions.has(session.sessionId)) return;
    const expiresAtMs = session.expiresAt.epochMilliseconds;
    sessionKeys.set(session.sessionId, {
      key: previewAccessKey(session),
      expiresAtMs,
      liveUntilMs:
        session.method === "dpop-access-token" ? expiresAtMs + DPOP_RENEWAL_GRACE_MS : expiresAtMs,
    });
    refreshSessions(nowMs);
    // The timer may be sleeping past this session's expiry.
    timerWake.openUnsafe();
  };

  /**
   * Ends the session's key outright, even while other sessions of a DPoP subject keep it live.
   * Returns whether it revoked the key.
   */
  const removeSession = (sid: string, nowMs: number) => {
    removedSessions.set(sid, nowMs + PREVIEW_COOKIE_MAX_AGE_MS);
    const known = sessionKeys.get(sid);
    // The store also reports a session removed when it disconnects after running out, which a
    // DPoP session does every hour. That is expiry: the session keeps its grace and the rest of
    // its subject stays in. One not known here has run out already or was never seen, so it names
    // no key to revoke: its own cannot come back, and a DPoP removal does not say its subject.
    if (known === undefined || known.expiresAtMs <= nowMs) return false;
    sessionKeys.delete(sid);
    revokedKeys.set(known.key, nowMs);
    for (const [code, entry] of entryCodes) if (entry.key === known.key) entryCodes.delete(code);
    refreshSessions(nowMs, known.key);
    return true;
  };

  const nextDeadline = () => {
    let next = nextPreviewDeadline(links);
    for (const until of liveKeys.values()) if (next === null || until < next) next = until;
    for (const until of libraryKeys.values()) if (next === null || until < next) next = until;
    return next;
  };

  const sweep = lock.withPermit(
    Effect.suspend(() => {
      const nowMs = now();
      refreshSessions(nowMs);
      const result = sweepPreviewLinks(links, nowMs);
      if (result.changed) return commitBackground(result.links);
      return libraryKeysDirty ? persist({ settings, links }).pipe(Effect.ignore) : Effect.void;
    }),
  );

  yield* forkParked(
    Effect.gen(function* () {
      for (;;) {
        yield* timerWake.close;
        const deadline = nextDeadline();
        // A sign-in that landed while the last sweep was saving opened the latch before this close
        // cleared it, so the flag is the only record that it still needs saving.
        if (!libraryKeysDirty) {
          if (deadline === null) {
            yield* timerWake.await;
          } else {
            const wait = Math.min(deadline - now(), MAX_TIMER_WAIT_MS);
            if (wait > 0) {
              yield* Effect.raceFirst(Effect.sleep(Duration.millis(wait)), timerWake.await);
            }
          }
        }
        yield* sweep;
      }
    }),
  );

  // A saved open link's lane existed when it was shared, and the first status lists every lane
  // still stored, so one missing from it was released while this server was down.
  const lanesSeen = new Set(
    links.flatMap((link) => (link.state === "open" && link.laneId !== null ? [link.laneId] : [])),
  );
  yield* forkParked(
    Stream.runForEach(lifecycle.changes, (status) => {
      // Lanes being off hides them without removing them, so it ends nothing.
      if (!status.enabled) return Effect.void;
      const portBases = new Map(status.lanes.map((lane) => [lane.id, lane.ports?.first ?? null]));
      for (const id of portBases.keys()) lanesSeen.add(id);
      // A lane gives up a link's port by going, or by moving to a new block at startup when
      // another server claimed its old one.
      const isGone = (link: PreviewLink) =>
        link.state === "open" &&
        link.laneId !== null &&
        lanesSeen.has(link.laneId) &&
        !isLanePort(link.port, portBases.get(link.laneId) ?? null);
      // Checked under the lock, so a share or restore still finishing ends here too.
      return lock.withPermit(
        Effect.suspend(() => {
          if (!links.some(isGone)) return Effect.void;
          const nowMs = now();
          return commitBackground(
            links.map((link) => (isGone(link) ? endPreviewLink(link, "revoked", nowMs) : link)),
          );
        }),
      );
    }),
  );

  const containerOf = (link: PreviewLink) =>
    link.backing?.kind === "container" ? link.backing : null;

  /** Container links still to check: open ones, and ended ones whose container may remain. */
  const watchedContainers = () =>
    links.flatMap((link) => {
      const backing = containerOf(link);
      return backing !== null && (link.state === "open" || !removedContainers.has(link.id))
        ? [{ link, containerId: backing.containerId }]
        : [];
    });

  /** Ends open links as expired, skipping any that ended meanwhile. */
  const expireLinks = (linkIds: ReadonlySet<string>) =>
    Effect.suspend(() => {
      const nowMs = now();
      let changed = false;
      const next = links.map((link) => {
        if (link.state !== "open" || !linkIds.has(link.id)) return link;
        changed = true;
        return endPreviewLink(link, "expired", nowMs);
      });
      return changed ? commitBackground(next) : Effect.void;
    });

  const reconcileFolders = lock.withPermit(
    Effect.gen(function* () {
      const open = new Map(
        links
          .filter((link) => link.state === "open" && link.backing?.kind === "folder")
          .map((link) => [link.id, link]),
      );
      for (const [linkId, server] of folderServers) {
        if (open.get(linkId)?.port !== server.port) yield* closeFolderServer(linkId);
      }
      for (const linkId of folderRoots.keys()) {
        if (findLink(linkId) === undefined) folderRoots.delete(linkId);
      }
      const failed = new Set<string>();
      for (const link of open.values()) {
        if (folderServers.has(link.id)) continue;
        const root = folderRoots.get(link.id);
        // Binding 127.0.0.1 can succeed beside a listener on ::1 or every address, which would
        // then answer at this link's address, so the port is probed first as on share.
        const started =
          root !== undefined &&
          (yield* isDirectory(root)) &&
          (yield* dependencies.portFree(link.port)) &&
          (yield* startFolderServer(link.id, root, link.port));
        if (!started) failed.add(link.id);
      }
      if (failed.size === 0) return;
      // Something else may hold the port now, and it must not answer at this link's address.
      yield* Effect.logWarning("Ending folder links whose server could not start", {
        linkIds: [...failed],
      });
      yield* expireLinks(failed);
    }),
  );

  // Outside the lock: Docker can take seconds to answer, and shares must not wait on it.
  const reconcileContainers = Effect.gen(function* () {
    const nowMs = now();
    const listed = new Set(
      links.filter((link) => containerOf(link) !== null).map((link) => link.id),
    );
    // A link can leave the list with its container still there, such as one the sweep dropped
    // after Docker was down for its whole restore window.
    for (const linkId of listedContainers) {
      if (!listed.has(linkId) && !removedContainers.has(linkId)) {
        strayContainers.set(linkId, {
          settleAtMs: nowMs,
          untilMs: nowMs + STRAY_CONTAINER_RETRY_MS,
        });
      }
    }
    listedContainers = listed;
    for (const linkId of removedContainers) {
      if (!listed.has(linkId)) removedContainers.delete(linkId);
    }
    for (const [linkId, stray] of strayContainers) {
      if (stray.untilMs > nowMs) continue;
      strayContainers.delete(linkId);
      yield* Effect.logWarning("Gave up removing a preview container", { linkId });
    }
    const watched = watchedContainers();
    if (watched.length === 0 && strayContainers.size === 0) return;
    const docker = yield* dependencies.dockerPath;
    if (docker === null) return;
    const gone = new Set<string>();
    for (const { link, containerId } of watched) {
      if (link.state !== "open") {
        if (yield* containers.remove(docker, containerId)) removedContainers.add(link.id);
        else yield* Effect.logWarning("Could not remove a preview container", { containerId });
      } else if ((yield* containers.running(docker, containerId)) === false) {
        gone.add(link.id);
      }
    }
    for (const [linkId, stray] of strayContainers) {
      const removed = yield* containers.removeLabelled(docker, linkId);
      if (removed && nowMs >= stray.settleAtMs) strayContainers.delete(linkId);
    }
    if (gone.size > 0) yield* lock.withPermit(expireLinks(gone));
  });

  /** What is left in Docker for this server: every container a link may still have. */
  const removeContainersNow = Effect.gen(function* () {
    const docker = yield* dependencies.dockerPath;
    if (docker === null) return;
    yield* Effect.all(
      [
        ...watchedContainers().map(({ containerId }) => containers.remove(docker, containerId)),
        ...[...strayContainers.keys()].map((linkId) => containers.removeLabelled(docker, linkId)),
      ],
      { concurrency: "unbounded", discard: true },
    );
  });

  /**
   * The one place backings start and stop. Runs at startup and after every commit, so a link
   * ending by any path (revoke, expiry, its lane going, revoke all) also stops what served it.
   * It logs and never fails, so no commit waits on or fails with it.
   */
  const reconcileBackings = Effect.andThen(reconcileFolders, reconcileContainers).pipe(
    Effect.catchDefect((defect) =>
      Effect.logError("Could not reconcile preview link backings", { defect }),
    ),
  );

  // Added before the loop starts, so it runs after the loop is interrupted. Links stay as they are:
  // the next start finds their containers gone and ends them.
  yield* Effect.addFinalizer(() =>
    removeContainersNow.pipe(
      Effect.interruptible,
      Effect.timeoutOption(SHUTDOWN_CONTAINER_REMOVAL_TIMEOUT),
      Effect.flatMap((done) =>
        Option.isNone(done)
          ? Effect.logWarning("Docker did not remove preview containers before shutdown")
          : Effect.void,
      ),
      Effect.catchDefect((defect) =>
        Effect.logError("Could not remove preview containers at shutdown", { defect }),
      ),
    ),
  );
  yield* forkParked(
    Effect.gen(function* () {
      for (;;) {
        yield* backingWake.close;
        yield* reconcileBackings;
        // A container that stops on its own announces nothing, so open ones are checked on a timer,
        // and Docker being down is only noticed by trying again.
        if (watchedContainers().length > 0 || strayContainers.size > 0) {
          yield* backingWake.await.pipe(
            Effect.timeoutOrElse({ duration: CONTAINER_CHECK_INTERVAL, orElse: () => Effect.void }),
          );
        } else {
          yield* backingWake.await;
        }
      }
    }),
  );

  // Under the lock, so it never saves over a change still being committed.
  const saveRevocations = lock.withPermit(
    Effect.suspend(() => persist({ settings, links })).pipe(Effect.ignore),
  );
  // Starting at once subscribes before the seed below reads the store, so a removal in between
  // still lands.
  yield* Effect.forkScoped(
    Stream.runForEach(sessions.streamChanges, (change) =>
      Effect.suspend(() => {
        const nowMs = now();
        if (change.type !== "clientRemoved") {
          admitSession(change.clientSession, nowMs);
          return Effect.void;
        }
        return removeSession(change.sessionId, nowMs) ? saveRevocations : Effect.void;
      }),
    ),
    { startImmediately: true },
  );
  const activeSessions = yield* sessions.listActive().pipe(
    Effect.catch((cause) =>
      // Fails closed: a browser's cookie works again once its Loom client reconnects.
      Effect.logWarning("Could not list Loom sessions for preview links", { cause }).pipe(
        Effect.as([]),
      ),
    ),
  );
  for (const each of activeSessions) admitSession(each, now());

  const relistSessions = Effect.gen(function* () {
    // Only sessions known before the list was read can be missing from it; one that signs in
    // meanwhile is not on it yet.
    const known = new Set(sessionKeys.keys());
    const listed = yield* sessions.listActive();
    // Read after the list, so a session it left out for running out counts as expired here too.
    const nowMs = now();
    const listedIds = new Set<string>(listed.map((each) => each.sessionId));
    let revoked = false;
    for (const sid of known) {
      if (!listedIds.has(sid) && removeSession(sid, nowMs)) revoked = true;
    }
    for (const each of listed) if (!sessionKeys.has(each.sessionId)) admitSession(each, nowMs);
    if (revoked) yield* saveRevocations;
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Could not list Loom sessions for preview links", { cause }),
    ),
  );
  yield* forkParked(
    Effect.forever(Effect.sleep(SESSION_RELIST_INTERVAL).pipe(Effect.andThen(relistSessions))),
  );

  if (swept.changed) yield* persist({ settings, links }).pipe(Effect.ignore);
  yield* reconcileRuntime;
  if (publisher.enabled) {
    yield* forkParked(
      Effect.gen(function* () {
        for (;;) {
          yield* refreshLibraryAccess;
          yield* Effect.sleep(LIBRARY_ACCESS_REFRESH_INTERVAL);
        }
      }),
    );
  }

  return PreviewLinksService.of({
    changes: SubscriptionRef.changes(state),
    snapshot: SubscriptionRef.get(state),
    configure,
    share,
    open,
    extend,
    revoke,
    restore,
    revokeAll,
    shareFolder,
    shareContainer,
    signOutBrowsers,
    listForThread: Effect.fn("PreviewLinksService.listForThread")(function (threadId) {
      return Effect.sync(() => links.filter((link) => link.threadId === threadId));
    }),
  });
});

export const layer = Layer.effect(
  PreviewLinksService,
  Effect.gen(function* () {
    const tunnelContext = yield* Effect.context<
      | RelayClient.RelayClient
      | ChildProcessSpawner.ChildProcessSpawner
      | FileSystem.FileSystem
      | Path.Path
    >();
    return yield* makePreviewLinksService({
      startGateway: startPreviewGateway,
      runTunnel: (options) => runPreviewTunnel(options).pipe(Effect.provideContext(tunnelContext)),
      serveFolder: servePreviewFolder,
      portFree: previewPortFree,
      dockerPath: makePreviewDockerLocator(),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
