import { makeHistoryGit } from "../model-preview-3d/history/git.ts";
import { makeHistoryRestore } from "../model-preview-3d/history/restore.ts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ThreadId,
  RunId,
  CheckpointId,
  CheckpointScopeId,
  CheckpointRef,
  NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { makePcbHistory } from "./history.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call: ${String(key)}`);
    },
  });
}
const testLayer = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    runner = yield* ProcessRunner.ProcessRunner;
  const top = yield* fs.makeTempDirectoryScoped({ prefix: "loom-history-" });
  const root = path.join(top, "workspace");
  yield* fs.makeDirectory(root);
  const git = (args: ReadonlyArray<string>) =>
    runner.run({ command: "git", args, cwd: top }).pipe(
      Effect.tap((output) =>
        Effect.sync(() => {
          expect(output.code, output.stderr).toBe(0);
        }),
      ),
    );
  yield* git(["init", "--quiet"]);
  yield* git(["config", "user.email", "history@example.test"]);
  yield* git(["config", "user.name", "History tests"]);
  yield* git(["config", "core.autocrlf", "false"]);
  const threadId = ThreadId.make("history-thread"),
    scopeId = CheckpointScopeId.make("root-scope");
  const file = { threadId, designId: "main.kicad_pro" };
  const scope: OrchestrationV2CheckpointScope = {
    id: scopeId,
    threadId,
    runId: null,
    nodeId: NodeId.make("node"),
    parentScopeId: null,
    providerThreadId: null,
    kind: "root_run",
    ordinalWithinParent: 0,
    advancesAppRunCount: true,
    cwd: root,
    createdAt: DateTime.makeUnsafe(0),
  };
  let checkpoints: OrchestrationV2Checkpoint[] = [];
  const capture = (turn: number, changed: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      yield* git(["add", "--all"]);
      yield* git(["commit", "--quiet", "--allow-empty", "-m", `turn ${turn}`]);
      const ref = CheckpointRef.make(`refs/t3/history-tests/${turn}`);
      yield* git(["update-ref", ref, "HEAD"]);
      const checkpoint: OrchestrationV2Checkpoint = {
        id: CheckpointId.make(`checkpoint-${turn}`),
        threadId,
        scopeId,
        runId: turn === 0 ? null : RunId.make(`run-${turn}`),
        nodeId: NodeId.make("node"),
        parentCheckpointId: null,
        ordinalWithinScope: turn,
        appRunOrdinal: turn || null,
        ref,
        status: "ready",
        files: changed.map((path) => ({ path, kind: "modified", additions: 1, deletions: 0 })),
        capturedAt: DateTime.makeUnsafe(turn * 1000),
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    });
  const store = ProjectionStore.ProjectionStoreV2.of(
    partial<ProjectionStore.ProjectionStoreV2["Service"]>({
      getThreadRecords: <K extends ProjectionStore.ProjectionRecordField>(
        _: ThreadId,
        fields: ReadonlyArray<K>,
      ) =>
        Effect.sync(() => {
          const supported = { checkpoints, checkpointScopes: [scope], runs: [] };
          for (const field of fields)
            if (!(field in supported)) throw new Error(`Unexpected projection field: ${field}`);
          return Object.fromEntries(
            fields.map((field) => [field, Reflect.get(supported, field)]),
          ) as unknown as ProjectionStore.ProjectionRecords<K>;
        }),
    }),
  );
  yield* fs.writeFileString(path.join(root, "main.kicad_pro"), "project");
  yield* fs.writeFileString(
    path.join(root, "main.kicad_sch"),
    '(property "Sheetfile" "power.kicad_sch")',
  );
  yield* fs.writeFileString(path.join(root, "power.kicad_sch"), "old power");
  yield* fs.writeFileString(path.join(root, "main.kicad_pcb"), "old board");
  const first = yield* capture(0, []);
  yield* fs.writeFileString(path.join(root, "main.kicad_pcb"), "new board");
  const second = yield* capture(1, ["workspace/main.kicad_pcb"]);
  yield* fs.writeFileString(path.join(root, "other.kicad_pcb"), "other");
  yield* capture(2, ["workspace/other.kicad_pcb"]);
  const history = yield* makePcbHistory({
    historyDir: path.join(top, "state", "pcb-history"),
    resolve: () =>
      Effect.succeed({
        root,
        absolute: path.join(root, file.designId),
        cwd: root,
        workspaceKey: "workspace",
        design: {
          id: file.designId,
          kind: "kicad" as const,
          boardPath: "main.kicad_pcb",
          schematicPath: "main.kicad_sch",
        },
      }),
    snapshot: () =>
      fs
        .readFileString(path.join(root, "main.kicad_sch"))
        .pipe(Effect.map((text) => ({ sourceHash: text, files: [], dirs: [root] }))),
  }).pipe(Effect.provideService(ProjectionStore.ProjectionStoreV2, store));
  return { fs, path, root, file, first, second, history, checkpoints, capture, git };
});
it.effect(
  "lists only this design's turns in a nested workspace and materializes the whole project",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup;
      const page = yield* ctx.history.history(ctx.file);
      expect(page.versions.map((version) => version.turn)).toEqual([1, 0]);
      expect(page.latestTurn).toBe(2);
      const version = yield* ctx.history.versionDesign({ ...ctx.file, checkpointId: ctx.first.id });
      expect(
        yield* ctx.fs.readFileString(ctx.path.join(version.resolved.root, "main.kicad_pcb")),
      ).toBe("old board");
      expect(
        yield* ctx.fs.readFileString(ctx.path.join(version.resolved.root, "power.kicad_sch")),
      ).toBe("old power");
      expect(version.set.design).not.toContain("other.kicad_pcb");
      const stale = yield* ctx.history
        .versionDesign({ ...ctx.file, checkpointId: CheckpointId.make("foreign") })
        .pipe(Effect.flip);
      expect(stale.reason).toBe("version-not-found");
    }).pipe(Effect.provide(testLayer)),
);
it.effect(
  "plans without writes, restores with conflict protection and undoes optional removals",
  () =>
    Effect.gen(function* () {
      const ctx = yield* setup;
      yield* ctx.fs.writeFileString(ctx.path.join(ctx.root, "added.kicad_sch"), "added");
      yield* ctx.fs.writeFileString(
        ctx.path.join(ctx.root, "main.kicad_sch"),
        '(property "Sheetfile" "power.kicad_sch") (property "Sheetfile" "added.kicad_sch")',
      );
      const page = yield* ctx.history.history(ctx.file);
      const input = {
        ...ctx.file,
        checkpointId: ctx.first.id,
        expectedContentKey: page.current.contentKey,
        includeSupporting: false,
        removeAdded: true,
      };
      const plan = yield* ctx.history.restore({ ...input, dryRun: true });
      expect(plan.plan.added).toEqual(["added.kicad_sch"]);
      expect(yield* ctx.fs.readFileString(ctx.path.join(ctx.root, "main.kicad_pcb"))).toBe(
        "new board",
      );
      const result = yield* ctx.history.restore(input);
      expect(yield* ctx.fs.exists(ctx.path.join(ctx.root, "added.kicad_sch"))).toBe(false);
      expect(yield* ctx.fs.readFileString(ctx.path.join(ctx.root, "main.kicad_pcb"))).toBe(
        "old board",
      );
      yield* ctx.history.undo({ ...ctx.file, undoId: result.undoId! });
      expect(yield* ctx.fs.readFileString(ctx.path.join(ctx.root, "added.kicad_sch"))).toBe(
        "added",
      );
      const conflict = yield* ctx.history
        .restore({ ...input, expectedContentKey: "stale" })
        .pipe(Effect.flip);
      expect(conflict.reason).toBe("conflict");
    }).pipe(Effect.provide(testLayer)),
);

it.effect("undo refuses a newer edit and keeps all design files intact", () =>
  Effect.gen(function* () {
    const ctx = yield* setup;
    const page = yield* ctx.history.history(ctx.file);
    const restored = yield* ctx.history.restore({
      ...ctx.file,
      checkpointId: ctx.first.id,
      includeSupporting: false,
      removeAdded: false,
      expectedContentKey: page.current.contentKey,
    });
    yield* ctx.fs.writeFileString(ctx.path.join(ctx.root, "main.kicad_pcb"), "newer edit");
    const refused = yield* ctx.history
      .undo({ ...ctx.file, undoId: restored.undoId! })
      .pipe(Effect.flip);
    expect(refused.reason).toBe("conflict");
    expect(yield* ctx.fs.readFileString(ctx.path.join(ctx.root, "main.kicad_pcb"))).toBe(
      "newer edit",
    );
  }).pipe(Effect.provide(testLayer)),
);
it.effect("a staging or second-rename failure leaves every file unchanged", () =>
  Effect.gen(function* () {
    const ctx = yield* setup;
    const git = yield* makeHistoryGit;
    const fs = ctx.fs;
    const source = ctx.path.join(ctx.root, "old-source");
    yield* fs.writeFileString(source, "restored");
    const entries = ["main.kicad_pcb", "power.kicad_sch"].map((name) => ({
      path: name,
      source,
      mode: 0o100644,
    }));
    for (const stage of [true, false]) {
      let renames = 0;
      const injected = FileSystem.FileSystem.of({
        ...fs,
        copyFile: (from, to) =>
          stage && to.includes("power.kicad_sch.loom-restore-")
            ? fs.copyFile("/missing-test-file", to)
            : fs.copyFile(from, to),
        rename: (from, to) =>
          !stage && from.includes(".loom-restore-") && ++renames === 2
            ? fs.rename("/missing-test-file", to)
            : fs.rename(from, to),
      });
      const restore = yield* makeHistoryRestore({
        undoDir: ctx.path.join(ctx.root, ".undo-test"),
        git,
      }).pipe(Effect.provideService(FileSystem.FileSystem, injected));
      yield* restore
        .restore({
          root: ctx.root,
          file: { threadId: ctx.file.threadId, path: ctx.file.designId },
          entries,
        })
        .pipe(Effect.flip);
      expect(yield* fs.readFileString(ctx.path.join(ctx.root, "main.kicad_pcb"))).toBe("new board");
      expect(yield* fs.readFileString(ctx.path.join(ctx.root, "power.kicad_sch"))).toBe(
        "old power",
      );
    }
  }).pipe(Effect.provide(testLayer)),
);
