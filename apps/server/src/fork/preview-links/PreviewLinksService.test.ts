import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  ProjectId,
  ThreadId,
  type AuthClientSession,
  type DiscoveredLocalServer,
} from "@t3tools/contracts";
import {
  ProjectLifecycleError,
  type PreviewLinksSettings,
  type PreviewLinksSnapshot,
  type ProjectLifecycleLane,
  type ProjectLifecycleStatus,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { TestClock } from "effect/testing";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { SessionStore, type SessionCredentialChange } from "../../auth/SessionStore.ts";
import * as ServerConfig from "../../config.ts";
import { PortDiscovery } from "../../preview/PortScanner.ts";
import { ProjectLifecycleService } from "../project-lifecycle/ProjectLifecycleService.ts";
import type { LaneRow } from "../project-lifecycle/store.ts";
import { isoAt } from "./policy.ts";
import {
  PREVIEW_COOKIE_KEY_SECRET,
  PREVIEW_TUNNEL_TOKEN_SECRET,
  makePreviewLinksService,
  type PreviewLinkActor,
  type PreviewLinksSession,
} from "./PreviewLinksService.ts";
import {
  PreviewGatewayListenError,
  type PreviewGatewayView,
  type RunPreviewTunnelOptions,
  type StartPreviewGateway,
} from "./types.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TOKEN = "cloudflare-connector-token-0123456789";
const owner: PreviewLinkActor = { _tag: "Owner" };
const threadA = ThreadId.make("thread-a");
const threadB = ThreadId.make("thread-b");
const agentA: PreviewLinkActor = { _tag: "Agent", threadId: threadA };
const agentB: PreviewLinkActor = { _tag: "Agent", threadId: threadB };
const cookieSession = (sessionId: string): PreviewLinksSession => ({
  sessionId,
  subject: "owner",
  method: "browser-session-cookie",
});
const session = cookieSession("session-1");

const ready: PreviewLinksSettings = {
  enabled: true,
  suffix: "bagels.top",
  machine: "dorothy",
  defaultLifetime: "12h",
  gatewayPort: 3779,
};

type Connection = { readonly host: string; readonly key: string };

const laneRow = (id: string, portBase: number): LaneRow => ({
  id,
  checkoutPath: `/work/${id}`,
  projectId: ProjectId.make("project"),
  projectName: "Project",
  name: id,
  laneDir: `/lanes/${id}`,
  backend: "folder",
  capBytes: 1,
  device: null,
  createdAt: isoAt(0),
  portBase,
});

const laneStatus = (id: string): ProjectLifecycleLane => ({
  id,
  projectId: ProjectId.make("project"),
  projectName: "Project",
  name: id,
  checkoutPath: `/work/${id}`,
  laneDir: `/lanes/${id}`,
  spacePath: `/lanes/${id}/space`,
  tmpPath: `/lanes/${id}/tmp`,
  buildPath: `/lanes/${id}/build`,
  dataPath: `/lanes/${id}/data`,
  backend: "folder",
  state: "ready",
  capBytes: 1,
  usedBytes: null,
  imageBytes: null,
  threadIds: [],
  running: false,
  createdAt: isoAt(0),
  message: null,
  ports: null,
  leases: [],
  helpers: { run: "lane-run", slot: "lane-slot" },
});

const lifecycleStatus = (
  enabled: boolean,
  laneIds: ReadonlyArray<string>,
): ProjectLifecycleStatus => ({
  enabled,
  lanesRoot: "/lanes",
  backend: "folder",
  hostFreeBytes: null,
  hostTotalBytes: null,
  reserveBytes: 0,
  belowReserve: false,
  shell: { installed: false, profilePath: "/profile" },
  lanes: laneIds.map(laneStatus),
  buildSlots: { count: 1, holders: [] },
});

/** A browser session, or a DPoP one (mobile and T3 Connect) when given its subject. */
const clientSession = (
  sessionId: string,
  expiresAtMs: number,
  dpopSubject?: string,
): AuthClientSession => ({
  sessionId: AuthSessionId.make(sessionId),
  subject: dpopSubject ?? "owner",
  scopes: [],
  method: dpopSubject === undefined ? "browser-session-cookie" : "dpop-access-token",
  client: { deviceType: "desktop" },
  issuedAt: DateTime.makeUnsafe(0),
  expiresAt: DateTime.makeUnsafe(expiresAtMs),
  lastConnectedAt: null,
  connected: true,
  current: false,
});

const terminalServer = (port: number, threadId: ThreadId): DiscoveredLocalServer => ({
  host: "127.0.0.1",
  port,
  url: `http://127.0.0.1:${port}/`,
  processName: "node",
  pid: 100 + port,
  terminal: { threadId, terminalId: "default" },
});

const makeHarness = Effect.fn("makeHarness")(function* (
  options: {
    readonly baseDir?: string;
    readonly secrets?: Map<string, Uint8Array>;
    readonly serverPort?: number;
    readonly devUrl?: URL;
    readonly failGatewayPort?: number;
    readonly lanes?: ReadonlyMap<ThreadId, LaneRow>;
    readonly servers?: ReadonlyArray<DiscoveredLocalServer>;
    /** Sessions the store lists at start. One given by id is valid for 30 days. */
    readonly activeSessions?: ReadonlyArray<string | AuthClientSession>;
    /** A session revoked after the service subscribes to changes but before the list is read. */
    readonly removedWhileListing?: string;
    /** Runs after each secret is stored, before the write returns. */
    readonly afterSecretSet?: Effect.Effect<void>;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = options.baseDir ?? (yield* fs.makeTempDirectoryScoped());
  const baseConfig = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  const secretValues = options.secrets ?? new Map<string, Uint8Array>();
  // Like the real store, a change reaches only those already subscribed.
  const sessionChanges = yield* PubSub.unbounded<SessionCredentialChange>();
  const sessionsExpireAt = (yield* Clock.currentTimeMillis) + 30 * DAY;
  const removeSession = (sessionId: string) =>
    PubSub.publish(sessionChanges, {
      type: "clientRemoved",
      sessionId: AuthSessionId.make(sessionId),
    });
  const lifecycleChanges = yield* SubscriptionRef.make(lifecycleStatus(true, []));

  const gateway = {
    starts: [] as Array<number>,
    stops: 0,
    view: null as PreviewGatewayView | null,
    destroyed: yield* Queue.unbounded<(connection: Connection) => boolean>(),
  };
  // See `sessionChangesHandled`. A marker's drops go to their own queue, out of the tests' way.
  let markers = 0;
  let pendingMarker: string | null = null;
  const markerDropped = yield* Queue.unbounded<void>();
  const startGateway: StartPreviewGateway = ({ port, view }) =>
    Effect.gen(function* () {
      if (port === options.failGatewayPort) {
        return yield* Effect.fail(new PreviewGatewayListenError(port, `Port ${port} is in use.`));
      }
      gateway.starts.push(port);
      gateway.view = view;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          gateway.stops += 1;
        }),
      );
      return {
        port,
        destroyConnections: (match) => {
          if (pendingMarker !== null && match({ host: "", key: pendingMarker })) {
            Queue.offerUnsafe(markerDropped, undefined);
          } else {
            Queue.offerUnsafe(gateway.destroyed, match);
          }
        },
      };
    });

  const tunnel = { tokens: [] as Array<string>, stops: 0 };
  const runTunnel = (tunnelOptions: RunPreviewTunnelOptions) =>
    Effect.gen(function* () {
      tunnel.tokens.push(tunnelOptions.token);
      yield* tunnelOptions.onStatus({ state: "connected", message: null, metricsPort: 20241 });
      return yield* Effect.never;
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          tunnel.stops += 1;
        }),
      ),
    );

  const service = yield* makePreviewLinksService({ startGateway, runTunnel }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ServerConfig.ServerConfig, {
          ...baseConfig,
          port: options.serverPort ?? baseConfig.port,
          devUrl: options.devUrl,
        }),
        Layer.succeed(
          ServerSecretStore,
          ServerSecretStore.of({
            get: (name) => Effect.sync(() => Option.fromNullishOr(secretValues.get(name))),
            set: (name, value) =>
              Effect.sync(() => void secretValues.set(name, value)).pipe(
                Effect.andThen(options.afterSecretSet ?? Effect.void),
              ),
            create: (name, value) => Effect.sync(() => void secretValues.set(name, value)),
            getOrCreateRandom: (name, bytes) =>
              Effect.sync(() => {
                const existing = secretValues.get(name);
                if (existing !== undefined) return existing;
                const created = new Uint8Array(bytes).fill(secretValues.size + 1);
                secretValues.set(name, created);
                return created;
              }),
            remove: (name) => Effect.sync(() => void secretValues.delete(name)),
          }),
        ),
        Layer.mock(SessionStore)({
          cookieName: "t3_session",
          legacyCookieName: undefined,
          listActive: () =>
            Effect.gen(function* () {
              if (options.removedWhileListing !== undefined) {
                yield* removeSession(options.removedWhileListing);
              }
              return (options.activeSessions ?? ["session-1", "session-2"]).map((each) =>
                typeof each === "string" ? clientSession(each, sessionsExpireAt) : each,
              );
            }),
          streamChanges: Stream.fromPubSub(sessionChanges),
        }),
        Layer.mock(PortDiscovery)({
          scan: () => Effect.succeed(options.servers ?? []),
        }),
        Layer.mock(ProjectLifecycleService)({
          changes: SubscriptionRef.changes(lifecycleChanges),
          ensureForThread: (threadId) => {
            const lane = options.lanes?.get(threadId);
            return lane === undefined
              ? Effect.fail(
                  new ProjectLifecycleError({
                    reason: "disabled",
                    message: "Lanes are turned off in Settings.",
                  }),
                )
              : Effect.succeed(lane);
          },
        }),
        Layer.succeed(HostProcess.Hostname, "Dorothy.local"),
      ),
    ),
  );

  const waitFor = (predicate: (snapshot: PreviewLinksSnapshot) => boolean) =>
    service.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));

  const view = Effect.gen(function* () {
    yield* waitFor((snapshot) => snapshot.setup.gateway.state === "listening");
    if (gateway.view === null) return yield* Effect.die("The gateway never started.");
    return gateway.view;
  });

  return {
    service,
    gateway,
    tunnel,
    secretValues,
    waitFor,
    view,
    removeSession,
    upsertSession: (sessionId: string, expiresAtMs: number, dpopSubject?: string) =>
      PubSub.publish(sessionChanges, {
        type: "clientUpserted",
        clientSession: clientSession(sessionId, expiresAtMs, dpopSubject),
      }),
    /**
     * Session changes are handled in order, so once a marker session signs in and its removal
     * drops its connections, every change published before it has landed. Needs a running gateway.
     */
    sessionChangesHandled: Effect.suspend(() => {
      markers += 1;
      const marker = `marker-${markers}`;
      pendingMarker = marker;
      return PubSub.publish(sessionChanges, {
        type: "clientUpserted",
        clientSession: clientSession(marker, sessionsExpireAt),
      }).pipe(
        Effect.andThen(removeSession(marker)),
        Effect.andThen(Queue.take(markerDropped)),
        Effect.ensuring(Effect.sync(() => void (pendingMarker = null))),
      );
    }),
    setLanes: (enabled: boolean, laneIds: ReadonlyArray<string>) =>
      SubscriptionRef.set(lifecycleChanges, lifecycleStatus(enabled, laneIds)),
  };
});

const codeOf = (url: string) => new URL(url).searchParams.get("code") ?? "";

it.layer(NodeServices.layer)("PreviewLinksService", (it) => {
  it.effect("starts off with defaults and refuses to share", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness();
      expect((yield* service.snapshot).setup).toEqual({
        settings: {
          enabled: false,
          suffix: null,
          machine: "dorothy",
          defaultLifetime: "12h",
          gatewayPort: 3779,
        },
        tokenStored: false,
        ready: false,
        tunnel: { state: "off", message: null },
        gateway: { state: "off", message: null },
      });
      const error = yield* Effect.flip(service.share({ port: 5173 }, owner));
      expect(error.reason).toBe("not-configured");
      expect(error.message).toBe(
        "Preview links are off. Turn them on in Settings > Loom > Previews in the desktop or web app.",
      );
    }),
  );

  it.effect("reuses an open link for the port and keeps settings and links across restarts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      const first = yield* makeHarness({ baseDir, secrets });
      yield* first.service.configure({ settings: ready });
      const start = yield* Clock.currentTimeMillis;
      const link = yield* first.service.share({ port: 5173 }, owner);
      expect(link.host).toMatch(/^5173-[a-z0-9]{6}-dorothy\.bagels\.top$/);
      expect(link.url).toBe(`https://${link.host}/`);
      expect(link.expiresAt).toBe(isoAt(start + 12 * HOUR));
      expect((yield* first.service.share({ port: 5173, lifetime: "1h" }, owner)).id).toBe(link.id);

      const reopened = yield* makeHarness({ baseDir, secrets });
      const snapshot = yield* reopened.service.snapshot;
      expect(snapshot.setup.settings).toEqual(ready);
      expect(snapshot.links).toEqual([link]);
    }),
  );

  it.effect("lets agents share lane ports and their own terminal servers only", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness({
        lanes: new Map([[threadA, laneRow("lane-a", 41000)]]),
        servers: [terminalServer(5173, threadA), terminalServer(5174, threadB)],
      });
      yield* service.configure({ settings: ready });

      const laneLink = yield* service.share({ port: 41005 }, agentA);
      expect(laneLink).toMatchObject({ createdBy: "agent", threadId: threadA, laneId: "lane-a" });
      const terminalLink = yield* service.share({ port: 5173 }, agentA);
      expect(terminalLink.laneId).toBeNull();

      for (const port of [5174, 41020]) {
        const error = yield* Effect.flip(service.share({ port }, agentA));
        expect(error.reason).toBe("port-not-in-lane");
      }
      // Thread B has no lane (lanes report disabled), so only its own terminal server counts.
      expect((yield* service.share({ port: 5174 }, agentB)).threadId).toBe(threadB);
      expect((yield* Effect.flip(service.share({ port: 41006 }, agentB))).reason).toBe(
        "port-not-in-lane",
      );
    }),
  );

  it.effect("refuses an agent's revoke of another thread's link", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness({
        lanes: new Map([[threadA, laneRow("lane-a", 41000)]]),
      });
      yield* service.configure({ settings: ready });
      const link = yield* service.share({ port: 41005 }, agentA);
      const error = yield* Effect.flip(service.revoke(link.id, agentB));
      expect(error.reason).toBe("not-found");
      expect((yield* service.revoke(link.id, agentA)).state).toBe("revoked");
      expect((yield* service.listForThread(threadA)).map((each) => each.state)).toEqual([
        "revoked",
      ]);
      expect(yield* service.listForThread(threadB)).toEqual([]);
    }),
  );

  it.effect("denies reserved ports, the server's own ports and the tunnel's metrics port", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        serverPort: 4888,
        devUrl: new URL("http://localhost:5733/"),
      });
      yield* harness.service.configure({
        settings: { ...ready, gatewayPort: 4100 },
        tunnelToken: TOKEN,
      });
      yield* harness.waitFor((snapshot) => snapshot.setup.tunnel.state === "connected");
      for (const port of [22, 80, 5432, 9229, 4888, 5733, 4100, 20241]) {
        const error = yield* Effect.flip(harness.service.share({ port }, owner));
        expect(error.reason).toBe("port-denied");
      }
      const view = yield* harness.view;
      expect(view.portAllowed(4100)).toBe(false);
      expect(view.portAllowed(20241)).toBe(false);
      expect(view.portAllowed(5173)).toBe(true);
    }),
  );

  it.effect("mints single-use entry codes bound to a host, a clean path and 60 seconds", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;

      const entry = yield* harness.service.open({ link: link.id }, session);
      expect(entry.url.startsWith(`https://${link.host}/__loom/enter?code=`)).toBe(true);
      expect(codeOf(entry.url)).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // A code shown to the wrong host is spent, not left for replay.
      expect(view.redeem("5173-zzzzzz-dorothy.bagels.top", codeOf(entry.url))).toBeNull();
      expect(view.redeem(link.host, codeOf(entry.url))).toBeNull();

      const deep = yield* harness.service.open({ link: `${link.url}app?tab=1#top` }, session);
      const redeemed = view.redeem(link.host, codeOf(deep.url));
      expect(redeemed).toMatchObject({ maxAgeSeconds: 43200, path: "/app?tab=1#top" });
      expect(view.redeem(link.host, codeOf(deep.url))).toBeNull();
      expect(view.authorize(link.host, redeemed?.cookieValue ?? "")).toEqual({
        key: "session-1",
        sub: "owner",
      });

      const offsite = yield* harness.service.open(
        { link: link.id, path: "//evil.example" },
        session,
      );
      expect(view.redeem(link.host, codeOf(offsite.url))?.path).toBe("/");

      const late = yield* harness.service.open({ link: link.id }, session);
      yield* TestClock.adjust("61 seconds");
      expect(view.redeem(link.host, codeOf(late.url))).toBeNull();
    }),
  );

  it.effect("ends cookies for signed-out sessions and rotates the key on sign out", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      const enter = (sessionId: string) =>
        harness.service
          .open({ link: link.id }, cookieSession(sessionId))
          .pipe(
            Effect.map((entry) => view.redeem(link.host, codeOf(entry.url))?.cookieValue ?? ""),
          );
      const first = yield* enter("session-1");
      const second = yield* enter("session-2");
      expect(view.authorize("3000-zzzzzz-dorothy.bagels.top", first)).toBeNull();

      yield* harness.removeSession("session-1");
      const dropped = yield* Queue.take(harness.gateway.destroyed);
      expect(dropped({ host: link.host, key: "session-1" })).toBe(true);
      expect(dropped({ host: link.host, key: "session-2" })).toBe(false);
      expect(view.authorize(link.host, first)).toBeNull();
      expect(view.authorize(link.host, second)).not.toBeNull();

      const keyBefore = harness.secretValues.get(PREVIEW_COOKIE_KEY_SECRET);
      yield* harness.service.signOutBrowsers;
      expect(harness.secretValues.get(PREVIEW_COOKIE_KEY_SECRET)).not.toEqual(keyBefore);
      expect((yield* Queue.take(harness.gateway.destroyed))({ host: "any", key: "any" })).toBe(
        true,
      );
      expect(view.authorize(link.host, second)).toBeNull();
    }),
  );

  it.effect("applies a saved sign-out even when its caller is interrupted", () =>
    Effect.gen(function* () {
      const saved = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        afterSecretSet: Deferred.succeed(saved, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      const entry = yield* harness.service.open({ link: link.id }, session);
      const cookie = view.redeem(link.host, codeOf(entry.url))?.cookieValue ?? "";

      const signingOut = yield* Effect.forkChild(harness.service.signOutBrowsers);
      yield* Deferred.await(saved);
      // Started at once, so the interrupt lands while the sign-out still waits on the write.
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(signingOut), {
        startImmediately: true,
      });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupting);
      expect(view.authorize(link.host, cookie)).toBeNull();
    }),
  );

  it.effect("keeps a session removed from Loom out after a restart", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      const first = yield* makeHarness({ baseDir, secrets });
      yield* first.service.configure({ settings: ready });
      const link = yield* first.service.share({ port: 5173 }, owner);
      const firstView = yield* first.view;
      const enter = (sessionId: string) =>
        first.service
          .open({ link: link.id }, cookieSession(sessionId))
          .pipe(
            Effect.map(
              (entry) => firstView.redeem(link.host, codeOf(entry.url))?.cookieValue ?? "",
            ),
          );
      const removed = yield* enter("session-1");
      const kept = yield* enter("session-2");
      yield* first.removeSession("session-1");
      yield* Queue.take(first.gateway.destroyed);

      // The store stops listing a removed session, including one removed while this server was down.
      const reopened = yield* makeHarness({ baseDir, secrets, activeSessions: ["session-2"] });
      const view = yield* reopened.view;
      expect(view.authorize(link.host, removed)).toBeNull();
      expect(view.authorize(link.host, kept)).toEqual({ key: "session-2", sub: "owner" });
    }),
  );

  it.effect("keeps out a session removed while the list of sessions was being read", () =>
    Effect.gen(function* () {
      // The list was read before the revoke committed, so it still holds session-1.
      const harness = yield* makeHarness({ removedWhileListing: "session-1" });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      yield* harness.sessionChangesHandled;
      const enter = (sessionId: string) =>
        harness.service
          .open({ link: link.id }, cookieSession(sessionId))
          .pipe(Effect.map((entry) => view.redeem(link.host, codeOf(entry.url))));
      expect(yield* enter("session-1")).toBeNull();
      expect(yield* enter("session-2")).not.toBeNull();
    }),
  );

  it.effect("admits sessions that sign in later until they expire or are removed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ activeSessions: [] });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      const enter = (sessionId: string) =>
        harness.service
          .open({ link: link.id }, cookieSession(sessionId))
          .pipe(Effect.map((entry) => view.redeem(link.host, codeOf(entry.url))?.cookieValue));
      expect(yield* enter("session-3")).toBeUndefined();
      // The expiry timer settles into its sleep toward the link's 12 hours first.
      yield* TestClock.adjust("1 second");

      const start = yield* Clock.currentTimeMillis;
      yield* harness.upsertSession("session-3", start + HOUR);
      yield* harness.upsertSession("session-4", start + DAY);
      yield* harness.sessionChangesHandled;
      const third = (yield* enter("session-3")) ?? "";
      const fourth = (yield* enter("session-4")) ?? "";
      expect(view.authorize(link.host, third)).toEqual({ key: "session-3", sub: "owner" });

      // The cookie is good for 12 hours, but not past the session it stands for. A session that
      // runs out with its client away sends no change, so its expiry alone ends what is running.
      yield* TestClock.adjust("1 hour");
      expect(view.authorize(link.host, third)).toBeNull();
      const expired = yield* Queue.take(harness.gateway.destroyed);
      expect(expired({ host: link.host, key: "session-3" })).toBe(true);
      expect(expired({ host: link.host, key: "session-4" })).toBe(false);

      yield* harness.removeSession("session-4");
      yield* Queue.take(harness.gateway.destroyed);
      // An upsert read just before the revoke committed can still arrive after the removal.
      yield* harness.upsertSession("session-4", start + DAY);
      yield* harness.sessionChangesHandled;
      expect(view.authorize(link.host, fourth)).toBeNull();
    }),
  );

  it.effect("keeps a T3 Connect browser in across hourly sessions until one is removed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ activeSessions: [] });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      const enter = (sessionId: string) =>
        harness.service
          .open(
            { link: link.id },
            { sessionId, subject: "cloud-connect", method: "dpop-access-token" },
          )
          .pipe(
            Effect.map((entry) => view.redeem(link.host, codeOf(entry.url))?.cookieValue ?? ""),
          );
      const family = { key: "dpop:cloud-connect", sub: "cloud-connect" };
      const start = yield* Clock.currentTimeMillis;
      yield* harness.upsertSession("relay-a", start + HOUR, "cloud-connect");
      yield* harness.sessionChangesHandled;
      const cookie = yield* enter("relay-a");

      // The client asks for its next session only once relay-a runs out and the store closes its
      // socket, which the store reports as a removal.
      yield* TestClock.adjust("1 hour");
      yield* harness.removeSession("relay-a");
      yield* harness.sessionChangesHandled;
      expect(view.authorize(link.host, cookie)).toEqual(family);
      yield* TestClock.adjust("2 seconds");
      yield* harness.upsertSession("relay-b", start + 2 * HOUR + 2000, "cloud-connect");
      yield* harness.sessionChangesHandled;
      yield* TestClock.adjust("10 minutes");
      expect(Option.isNone(yield* Queue.poll(harness.gateway.destroyed))).toBe(true);
      expect(view.authorize(link.host, cookie)).toEqual(family);

      yield* harness.removeSession("relay-b");
      const dropped = yield* Queue.take(harness.gateway.destroyed);
      expect(dropped({ host: link.host, key: "dpop:cloud-connect" })).toBe(true);
      expect(view.authorize(link.host, cookie)).toBeNull();

      // A later session of the subject does not bring old cookies back, only fresh entries.
      yield* TestClock.adjust("1 second");
      yield* harness.upsertSession("relay-c", start + 3 * HOUR, "cloud-connect");
      yield* harness.sessionChangesHandled;
      expect(view.authorize(link.host, cookie)).toBeNull();
      expect(view.authorize(link.host, yield* enter("relay-c"))).toEqual(family);
    }),
  );

  it.effect("ends a T3 Connect browser's access once its device stays away past the grace", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ activeSessions: [] });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      const start = yield* Clock.currentTimeMillis;
      yield* harness.upsertSession("relay-a", start + HOUR, "cloud-connect");
      yield* harness.sessionChangesHandled;
      const entry = yield* harness.service.open(
        { link: link.id },
        clientSession("relay-a", start + HOUR, "cloud-connect"),
      );
      const cookie = view.redeem(link.host, codeOf(entry.url))?.cookieValue ?? "";
      const family = { key: "dpop:cloud-connect", sub: "cloud-connect" };

      yield* TestClock.adjust("1 hour");
      yield* harness.removeSession("relay-a");
      yield* harness.sessionChangesHandled;
      yield* TestClock.adjust("4 minutes");
      expect(view.authorize(link.host, cookie)).toEqual(family);
      yield* TestClock.adjust("1 minute");
      expect(view.authorize(link.host, cookie)).toBeNull();
      const ended = yield* Queue.take(harness.gateway.destroyed);
      expect(ended({ host: link.host, key: "dpop:cloud-connect" })).toBe(true);

      // Running out revokes nothing, so the device's next session lets the same browser back in.
      yield* harness.upsertSession("relay-b", start + 2 * HOUR, "cloud-connect");
      yield* harness.sessionChangesHandled;
      expect(view.authorize(link.host, cookie)).toEqual(family);
    }),
  );

  it.effect("keeps a T3 Connect browser out after a restart while the subject stays in", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      // An odd millisecond, so the saved revocation has to keep milliseconds.
      yield* TestClock.adjust("1234 millis");
      const start = yield* Clock.currentTimeMillis;
      const relay = (sessionId: string) => clientSession(sessionId, start + HOUR, "cloud-connect");
      const first = yield* makeHarness({
        baseDir,
        secrets,
        activeSessions: [relay("relay-a"), relay("relay-b")],
      });
      yield* first.service.configure({ settings: ready });
      const link = yield* first.service.share({ port: 5173 }, owner);
      const firstView = yield* first.view;
      const entry = yield* first.service.open({ link: link.id }, relay("relay-a"));
      const cookie = firstView.redeem(link.host, codeOf(entry.url))?.cookieValue ?? "";
      yield* first.removeSession("relay-a");
      yield* Queue.take(first.gateway.destroyed);
      // The next change is handled only once the revocation is saved.
      yield* first.sessionChangesHandled;

      const reopened = yield* makeHarness({ baseDir, secrets, activeSessions: [relay("relay-b")] });
      const view = yield* reopened.view;
      expect(view.authorize(link.host, cookie)).toBeNull();
      yield* TestClock.adjust("1 second");
      const fresh = yield* reopened.service.open({ link: link.id }, relay("relay-b"));
      expect(
        view.authorize(link.host, view.redeem(link.host, codeOf(fresh.url))?.cookieValue ?? ""),
      ).toEqual({ key: "dpop:cloud-connect", sub: "cloud-connect" });
    }),
  );

  it.effect("expires links on time and purges them after the restore window", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.service.configure({ settings: ready });
      const start = yield* Clock.currentTimeMillis;
      const link = yield* harness.service.share({ port: 5173, lifetime: "1h" }, owner);
      const view = yield* harness.view;
      expect(view.route(link.host)).toEqual({ _tag: "Link", linkId: link.id, port: 5173 });

      yield* TestClock.adjust("1 hour");
      const expired = yield* harness.waitFor((snapshot) => snapshot.links[0]?.state === "expired");
      expect(expired.links[0]).toMatchObject({
        endedAt: isoAt(start + HOUR),
        restorableUntil: isoAt(start + HOUR + 7 * DAY),
      });
      expect(view.route(link.host)).toEqual({ _tag: "Ended" });

      yield* TestClock.adjust("7 days");
      yield* harness.waitFor((snapshot) => snapshot.links.length === 0);
    }),
  );

  it.effect("restores an ended link at the same address", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      yield* harness.service.revoke(link.id, owner);
      expect(view.route(link.host)).toEqual({ _tag: "Ended" });
      const ended = yield* Effect.flip(harness.service.open({ link: link.url }, session));
      expect(ended.message).toBe(
        "This link ended. Restore it in Settings > Loom > Previews, or Settings > Previews on mobile.",
      );

      const restored = yield* harness.service.restore({ linkId: link.id, lifetime: "24h" });
      expect(restored).toMatchObject({
        host: link.host,
        state: "open",
        endedAt: null,
        expiresAt: isoAt((yield* Clock.currentTimeMillis) + 24 * HOUR),
      });
      expect(view.route(link.host)).toEqual({ _tag: "Link", linkId: link.id, port: 5173 });
    }),
  );

  it.effect("will not restore a link while its port has another open link", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.service.configure({ settings: ready });
      const ended = yield* harness.service.share({ port: 5173 }, owner);
      yield* harness.service.revoke(ended.id, owner);
      const current = yield* harness.service.share({ port: 5173 }, owner);

      const error = yield* Effect.flip(harness.service.restore({ linkId: ended.id }));
      expect(error).toMatchObject({
        reason: "not-restorable",
        message: "Port 5173 already has an open link. End it first, then restore this one.",
      });
      const open = (yield* harness.service.snapshot).links.filter((link) => link.state === "open");
      expect(open.map((link) => link.id)).toEqual([current.id]);
    }),
  );

  it.effect("ends open links when the domain changes and will not restore them under it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      yield* harness.service.configure({ settings: { ...ready, suffix: "example.com" } });
      expect((yield* harness.service.snapshot).links.map((each) => each.state)).toEqual([
        "revoked",
      ]);
      expect(view.route(link.host)).toEqual({ _tag: "Foreign" });
      const error = yield* Effect.flip(harness.service.restore({ linkId: link.id }));
      expect(error.reason).toBe("not-restorable");
    }),
  );

  it.effect("ends agent lane links only after their lane is seen and then removed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        lanes: new Map([
          [threadA, laneRow("lane-a", 41000)],
          [threadB, laneRow("lane-b", 41020)],
        ]),
      });
      yield* harness.service.configure({ settings: ready });
      const linkA = yield* harness.service.share({ port: 41005 }, agentA);
      const linkB = yield* harness.service.share({ port: 41025 }, agentB);
      yield* harness.setLanes(true, ["lane-a", "lane-b"]);
      yield* harness.setLanes(false, []);
      yield* harness.setLanes(true, ["lane-a"]);
      const snapshot = yield* harness.waitFor((next) =>
        next.links.some((link) => link.id === linkB.id && link.state === "revoked"),
      );
      expect(snapshot.links.find((link) => link.id === linkA.id)?.state).toBe("open");
    }),
  );

  it.effect("starts and stops the gateway and tunnel only for what changed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const setup = yield* harness.service.configure({ settings: ready, tunnelToken: TOKEN });
      expect(setup).toMatchObject({ ready: true, tokenStored: true });
      expect(new TextDecoder().decode(harness.secretValues.get(PREVIEW_TUNNEL_TOKEN_SECRET))).toBe(
        TOKEN,
      );
      yield* harness.waitFor(
        (snapshot) =>
          snapshot.setup.gateway.state === "listening" &&
          snapshot.setup.tunnel.state === "connected",
      );

      yield* harness.service.configure({ settings: { ...ready, defaultLifetime: "1h" } });
      expect(harness.gateway.starts).toEqual([3779]);
      expect(harness.tunnel.tokens).toEqual([TOKEN]);

      const off = yield* harness.service.configure({ settings: { ...ready, enabled: false } });
      expect(off.gateway.state).toBe("off");
      expect(off.tunnel.state).toBe("off");
      expect(harness.gateway.stops).toBe(1);
      expect(harness.tunnel.stops).toBe(1);

      const cleared = yield* harness.service.configure({ settings: ready, tunnelToken: null });
      expect(cleared.tunnel.state).toBe("needs-token");
      expect(harness.secretValues.has(PREVIEW_TUNNEL_TOKEN_SECRET)).toBe(false);
    }),
  );

  it.effect("reports a gateway that cannot listen and retries on the next save", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failGatewayPort: 3779 });
      yield* harness.service.configure({ settings: ready });
      const failed = yield* harness.waitFor((snapshot) => snapshot.setup.gateway.state === "error");
      expect(failed.setup.gateway.message).toBe("Port 3779 is in use.");

      yield* harness.service.configure({ settings: { ...ready, gatewayPort: 4100 } });
      yield* harness.view;
      expect(harness.gateway.starts).toEqual([4100]);
    }),
  );
});
