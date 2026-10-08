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
import type { ProjectLifecycleStatus } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Config from "../../config.ts";
import { DeviceService } from "../../device/DeviceService.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import {
  ThreadManagementService,
  type ThreadManagementSendInput,
} from "../../orchestration-v2/ThreadManagementService.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLifecycleMigrations } from "./migrations.ts";
import { makeWith } from "./ProjectLifecycleService.ts";
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
  // Lists one container and one volume labelled for the lane id in <home>/lane-id.
  stub(
    "docker",
    `lane=$(cat '${home}/lane-id' 2>/dev/null)
[ -n "$lane" ] || exit 0
case "$1 $2" in
  "ps -a") printf 'c0ffee\\t%s\\tdb\\trunning\\n' "$lane" ;;
  "volume ls") printf 'db-data\\t%s\\n' "$lane" ;;
esac`,
  );
  stub("lsof", "exit 1");
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

const setup = Effect.gen(function* () {
  const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-lc-")));
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
    getShellSnapshot: () =>
      Effect.succeed({
        schemaVersion: 1,
        snapshotSequence: 0,
        threads: [...threads],
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
  const projects = partial<ProjectStore.ProjectStoreV2["Service"]>({
    listShells: () =>
      Effect.succeed([
        { id: projectId, title: "App", workspaceRoot: checkout } as OrchestrationProjectShell,
      ]),
  });
  const deviceSessions: Array<DeviceSession> = [];
  const closed: Array<{ threadId: string; deviceId?: string; shutdown?: boolean }> = [];
  const devices = partial<DeviceService["Service"]>({
    state: Effect.sync(() => ({ sessions: [...deviceSessions] }) as unknown as DeviceServiceState),
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
      Config.layerTest(home, NodePath.join(home, "state")),
      SqlitePersistenceMemory,
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
  }).pipe(
    Effect.provide(context),
    Effect.provideService(ThreadManagementService, threadManagement),
    Effect.provideService(ProjectStore.ProjectStoreV2, projects),
    Effect.provideService(DeviceService, devices),
  );
  const service = yield* create;
  yield* service.updateSettings({ ...(yield* service.getSettings), reserveGb: 0 });
  const store = yield* makeStore.pipe(Effect.provide(context));
  return {
    home,
    checkout,
    worktree,
    threads,
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

const laneOf = (status: ProjectLifecycleStatus, checkoutPath: string) =>
  status.lanes.find((lane) => lane.checkoutPath === checkoutPath);

describe("ProjectLifecycleService", () => {
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

  it.live("steers a running agent once, then clears tmp once the lane is idle", () =>
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
      const status = yield* service.tick();
      expect(NodeFS.readdirSync(created.tmpPath)).toEqual([]);
      expect(NodeFS.readFileSync(`${created.dataPath}/keep`, "utf8")).toBe("notes");
      expect(laneOf(status, t.checkout)?.usedBytes).toBeLessThan(500_000);
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

  it.live("creates lanes when runs start and reclaims them when threads settle", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.service.start();
      const settledStatus = (predicate: (status: ProjectLifecycleStatus) => boolean) =>
        t.service.changes.pipe(Stream.filter(predicate), Stream.runHead);

      t.threads.push(thread("worker", { activeRunId: RunId.make("run-1") }));
      const created = yield* Effect.forkChild(settledStatus((status) => status.lanes.length === 1));
      yield* Effect.yieldNow;
      yield* PubSub.publish(t.events, {
        type: "run.created",
        payload: { threadId: ThreadId.make("worker") },
      } as OrchestrationV2DomainEvent);
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
});
