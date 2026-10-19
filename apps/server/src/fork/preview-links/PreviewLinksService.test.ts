import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, ProjectId, ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import {
  ProjectLifecycleError,
  type PreviewLinksSettings,
  type PreviewLinksSnapshot,
  type ProjectLifecycleLane,
  type ProjectLifecycleStatus,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
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
const session = { sessionId: "session-1", subject: "owner" };

const ready: PreviewLinksSettings = {
  enabled: true,
  suffix: "bagels.top",
  machine: "dorothy",
  defaultLifetime: "12h",
  gatewayPort: 3779,
};

type Connection = { readonly host: string; readonly sid: string };

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
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = options.baseDir ?? (yield* fs.makeTempDirectoryScoped());
  const baseConfig = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  const secretValues = options.secrets ?? new Map<string, Uint8Array>();
  const sessionChanges = yield* PubSub.unbounded<SessionCredentialChange>({ replay: 16 });
  const lifecycleChanges = yield* SubscriptionRef.make(lifecycleStatus(true, []));

  const gateway = {
    starts: [] as Array<number>,
    stops: 0,
    view: null as PreviewGatewayView | null,
    destroyed: yield* Queue.unbounded<(connection: Connection) => boolean>(),
  };
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
        destroyUpgrades: (match) => {
          Queue.offerUnsafe(gateway.destroyed, match);
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
            set: (name, value) => Effect.sync(() => void secretValues.set(name, value)),
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
    removeSession: (sessionId: string) =>
      PubSub.publish(sessionChanges, {
        type: "clientRemoved",
        sessionId: AuthSessionId.make(sessionId),
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
      expect(error.message).toBe("Preview links are off. Turn them on in Settings > Previews.");
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
        sid: "session-1",
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
          .open({ link: link.id }, { sessionId, subject: "owner" })
          .pipe(
            Effect.map((entry) => view.redeem(link.host, codeOf(entry.url))?.cookieValue ?? ""),
          );
      const first = yield* enter("session-1");
      const second = yield* enter("session-2");
      expect(view.authorize("3000-zzzzzz-dorothy.bagels.top", first)).toBeNull();

      yield* harness.removeSession("session-1");
      const dropped = yield* Queue.take(harness.gateway.destroyed);
      expect(dropped({ host: link.host, sid: "session-1" })).toBe(true);
      expect(dropped({ host: link.host, sid: "session-2" })).toBe(false);
      expect(view.authorize(link.host, first)).toBeNull();
      expect(view.authorize(link.host, second)).not.toBeNull();

      const keyBefore = harness.secretValues.get(PREVIEW_COOKIE_KEY_SECRET);
      yield* harness.service.signOutBrowsers;
      expect(harness.secretValues.get(PREVIEW_COOKIE_KEY_SECRET)).not.toEqual(keyBefore);
      expect((yield* Queue.take(harness.gateway.destroyed))({ host: "any", sid: "any" })).toBe(
        true,
      );
      expect(view.authorize(link.host, second)).toBeNull();
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
      expect(ended.message).toBe("This link ended. Restore it in Settings > Previews.");

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
