import * as TestClock from "effect/testing/TestClock";
// @effect-diagnostics nodeBuiltinImport:off - Lanes are real folders the test inspects directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  RunId,
  ThreadId,
  type DeviceServiceState,
  type DeviceSession,
  type OrchestrationProjectShell,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { ProjectLifecycleError, type ProjectLifecycleStatus } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Config from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as GitWorkflow from "../../git/GitWorkflowService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../../project/WorktreeSetupTracker.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as ThreadSettlement from "../../orchestration-v2/ThreadSettlementService.ts";
import {
  ThreadManagementService,
  type ThreadManagementSendInput,
} from "../../orchestration-v2/ThreadManagementService.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ledgerLine, normalizeStart } from "./leases.ts";
import { ProjectLifecycleMigrations } from "./migrations.ts";
import { GB } from "./policy.ts";
import { makeWith, type ProjectLifecycleOptions } from "./ProjectLifecycleService.ts";
import { makeStore } from "./store.ts";

/** Unused service methods fail immediately instead of silently returning a fake value. */
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const projectId = ProjectId.make("project-app");

const thread = (id: string, fields: Partial<OrchestrationV2ThreadShell> = {}) =>
  ({
    id: ThreadId.make(id),
    projectId,
    worktreePath: null,
    archivedAt: null,
    settledAt: null,
    settledOverride: null,
    activeRunId: null,
    creationSource: "web",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
    ...fields,
  }) as OrchestrationV2ThreadShell;

const SIMULATOR = "0A1B2C3D-0000-4000-8000-00000000ABCD";

const session = (threadId: string, deviceId: string): DeviceSession => ({
  threadId: ThreadId.make(threadId),
  hostId: "local",
  deviceId,
  platform: "ios",
  openedAt: "2026-10-08T00:00:00.000Z",
});

/** Executable stubs that log their arguments to `<home>/calls`. */
const writeStubs = (home: string) => {
  const stubs = NodePath.join(home, "stubs");
  NodeFS.mkdirSync(stubs);
  const log = NodePath.join(home, "calls");
  const stub = (name: string, body: string) =>
    NodeFS.writeFileSync(
      NodePath.join(stubs, name),
      `#!/bin/sh\necho "${name} $*" >> '${log}'\n${body}\n`,
      { mode: 0o755 },
    );
  stub(
    "xcrun",
    `[ "$2" = list ] && printf '{"devices":{"iOS":[{"udid":"${SIMULATOR}","name":"Lane Phone","state":"Booted"}]}}'`,
  );
  // Lists one container and one volume labelled for the lane id in <home>/lane-id, and the
  // published ports in <home>/published. `rm` logs which listeners were still alive. A
  // <home>/docker-down file makes it answer as Docker does when it is installed but not running.
  stub(
    "docker",
    `[ -e '${home}/docker-down' ] && exit 1
case "$1 $2" in
  "ps --format") cat '${home}/published' 2>/dev/null; exit 0 ;;
  "rm -f")
    for pid in $(awk '{ print $1 }' '${home}/listening' 2>/dev/null); do
      kill -0 "$pid" 2>/dev/null && echo "listener $pid alive" >> '${log}'
    done
    exit 0 ;;
esac
lane=$(cat '${home}/lane-id' 2>/dev/null)
[ -n "$lane" ] || exit 0
case "$1 $2" in
  "ps -a") printf 'c0ffee\\t%s\\tdb\\trunning\\n' "$lane" ;;
  "volume ls") printf 'db-data\\t%s\\n' "$lane" ;;
esac`,
  );
  // Reports each `pid [port [command]]` line of <home>/listening as a lane port listener, and
  // <home>/holding, already in lsof's field format, as the files open on a lane's mount.
  stub(
    "lsof",
    `case " $* " in *" +f "*) [ -s '${home}/holding' ] || exit 1; cat '${home}/holding'; exit 0 ;; esac
[ -s '${home}/listening' ] || exit 1
awk '{ print "p" $1; if ($3 != "") print "c" $3; print "f3"; if ($2 != "") print "n127.0.0.1:" $2 }' '${home}/listening'`,
  );
  return { stubs, log };
};

const calls = (log: string) =>
  NodeFS.existsSync(log) ? NodeFS.readFileSync(log, "utf8").trim().split("\n") : [];

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** `devUrl` makes the service behave as a dev server would. */
const setupWith = (
  options: {
    readonly devUrl?: URL;
    readonly restoreBranchMissing?: boolean;
    readonly wrapSpaces?: ProjectLifecycleOptions["wrapSpaces"];
    readonly prepareForCleanup?: (threadId: ThreadId) => Effect.Effect<boolean>;
  } = {},
) =>
  Effect.gen(function* () {
    const home = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-lc-")),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
    );
    const checkout = NodePath.join(home, "src", "app");
    const worktree = NodePath.join(home, "worktrees", "app-feature");
    NodeFS.mkdirSync(checkout, { recursive: true });
    NodeFS.mkdirSync(worktree, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(checkout, "App.xcodeproj"), "");

    const threads: Array<OrchestrationV2ThreadShell> = [];
    const sent: Array<ThreadManagementSendInput> = [];
    const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
    const threadManagement = partial<ThreadManagementService["Service"]>({
      // Like the projection: the active location leaves archived threads out.
      getShellSnapshot: (options) =>
        Effect.succeed({
          schemaVersion: 1,
          snapshotSequence: 0,
          threads: threads.filter(
            (entry) => options?.location !== "active" || entry.archivedAt === null,
          ),
          archivedThreads: [],
        }),
      sendToThread: (input) =>
        Effect.sync(() => {
          sent.push(input);
          // The service ignores the result.
          return {} as never;
        }),
      streamDomainEvents: Stream.fromPubSub(events),
    });
    const projectRows = [
      { id: projectId, title: "App", workspaceRoot: checkout } as OrchestrationProjectShell,
    ];
    const projects = partial<ProjectStore.ProjectStoreV2["Service"]>({
      listShells: () => Effect.succeed([...projectRows]),
    });
    const deviceSessions: Array<DeviceSession> = [];
    const closed: Array<{ threadId: string; deviceId?: string; shutdown?: boolean }> = [];
    const devices = partial<DeviceService["Service"]>({
      state: Effect.sync(
        () => ({ sessions: [...deviceSessions] }) as unknown as DeviceServiceState,
      ),
      sessionsForThread: (threadId) =>
        Effect.sync(() => deviceSessions.filter((entry) => entry.threadId === threadId)),
      close: (input) =>
        Effect.sync(() => {
          closed.push({
            threadId: input.threadId,
            ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
            ...(input.shutdown === undefined ? {} : { shutdown: input.shutdown }),
          });
          for (let index = deviceSessions.length - 1; index >= 0; index--) {
            const entry = deviceSessions[index]!;
            if (entry.threadId === input.threadId && entry.deviceId === input.deviceId)
              deviceSessions.splice(index, 1);
          }
        }),
    });
    const { stubs, log } = writeStubs(home);
    const context = yield* Layer.build(
      Layer.mergeAll(
        options.devUrl === undefined
          ? Config.layerTest(home, NodePath.join(home, "state"))
          : Layer.effect(
              Config.ServerConfig,
              Config.ServerConfig.pipe(
                Effect.map((config) => ({ ...config, devUrl: options.devUrl })),
              ),
            ).pipe(Layer.provide(Config.layerTest(home, NodePath.join(home, "state")))),
        SqlitePersistenceMemory,
        Layer.mock(GitWorkflow.GitWorkflowService)({
          hasCommit: () => Effect.succeed(!options.restoreBranchMissing),
          pruneWorktrees: () => Effect.void,
          createWorktree: ({ path }) =>
            Effect.sync(() => {
              NodeFS.mkdirSync(path!, { recursive: true });
              return { worktreePath: path, branch: "feature" } as never;
            }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome({ workspaceRoot: checkout } as never),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getCheckpointContext: () =>
            Effect.succeed({
              runs: [],
              checkpointScopes: [{ kind: "root_run", id: "scope", cwd: worktree }],
              checkpoints: [{ status: "ready", scopeId: "scope", ref: "missing" }],
            } as never),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" }),
        }),
        Layer.mock(WorktreeSetupTracker.WorktreeSetupTracker)({
          begin: () => Effect.void,
          stageStatus: () => Effect.void,
          finish: () => Effect.succeed(null),
        }),
        ProcessRunner.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    );
    yield* runForkMigrationSet(ProjectLifecycleMigrations).pipe(Effect.provide(context));
    const create = makeWith({
      homeDir: home,
      imageBackend: false,
      xcrunPath: NodePath.join(stubs, "xcrun"),
      dockerPath: NodePath.join(stubs, "docker"),
      lsofPath: NodePath.join(stubs, "lsof"),
      ...(options.wrapSpaces === undefined ? {} : { wrapSpaces: options.wrapSpaces }),
      // Growth and reserve steering depend on free space, so the host is pinned well above both.
      hostSpace: async () => ({ free: 1000 * GB, total: 2000 * GB }),
    }).pipe(
      Effect.provide(context),
      Effect.provideService(ThreadManagementService, threadManagement),
      Effect.provideService(ProjectStore.ProjectStoreV2, projects),
      Effect.provideService(DeviceService, devices),
      Effect.provideService(
        ThreadSettlement.ThreadSettlementServiceV2,
        partial<ThreadSettlement.ThreadSettlementServiceV2["Service"]>({
          prepareForCleanup: options.prepareForCleanup ?? (() => Effect.succeed(true)),
        }),
      ),
    );
    const service = yield* create;
    yield* service.updateSettings({ ...(yield* service.getSettings), reserveGb: 0 });
    const store = yield* makeStore.pipe(Effect.provide(context));
    return {
      home,
      checkout,
      worktree,
      threads,
      projectRows,
      sent,
      events,
      service,
      create,
      store,
      deviceSessions,
      closed,
      log,
    };
  });

const setup = setupWith();

const laneOf = (status: ProjectLifecycleStatus, checkoutPath: string) =>
  status.lanes.find((lane) => lane.checkoutPath === checkoutPath);

describe("ProjectLifecycleService", () => {
  it.live.each([false, true])(
    "awaits settlement before releasing a lane (reengaged: %s)",
    (reengaged) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<void>();
        const t = yield* setupWith({
          prepareForCleanup: () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(completed)),
              Effect.as(true),
            ),
        });
        t.threads.push(thread("settling", { worktreePath: t.worktree }));
        const lane = yield* t.service.ensureForThread(ThreadId.make("settling"));
        NodeFS.writeFileSync(`${lane.laneDir}/space/build/settle-input`, "needed by settle hook");
        t.threads[0] = thread("settling", { worktreePath: t.worktree, settledOverride: "settled" });
        const cleanup = yield* t.service.tick().pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.raceFirst(
          Deferred.await(entered),
          Fiber.join(cleanup).pipe(
            Effect.andThen(Effect.die("Lane cleanup did not await settlement")),
          ),
        );
        expect(NodeFS.readFileSync(`${lane.laneDir}/space/build/settle-input`, "utf8")).toBe(
          "needed by settle hook",
        );
        if (reengaged) t.threads[0] = thread("settling", { worktreePath: t.worktree });
        yield* Deferred.succeed(completed, undefined);
        yield* Fiber.join(cleanup);
        expect(NodeFS.existsSync(lane.laneDir)).toBe(reengaged);
        expect(NodeFS.existsSync(t.worktree)).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.live("preserves a lane when its settlement preparation fails", () =>
    Effect.gen(function* () {
      const t = yield* setupWith({ prepareForCleanup: () => Effect.succeed(false) });
      t.threads.push(thread("settling", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("settling"));
      t.threads[0] = thread("settling", { worktreePath: t.worktree, settledOverride: "settled" });
      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("keeps a lane while its settle action fails and checks it again each tick", () =>
    Effect.gen(function* () {
      const answers = [false, false, true];
      const probed: Array<ThreadId> = [];
      const t = yield* setupWith({
        prepareForCleanup: (threadId) =>
          Effect.sync(() => {
            probed.push(threadId);
            return answers.shift() ?? true;
          }),
      });
      t.threads.push(thread("settling", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("settling"));
      t.threads[0] = thread("settling", { worktreePath: t.worktree, settledOverride: "settled" });

      yield* t.service.tick();
      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);
      expect(probed).toHaveLength(2);

      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
      expect(probed).toHaveLength(3);
    }).pipe(Effect.scoped),
  );

  it.live("removes free lanes without probing threads that have no settle action", () =>
    Effect.gen(function* () {
      const probed: Array<ThreadId> = [];
      const t = yield* setupWith({
        prepareForCleanup: (threadId) =>
          Effect.sync(() => {
            probed.push(threadId);
            return true;
          }),
      });
      t.threads.push(
        thread("root", { activeRunId: RunId.make("root-run") }),
        thread("feature", { worktreePath: t.worktree, activeRunId: RunId.make("feature-run") }),
        thread("deleted-feature", { worktreePath: t.worktree }),
      );
      const root = yield* t.service.ensureForThread(ThreadId.make("root"));
      const feature = yield* t.service.ensureForThread(ThreadId.make("feature"));

      t.threads.splice(
        0,
        t.threads.length,
        // Settled in the shared checkout: the settlement service never runs a settle action there.
        thread("root", { settledOverride: "settled", settledAt: DateTime.nowUnsafe() }),
        // A provider's idle subagent never settles.
        thread("root-subagent", {
          creationSource: "provider",
          lineage: {
            parentThreadId: ThreadId.make("root"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("root"),
          },
        }),
        thread("feature", {
          worktreePath: t.worktree,
          settledOverride: "settled",
          archivedAt: DateTime.nowUnsafe(),
        }),
      );
      const status = yield* t.service.tick();

      expect(status.lanes).toEqual([]);
      expect(NodeFS.existsSync(root.laneDir)).toBe(false);
      expect(NodeFS.existsSync(feature.laneDir)).toBe(false);
      expect(probed).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("does not probe a protected lane again until its threads' settlement changes", () =>
    Effect.gen(function* () {
      const probed: Array<ThreadId> = [];
      const t = yield* setupWith({
        prepareForCleanup: (threadId) =>
          Effect.sync(() => {
            probed.push(threadId);
            return true;
          }),
      });
      t.threads.push(thread("feature", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("feature"));
      // A registered checkout inside the lane keeps it after its own thread settles.
      const nested = `${lane.laneDir}/space/data/nested`;
      NodeFS.mkdirSync(nested);
      t.threads.push(thread("nested", { worktreePath: nested, archivedAt: DateTime.nowUnsafe() }));
      const settledAt = DateTime.nowUnsafe();
      t.threads[0] = thread("feature", {
        worktreePath: t.worktree,
        settledOverride: "settled",
        settledAt,
      });

      yield* t.service.tick();
      yield* t.service.tick();
      expect(probed).toEqual([ThreadId.make("feature")]);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);

      t.threads[0] = thread("feature", {
        worktreePath: t.worktree,
        settledOverride: "settled",
        settledAt: DateTime.add(settledAt, { seconds: 1 }),
      });
      yield* t.service.tick();
      expect(probed).toEqual([ThreadId.make("feature"), ThreadId.make("feature")]);

      // The protection clearing needs no new probe.
      NodeFS.rmSync(nested, { recursive: true });
      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
      expect(probed).toHaveLength(2);
    }).pipe(Effect.scoped),
  );

  it.live("probes a protected lane again once an archived thread sharing it is deleted", () =>
    Effect.gen(function* () {
      const settleRan = yield* Deferred.make<void>();
      let sharerDeleted = false;
      let settleSucceeds = false;
      const t = yield* setupWith({
        // As the settlement service does, an unsettled thread sharing the worktree answers ready
        // without running the settle action.
        prepareForCleanup: () =>
          sharerDeleted
            ? Deferred.succeed(settleRan, undefined).pipe(Effect.as(settleSucceeds))
            : Effect.succeed(true),
      });
      yield* t.service.start();
      t.threads.push(thread("feature", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("feature"));
      const nested = `${lane.laneDir}/space/data/nested`;
      NodeFS.mkdirSync(nested);
      t.threads.push(
        thread("nested", { worktreePath: nested, archivedAt: DateTime.nowUnsafe() }),
        thread("sharer", { worktreePath: t.worktree, archivedAt: DateTime.nowUnsafe() }),
      );
      t.threads[0] = thread("feature", {
        worktreePath: t.worktree,
        settledOverride: "settled",
        settledAt: DateTime.nowUnsafe(),
      });
      yield* t.service.tick();
      yield* t.service.tick();
      expect(yield* Deferred.isDone(settleRan)).toBe(false);

      sharerDeleted = true;
      t.threads.splice(
        t.threads.findIndex((entry) => entry.id === "sharer"),
        1,
      );
      yield* PubSub.publish(t.events, {
        type: "thread.deleted",
        payload: { id: ThreadId.make("sharer") },
      } as OrchestrationV2DomainEvent);
      yield* Deferred.await(settleRan);

      // The failing settle action now keeps the lane after its protection clears.
      NodeFS.rmSync(nested, { recursive: true });
      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);
      settleSucceeds = true;
      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("probes a settled thread that joins a lane while its other threads are probed", () =>
    Effect.gen(function* () {
      const probed: Array<ThreadId> = [];
      let unarchiveSecond = () => {};
      const t = yield* setupWith({
        prepareForCleanup: (threadId) =>
          Effect.sync(() => {
            probed.push(threadId);
            unarchiveSecond();
            unarchiveSecond = () => {};
            return true;
          }),
      });
      t.threads.push(thread("first", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("first"));
      const settled = { worktreePath: t.worktree, settledOverride: "settled" } as const;
      t.threads[0] = thread("first", settled);
      t.threads.push(thread("second", { ...settled, archivedAt: DateTime.nowUnsafe() }));
      unarchiveSecond = () => {
        t.threads[1] = thread("second", settled);
      };

      yield* t.service.tick();
      expect(probed).toEqual([ThreadId.make("first")]);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);

      yield* t.service.tick();
      expect(probed.toSorted()).toEqual([
        ThreadId.make("first"),
        ThreadId.make("first"),
        ThreadId.make("second"),
      ]);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("gives each checkout one lane under the lanes folder and removes it once released", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(
        thread("root-a"),
        thread("root-b"),
        thread("feature", { worktreePath: t.worktree }),
      );
      const root = yield* t.service.ensureForThread(ThreadId.make("root-a"));
      expect(yield* t.service.ensureForThread(ThreadId.make("root-b"))).toEqual(root);
      const feature = yield* t.service.ensureForThread(ThreadId.make("feature"));

      const lanes = `${t.home}/Developer/lanes`;
      expect(root.laneDir).toBe(`${lanes}/app/main`);
      expect(feature.laneDir).toBe(`${lanes}/app/app-feature`);
      // The checkout has an Xcode project; the worktree folder does not.
      expect(root.capBytes).toBe(100e9);
      expect(feature.capBytes).toBe(40e9);
      expect(NodeFS.readdirSync(`${root.laneDir}/space`).sort()).toEqual(["build", "data", "tmp"]);
      expect(NodeFS.readFileSync(`${root.laneDir}/LANE.md`, "utf8")).toContain(t.checkout);
      const index = NodeFS.readFileSync(`${lanes}/.loom/lanes.tsv`, "utf8");
      expect(index).toContain(`${t.checkout}\t${root.laneDir}/space\t${root.id}\t41000\n`);
      expect(index).toContain(`${t.worktree}\t${feature.laneDir}/space\t${feature.id}\t41020\n`);
      expect(NodeFS.readFileSync(`${feature.laneDir}/LANE.md`, "utf8")).toContain(
        "Ports: 41020 to 41039",
      );

      // One settled thread still leaves another holding the main lane.
      t.threads[0] = thread("root-a", { settledAt: DateTime.nowUnsafe() });
      t.threads[2] = thread("feature", {
        worktreePath: t.worktree,
        archivedAt: DateTime.nowUnsafe(),
      });
      const status = yield* t.service.tick();
      expect(status.lanes.map((lane) => lane.name)).toEqual(["main"]);
      expect(laneOf(status, t.checkout)?.threadIds).toEqual(["root-b"]);
      expect(NodeFS.existsSync(feature.laneDir)).toBe(false);
      expect(NodeFS.existsSync(t.worktree)).toBe(true);
      expect(NodeFS.readFileSync(`${lanes}/.loom/lanes.tsv`, "utf8")).not.toContain(t.worktree);
    }).pipe(Effect.scoped),
  );

  it.live("preserves shared checkout process leases until the last holder settles", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("first"), thread("second", { activeRunId: RunId.make("working") }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("first"));
      const child = NodeChildProcess.spawn("/bin/sleep", ["60"], {
        cwd: t.checkout,
        stdio: "ignore",
      });
      const pid = child.pid!;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (alive(pid)) process.kill(pid, "SIGKILL");
        }),
      );
      yield* t.service.adoptLease(lane.id, "process", String(pid), "shared server");

      t.threads[0] = thread("first", { settledOverride: "settled" });
      const shared = yield* t.service.tick();
      expect(laneOf(shared, t.checkout)?.threadIds).toEqual(["second"]);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);
      expect(alive(pid)).toBe(true);

      t.threads[1] = thread("second", { settledOverride: "settled" });
      yield* t.service.tick();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
      expect(alive(pid)).toBe(false);
      expect(NodeFS.existsSync(t.checkout)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("reports missing worktree checkouts without marking primary checkouts as released", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("primary"));
      t.threads.push(thread("present", { worktreePath: t.worktree }));
      t.threads.push(thread("missing", { worktreePath: `${t.home}/missing` }));
      yield* t.service.tick();
      const status = yield* t.service.changes.pipe(Stream.take(1), Stream.runCollect);
      expect(status[0]).toMatchObject({ releasedCheckouts: [ThreadId.make("missing")] });
      NodeFS.mkdirSync(`${t.home}/missing`);
      yield* t.service.tick();
      expect(
        (yield* t.service.changes.pipe(Stream.take(1), Stream.runCollect))[0]?.releasedCheckouts,
      ).toEqual([ThreadId.make("missing")]);
      expect((yield* t.service.refreshCheckouts()).releasedCheckouts).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("restores a checkout and updates its cached released state immediately", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const id = ThreadId.make("restoring");
      t.threads.push(thread(id, { worktreePath: t.worktree, branch: "feature" }));
      NodeFS.rmSync(t.worktree, { recursive: true });
      expect((yield* t.service.refreshCheckouts()).releasedCheckouts).toEqual([id]);
      yield* t.service.restoreCheckout(id);
      expect(NodeFS.existsSync(t.worktree)).toBe(true);
      expect((yield* t.service.refreshCheckouts()).releasedCheckouts).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("explains a missing branch when no saved checkout can restore it", () =>
    Effect.gen(function* () {
      const t = yield* setupWith({ restoreBranchMissing: true });
      const id = ThreadId.make("missing-branch");
      t.threads.push(thread(id, { worktreePath: t.worktree, branch: "feature" }));
      NodeFS.rmSync(t.worktree, { recursive: true });
      const failure = yield* t.service.restoreCheckout(id).pipe(Effect.flip);
      expect(failure.message).toContain("branch is missing and no saved checkout is available");
      expect(NodeFS.existsSync(t.worktree)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("prepares a lane only after a released checkout has been restored", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("resuming", { activeRunId: RunId.make("resume-run") }));
      NodeFS.rmSync(t.checkout, { recursive: true });
      const failure = yield* t.service.ensureForThread(ThreadId.make("resuming")).pipe(Effect.flip);
      expect(failure.reason).toBe("command-failed");
      expect(failure.message).toContain("ENOENT");
      expect(yield* t.store.listLanes()).toEqual([]);

      NodeFS.mkdirSync(t.checkout);
      NodeFS.writeFileSync(`${t.checkout}/retained.txt`, "restored work");
      const lane = yield* t.service.ensureForThread(ThreadId.make("resuming"));
      expect(lane.checkoutPath).toBe(t.checkout);
      expect(NodeFS.existsSync(`${lane.laneDir}/space/tmp`)).toBe(true);
      expect(NodeFS.readFileSync(`${t.checkout}/retained.txt`, "utf8")).toBe("restored work");
    }).pipe(Effect.scoped),
  );

  it.live("blocks startup on failed lane shims and repairs them before retrying", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("setup-shims", { activeRunId: RunId.make("setup-run") }));
      const shims = `${(yield* t.service.getSettings).lanesRoot}/.loom/shims`;
      NodeFS.rmSync(shims, { recursive: true });
      NodeFS.writeFileSync(shims, "blocked");
      const failure = yield* t.service
        .ensureForThread(ThreadId.make("setup-shims"))
        .pipe(Effect.flip);
      expect(failure.reason).toBe("command-failed");
      NodeFS.unlinkSync(shims);
      const lane = yield* t.service.ensureForThread(ThreadId.make("setup-shims"));
      expect((yield* t.store.listLanes()).map((row) => row.id)).toEqual([lane.id]);
      expect(NodeFS.existsSync(`${shims}/xcodebuild`)).toBe(true);
      expect(NodeFS.existsSync(`${shims}/lane-slot`)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("prepares the setup checkout before the thread's worktree is restored", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(
        thread("setup-root", { worktreePath: t.worktree, activeRunId: RunId.make("setup-run") }),
      );
      NodeFS.rmSync(t.worktree, { recursive: true });
      const lane = yield* t.service.ensureForThread(ThreadId.make("setup-root"), t.checkout);
      expect(lane.checkoutPath).toBe(t.checkout);
      expect(NodeFS.existsSync(`${lane.laneDir}/space/build`)).toBe(true);
      expect(
        NodeFS.readFileSync(`${(yield* t.service.getSettings).lanesRoot}/.loom/lanes.tsv`, "utf8"),
      ).toContain(t.checkout);
    }).pipe(Effect.scoped),
  );

  it.live("indexes a lane prepared while startup and a settings save rewrite the index", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("root"), thread("resuming", { worktreePath: t.worktree }));
      yield* t.service.ensureForThread(ThreadId.make("root"));
      const settings = yield* t.service.getSettings;
      const [, feature] = yield* Effect.all(
        [
          t.service.reconcile(),
          t.service.ensureForThread(ThreadId.make("resuming")),
          t.service.updateSettings(settings),
          t.service.updateSettings(settings),
        ],
        { concurrency: "unbounded" },
      );
      expect(NodeFS.readFileSync(`${settings.lanesRoot}/.loom/lanes.tsv`, "utf8")).toContain(
        `${t.worktree}\t${feature.laneDir}/space\t${feature.id}\t`,
      );
    }).pipe(Effect.scoped),
  );

  it.live("claims lane ports against every other server on the computer", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const claimsDir = `${t.home}/.loom/lane-ports`;
      const claimOf = (base: number) =>
        JSON.parse(NodeFS.readFileSync(`${claimsDir}/${base}`, "utf8")) as {
          owner: string;
          laneId: string;
        };
      const otherState = `${t.home}/other/userdata`;
      NodeFS.mkdirSync(otherState, { recursive: true });
      NodeFS.mkdirSync(claimsDir, { recursive: true });
      // A running server holds the first block; a deleted worktree's server left the second.
      const other = `${JSON.stringify({ owner: otherState, laneId: "theirs" })}\n`;
      NodeFS.writeFileSync(`${claimsDir}/41000`, other);
      NodeFS.writeFileSync(
        `${claimsDir}/41020`,
        JSON.stringify({ owner: `${t.home}/gone/userdata`, laneId: "old" }),
      );
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      expect(lane.portBase).toBe(41020);
      expect(claimOf(41020).laneId).toBe(lane.id);
      const owner = claimOf(41020).owner;
      expect(owner).not.toBe(otherState);

      // A block another server claimed first moves this server's lane when it starts.
      NodeFS.writeFileSync(`${claimsDir}/41020`, other);
      yield* t.create;
      const moved = (yield* t.store.listLanes()).find((row) => row.id === lane.id);
      expect(moved?.portBase).toBe(41040);
      expect(claimOf(41040)).toEqual({ owner, laneId: lane.id });
      expect(NodeFS.readFileSync(`${lane.laneDir}/LANE.md`, "utf8")).toContain(
        "Ports: 41040 to 41059",
      );

      // Removing the lane gives its block back and leaves other servers' claims alone.
      const service = yield* t.create;
      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      yield* service.tick();
      expect(NodeFS.readdirSync(claimsDir).sort()).toEqual(["41000", "41020"]);
    }).pipe(Effect.scoped),
  );

  it.live("leaves ports unassigned when the shared reservation directory is unavailable", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const claimsDir = `${t.home}/.loom/lane-ports`;
      NodeFS.mkdirSync(NodePath.dirname(claimsDir), { recursive: true });
      NodeFS.writeFileSync(claimsDir, "unavailable");
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      expect(lane.portBase).toBeNull();
      expect((yield* t.service.laneView(lane.id)).ports).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.live("keeps another server's claim when its state folder cannot be inspected", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const claimsDir = `${t.home}/.loom/lane-ports`;
      const unreadable = `${t.home}/owner-loop`;
      NodeFS.symlinkSync(unreadable, unreadable);
      NodeFS.mkdirSync(claimsDir, { recursive: true });
      const claim = JSON.stringify({ owner: `${unreadable}/state`, laneId: "theirs" });
      NodeFS.writeFileSync(`${claimsDir}/41000`, claim);
      t.threads.push(thread("worker"));

      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      expect(lane.portBase).toBe(41020);
      expect(NodeFS.readFileSync(`${claimsDir}/41000`, "utf8")).toBe(claim);
    }).pipe(Effect.scoped),
  );

  it.live("clears a saved port block when startup cannot renew its shared reservation", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      expect(lane.portBase).not.toBeNull();
      const claimsDir = `${t.home}/.loom/lane-ports`;
      NodeFS.rmSync(claimsDir, { recursive: true });
      NodeFS.writeFileSync(claimsDir, "unavailable");

      const restarted = yield* t.create;
      expect((yield* t.store.listLanes()).find((row) => row.id === lane.id)?.portBase).toBeNull();
      expect((yield* restarted.laneView(lane.id)).ports).toBeNull();
    }).pipe(Effect.scoped),
  );

  it.live("gives a new lane a block nothing listens on or publishes, and never moves a lane", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      // Docker publishes a port in the first block and this server listens in the second.
      NodeFS.writeFileSync(`${t.home}/published`, "0.0.0.0:41005->80/tcp\n");
      NodeFS.writeFileSync(`${t.home}/listening`, `${process.pid} 41039 node\n`);
      t.threads.push(thread("worker"), thread("feature", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      expect(lane.portBase).toBe(41040);

      // A lane keeps its block across restarts even once something listens there.
      NodeFS.appendFileSync(`${t.home}/listening`, `${process.pid} 41041 node\n`);
      yield* t.create;
      expect((yield* t.store.listLanes()).find((row) => row.id === lane.id)?.portBase).toBe(41040);

      // Without Docker's answer its ports are unknown, and unknown ports block nothing.
      NodeFS.writeFileSync(`${t.home}/docker-down`, "");
      const feature = yield* t.service.ensureForThread(ThreadId.make("feature"));
      expect(feature.portBase).toBe(41000);
    }).pipe(Effect.scoped),
  );

  it.live("steers a running agent once and keeps fresh tmp files when it becomes idle", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker", { activeRunId: RunId.make("run-1") }));
      const created = yield* t.service
        .ensureForThread(ThreadId.make("worker"))
        .pipe(Effect.flatMap((row) => t.service.laneView(row.id)));
      // A 1 MB cap keeps the fill small; the service reads caps when it starts.
      yield* t.store.updateLane(created.id, { capBytes: 1_000_000, device: null });
      const service = yield* t.create;
      NodeFS.writeFileSync(`${created.tmpPath}/scratch`, Buffer.alloc(950_000, 1));
      NodeFS.writeFileSync(`${created.dataPath}/keep`, "notes");

      yield* service.tick();
      yield* service.tick();
      expect(t.sent.map((input) => [input.threadId, input.mode, input.createdBy])).toEqual([
        ["worker", "steer", "system"],
      ]);
      expect(t.sent[0]!.text).toContain(created.tmpPath);
      expect(t.sent[0]!.text).not.toContain("—");

      t.threads[0] = thread("worker");
      yield* service.tick();
      expect(NodeFS.readdirSync(created.tmpPath)).toEqual(["scratch"]);
      expect(NodeFS.readFileSync(`${created.dataPath}/keep`, "utf8")).toBe("notes");
    }).pipe(Effect.scoped),
  );

  it.live("lets an agent free one scope and grow its lane", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker"));
      const lane = yield* t.service
        .ensureForThread(ThreadId.make("worker"))
        .pipe(Effect.flatMap((row) => t.service.laneView(row.id)));
      NodeFS.mkdirSync(`${lane.buildPath}/DerivedData`);
      NodeFS.writeFileSync(`${lane.buildPath}/DerivedData/index`, "x");
      NodeFS.writeFileSync(`${lane.tmpPath}/scratch`, "x");

      yield* t.service.free(lane.id, "build");
      expect(NodeFS.readdirSync(lane.buildPath)).toEqual([]);
      expect(NodeFS.readdirSync(lane.tmpPath)).toEqual(["scratch"]);

      const grown = yield* t.service.grow(lane.id);
      expect(grown.capBytes).toBe(150e9);
      const error = yield* t.service.grow("missing").pipe(Effect.flip);
      expect(error.reason).toBe("not-found");
    }).pipe(Effect.scoped),
  );

  it.live("reclaims prepared lanes when threads settle", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.service.start();
      const settledStatus = (predicate: (status: ProjectLifecycleStatus) => boolean) =>
        t.service.changes.pipe(Stream.filter(predicate), Stream.runHead);

      t.threads.push(thread("worker", { activeRunId: RunId.make("run-1") }));
      const created = yield* Effect.forkChild(settledStatus((status) => status.lanes.length === 1));
      yield* Effect.yieldNow;
      yield* t.service.ensureForThread(ThreadId.make("worker"));
      yield* t.service.tick();
      yield* Fiber.join(created);

      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      const removed = yield* Effect.forkChild(settledStatus((status) => status.lanes.length === 0));
      yield* Effect.yieldNow;
      yield* PubSub.publish(t.events, {
        type: "thread.settled",
        payload: { id: ThreadId.make("worker") },
      } as OrchestrationV2DomainEvent);
      yield* Fiber.join(removed);
      expect(NodeFS.readdirSync(`${t.home}/Developer/lanes`)).toEqual([".loom"]);
    }).pipe(Effect.scoped),
  );

  it.live("keeps a parent lane while a nested registered checkout still exists", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("root"));
      const parent = yield* t.service.ensureForThread(ThreadId.make("root"));
      const nested = `${parent.laneDir}/space/tmp/feature`;
      NodeFS.mkdirSync(nested);
      NodeFS.writeFileSync(`${nested}/keep.txt`, "nested conversation work");
      t.threads.push(thread("nested", { worktreePath: nested }));
      yield* t.service.ensureForThread(ThreadId.make("nested"));
      t.threads.splice(0, 1);

      const kept = yield* t.service.tick();
      expect(laneOf(kept, t.checkout)).toBeDefined();
      expect((yield* t.store.listLanes()).some((lane) => lane.id === parent.id)).toBe(true);
      expect(NodeFS.readFileSync(`${nested}/keep.txt`, "utf8")).toBe("nested conversation work");

      // A released checkout's saved path must not keep an empty parent lane forever.
      NodeFS.rmSync(nested, { recursive: true });
      const removed = yield* t.service.tick();
      expect(laneOf(removed, t.checkout)).toBeUndefined();
      expect(NodeFS.existsSync(parent.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "removes day-old tmp files from active lanes while keeping nested registered checkouts",
    () =>
      Effect.gen(function* () {
        const t = yield* setup;
        t.threads.push(thread("root", { activeRunId: RunId.make("root-run") }));
        const parent = yield* t.service.ensureForThread(ThreadId.make("root"));
        const service = yield* t.create;
        const tmp = `${parent.laneDir}/space/tmp`;
        const nested = `${tmp}/feature`;
        NodeFS.mkdirSync(nested);
        NodeFS.writeFileSync(`${nested}/keep.txt`, "active thread files");
        NodeFS.writeFileSync(`${tmp}/scratch`, Buffer.alloc(950_000, 1));
        t.threads.push(
          thread("nested", { worktreePath: nested, activeRunId: RunId.make("nested-run") }),
        );

        yield* TestClock.setTime(NodeFS.statSync(`${tmp}/scratch`).ctimeMs + 25 * 60 * 60 * 1000);
        yield* service.tick();
        expect(NodeFS.readFileSync(`${nested}/keep.txt`, "utf8")).toBe("active thread files");
        expect(NodeFS.existsSync(`${tmp}/scratch`)).toBe(false);
      }).pipe(Effect.scoped),
  );

  it.live("freeing all scopes keeps registered project checkouts and removes auxiliary files", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("root"));
      const parent = yield* t.service.ensureForThread(ThreadId.make("root"));
      const nested = `${parent.laneDir}/space/build/project`;
      NodeFS.mkdirSync(nested);
      NodeFS.writeFileSync(`${nested}/keep.txt`, "project work");
      NodeFS.writeFileSync(`${parent.laneDir}/space/build/cache`, "disposable cache");
      NodeFS.writeFileSync(`${parent.laneDir}/space/tmp/cache`, "disposable scratch");
      t.projectRows.push({
        ...t.projectRows[0]!,
        id: ProjectId.make("nested-project"),
        workspaceRoot: nested,
      });

      const blocked = yield* t.service.free(parent.id, "all").pipe(Effect.flip);
      expect(blocked.reason).toBe("busy");
      expect(blocked.message).toContain("working files");
      expect(NodeFS.readFileSync(`${nested}/keep.txt`, "utf8")).toBe("project work");
      expect(NodeFS.existsSync(`${parent.laneDir}/space/build/cache`)).toBe(false);
      expect(NodeFS.existsSync(`${parent.laneDir}/space/tmp/cache`)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("protects registered checkout paths through a symlink outside the lane", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("root"));
      const parent = yield* t.service.ensureForThread(ThreadId.make("root"));
      const nested = `${parent.laneDir}/space/tmp/feature`;
      NodeFS.mkdirSync(nested);
      NodeFS.writeFileSync(`${nested}/keep.txt`, "aliased thread files");
      const alias = `${t.home}/feature-alias`;
      NodeFS.symlinkSync(nested, alias, "dir");
      t.threads.push(thread("nested", { worktreePath: alias }));
      t.threads.splice(0, 1);

      const status = yield* t.service.tick();
      expect(laneOf(status, t.checkout)).toBeDefined();
      expect(NodeFS.readFileSync(`${alias}/keep.txt`, "utf8")).toBe("aliased thread files");
      expect(NodeFS.existsSync(parent.laneDir)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("refuses to discard a lane containing a registered checkout", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("root"));
      const parent = yield* t.service.ensureForThread(ThreadId.make("root"));
      const nested = `${parent.laneDir}/space/data/feature`;
      NodeFS.mkdirSync(nested);
      NodeFS.writeFileSync(`${nested}/keep.txt`, "archived conversation files");
      t.threads.push(thread("nested", { worktreePath: nested, archivedAt: DateTime.nowUnsafe() }));

      const failure = yield* t.service.discard(parent.id).pipe(Effect.flip);
      expect(failure.reason).toBe("busy");
      expect(failure.message).toContain("working files");
      expect(NodeFS.readFileSync(`${nested}/keep.txt`, "utf8")).toBe("archived conversation files");
    }).pipe(Effect.scoped),
  );

  it.live("adds and removes its block in the profile a ~/.zshenv link points to", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const target = `${t.home}/dotfiles/zshenv`;
      NodeFS.mkdirSync(NodePath.dirname(target));
      NodeFS.writeFileSync(target, "export EDITOR=vim\n");
      NodeFS.symlinkSync(target, `${t.home}/.zshenv`);

      yield* t.service.installShell();
      expect(NodeFS.lstatSync(`${t.home}/.zshenv`).isSymbolicLink()).toBe(true);
      expect(NodeFS.readFileSync(target, "utf8")).toContain(
        `source '${t.home}/Developer/lanes/.loom/lanes.zsh'`,
      );
      expect(NodeFS.existsSync(`${t.home}/Developer/lanes/.loom/shims/xcodebuild`)).toBe(true);

      yield* t.service.removeShell();
      expect(NodeFS.readFileSync(target, "utf8")).toBe("export EDITOR=vim\n");
    }).pipe(Effect.scoped),
  );

  it.live("installs a dev server's shell hook in its own profile, not ~/.zshenv", () =>
    Effect.gen(function* () {
      const t = yield* setupWith({ devUrl: new URL("http://localhost:5733") });
      NodeFS.writeFileSync(`${t.home}/.zshenv`, "export EDITOR=vim\n");

      yield* t.service.installShell();
      const status = yield* Stream.runHead(t.service.changes);
      const profilePath = Option.getOrThrow(status).shell.profilePath;
      expect(profilePath.startsWith(`${t.home}/state/`)).toBe(true);
      expect(NodeFS.readFileSync(profilePath, "utf8")).toContain("lanes.zsh'");
      yield* t.service.removeShell();
      expect(NodeFS.readFileSync(`${t.home}/.zshenv`, "utf8")).toBe("export EDITOR=vim\n");
    }).pipe(Effect.scoped),
  );

  it.live("adopts a process, lists it as a lease and stops it on release", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      const child = NodeChildProcess.spawn("/bin/sleep", ["60"], { stdio: "ignore" });
      yield* Effect.addFinalizer(() => Effect.sync(() => child.kill("SIGKILL")));
      const pid = child.pid!;

      const own = yield* t.service
        .adoptLease(lane.id, "process", String(process.pid), undefined)
        .pipe(Effect.flip);
      expect(own.reason).toBe("unsupported");
      const adopted = yield* t.service.adoptLease(lane.id, "process", String(pid), "sleeper");
      expect(adopted.leases).toContainEqual({
        kind: "process",
        ref: String(pid),
        label: "sleeper",
      });

      const released = yield* t.service.releaseLease(lane.id, "process", String(pid));
      expect(alive(pid)).toBe(false);
      expect(released.leases.filter((lease) => lease.kind === "process")).toEqual([]);
      const missing = yield* t.service
        .releaseLease(lane.id, "process", String(pid))
        .pipe(Effect.flip);
      expect(missing.reason).toBe("not-found");
    }).pipe(Effect.scoped),
  );

  it.live("stops a stuck lane's port listeners on its first release attempt only", () =>
    Effect.gen(function* () {
      let busy = true;
      const t = yield* setupWith({
        wrapSpaces: (spaces) => ({
          ...spaces,
          folder: {
            ...spaces.folder,
            detach: (paths, device, force) =>
              busy
                ? Effect.fail(
                    new ProjectLifecycleError({ reason: "busy", message: "Files are open." }),
                  )
                : spaces.folder.detach(paths, device, force),
          },
        }),
      });
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      const sleeper = () => {
        const child = NodeChildProcess.spawn("/bin/sleep", ["60"], { stdio: "ignore" });
        return child.pid!;
      };
      const started: Array<number> = [];
      const listen = () => {
        const pid = sleeper();
        started.push(pid);
        NodeFS.writeFileSync(`${t.home}/listening`, `${pid}\n`);
        return pid;
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const pid of started) if (alive(pid)) process.kill(pid, "SIGKILL");
        }),
      );
      const settle = (settled: boolean) => {
        t.threads[0] = thread("worker", settled ? { settledAt: DateTime.nowUnsafe() } : {});
      };

      const original = listen();
      settle(true);
      expect(laneOf(yield* t.service.tick(), t.checkout)?.id).toBe(lane.id);
      expect(alive(original)).toBe(false);

      // Another server took the port while the unmount stayed busy; a recorded process did not.
      // The watchdog now waits before retrying, so the retry is a discard.
      const newcomer = listen();
      const recorded = sleeper();
      started.push(recorded);
      yield* t.service.adoptLease(lane.id, "process", String(recorded), "worker");
      expect((yield* Effect.flip(t.service.discard(lane.id))).reason).toBe("busy");
      expect(alive(newcomer)).toBe(true);
      expect(alive(recorded)).toBe(false);

      // Held again and released again, the lane's ports are its own once more.
      settle(false);
      yield* t.service.tick();
      settle(true);
      busy = false;
      expect(laneOf(yield* t.service.tick(), t.checkout)).toBeUndefined();
      expect(alive(newcomer)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("stops a process holding files in a released lane, then removes the lane", () =>
    Effect.gen(function* () {
      // Detached, so it has no controlling terminal however the tests run, like a daemon.
      const holder = NodeChildProcess.spawn("/bin/sleep", ["60"], {
        stdio: "ignore",
        detached: true,
      }).pid!;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (alive(holder)) process.kill(holder, "SIGKILL");
        }),
      );
      const t = yield* setupWith({
        wrapSpaces: (spaces) => ({
          ...spaces,
          folder: {
            ...spaces.folder,
            detach: (paths, device, force) =>
              alive(holder)
                ? Effect.fail(
                    new ProjectLifecycleError({ reason: "busy", message: "Files are open." }),
                  )
                : spaces.folder.detach(paths, device, force),
          },
        }),
      });
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      NodeFS.writeFileSync(
        `${t.home}/holding`,
        `p${holder}\ncop\nfcwd\nn${lane.laneDir}/space/tmp/com.agilebits.op.501\n`,
      );
      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      expect(laneOf(yield* t.service.tick(), t.checkout)).toBeUndefined();
      expect(alive(holder)).toBe(false);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("unmounts a released lane that only processes lsof cannot see hold open", () =>
    Effect.gen(function* () {
      const forced: Array<string> = [];
      const t = yield* setupWith({
        wrapSpaces: (spaces) => ({
          ...spaces,
          folder: {
            ...spaces.folder,
            // Like syspolicyd, which keeps scanning a lane's binaries for hours.
            detach: (paths, device, force) => {
              if (!force)
                return Effect.fail(
                  new ProjectLifecycleError({ reason: "busy", message: "Files are open." }),
                );
              forced.push(paths.spacePath);
              return spaces.folder.detach(paths, device, force);
            },
          },
        }),
      });
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      expect(laneOf(yield* t.service.tick(), t.checkout)).toBeUndefined();
      expect(forced).toEqual([`${lane.laneDir}/space`]);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("names what keeps a released lane mounted and waits before trying again", () =>
    Effect.gen(function* () {
      let detaches = 0;
      const t = yield* setupWith({
        wrapSpaces: (spaces) => ({
          ...spaces,
          folder: {
            ...spaces.folder,
            detach: () => {
              detaches++;
              return Effect.fail(
                new ProjectLifecycleError({ reason: "busy", message: "Files are open." }),
              );
            },
          },
        }),
      });
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      const tmp = `${lane.laneDir}/space/tmp`;
      // This test process stands in for the server, which a release never stops.
      NodeFS.writeFileSync(
        `${t.home}/holding`,
        `p${process.pid}\ncnode\nfcwd\nn${tmp}\nf12\nn${tmp}/a.log\nf13\nn${tmp}/b.log\n`,
      );
      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      const message = laneOf(yield* t.service.tick(), t.checkout)?.message;
      expect(message).toContain(`node (pid ${process.pid}`);
      expect(message).toContain(
        "working directory space/tmp, has space/tmp/a.log and 1 more files open",
      );
      expect(detaches).toBe(1);

      yield* t.service.tick();
      expect(detaches).toBe(1);
      const refused = yield* Effect.flip(t.service.discard(lane.id));
      expect(refused.reason).toBe("busy");
      expect(refused.message).toContain(`node (pid ${process.pid}`);
      expect(detaches).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.live("releases a settled lane's processes, containers, simulators and devices", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.service.start();
      t.threads.push(
        thread("worker", { activeRunId: RunId.make("run-1") }),
        thread("other", { worktreePath: t.worktree }),
      );
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      NodeFS.writeFileSync(`${t.home}/lane-id`, lane.id);

      // A server started with lane-run, which starts a child of its own.
      const childFile = `${t.home}/child`;
      NodeChildProcess.execFileSync(
        "/bin/sh",
        [
          "-c",
          `'${t.home}/Developer/lanes/.loom/shims/lane-run' --name web sh -c 'sleep 60 & echo $! > ${childFile}; wait' >/dev/null 2>&1 &
           while [ ! -s ${childFile} ]; do sleep 0.05; done`,
        ],
        { cwd: t.checkout, env: { PATH: "/usr/bin:/bin" } },
      );
      const [, runPid] = NodeFS.readFileSync(`${lane.laneDir}/leases.tsv`, "utf8").split("\t");
      const childPid = Number(NodeFS.readFileSync(childFile, "utf8"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const pid of [Number(runPid), childPid])
            if (alive(pid)) process.kill(pid, "SIGKILL");
        }),
      );

      const adopted = yield* t.service.adoptLease(lane.id, "simulator", SIMULATOR, undefined);
      expect(adopted.leases.map((lease) => [lease.kind, lease.ref, lease.label])).toEqual([
        ["process", runPid, "web"],
        ["simulator", SIMULATOR, "Lane Phone"],
        ["container", "c0ffee", "db (running)"],
        ["volume", "db-data", "db-data"],
      ]);

      // The settled thread shares one device with an active thread and has the lane simulator open.
      t.deviceSessions.push(
        session("worker", SIMULATOR),
        session("worker", "shared-device"),
        session("other", "shared-device"),
      );
      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      const removed = yield* Effect.forkChild(
        t.service.changes.pipe(
          Stream.filter((status) => status.lanes.every((entry) => entry.id !== lane.id)),
          Stream.runHead,
        ),
      );
      yield* Effect.yieldNow;
      yield* PubSub.publish(t.events, {
        type: "thread.settled",
        payload: { id: ThreadId.make("worker") },
      } as OrchestrationV2DomainEvent);
      yield* Fiber.join(removed);

      expect(t.closed).toEqual([
        { threadId: "worker", deviceId: SIMULATOR, shutdown: true },
        { threadId: "worker", deviceId: "shared-device", shutdown: false },
      ]);
      expect(alive(Number(runPid))).toBe(false);
      expect(alive(childPid)).toBe(false);
      const log = calls(t.log);
      expect(log).toContain("docker rm -f c0ffee");
      expect(log).toContain("docker volume rm -f db-data");
      expect(log.indexOf("docker rm -f c0ffee")).toBeLessThan(
        log.indexOf("docker volume rm -f db-data"),
      );
      expect(log).toContain(`xcrun simctl delete ${SIMULATOR}`);
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("removes lane containers before stopping listeners and spares Docker's forwarders", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      NodeFS.writeFileSync(`${t.home}/lane-id`, lane.id);
      const sleeper = () => {
        const child = NodeChildProcess.spawn("/bin/sleep", ["60"], { stdio: "ignore" });
        return child.pid!;
      };
      const server = sleeper();
      const forwarder = sleeper();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const pid of [server, forwarder]) if (alive(pid)) process.kill(pid, "SIGKILL");
        }),
      );
      const base = lane.portBase!;
      // Some container on the computer publishes the forwarder's port; the server listens
      // beside it, and so does this server, which is never a lease.
      NodeFS.writeFileSync(
        `${t.home}/published`,
        `127.0.0.1:${base + 3}->80/tcp, [::]:${base + 3}->80/tcp\n5432/tcp\n`,
      );
      NodeFS.writeFileSync(
        `${t.home}/listening`,
        `${server} ${base + 1} node\n${forwarder} ${base + 3} sleep\n${process.pid} ${base + 5} node\n`,
      );

      const view = yield* t.service.laneView(lane.id);
      expect(view.leases.filter((lease) => lease.kind === "process")).toEqual([
        { kind: "process", ref: String(server), label: "Listening on a lane port" },
      ]);
      for (const pid of [forwarder, process.pid]) {
        const refused = yield* t.service
          .releaseLease(lane.id, "process", String(pid))
          .pipe(Effect.flip);
        expect(refused.reason).toBe("not-found");
      }

      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      expect(laneOf(yield* t.service.tick(), t.checkout)).toBeUndefined();
      const log = calls(t.log);
      // The server was still up when its lane's container went.
      expect(log).toContain(`listener ${server} alive`);
      expect(log.indexOf("docker rm -f c0ffee")).toBeLessThan(
        log.indexOf("docker volume rm -f db-data"),
      );
      expect(alive(server)).toBe(false);
      expect(alive(forwarder)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("spares a runtime's forwarder by name when Docker does not answer", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      NodeFS.writeFileSync(`${t.home}/docker-down`, "");
      const sleeper = () => {
        const child = NodeChildProcess.spawn("/bin/sleep", ["60"], { stdio: "ignore" });
        return child.pid!;
      };
      const server = sleeper();
      const backend = sleeper();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const pid of [server, backend]) if (alive(pid)) process.kill(pid, "SIGKILL");
        }),
      );
      const base = lane.portBase!;
      NodeFS.writeFileSync(
        `${t.home}/listening`,
        `${server} ${base} node\n${backend} ${base + 2} com.docker.backend\n`,
      );

      const view = yield* t.service.laneView(lane.id);
      expect(view.leases.map((lease) => lease.ref)).toEqual([String(server)]);
      // Once seen forwarding a lane port, it cannot be handed to the lane by mistake.
      const refused = yield* t.service
        .adoptLease(lane.id, "process", String(backend), "docker")
        .pipe(Effect.flip);
      expect(refused.reason).toBe("unsupported");
      expect(refused.message).toContain(`loom.lane=${lane.id}`);

      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      expect(laneOf(yield* t.service.tick(), t.checkout)).toBeUndefined();
      expect(alive(server)).toBe(false);
      expect(alive(backend)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("never stops a runtime a ledger names, even once it stops listening", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("worker"));
      const lane = yield* t.service.ensureForThread(ThreadId.make("worker"));
      NodeFS.writeFileSync(`${t.home}/lane-id`, lane.id);
      // ps reports the link's name on Linux and its path on macOS; both name Docker's backend.
      const executable = `${t.home}/com.docker.backend`;
      // Bash keeps the link's name, where uutils sleep refuses one and Node hides it on Linux. Its
      // read waits on a stdin pipe this test never writes.
      NodeFS.symlinkSync("/bin/bash", executable);
      const backend = NodeChildProcess.spawn(executable, ["-c", "read -t 60"], {
        stdio: ["pipe", "ignore", "ignore"],
      }).pid!;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (alive(backend)) process.kill(backend, "SIGKILL");
        }),
      );

      const refused = yield* t.service
        .adoptLease(lane.id, "process", String(backend), "docker")
        .pipe(Effect.flip);
      expect(refused.reason).toBe("unsupported");

      // A ledger entry written before adoption refused runtimes. Docker has already closed the
      // forwarder's lane port, so nothing about the lane's ports points at it.
      const started = NodeChildProcess.execFileSync(
        "ps",
        ["-o", "lstart=", "-p", String(backend)],
        {
          env: { ...process.env, LC_ALL: "C" },
          encoding: "utf8",
        },
      );
      NodeFS.appendFileSync(
        `${lane.laneDir}/leases.tsv`,
        ledgerLine({
          kind: "process",
          ref: String(backend),
          label: "docker",
          stamp: normalizeStart(started),
        }),
      );
      const view = yield* t.service.laneView(lane.id);
      expect(view.leases).toContainEqual({
        kind: "process",
        ref: String(backend),
        label: "docker",
      });
      const kept = yield* t.service
        .releaseLease(lane.id, "process", String(backend))
        .pipe(Effect.flip);
      expect(kept.reason).toBe("unsupported");

      t.threads[0] = thread("worker", { settledAt: DateTime.nowUnsafe() });
      expect(laneOf(yield* t.service.tick(), t.checkout)).toBeUndefined();
      expect(calls(t.log)).toContain("docker rm -f c0ffee");
      expect(alive(backend)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("frees a lane an hour after its checkout is removed", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("lane-worker", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("lane-worker"));
      NodeFS.rmSync(t.worktree, { recursive: true });

      const missing = laneOf(yield* t.service.tick(), t.worktree);
      expect(missing?.checkoutMissing).toEqual({
        since: "1970-01-01T00:00:00.000Z",
        freesAt: "1970-01-01T01:00:00.000Z",
      });
      yield* TestClock.adjust("59 minutes");
      expect(laneOf(yield* t.service.tick(), t.worktree)).toBeDefined();
      yield* TestClock.adjust("1 minute");
      expect(laneOf(yield* t.service.tick(), t.worktree)).toBeUndefined();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a lane whose checkout's volume is unplugged or denied", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("lane-worker", { worktreePath: t.worktree }));
      const lane = yield* t.service.ensureForThread(ThreadId.make("lane-worker"));
      const kept = `${lane.laneDir}/space/data/kept.txt`;
      NodeFS.writeFileSync(kept, "keep");
      const volume = NodePath.dirname(t.worktree);
      const unplugged = `${volume}-unplugged`;
      NodeFS.renameSync(volume, unplugged);
      expect(laneOf(yield* t.service.tick(), t.worktree)?.checkoutMissing).toBeNull();
      yield* TestClock.adjust("2 hours");
      expect(laneOf(yield* t.service.tick(), t.worktree)).toBeDefined();
      NodeFS.renameSync(unplugged, volume);

      NodeFS.chmodSync(volume, 0o000);
      yield* Effect.addFinalizer(() => Effect.sync(() => NodeFS.chmodSync(volume, 0o755)));
      expect(laneOf(yield* t.service.tick(), t.worktree)?.checkoutMissing).toBeNull();
      yield* TestClock.adjust("2 hours");
      expect(laneOf(yield* t.service.tick(), t.worktree)).toBeDefined();
      expect(NodeFS.readFileSync(kept, "utf8")).toBe("keep");
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a lane whose checkout is gone while a holder runs", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(
        thread("lane-runner", { worktreePath: t.worktree, activeRunId: RunId.make("run") }),
      );
      const lane = yield* t.service.ensureForThread(ThreadId.make("lane-runner"));
      NodeFS.rmSync(t.worktree, { recursive: true });
      yield* t.service.tick();
      yield* TestClock.adjust("2 hours");
      const held = laneOf(yield* t.service.tick(), t.worktree);
      expect(held?.checkoutMissing?.freesAt).toBeNull();
      expect(NodeFS.existsSync(lane.laneDir)).toBe(true);

      t.threads[0] = thread("lane-runner", { worktreePath: t.worktree });
      expect(laneOf(yield* t.service.tick(), t.worktree)).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect(
    "restarts the wait when the checkout returns and gives a resumed thread a new lane",
    () =>
      Effect.gen(function* () {
        const t = yield* setup;
        t.threads.push(thread("lane-resume", { worktreePath: t.worktree }));
        const first = yield* t.service.ensureForThread(ThreadId.make("lane-resume"));
        NodeFS.rmSync(t.worktree, { recursive: true });
        yield* t.service.tick();
        yield* TestClock.adjust("50 minutes");
        NodeFS.mkdirSync(t.worktree);
        expect(laneOf(yield* t.service.tick(), t.worktree)?.checkoutMissing).toBeNull();

        NodeFS.rmSync(t.worktree, { recursive: true });
        yield* t.service.tick();
        yield* TestClock.adjust("20 minutes");
        expect(laneOf(yield* t.service.tick(), t.worktree)).toBeDefined();
        yield* TestClock.adjust("40 minutes");
        expect(laneOf(yield* t.service.tick(), t.worktree)).toBeUndefined();

        NodeFS.mkdirSync(t.worktree);
        const fresh = yield* t.service.ensureForThread(ThreadId.make("lane-resume"));
        expect(fresh.id).not.toBe(first.id);
        expect(NodeFS.existsSync(`${fresh.laneDir}/space/tmp`)).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.live("lists unrecorded lane folders, never reclaims them, and discards one on request", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const root = (yield* t.service.getSettings).lanesRoot;
      t.threads.push(thread("recorded", { worktreePath: t.worktree }));
      const recorded = yield* t.service.ensureForThread(ThreadId.make("recorded"));
      const ghost = `${root}/ghost/old`;
      NodeFS.mkdirSync(`${ghost}/space/tmp`, { recursive: true });
      NodeFS.writeFileSync(`${root}/ghost/.DS_Store`, "");
      yield* t.service.reconcile();

      t.threads[0] = thread("recorded", { worktreePath: t.worktree, settledOverride: "settled" });
      NodeFS.writeFileSync(`${root}/app/.DS_Store`, "");
      const status = yield* t.service.tick();
      expect(status.lanes).toEqual([]);
      expect(status.unrecordedLanes).toEqual([{ path: ghost, project: "ghost", name: "old" }]);
      expect(NodeFS.existsSync(ghost)).toBe(true);
      expect(NodeFS.existsSync(NodePath.dirname(recorded.laneDir))).toBe(false);

      const outside = yield* t.service.discardUnrecorded(t.checkout).pipe(Effect.flip);
      expect(outside.reason).toBe("not-found");
      expect(NodeFS.existsSync(t.checkout)).toBe(true);
      yield* t.service.discardUnrecorded(ghost);
      expect(NodeFS.existsSync(`${root}/ghost`)).toBe(false);
      expect((yield* t.service.tick()).unrecordedLanes).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("refuses a relative lanes folder", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const settings = yield* t.service.getSettings;
      const refused = yield* t.service
        .updateSettings({ ...settings, lanesRoot: "Developer/lanes" })
        .pipe(Effect.flip);
      expect(refused.reason).toBe("unsupported");
      expect((yield* t.service.getSettings).lanesRoot).toBe(settings.lanesRoot);
      expect(yield* t.service.lanesRoots()).toEqual([settings.lanesRoot]);
    }).pipe(Effect.scoped),
  );

  it.live("reads a thread's lane without creating one", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      t.threads.push(thread("reader", { worktreePath: t.worktree }));
      const missing = yield* t.service.currentLaneView(ThreadId.make("reader")).pipe(Effect.flip);
      expect(missing.reason).toBe("not-found");
      expect(yield* t.store.listLanes()).toEqual([]);
      const lane = yield* t.service.ensureForThread(ThreadId.make("reader"));
      expect((yield* t.service.currentLaneView(ThreadId.make("reader"))).id).toBe(lane.id);
    }).pipe(Effect.scoped),
  );
});
