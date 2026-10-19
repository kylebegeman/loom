import type { ThreadId } from "@t3tools/contracts";
import {
  PreviewLink,
  PreviewLinksError,
  PreviewLinksSettings,
  DEFAULT_PREVIEW_GATEWAY_PORT,
  type PreviewLinkEntry,
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
import { forkParked } from "../../serverActivation.ts";
import { ProjectLifecycleService } from "../project-lifecycle/ProjectLifecycleService.ts";
import { startPreviewGateway } from "./gateway.ts";
import {
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  PREVIEW_ENTRY_CODE_TTL_MS,
  endPreviewLink,
  formatPreviewHost,
  isCurrentPreviewHost,
  isLanePort,
  isPreviewPortDenied,
  isPreviewReady,
  isoAt,
  nextPreviewDeadline,
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
} from "./policy.ts";
import { runPreviewTunnel } from "./tunnel.ts";
import type {
  PreviewGatewayHandle,
  PreviewGatewayView,
  PreviewTunnelStatus,
  RunPreviewTunnelOptions,
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
      session: { readonly sessionId: string; readonly subject: string },
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
});
const sidecarJson = Schema.fromJsonString(Sidecar);
const isSettings = Schema.is(PreviewLinksSettings);

const fail = (reason: PreviewLinksErrorReason, message: string) =>
  new PreviewLinksError({ reason, message });

const ENDED_MESSAGE = "This link ended. Restore it in Settings > Previews.";
const NOT_FOUND_MESSAGE = "That preview link was not found.";

interface EntryCode {
  readonly host: string;
  readonly path: string;
  readonly sid: string;
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
  handle: PreviewGatewayHandle | null;
  failure: string | null;
}

interface TunnelRuntime {
  readonly scope: Scope.Closeable;
  readonly token: string;
  status: PreviewTunnelStatus;
}

export interface PreviewLinksServiceDependencies {
  readonly startGateway: StartPreviewGateway;
  /** Never completes; interrupting it stops the connector. */
  readonly runTunnel: (options: RunPreviewTunnelOptions) => Effect.Effect<never>;
}

/** Builds the service with injected gateway and tunnel starters, so tests bind no ports. */
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
  const clock = yield* Clock.Clock;
  const hostname = yield* HostProcess.Hostname;
  const rootScope = yield* Effect.scope;

  const sidecarPath = path.join(config.stateDir, "fork", "preview-links", "state.json");
  const now = () => clock.currentTimeMillisUnsafe();
  const devPort = config.devUrl === undefined ? null : Number(config.devUrl.port) || null;

  const defaults: PreviewLinksSettings = {
    enabled: false,
    suffix: null,
    machine: previewMachineSlug(hostname),
    defaultLifetime: "12h",
    gatewayPort: DEFAULT_PREVIEW_GATEWAY_PORT,
  };
  const saved = yield* fs.readFileString(sidecarPath).pipe(
    Effect.flatMap(Schema.decodeEffect(sidecarJson)),
    Effect.map((sidecar) => ({ settings: sidecar.settings, links: sidecar.links })),
    Effect.catchIf(
      (cause) => "reason" in cause && cause.reason._tag === "NotFound",
      () => Effect.succeed({ settings: defaults, links: [] as ReadonlyArray<PreviewLink> }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Ignoring unreadable preview link state", {
        path: sidecarPath,
        cause,
      }).pipe(Effect.as({ settings: defaults, links: [] as ReadonlyArray<PreviewLink> })),
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
   * Loom sessions a preview cookie may stand for, with their expiry. Seeded from the session
   * store at start, so a device removed while this server was down never gets back in.
   */
  const liveSessions = new Map<string, number>();
  /** Sessions removed while running, kept until any cookie they hold has expired. */
  const removedSessions = new Map<string, number>();

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

  const isLive = (sid: string, nowMs: number) => {
    const until = liveSessions.get(sid);
    return until !== undefined && until > nowMs;
  };

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
      if (entry.host !== host || !isLive(entry.sid, nowMs)) return null;
      return {
        cookieValue: signPreviewCookie(
          {
            sub: entry.sub,
            sid: entry.sid,
            host,
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
      const session = verifyPreviewCookie(cookieValue, cookieKey, host, nowMs);
      return session === null || !isLive(session.sid, nowMs) ? null : session;
    },
    portAllowed: (port) => !isPreviewPortDenied(port, ownPorts()),
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

  const currentSetup = (): PreviewLinksSetup => ({
    settings,
    tokenStored: tunnelToken !== null,
    ready: isPreviewReady(settings),
    tunnel: tunnelSetup(),
    gateway: gatewaySetup(),
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

  const persist = (next: {
    readonly settings: PreviewLinksSettings;
    readonly links: ReadonlyArray<PreviewLink>;
  }) =>
    Schema.encodeEffect(sidecarJson)({ version: 1, ...next }).pipe(
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
    match: (connection: { readonly host: string; readonly sid: string }) => boolean,
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

  const startGateway = (port: number) =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(rootScope, "sequential");
      const runtime: GatewayRuntime = { scope, port, handle: null, failure: null };
      gateway = runtime;
      const report = (update: () => void) =>
        Effect.suspend(() => {
          if (gateway !== runtime) return Effect.void;
          update();
          return publish;
        });
      yield* forkParked(
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

  const startTunnel = (token: string) =>
    Effect.gen(function* () {
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
        fail("not-configured", "Preview links are off. Turn them on in Settings > Previews."),
      );
    }
    if (settings.suffix === null) {
      return Effect.fail(
        fail("not-configured", "Preview links need a domain. Add one in Settings > Previews."),
      );
    }
    return Effect.succeed(settings.suffix);
  });

  const requirePortAllowed = (port: number) =>
    isPreviewPortDenied(port, ownPorts())
      ? Effect.fail(fail("port-denied", `Port ${port} is reserved and cannot be shared.`))
      : Effect.void;

  /** Resolves to the lane id when the lane check passed, or null for a terminal-owned server. */
  const checkAgentPort = (threadId: ThreadId, port: number) =>
    Effect.gen(function* () {
      // Any lane failure, including lanes being off, just means this thread has no lane ports.
      const lane = yield* lifecycle.ensureForThread(threadId).pipe(Effect.option);
      if (Option.isSome(lane) && isLanePort(port, lane.value.portBase)) return lane.value.id;
      const servers = yield* discovery.scan();
      if (
        servers.some((server) => server.port === port && server.terminal?.threadId === threadId)
      ) {
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

  const configure = Effect.fn("PreviewLinksService.configure")(
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
        const nowMs = now();
        const lifetime = input.lifetime ?? settings.defaultLifetime;
        const host = uniqueHost(input.port, suffix);
        const link: PreviewLink = {
          id: randomPreviewLinkId(),
          kind: "port",
          port: input.port,
          host,
          url: `https://${host}/`,
          createdBy: actor._tag === "Agent" ? "agent" : "owner",
          threadId: actor._tag === "Agent" ? actor.threadId : null,
          laneId,
          state: "open",
          lifetime,
          createdAt: isoAt(nowMs),
          expiresAt: previewExpiry(nowMs, lifetime),
          endedAt: null,
          restorableUntil: null,
        };
        yield* commit({ settings, links: [...links, link] });
        return link;
      }),
    );
  });

  const open = Effect.fn("PreviewLinksService.open")(function* (
    input: PreviewLinkOpenInput,
    session: { readonly sessionId: string; readonly subject: string },
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
      sid: session.sessionId,
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

  const restore = Effect.fn("PreviewLinksService.restore")(function* (
    input: PreviewLinkLifetimeInput,
  ) {
    yield* requireReady;
    const link = findLink(input.linkId);
    if (link === undefined) return yield* fail("not-found", NOT_FOUND_MESSAGE);
    if (link.state === "open") return link;
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
    const lifetime = input.lifetime ?? link.lifetime;
    const restored: PreviewLink = {
      ...link,
      state: "open",
      lifetime,
      expiresAt: previewExpiry(nowMs, lifetime),
      endedAt: null,
      restorableUntil: null,
      // The owner vouches for it now, so it no longer ends with the lane it came from.
      laneId: null,
    };
    yield* commit({ settings, links: replaceLink(restored) });
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
      Effect.gen(function* () {
        const key = randomCookieKey();
        yield* secrets
          .set(PREVIEW_COOKIE_KEY_SECRET, key)
          .pipe(Effect.mapError(() => fail("storage", "Could not sign out browsers.")));
        cookieKey = key;
        entryCodes.clear();
        dropConnections(() => true);
      }),
    )
    .pipe(Effect.withSpan("PreviewLinksService.signOutBrowsers"));

  const sweep = lock.withPermit(
    Effect.suspend(() => {
      const result = sweepPreviewLinks(links, now());
      return result.changed ? commitBackground(result.links) : Effect.void;
    }),
  );

  yield* forkParked(
    Effect.gen(function* () {
      for (;;) {
        yield* timerWake.close;
        const deadline = nextPreviewDeadline(links);
        if (deadline === null) {
          yield* timerWake.await;
        } else {
          const wait = Math.min(deadline - now(), MAX_TIMER_WAIT_MS);
          if (wait > 0) {
            yield* Effect.raceFirst(Effect.sleep(Duration.millis(wait)), timerWake.await);
          }
        }
        yield* sweep;
      }
    }),
  );

  const lanesSeen = new Set<string>();
  yield* forkParked(
    Stream.runForEach(lifecycle.changes, (status) => {
      // Lanes being off hides them without removing them, so it ends nothing.
      if (!status.enabled) return Effect.void;
      const current = new Set(status.lanes.map((lane) => lane.id));
      for (const id of current) lanesSeen.add(id);
      const isGone = (link: PreviewLink) =>
        link.state === "open" &&
        link.laneId !== null &&
        lanesSeen.has(link.laneId) &&
        !current.has(link.laneId);
      if (!links.some(isGone)) return Effect.void;
      return lock.withPermit(
        Effect.suspend(() => {
          const nowMs = now();
          return commitBackground(
            links.map((link) => (isGone(link) ? endPreviewLink(link, "revoked", nowMs) : link)),
          );
        }),
      );
    }),
  );

  // An upsert read just before a revoke committed can arrive after its removal; the removal wins.
  const admitSession = (sid: string, expiresAtMs: number) => {
    if (!removedSessions.has(sid)) liveSessions.set(sid, expiresAtMs);
  };

  const removeSession = (sid: string, nowMs: number) => {
    liveSessions.delete(sid);
    removedSessions.set(sid, nowMs + PREVIEW_COOKIE_MAX_AGE_SECONDS * 1000);
    for (const [code, entry] of entryCodes) if (entry.sid === sid) entryCodes.delete(code);
    dropConnections((connection) => connection.sid === sid);
  };

  // Starting at once subscribes before the seed below reads the store, so a removal in between
  // still lands.
  yield* Effect.forkScoped(
    Stream.runForEach(sessions.streamChanges, (change) =>
      Effect.sync(() => {
        const nowMs = now();
        for (const [id, until] of removedSessions) if (until <= nowMs) removedSessions.delete(id);
        for (const [id, until] of liveSessions) if (until <= nowMs) liveSessions.delete(id);
        if (change.type === "clientRemoved") {
          removeSession(change.sessionId, nowMs);
        } else {
          const { sessionId, expiresAt } = change.clientSession;
          admitSession(sessionId, expiresAt.epochMilliseconds);
        }
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
  for (const each of activeSessions) admitSession(each.sessionId, each.expiresAt.epochMilliseconds);

  if (swept.changed) yield* persist({ settings, links }).pipe(Effect.ignore);
  yield* reconcileRuntime;

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
    signOutBrowsers,
    listForThread: (threadId) =>
      Effect.sync(() => links.filter((link) => link.threadId === threadId)),
  });
});

export const layer = Layer.effect(
  PreviewLinksService,
  Effect.gen(function* () {
    const tunnelContext = yield* Effect.context<
      RelayClient.RelayClient | ChildProcessSpawner.ChildProcessSpawner
    >();
    return yield* makePreviewLinksService({
      startGateway: startPreviewGateway,
      runTunnel: (options) => runPreviewTunnel(options).pipe(Effect.provideContext(tunnelContext)),
    });
  }),
);
