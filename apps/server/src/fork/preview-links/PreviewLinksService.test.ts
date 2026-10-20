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
  LibraryError,
  ProjectLifecycleError,
  type LibraryPreviewAccess,
  type LibraryPreviewRegisterRequest,
  type PreviewLinksSettings,
  type PreviewLinksSnapshot,
  type ProjectLifecycleLane,
  type ProjectLifecycleSettings,
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
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { TestClock } from "effect/testing";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { SessionStore, type SessionCredentialChange } from "../../auth/SessionStore.ts";
import * as ServerConfig from "../../config.ts";
import { PortDiscovery } from "../../preview/PortScanner.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { ProjectLifecycleService } from "../project-lifecycle/ProjectLifecycleService.ts";
import type { LaneRow } from "../project-lifecycle/store.ts";
import { DOCKER_MISSING_MESSAGE } from "./backings.ts";
import { isoAt } from "./policy.ts";
import {
  PREVIEW_COOKIE_KEY_SECRET,
  PREVIEW_TUNNEL_TOKEN_SECRET,
  makePreviewLinksService,
  type PreviewLinkActor,
  type PreviewLinksSession,
} from "./PreviewLinksService.ts";
import {
  generatePreviewTicketKeyPair,
  previewTicketAudience,
  previewTicketKeyId,
  previewTicketPrivateKey,
  randomPreviewNonce,
  signPreviewTicket,
} from "./ticket.ts";
import {
  PreviewFolderListenError,
  PreviewGatewayListenError,
  type PreviewGatewayView,
  type RunPreviewTunnelOptions,
  type ServePreviewFolder,
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

const LIBRARY_ORIGIN = "https://library.example.test";

type RegisteredPreviews = LibraryPreviewRegisterRequest["previews"];

/** A Library that signs tickets with its own key and answers registrations as told. */
const makeLibrary = Effect.gen(function* () {
  const keys = generatePreviewTicketKeyPair();
  const privateKey = previewTicketPrivateKey(keys.privateKey);
  if (privateKey === null) return yield* Effect.die("The ticket key did not load.");
  const access: LibraryPreviewAccess = {
    origin: LIBRARY_ORIGIN,
    ticketPath: "/api/loom/preview/ticket",
    keyId: previewTicketKeyId(keys.publicKey),
    publicKey: keys.publicKey,
  };
  const calls = yield* Queue.unbounded<RegisteredPreviews>();
  let answer: Effect.Effect<LibraryPreviewAccess, LibraryError> = Effect.succeed(access);
  return {
    access,
    calls,
    answer: (next: Effect.Effect<LibraryPreviewAccess, LibraryError>) => {
      answer = next;
    },
    registerPreviews: (previews: RegisteredPreviews) =>
      Queue.offer(calls, previews).pipe(Effect.andThen(Effect.suspend(() => answer))),
    ticket: (host: string, nonce: string, nowMs: number) =>
      signPreviewTicket({
        privateKey,
        keyId: access.keyId,
        issuer: LIBRARY_ORIGIN,
        audience: previewTicketAudience(host),
        subject: "pocket-kyle",
        nonce,
        nowMs,
      }),
  };
});

/**
 * Takes every registration so far and checks each asked for `previews`. Startup may register
 * once more alongside the first save, so the count is not fixed.
 */
const expectRegistrations = (
  library: { readonly calls: Queue.Queue<RegisteredPreviews> },
  previews: RegisteredPreviews,
) =>
  Queue.clear(library.calls).pipe(
    Effect.map((calls) =>
      expect([...new Set(calls.map((each) => JSON.stringify(each)))]).toEqual([
        JSON.stringify(previews),
      ]),
    ),
  );

const DOCKER = "/usr/local/bin/docker";

const dockerReply = (code: number, stdout = "", stderr = ""): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

/** Takes events until one starts with `prefix`, so a test waits on what happened, never on time. */
const nextEvent = (events: Queue.Queue<string>, prefix: string): Effect.Effect<string> =>
  Queue.take(events).pipe(
    Effect.filterOrElse(
      (event) => event.startsWith(prefix),
      () => nextEvent(events, prefix),
    ),
  );

const makeHarness = Effect.fn("makeHarness")(function* (
  options: {
    readonly baseDir?: string;
    readonly secrets?: Map<string, Uint8Array>;
    readonly serverPort?: number;
    readonly devUrl?: URL;
    readonly failGatewayPort?: number;
    readonly lanes?: ReadonlyMap<ThreadId, LaneRow>;
    /** Ports something listens on over ::1 only, from the start. */
    readonly ipv6Ports?: ReadonlyArray<number>;
    readonly servers?: ReadonlyArray<DiscoveredLocalServer>;
    /** Sessions the store lists at start. One given by id is valid for 30 days. */
    readonly activeSessions?: ReadonlyArray<string | AuthClientSession>;
    /** A session revoked after the service subscribes to changes but before the list is read. */
    readonly removedWhileListing?: string;
    /** Runs after each secret is stored, before the write returns. */
    readonly afterSecretSet?: Effect.Effect<void>;
    /** Without one, no Library is configured. */
    readonly library?: {
      readonly registerPreviews: LibraryPublisher["Service"]["registerPreviews"];
    };
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
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

  /** Folder servers by port. Events read `start <port>` and `stop <port>`. */
  const folders = {
    open: new Map<number, string>(),
    events: yield* Queue.unbounded<string>(),
  };
  /** Ports something outside Loom listens on. */
  const busyPorts = new Set<number>();
  /**
   * Ports something listens on over ::1 only. A 127.0.0.1 bind still succeeds beside it, but the
   * port probe sees it.
   */
  const ipv6Ports = new Set<number>(options.ipv6Ports);
  const serveFolder: ServePreviewFolder = ({ root, port }) =>
    Effect.gen(function* () {
      if (busyPorts.has(port) || folders.open.has(port)) {
        return yield* Effect.fail(new PreviewFolderListenError(port, `Port ${port} is in use.`));
      }
      folders.open.set(port, root);
      Queue.offerUnsafe(folders.events, `start ${port}`);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          folders.open.delete(port);
          Queue.offerUnsafe(folders.events, `stop ${port}`);
        }),
      );
      return { port };
    });

  /**
   * A docker that runs nothing. Each command's arguments land in `commands`, and containers report
   * the state in `states`, keyed by short id, until removed.
   */
  const docker = {
    path: DOCKER as string | null,
    runs: [] as Array<ReadonlyArray<string>>,
    commands: yield* Queue.unbounded<string>(),
    states: new Map<string, "true" | "false">(),
    /** Stderr for `docker run` to fail with. */
    failRun: null as string | null,
    /** Holds each `docker run` after it is recorded in `commands`, until it completes. */
    runGate: null as Deferred.Deferred<void> | null,
  };
  const reply = (args: ReadonlyArray<string>) => {
    const target = args.at(-1) ?? "";
    switch (args[0]) {
      case "run": {
        docker.runs.push(args);
        if (docker.failRun !== null) return dockerReply(125, "", docker.failRun);
        const id = String(docker.runs.length).padStart(12, "0");
        docker.states.set(id, "true");
        return dockerReply(0, `${id.padEnd(64, "f")}\n`);
      }
      case "inspect": {
        const state = docker.states.get(target);
        return state === undefined
          ? dockerReply(1, "", `Error: No such object: ${target}`)
          : dockerReply(0, `${state}\n`);
      }
      case "rm":
        return docker.states.delete(target)
          ? dockerReply(0, `${target}\n`)
          : dockerReply(1, "", `Error: No such container: ${target}`);
      case "ps":
        return dockerReply(0);
      default:
        return dockerReply(1, "", "unknown command");
    }
  };
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.suspend(() => {
        if (input.command !== docker.path) {
          return Effect.succeed(dockerReply(127, "", "not docker"));
        }
        Queue.offerUnsafe(docker.commands, input.args.join(" "));
        const gate = input.args[0] === "run" ? docker.runGate : null;
        return (gate === null ? Effect.void : Deferred.await(gate)).pipe(
          Effect.andThen(Effect.sync(() => reply(input.args))),
        );
      }),
  });

  const service = yield* makePreviewLinksService({
    startGateway,
    runTunnel,
    serveFolder,
    portFree: (port) =>
      Effect.sync(() => !busyPorts.has(port) && !ipv6Ports.has(port) && !folders.open.has(port)),
    dockerPath: Effect.sync(() => docker.path),
  }).pipe(
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
          getSettings: SubscriptionRef.get(lifecycleChanges).pipe(
            Effect.map((status): ProjectLifecycleSettings => ({
              enabled: status.enabled,
              lanesRoot: status.lanesRoot,
              defaultCapGb: 40,
              appleCapGb: 100,
              reserveGb: 40,
              projectCapsGb: {},
              buildSlots: null,
            })),
          ),
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
        Layer.mock(LibraryPublisher)(
          options.library === undefined
            ? { enabled: false }
            : { enabled: true, registerPreviews: options.library.registerPreviews },
        ),
        Layer.succeed(HostProcess.Hostname, "Dorothy.local"),
        Layer.succeed(ProcessRunner.ProcessRunner, runner),
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
    folders,
    busyPorts,
    docker,
    secretValues,
    waitFor,
    view,
    savedState: fs
      .readFileString(path.join(baseConfig.stateDir, "fork", "preview-links", "state.json"))
      .pipe(
        Effect.map((text): { readonly libraryKeys?: ReadonlyArray<unknown> } => JSON.parse(text)),
        Effect.orDie,
      ),
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

/** A workspace with a built site in `dist`, a file, and a symlink to a folder outside it. */
const makeSite = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const outside = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const site = path.join(workspace, "dist");
  yield* fs.makeDirectory(site);
  yield* fs.writeFileString(path.join(site, "index.html"), "<h1>Site</h1>");
  yield* fs.writeFileString(path.join(workspace, "notes.txt"), "notes");
  yield* fs.symlink(outside, path.join(workspace, "outside"));
  return { workspace, site };
});

const siteLanes = (workspace: string) =>
  new Map([[threadA, { ...laneRow("lane-a", 41000), checkoutPath: workspace }]]);

const containerLanes = new Map([[threadA, laneRow("lane-a", 41000)]]);

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

  it.effect("signs a browser in with a Library ticket, once", () =>
    Effect.gen(function* () {
      const library = yield* makeLibrary;
      const harness = yield* makeHarness({ library });
      yield* harness.service.configure({ settings: ready });
      yield* expectRegistrations(library, { machine: "dorothy", suffix: "bagels.top" });
      const link = yield* harness.service.share({ port: 5173 }, owner);
      const view = yield* harness.view;
      expect(view.libraryAccess()).toEqual({
        origin: LIBRARY_ORIGIN,
        ticketPath: library.access.ticketPath,
      });
      const nowMs = yield* Clock.currentTimeMillis;
      const nonce = randomPreviewNonce();
      const ticket = library.ticket(link.host, nonce, nowMs);
      // Refused without being spent: another host, another browser's nonce, or no nonce.
      expect(view.redeemTicket("5174-aaaaaa-dorothy.bagels.top", ticket, nonce, "/")).toBeNull();
      expect(view.redeemTicket(link.host, ticket, randomPreviewNonce(), "/")).toBeNull();
      expect(view.redeemTicket(link.host, ticket, "", "/")).toBeNull();

      const entry = view.redeemTicket(link.host, ticket, nonce, "/deep?x=1");
      expect(entry).toMatchObject({ maxAgeSeconds: 12 * 60 * 60, path: "/deep?x=1" });
      expect(view.authorize(link.host, entry?.cookieValue ?? "")).toEqual({
        key: "library:pocket-kyle",
        sub: "pocket-kyle",
      });
      expect(view.redeemTicket(link.host, ticket, nonce, "/")).toBeNull();
      const again = library.ticket(link.host, nonce, nowMs);
      expect(view.redeemTicket(link.host, again, nonce, "/")).toBeNull();

      const stranger = yield* makeLibrary;
      const strangerNonce = randomPreviewNonce();
      expect(
        view.redeemTicket(
          link.host,
          stranger.ticket(link.host, strangerNonce, nowMs),
          strangerNonce,
          "/",
        ),
      ).toBeNull();

      const lateNonce = randomPreviewNonce();
      const late = library.ticket(link.host, lateNonce, nowMs);
      // A minute to live plus 30 seconds of allowed clock skew.
      yield* TestClock.adjust("91 seconds");
      expect(view.redeemTicket(link.host, late, lateNonce, "/")).toBeNull();
      const freshNonce = randomPreviewNonce();
      const fresh = library.ticket(link.host, freshNonce, yield* Clock.currentTimeMillis);
      expect(view.redeemTicket(link.host, fresh, freshNonce, "//evil.example")?.path).toBe("/");
    }),
  );

  it.effect("ends what a Library sign-in has running once its cookie runs out", () =>
    Effect.gen(function* () {
      const library = yield* makeLibrary;
      const harness = yield* makeHarness({ library });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.share({ port: 5173, lifetime: "24h" }, owner);
      const view = yield* harness.view;
      const nonce = randomPreviewNonce();
      const ticket = library.ticket(link.host, nonce, yield* Clock.currentTimeMillis);
      const cookie = view.redeemTicket(link.host, ticket, nonce, "/")?.cookieValue ?? "";
      yield* Queue.clear(harness.gateway.destroyed);

      yield* TestClock.adjust("12 hours");
      const dropped = yield* Queue.take(harness.gateway.destroyed);
      expect(dropped({ host: link.host, key: "library:pocket-kyle" })).toBe(true);
      expect(dropped({ host: link.host, key: "session-1" })).toBe(false);
      expect(view.authorize(link.host, cookie)).toBeNull();
    }),
  );

  it.effect("keeps Library sign-ins across a restart until browsers are signed out", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      const library = yield* makeLibrary;
      const first = yield* makeHarness({ baseDir, secrets, library });
      yield* first.service.configure({ settings: ready });
      const link = yield* first.service.share({ port: 5173 }, owner);
      const firstView = yield* first.view;
      const nonce = randomPreviewNonce();
      const ticket = library.ticket(link.host, nonce, yield* Clock.currentTimeMillis);
      const cookie = firstView.redeemTicket(link.host, ticket, nonce, "/")?.cookieValue ?? "";
      // Any save also writes the sign-ins.
      yield* first.service.configure({ settings: ready });

      const reopened = yield* makeHarness({ baseDir, secrets, library });
      const view = yield* reopened.view;
      expect(view.authorize(link.host, cookie)).toEqual({
        key: "library:pocket-kyle",
        sub: "pocket-kyle",
      });

      yield* reopened.service.signOutBrowsers;
      const dropped = yield* Queue.take(reopened.gateway.destroyed);
      expect(dropped({ host: link.host, key: "library:pocket-kyle" })).toBe(true);
      expect(view.authorize(link.host, cookie)).toBeNull();
      expect((yield* reopened.savedState).libraryKeys).toEqual([]);
    }),
  );

  it.effect("never redeems a ticket from before a restart, which only memory knew was spent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      const library = yield* makeLibrary;
      const first = yield* makeHarness({ baseDir, secrets, library });
      yield* first.service.configure({ settings: ready });
      const link = yield* first.service.share({ port: 5173 }, owner);
      const nonce = randomPreviewNonce();
      const ticket = library.ticket(link.host, nonce, yield* Clock.currentTimeMillis);
      expect((yield* first.view).redeemTicket(link.host, ticket, nonce, "/")).not.toBeNull();

      // Still inside the ticket's minute, so only the restart can refuse it.
      yield* TestClock.adjust("1 second");
      const reopened = yield* makeHarness({ baseDir, secrets, library });
      yield* reopened.service.configure({ settings: ready });
      const view = yield* reopened.view;
      expect(view.redeemTicket(link.host, ticket, nonce, "/")).toBeNull();
      const freshNonce = randomPreviewNonce();
      const fresh = library.ticket(link.host, freshNonce, yield* Clock.currentTimeMillis);
      expect(view.redeemTicket(link.host, fresh, freshNonce, "/")).not.toBeNull();
    }),
  );

  it.effect("tells the Library when previews turn on and off, and rides out a Library blip", () =>
    Effect.gen(function* () {
      const library = yield* makeLibrary;
      const harness = yield* makeHarness({ library });
      const previews = { machine: "dorothy", suffix: "bagels.top" };
      const signIn = { origin: LIBRARY_ORIGIN, ticketPath: library.access.ticketPath };
      yield* harness.service.configure({ settings: ready });
      yield* expectRegistrations(library, previews);
      const view = yield* harness.view;
      expect(view.libraryAccess()).toEqual(signIn);

      library.answer(Effect.fail(new LibraryError({ reason: "io" })));
      yield* harness.service.configure({ settings: { ...ready, defaultLifetime: "1h" } });
      yield* expectRegistrations(library, previews);
      expect(view.libraryAccess()).toEqual(signIn);

      library.answer(Effect.succeed(library.access));
      yield* harness.service.configure({ settings: { ...ready, enabled: false } });
      yield* expectRegistrations(library, null);
      expect(view.libraryAccess()).toBeNull();

      yield* harness.service.configure({ settings: ready });
      yield* expectRegistrations(library, previews);
      expect(view.libraryAccess()).toEqual(signIn);

      // An older Library has no preview sign-in, so there is nothing to turn off afterwards.
      library.answer(Effect.fail(new LibraryError({ reason: "not-found" })));
      yield* harness.service.configure({ settings: { ...ready, defaultLifetime: "1h" } });
      yield* expectRegistrations(library, previews);
      expect(view.libraryAccess()).toBeNull();
      yield* harness.service.configure({ settings: { ...ready, enabled: false } });
      expect(yield* Queue.clear(library.calls)).toEqual([]);
    }),
  );

  it.effect("asks the Library again every half hour", () =>
    Effect.gen(function* () {
      const library = yield* makeLibrary;
      const harness = yield* makeHarness({ library });
      yield* harness.service.configure({ settings: ready });
      yield* Queue.clear(library.calls);
      yield* TestClock.adjust("30 minutes");
      expect(yield* Queue.take(library.calls)).toEqual({
        machine: "dorothy",
        suffix: "bagels.top",
      });
    }),
  );

  it.effect("serves a workspace folder on the first free lane port, once per folder", () =>
    Effect.gen(function* () {
      const { workspace, site } = yield* makeSite;
      const harness = yield* makeHarness({ lanes: siteLanes(workspace) });
      yield* harness.service.configure({ settings: ready });
      harness.busyPorts.add(41000);
      yield* harness.service.share({ port: 41001 }, agentA);

      const link = yield* harness.service.shareFolder({ path: "dist" }, threadA);
      expect(link).toMatchObject({
        port: 41002,
        createdBy: "agent",
        threadId: threadA,
        laneId: "lane-a",
        backing: { kind: "folder", path: "dist" },
      });
      expect(harness.folders.open.get(41002)).toBe(site);
      expect((yield* harness.view).route(link.host)).toEqual({
        _tag: "Link",
        linkId: link.id,
        port: 41002,
      });
      expect((yield* harness.service.shareFolder({ path: "./dist/" }, threadA)).id).toBe(link.id);
      expect([...harness.folders.open.keys()]).toEqual([41002]);
    }),
  );

  it.effect("refuses folders outside the workspace, files, and threads without lane ports", () =>
    Effect.gen(function* () {
      const { workspace } = yield* makeSite;
      const harness = yield* makeHarness({
        lanes: new Map([
          [threadA, { ...laneRow("lane-a", 41000), checkoutPath: workspace }],
          [threadB, { ...laneRow("lane-b", 41020), checkoutPath: workspace, portBase: null }],
        ]),
      });
      yield* harness.service.configure({ settings: ready });
      const refusal = (folder: string, threadId = threadA) =>
        Effect.flip(harness.service.shareFolder({ path: folder }, threadId));

      // `outside` is a symlink out of the workspace.
      for (const folder of ["..", "outside", "/"]) {
        expect(yield* refusal(folder)).toMatchObject({
          reason: "invalid",
          message: "Folder links can only share a folder inside this thread's workspace.",
        });
      }
      expect(yield* refusal("notes.txt")).toMatchObject({
        reason: "invalid",
        message:
          "notes.txt is not a folder. Share the built folder that holds the site, such as dist.",
      });
      expect(yield* refusal("nope")).toMatchObject({
        reason: "invalid",
        message: "nope was not found in this thread's workspace.",
      });
      expect(yield* refusal("dist", threadB)).toMatchObject({
        reason: "port-not-in-lane",
        message:
          "This thread's lane has no ports, so folder and container links cannot be shared from it.",
      });
      expect(yield* refusal("dist", ThreadId.make("thread-c"))).toMatchObject({
        reason: "port-not-in-lane",
        message:
          "Folder and container links need lanes on. Turn them on in Settings > Loom > Storage.",
      });
      for (let port = 41000; port < 41020; port++) harness.busyPorts.add(port);
      expect(yield* refusal("dist")).toMatchObject({
        reason: "invalid",
        message:
          "Ports 41000 to 41019 of this thread's lane are all in use or shared. Stop a server on one of them or end one of this thread's links, then try again.",
      });
      harness.busyPorts.clear();
      // Turning lanes off keeps the thread's lane, but no longer vouches for its ports.
      yield* harness.setLanes(false, ["lane-a"]);
      const lanesOff = {
        reason: "port-not-in-lane",
        message:
          "Folder and container links need lanes on. Turn them on in Settings > Loom > Storage.",
      };
      expect(yield* refusal("dist")).toMatchObject(lanesOff);
      expect(
        yield* Effect.flip(
          harness.service.shareContainer({ image: "nginx", containerPort: 80 }, threadA),
        ),
      ).toMatchObject(lanesOff);
      expect(harness.folders.open.size).toBe(0);
      expect(harness.docker.runs).toEqual([]);
      expect((yield* harness.service.snapshot).links).toEqual([]);
    }),
  );

  it.effect("stops a folder's server when its link is revoked or its lane goes", () =>
    Effect.gen(function* () {
      const { workspace } = yield* makeSite;
      const harness = yield* makeHarness({ lanes: siteLanes(workspace) });
      yield* harness.service.configure({ settings: ready });
      const revoked = yield* harness.service.shareFolder({ path: "dist" }, threadA);
      yield* nextEvent(harness.folders.events, "start 41000");
      yield* harness.service.revoke(revoked.id, agentA);
      yield* nextEvent(harness.folders.events, "stop 41000");

      const laneLink = yield* harness.service.shareFolder({ path: "dist" }, threadA);
      expect(laneLink.id).not.toBe(revoked.id);
      yield* nextEvent(harness.folders.events, "start 41000");
      yield* harness.setLanes(true, ["lane-a"]);
      yield* harness.setLanes(true, []);
      yield* harness.waitFor((snapshot) =>
        snapshot.links.some((link) => link.id === laneLink.id && link.state === "revoked"),
      );
      yield* nextEvent(harness.folders.events, "stop 41000");
      expect(harness.folders.open.size).toBe(0);
    }),
  );

  it.effect("restores a folder link on its own port only while that port is free", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { workspace, site } = yield* makeSite;
      const harness = yield* makeHarness({ lanes: siteLanes(workspace) });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.shareFolder({ path: "dist" }, threadA);
      const endLink = harness.service
        .revoke(link.id, owner)
        .pipe(Effect.andThen(nextEvent(harness.folders.events, "stop 41000")));
      yield* endLink;

      expect(yield* harness.service.restore({ linkId: link.id })).toMatchObject({
        host: link.host,
        port: 41000,
        state: "open",
        laneId: null,
      });
      yield* nextEvent(harness.folders.events, "start 41000");
      expect(harness.folders.open.get(41000)).toBe(site);

      yield* endLink;
      harness.busyPorts.add(41000);
      expect(yield* Effect.flip(harness.service.restore({ linkId: link.id }))).toMatchObject({
        reason: "not-restorable",
        message:
          "Port 41000 is in use now, so this folder link cannot come back at its address. Share the folder again.",
      });

      harness.busyPorts.delete(41000);
      yield* fs.remove(site, { recursive: true });
      expect(yield* Effect.flip(harness.service.restore({ linkId: link.id }))).toMatchObject({
        reason: "not-restorable",
        message: "The folder this link served is gone. Share the folder again.",
      });
      expect((yield* harness.service.snapshot).links.map((each) => each.state)).toEqual([
        "revoked",
      ]);
      expect(harness.folders.open.size).toBe(0);
    }),
  );

  it.effect("serves open folder links again after a restart, and ends one whose folder went", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { workspace, site } = yield* makeSite;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      const first = yield* makeHarness({ baseDir, secrets, lanes: siteLanes(workspace) });
      yield* first.service.configure({ settings: ready });
      const link = yield* first.service.shareFolder({ path: "dist" }, threadA);

      const reopened = yield* makeHarness({ baseDir, secrets });
      yield* nextEvent(reopened.folders.events, "start 41000");
      expect(reopened.folders.open.get(41000)).toBe(site);
      expect((yield* reopened.service.snapshot).links).toEqual([link]);

      yield* fs.remove(site, { recursive: true });
      const withoutFolder = yield* makeHarness({ baseDir, secrets });
      yield* withoutFolder.waitFor((snapshot) => snapshot.links[0]?.state === "expired");
      expect(withoutFolder.folders.open.size).toBe(0);
    }),
  );

  it.effect("ends a folder link at restart when something else now answers on its port", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { workspace } = yield* makeSite;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      const secrets = new Map<string, Uint8Array>();
      const first = yield* makeHarness({ baseDir, secrets, lanes: siteLanes(workspace) });
      yield* first.service.configure({ settings: ready });
      yield* first.service.shareFolder({ path: "dist" }, threadA);

      // A 127.0.0.1 bind succeeds beside it, but it would win the gateway's connections.
      const reopened = yield* makeHarness({ baseDir, secrets, ipv6Ports: [41000] });
      yield* reopened.waitFor((snapshot) => snapshot.links[0]?.state === "expired");
      expect(reopened.folders.open.size).toBe(0);
    }),
  );

  it.effect(
    "keeps a starting container's port from a share or restore, and frees it if cancelled",
    () =>
      Effect.gen(function* () {
        const { workspace } = yield* makeSite;
        const harness = yield* makeHarness({ lanes: siteLanes(workspace) });
        yield* harness.service.configure({ settings: ready });
        const folder = yield* harness.service.shareFolder({ path: "dist" }, threadA);
        yield* harness.service.revoke(folder.id, owner);
        yield* nextEvent(harness.folders.events, "stop 41000");

        harness.docker.runGate = yield* Deferred.make<void>();
        const starting = yield* Effect.forkChild(
          harness.service.shareContainer({ image: "nginx", containerPort: 80 }, threadA),
        );
        yield* nextEvent(harness.docker.commands, "run");
        expect(yield* Effect.flip(harness.service.share({ port: 41000 }, owner))).toMatchObject({
          reason: "invalid",
          message:
            "A container is still starting on port 41000. Its link appears when it is ready.",
        });
        expect(yield* Effect.flip(harness.service.restore({ linkId: folder.id }))).toMatchObject({
          reason: "not-restorable",
          message:
            "Port 41000 is in use now, so this folder link cannot come back at its address. Share the folder again.",
        });
        expect(harness.folders.open.size).toBe(0);

        // A cancelled tool call removes whatever Docker made and gives the port back.
        yield* Fiber.interrupt(starting);
        yield* nextEvent(harness.docker.commands, "ps -aq --filter label=loom.preview-link=");
        expect((yield* harness.service.restore({ linkId: folder.id })).state).toBe("open");
        expect(harness.folders.open.has(41000)).toBe(true);
      }),
  );

  it.effect("runs a container on a lane port and removes it when its link ends", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ lanes: containerLanes });
      yield* harness.service.configure({ settings: ready });
      const start = yield* Clock.currentTimeMillis;
      const link = yield* harness.service.shareContainer(
        {
          image: "nginx:alpine",
          containerPort: 80,
          env: { MODE: "preview" },
          command: ["nginx", "-g", "daemon off;"],
          minutes: 30,
        },
        threadA,
      );
      expect(harness.docker.runs).toEqual([
        [
          "run",
          "-d",
          "--pull",
          "missing",
          "--label",
          "loom.lane=lane-a",
          "--label",
          `loom.preview-link=${link.id}`,
          "-p",
          "127.0.0.1:41000:80",
          "-e",
          "MODE=preview",
          "nginx:alpine",
          "nginx",
          "-g",
          "daemon off;",
        ],
      ]);
      const stopsAt = isoAt(start + 30 * 60 * 1000);
      expect(link).toMatchObject({
        port: 41000,
        createdBy: "agent",
        threadId: threadA,
        laneId: "lane-a",
        lifetime: "1h",
        expiresAt: stopsAt,
        backing: {
          kind: "container",
          image: "nginx:alpine",
          containerId: "000000000001",
          containerPort: 80,
          stopsAt,
        },
      });
      expect((yield* harness.view).route(link.host)).toEqual({
        _tag: "Link",
        linkId: link.id,
        port: 41000,
      });

      yield* harness.service.revoke(link.id, agentA);
      yield* nextEvent(harness.docker.commands, "rm -f 000000000001");
      expect(harness.docker.states.size).toBe(0);
    }),
  );

  it.effect("ends a container link when its container stops or its time is up", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ lanes: containerLanes });
      yield* harness.service.configure({ settings: ready });
      const stopped = yield* harness.service.shareContainer(
        { image: "nginx", containerPort: 80 },
        threadA,
      );
      yield* nextEvent(harness.docker.commands, "inspect -f {{.State.Running}} 000000000001");
      harness.docker.states.set("000000000001", "false");
      yield* TestClock.adjust("1 minute");
      yield* harness.waitFor((snapshot) =>
        snapshot.links.some((link) => link.id === stopped.id && link.state === "expired"),
      );
      yield* nextEvent(harness.docker.commands, "rm -f 000000000001");

      const timed = yield* harness.service.shareContainer(
        { image: "nginx", containerPort: 80, minutes: 5 },
        threadA,
      );
      expect(timed.port).toBe(41000);
      yield* TestClock.adjust("5 minutes");
      yield* harness.waitFor((snapshot) =>
        snapshot.links.some((link) => link.id === timed.id && link.state === "expired"),
      );
      yield* nextEvent(harness.docker.commands, "rm -f 000000000002");
      expect(harness.docker.states.size).toBe(0);
    }),
  );

  it.effect("refuses containers without Docker and cleans up after a failed start", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ lanes: containerLanes });
      yield* harness.service.configure({ settings: ready });
      const input = { image: "nginx", containerPort: 80 };
      expect(yield* Effect.flip(harness.service.shareContainer(input, threadB))).toMatchObject({
        reason: "port-not-in-lane",
      });

      harness.docker.path = null;
      expect(yield* Effect.flip(harness.service.shareContainer(input, threadA))).toMatchObject({
        reason: "invalid",
        message: DOCKER_MISSING_MESSAGE,
      });
      expect(harness.docker.runs).toEqual([]);

      harness.docker.path = DOCKER;
      harness.docker.failRun =
        "docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?";
      expect(yield* Effect.flip(harness.service.shareContainer(input, threadA))).toMatchObject({
        reason: "invalid",
        message:
          "Docker is not running. Start Docker Desktop or OrbStack, then share the container again.",
      });
      const label = harness.docker.runs[0]?.find((arg) => arg.startsWith("loom.preview-link="));
      expect(label).toBeDefined();
      yield* nextEvent(harness.docker.commands, `ps -aq --filter label=${label}`);
      expect((yield* harness.service.snapshot).links).toEqual([]);

      harness.docker.failRun = null;
      expect((yield* harness.service.shareContainer(input, threadA)).port).toBe(41000);
    }),
  );

  it.effect("will not extend or restore a container link", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ lanes: containerLanes });
      yield* harness.service.configure({ settings: ready });
      const link = yield* harness.service.shareContainer(
        { image: "nginx", containerPort: 80 },
        threadA,
      );
      const message = "Container links end when the container stops; share it again for more time.";
      expect(
        yield* Effect.flip(harness.service.extend({ linkId: link.id, lifetime: "24h" })),
      ).toMatchObject({ reason: "invalid", message });
      yield* harness.service.revoke(link.id, owner);
      expect(yield* Effect.flip(harness.service.restore({ linkId: link.id }))).toMatchObject({
        reason: "not-restorable",
        message,
      });
    }),
  );
});
