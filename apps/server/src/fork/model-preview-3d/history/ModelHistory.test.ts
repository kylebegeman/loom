import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ThreadId,
  RunId,
  CheckpointId,
  CheckpointScopeId,
  CheckpointRef,
  NodeId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointScope,
} from "@t3tools/contracts";
import { ModelPreviewError, type SignedFile } from "@t3tools/contracts/fork";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../../../processRunner.ts";
import { makeHistory, type HistoryOptions } from "./ModelHistory.ts";
import { makeHistoryGit } from "./git.ts";

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
  const top = yield* fs
    .makeTempDirectoryScoped({ prefix: "loom-history-" })
    .pipe(Effect.flatMap(fs.realPath));
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
    projectId = ProjectId.make("project"),
    scopeId = CheckpointScopeId.make("root-scope");
  const file = { threadId, path: "part.scad" };
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
  const mesh: SignedFile = {
    relativeUrl: "/api/mesh",
    expiresAt: 999999,
    sizeBytes: 84,
    modifiedAt: "1970-01-01T00:00:00.000Z",
    revision: "mesh",
  };
  const snapshots: string[] = [];
  const options: HistoryOptions = {
    historyDir: path.join(top, "state", "history"),
    resolveWorkspace: (input) =>
      Effect.succeed({ root, absolute: path.join(root, input.path), projectId }),
    sign: () => Effect.succeed(mesh),
    maxFileBytes: () => 1024 * 1024,
    renderSnapshot: (_, resolved) =>
      Effect.gen(function* () {
        snapshots.push(
          yield* fs.readFileString(path.join(path.dirname(resolved.absolute), "shape.scad")),
        );
        return {
          status: "ok",
          mesh,
          meshFormat: "stl",
          render: {
            status: "ok",
            mesh,
            meshFormat: "stl",
            cached: false,
            durationMs: 0,
            log: [],
            summary: null,
          },
        } as const;
      }).pipe(
        Effect.mapError(
          () =>
            new ModelPreviewError({
              reason: "command-failed",
              message: "The snapshot fixture could not be read.",
            }),
        ),
      ),
  };
  const create = (overrides: Partial<HistoryOptions> = {}) =>
    makeHistory({ ...options, ...overrides }).pipe(
      Effect.provideService(ProjectionStore.ProjectionStoreV2, store),
    );
  yield* fs.writeFileString(path.join(root, "part.scad"), "include <shape.scad>\ncube(1);");
  yield* fs.writeFileString(path.join(root, "shape.scad"), "sphere(1);");
  yield* capture(0, []);
  yield* fs.writeFileString(path.join(root, "shape.scad"), "sphere(2);");
  const turn = yield* capture(2, ["workspace/shape.scad"]);
  yield* fs.writeFileString(path.join(root, "unrelated.ts"), "const x=1;");
  yield* capture(3, ["workspace/unrelated.ts"]);
  yield* fs.writeFileString(path.join(root, "shape.scad"), "sphere(9);");
  return { fs, path, top, root, file, git, create, turn, snapshots, capture, options };
});
const run = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
  operation.pipe(Effect.scoped, Effect.provide(testLayer));
it.effect(
  "lists recursive dependencies in a Git subdirectory and preserves the real index during snapshot checkout",
  () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup,
          service = yield* t.create();
        const before = yield* t.fs.readFile(t.path.join(t.top, ".git", "index"));
        const page = yield* service.history({ file: t.file });
        expect(page.versions.map((version) => version.turn)).toEqual([2, 0]);
        expect(page.latestTurn).toBe(3);
        expect(page.versions[0]!.changed).toEqual(["shape.scad"]);
        const result = yield* service.historyVersion({ file: t.file, checkpointId: t.turn.id });
        expect(result.status).toBe("ok");
        expect(result.differingIncludes).toEqual(["shape.scad"]);
        expect(t.snapshots).toEqual(["sphere(2);"]);
        expect(yield* t.fs.readFile(t.path.join(t.top, ".git", "index"))).toEqual(before);
        expect(yield* t.fs.readFileString(t.path.join(t.root, "shape.scad"))).toBe("sphere(9);");
      }),
    ),
);
it.effect("rejects stale restore content without writing anything", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        page = yield* service.history({ file: t.file });
      yield* t.fs.writeFileString(t.path.join(t.root, "part.scad"), "cube(90);");
      const result = yield* Effect.result(
        service.historyRestore({
          file: t.file,
          checkpointId: t.turn.id,
          includeDependencies: true,
          expectedContentKey: page.current.contentKey,
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.reason).toBe("conflict");
      expect(yield* t.fs.readFileString(t.path.join(t.root, "shape.scad"))).toBe("sphere(9);");
    }),
  ),
);
it.effect("restores dependencies and supports durable undo after service reconstruction", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        page = yield* service.history({ file: t.file });
      yield* t.fs.chmod(t.path.join(t.root, "shape.scad"), 0o755);
      const restored = yield* service.historyRestore({
        file: t.file,
        checkpointId: t.turn.id,
        includeDependencies: true,
        expectedContentKey: page.current.contentKey,
      });
      expect(restored.restored.toSorted()).toEqual(["part.scad", "shape.scad"]);
      expect(yield* t.fs.readFileString(t.path.join(t.root, "shape.scad"))).toBe("sphere(2);");
      yield* (yield* t.create()).historyUndo({ file: t.file, undoId: restored.undoId });
      expect(yield* t.fs.readFileString(t.path.join(t.root, "shape.scad"))).toBe("sphere(9);");
      expect((yield* t.fs.stat(t.path.join(t.root, "shape.scad"))).mode & 0o777).toBe(0o755);
    }),
  ),
);
it.effect("undo rejects newer edits and retains the record", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create(),
        page = yield* service.history({ file: t.file });
      const restored = yield* service.historyRestore({
        file: t.file,
        checkpointId: t.turn.id,
        includeDependencies: true,
        expectedContentKey: page.current.contentKey,
      });
      yield* t.fs.writeFileString(t.path.join(t.root, "shape.scad"), "sphere(100);");
      const result = yield* Effect.result(
        service.historyUndo({ file: t.file, undoId: restored.undoId }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.reason).toBe("conflict");
      expect(yield* t.fs.readFileString(t.path.join(t.root, "shape.scad"))).toBe("sphere(100);");
      expect(
        yield* t.fs.exists(
          t.path.join(t.options.historyDir, "undo", restored.undoId, "manifest.json"),
        ),
      ).toBe(true);
    }),
  ),
);
it.effect("undo removes included files that restore created", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      yield* t.fs.remove(t.path.join(t.root, "shape.scad"));
      const page = yield* service.history({ file: t.file });
      const restored = yield* service.historyRestore({
        file: t.file,
        checkpointId: t.turn.id,
        includeDependencies: true,
        expectedContentKey: page.current.contentKey,
      });
      expect(yield* t.fs.exists(t.path.join(t.root, "shape.scad"))).toBe(true);
      yield* service.historyUndo({ file: t.file, undoId: restored.undoId });
      expect(yield* t.fs.exists(t.path.join(t.root, "shape.scad"))).toBe(false);
    }),
  ),
);
it.effect("drops refs removed by rollback and rejects stale selection", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      yield* t.git(["update-ref", "-d", t.turn.ref]);
      const page = yield* service.history({ file: t.file });
      expect(page.versions.map((version) => version.turn)).toEqual([0]);
      const result = yield* Effect.result(
        service.historyVersion({ file: t.file, checkpointId: t.turn.id }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.reason).toBe("not-found");
    }),
  ),
);
it.effect("Git checkout preserves attributes without modifying the live index", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.fs.writeFileString(t.path.join(t.top, ".gitattributes"), "*.txt text eol=crlf\n");
      yield* t.fs.writeFileString(t.path.join(t.root, "notes.txt"), "first\nsecond\n");
      const checkpoint = yield* t.capture(4, ["workspace/notes.txt"]);
      const helper = yield* makeHistoryGit;
      const entries = yield* helper.lsTree(t.root, checkpoint.ref, ["notes.txt"]);
      const output = t.path.join(t.top, "checkout", "files");
      yield* helper.materialize(t.root, checkpoint.ref, entries, output);
      expect(yield* t.fs.readFileString(t.path.join(output, "workspace", "notes.txt"))).toBe(
        "first\r\nsecond\r\n",
      );
    }),
  ),
);
it.effect("follows safe in-root file symlinks and preserves the symlink", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const target = t.path.join(t.root, "source.scad");
      yield* t.fs.rename(t.path.join(t.root, "part.scad"), target);
      yield* t.fs.symlink("source.scad", t.path.join(t.root, "part.scad"));
      const page = yield* service.history({ file: t.file });
      const restored = yield* service.historyRestore({
        file: t.file,
        checkpointId: t.turn.id,
        includeDependencies: false,
        expectedContentKey: page.current.contentKey,
      });
      expect(yield* t.fs.readLink(t.path.join(t.root, "part.scad"))).toBe("source.scad");
      yield* service.historyUndo({ file: t.file, undoId: restored.undoId });
      expect(yield* t.fs.readLink(t.path.join(t.root, "part.scad"))).toBe("source.scad");
    }),
  ),
);

it.effect("undo rejects a changed symlink target even if its bytes match", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup,
        service = yield* t.create();
      const original = t.path.join(t.root, "original.scad");
      yield* t.fs.rename(t.path.join(t.root, "part.scad"), original);
      yield* t.fs.symlink("original.scad", t.path.join(t.root, "part.scad"));
      const page = yield* service.history({ file: t.file });
      const restored = yield* service.historyRestore({
        file: t.file,
        checkpointId: t.turn.id,
        includeDependencies: false,
        expectedContentKey: page.current.contentKey,
      });
      yield* t.fs.copyFile(original, t.path.join(t.root, "new-target.scad"));
      yield* t.fs.remove(t.path.join(t.root, "part.scad"));
      yield* t.fs.symlink("new-target.scad", t.path.join(t.root, "part.scad"));
      const result = yield* Effect.result(
        service.historyUndo({ file: t.file, undoId: restored.undoId }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.reason).toBe("conflict");
    }),
  ),
);
it.effect("rejects LFS historical models and remains recoverable after cancellation", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.fs.writeFileString(
        t.path.join(t.root, "part.scad"),
        "version https://git-lfs.github.com/spec/v1\noid sha256:123\nsize 999\n",
      );
      const pointer = yield* t.capture(5, ["workspace/part.scad"]);
      const service = yield* t.create();
      const failed = yield* Effect.result(
        service.historyVersion({ file: t.file, checkpointId: pointer.id }),
      );
      expect(failed._tag).toBe("Failure");
      if (failed._tag === "Failure") {
        expect(failed.failure.reason).toBe("command-failed");
        expect(failed.failure.message).toContain("Git LFS");
      }
      yield* service.historyCancel(t.file);
      expect(
        (yield* service.historyVersion({ file: t.file, checkpointId: t.turn.id })).status,
      ).toBe("ok");
    }),
  ),
);
it.effect("a newer history request interrupts a pending snapshot render for the same model", () =>
  run(
    Effect.gen(function* () {
      const t = yield* setup;
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      let count = 0;
      const service = yield* t.create({
        renderSnapshot: (input, resolved) =>
          ++count === 1
            ? Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }).pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined)))
            : t.options.renderSnapshot(input, resolved),
      });
      const previous = yield* Effect.forkChild(
        service.historyVersion({ file: t.file, checkpointId: t.turn.id }),
      );
      yield* Deferred.await(started);
      expect(
        (yield* service.historyVersion({ file: t.file, checkpointId: t.turn.id })).status,
      ).toBe("ok");
      yield* Deferred.await(interrupted);
      expect((yield* Fiber.join(previous)).status).toBe("cancelled");
    }),
  ),
);

it.effect(
  "materializes Python parameter sidecars, local imports and recorded data dependencies at the selected turn",
  () =>
    run(
      Effect.gen(function* () {
        const t = yield* setup;
        const file = { ...t.file, path: "part.b3d.py" };
        yield* t.fs.writeFileString(
          t.path.join(t.root, file.path),
          "import helper\ndef model(): return helper.make()\n",
        );
        yield* t.fs.writeFileString(
          t.path.join(t.root, "part.json"),
          '{"parameterSets":{"Small":{"size":"2"}}}',
        );
        yield* t.fs.writeFileString(t.path.join(t.root, "helper.py"), "def make(): return 2\n");
        yield* t.fs.writeFileString(t.path.join(t.root, "data.csv"), "size\n2\n");
        const checkpoint = yield* t.capture(4, [
          "workspace/part.b3d.py",
          "workspace/part.json",
          "workspace/helper.py",
          "workspace/data.csv",
        ]);
        yield* t.fs.writeFileString(t.path.join(t.root, "data.csv"), "size\n9\n");
        const service = yield* t.create({
          currentDependencies: () => [t.path.join(t.root, "data.csv")],
        });
        const snapshot = yield* service.materialize({ file, checkpointId: checkpoint.id });
        const folder = t.path.dirname(snapshot.absolute);
        expect(yield* t.fs.readFileString(t.path.join(folder, "helper.py"))).toBe(
          "def make(): return 2\n",
        );
        expect(yield* t.fs.readFileString(t.path.join(folder, "data.csv"))).toBe("size\n2\n");
        expect(yield* t.fs.readFileString(t.path.join(folder, "part.json"))).toContain('"Small"');
        expect(snapshot.differingIncludes).toEqual(["data.csv"]);
      }),
    ),
);
