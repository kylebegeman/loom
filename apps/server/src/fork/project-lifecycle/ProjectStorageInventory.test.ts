import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShellSnapshot,
} from "@t3tools/contracts";
import type { ProjectLifecycleStatus } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Config from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as DatabaseStorage from "../../persistence/DatabaseStorage.ts";
import * as Settings from "../../serverSettings.ts";
import * as Cleanup from "../../storageCleanup.ts";
import * as Workspace from "../project-library/LibraryWorkspaceStore.ts";
import * as Mirrors from "../project-library/LibraryGitFetch.ts";
import * as Lifecycle from "./ProjectLifecycleService.ts";
import * as Accounting from "./StorageCleanupAccounting.ts";
import * as Inventory from "./ProjectStorageInventory.ts";

function partial<A extends object>(value: Partial<A>): A {
  return new Proxy(value as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call ${String(key)}`);
    },
  });
}

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const primary = `${root}/primary`,
    worktree = `${primary}/worktree`;
  yield* fs.makeDirectory(worktree, { recursive: true });
  yield* fs.writeFileString(`${primary}/file`, "primary".repeat(8192));
  yield* fs.writeFileString(`${worktree}/file`, "worktree".repeat(8192));
  yield* fs.symlink(primary, `${root}/alias`);
  const projectId = ProjectId.make("project");
  const snapshot = {
    projects: [
      { id: projectId, workspaceRoot: primary },
      { id: ProjectId.make("alias"), workspaceRoot: `${root}/alias` },
    ],
    threads: [{ id: ThreadId.make("thread"), projectId, worktreePath: worktree }],
    archivedThreads: [],
  } as unknown as OrchestrationV2ThreadShellSnapshot;
  let reads = 0;
  const started = yield* Deferred.make<void>();
  const resume = yield* Deferred.make<void>();
  let pause = true;
  const source = Effect.gen(function* () {
    reads++;
    yield* Deferred.succeed(started, undefined);
    if (pause) yield* Deferred.await(resume);
    return snapshot;
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(HostProcess.HomeDirectory, root),
    Layer.succeed(
      ProjectStore.ProjectStoreV2,
      partial<ProjectStore.ProjectStoreV2["Service"]>({
        listShells: () =>
          Effect.succeed([
            { id: projectId, workspaceRoot: primary },
            { id: ProjectId.make("alias"), workspaceRoot: `${root}/alias` },
          ] as unknown as ReadonlyArray<import("@t3tools/contracts").OrchestrationProjectShell>),
      }),
    ),
    Layer.succeed(
      ProjectionStore.ProjectionStoreV2,
      partial<ProjectionStore.ProjectionStoreV2["Service"]>({ getShellSnapshot: () => source }),
    ),
    Layer.succeed(
      Settings.ServerSettingsService,
      partial<Settings.ServerSettingsService["Service"]>({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
    ),
    Layer.succeed(
      Workspace.LibraryWorkspaceStore,
      partial<Workspace.LibraryWorkspaceStore["Service"]>({ receipts: Effect.succeed([]) }),
    ),
    Layer.succeed(
      Mirrors.LibraryGitFetch,
      partial<Mirrors.LibraryGitFetch["Service"]>({ mirrorLocations: Effect.succeed([]) }),
    ),
    Layer.succeed(
      Lifecycle.ProjectLifecycleService,
      partial<Lifecycle.ProjectLifecycleService["Service"]>({
        changes: Stream.succeed({
          lanes: [],
          releasedCheckouts: [],
          unrecordedLanes: [],
        } as unknown as ProjectLifecycleStatus),
      }),
    ),
    Layer.succeed(
      DatabaseStorage.DatabaseStorage,
      partial<DatabaseStorage.DatabaseStorage["Service"]>({ status: Stream.succeed(null) }),
    ),
    Layer.succeed(
      Cleanup.StorageCleanup,
      partial<Cleanup.StorageCleanup["Service"]>({ latestReport: Effect.succeed(null) }),
    ),
    Accounting.layer,
  );
  return {
    root,
    reads: () => reads,
    started,
    resume,
    unpause: () => {
      pause = false;
    },
    service: Inventory.layer.pipe(Layer.provide(dependencies)),
  };
});

describe("project storage inventory", () => {
  it.effect("measures canonical category roots once and coalesces refreshes", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const inventory = yield* Inventory.ProjectStorageInventory;
        const first = yield* inventory.byCategory().pipe(Effect.forkChild);
        yield* Deferred.await(f.started);
        const second = yield* inventory.byCategory({ refresh: true }).pipe(Effect.forkChild);
        f.unpause();
        yield* Deferred.succeed(f.resume, undefined);
        const [a, b] = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
        expect(f.reads()).toBe(1);
        expect(b.breakdown).toEqual(a.breakdown);
        const primary = a.breakdown.categories.find((row) => row.kind === "primary")!;
        const worktrees = a.breakdown.categories.find((row) => row.kind === "worktrees")!;
        expect(primary.locations).toBe(1);
        expect(worktrees.locations).toBe(1);
        expect(primary.bytes).toBeGreaterThan(0);
        expect(worktrees.bytes).toBeGreaterThan(0);
        expect(a.breakdown.categories.find((row) => row.kind === "database")?.bytes).toBeNull();
        yield* inventory.byCategory();
        expect(f.reads()).toBe(1);
        yield* inventory.byCategory({ refresh: true });
        expect(f.reads()).toBe(2);
        yield* TestClock.adjust("1 minute");
        yield* inventory.byCategory();
        expect(f.reads()).toBe(3);
      }).pipe(Effect.provide(f.service));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Config.layerTest(process.cwd(), { prefix: "storage-inventory-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});
