// @effect-diagnostics nodeBuiltinImport:off - Lanes are real folders the test inspects directly.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  RunId,
  ThreadId,
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

const setup = Effect.gen(function* () {
  const home = NodeFs.realpathSync(NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "loom-lc-")));
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => NodeFs.rmSync(home, { recursive: true, force: true })),
  );
  const checkout = NodePath.join(home, "src", "app");
  const worktree = NodePath.join(home, "worktrees", "app-feature");
  NodeFs.mkdirSync(checkout, { recursive: true });
  NodeFs.mkdirSync(worktree, { recursive: true });
  NodeFs.writeFileSync(NodePath.join(checkout, "App.xcodeproj"), "");

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
  const context = yield* Layer.build(
    Layer.mergeAll(
      Config.layerTest(home, NodePath.join(home, "state")),
      SqlitePersistenceMemory,
      ProcessRunner.layer,
    ).pipe(Layer.provideMerge(NodeServices.layer)),
  );
  yield* runForkMigrationSet(ProjectLifecycleMigrations).pipe(Effect.provide(context));
  const create = makeWith({ homeDir: home, imageBackend: false }).pipe(
    Effect.provide(context),
    Effect.provideService(ThreadManagementService, threadManagement),
    Effect.provideService(ProjectStore.ProjectStoreV2, projects),
  );
  const service = yield* create;
  yield* service.updateSettings({ ...(yield* service.getSettings), reserveGb: 0 });
  const store = yield* makeStore.pipe(Effect.provide(context));
  return { home, checkout, worktree, threads, sent, events, service, create, store };
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
      expect(NodeFs.readdirSync(`${root.laneDir}/space`).sort()).toEqual(["build", "data", "tmp"]);
      expect(NodeFs.readFileSync(`${root.laneDir}/LANE.md`, "utf8")).toContain(t.checkout);
      const index = NodeFs.readFileSync(`${lanes}/.loom/lanes.tsv`, "utf8");
      expect(index).toContain(`${t.checkout}\t${root.laneDir}/space\n`);
      expect(index).toContain(`${t.worktree}\t${feature.laneDir}/space\n`);

      // One settled thread still leaves another holding the main lane.
      t.threads[0] = thread("root-a", { settledAt: DateTime.nowUnsafe() });
      t.threads[2] = thread("feature", {
        worktreePath: t.worktree,
        archivedAt: DateTime.nowUnsafe(),
      });
      const status = yield* t.service.tick();
      expect(status.lanes.map((lane) => lane.name)).toEqual(["main"]);
      expect(laneOf(status, t.checkout)?.threadIds).toEqual(["root-b"]);
      expect(NodeFs.existsSync(feature.laneDir)).toBe(false);
      expect(NodeFs.existsSync(t.worktree)).toBe(true);
      expect(NodeFs.readFileSync(`${lanes}/.loom/lanes.tsv`, "utf8")).not.toContain(t.worktree);
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
      NodeFs.writeFileSync(`${created.tmpPath}/scratch`, Buffer.alloc(950_000, 1));
      NodeFs.writeFileSync(`${created.dataPath}/keep`, "notes");

      yield* service.tick();
      yield* service.tick();
      expect(t.sent.map((input) => [input.threadId, input.mode, input.createdBy])).toEqual([
        ["worker", "steer", "system"],
      ]);
      expect(t.sent[0]!.text).toContain(created.tmpPath);
      expect(t.sent[0]!.text).not.toContain("—");

      t.threads[0] = thread("worker");
      const status = yield* service.tick();
      expect(NodeFs.readdirSync(created.tmpPath)).toEqual([]);
      expect(NodeFs.readFileSync(`${created.dataPath}/keep`, "utf8")).toBe("notes");
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
      NodeFs.mkdirSync(`${lane.buildPath}/DerivedData`);
      NodeFs.writeFileSync(`${lane.buildPath}/DerivedData/index`, "x");
      NodeFs.writeFileSync(`${lane.tmpPath}/scratch`, "x");

      yield* t.service.free(lane.id, "build");
      expect(NodeFs.readdirSync(lane.buildPath)).toEqual([]);
      expect(NodeFs.readdirSync(lane.tmpPath)).toEqual(["scratch"]);

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
      expect(NodeFs.readdirSync(`${t.home}/Developer/lanes`)).toEqual([".loom"]);
    }).pipe(Effect.scoped),
  );

  it.live("adds and removes its block in the profile a ~/.zshenv link points to", () =>
    Effect.gen(function* () {
      const t = yield* setup;
      const target = `${t.home}/dotfiles/zshenv`;
      NodeFs.mkdirSync(NodePath.dirname(target));
      NodeFs.writeFileSync(target, "export EDITOR=vim\n");
      NodeFs.symlinkSync(target, `${t.home}/.zshenv`);

      yield* t.service.installShell();
      expect(NodeFs.lstatSync(`${t.home}/.zshenv`).isSymbolicLink()).toBe(true);
      expect(NodeFs.readFileSync(target, "utf8")).toContain(
        `source '${t.home}/Developer/lanes/.loom/lanes.zsh'`,
      );
      expect(NodeFs.existsSync(`${t.home}/Developer/lanes/.loom/shims/xcodebuild`)).toBe(true);

      yield* t.service.removeShell();
      expect(NodeFs.readFileSync(target, "utf8")).toBe("export EDITOR=vim\n");
    }).pipe(Effect.scoped),
  );
});
