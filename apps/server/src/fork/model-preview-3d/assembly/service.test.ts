import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ModelPreviewError, type ModelFileRef } from "@t3tools/contracts/fork";
import { ThreadId } from "@t3tools/contracts";
import { makeAssemblies } from "./service.ts";
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
  const resolveWorkspace = (file: ModelFileRef) =>
    Effect.succeed({ root, absolute: `${root}/${file.path}` });
  const service = yield* makeAssemblies({
    resolveWorkspace,
    resolveFile: (file) =>
      Effect.gen(function* () {
        const location = yield* resolveWorkspace(file);
        const info = yield* fs
          .stat(location.absolute)
          .pipe(
            Effect.mapError(
              () => new ModelPreviewError({ reason: "not-found", message: "Missing" }),
            ),
          );
        return { ...location, info };
      }),
    metadata: (info) => ({ revision: String(info.size) }),
    boundsOf: () => Effect.succeed({ min: [0, 0, 0], max: [1, 1, 1] }),
  });
  return {
    fs,
    root,
    service,
    file: { threadId: ThreadId.make("test"), path: "test.loom-assembly.json" },
  };
});
it.effect(
  "creates portable files and serializes two CAS writers without losing the first save",
  () =>
    Effect.gen(function* () {
      const { fs, root, service, file } = yield* setup;
      yield* fs.writeFileString(`${root}/case.stl`, "mesh");
      const initial = yield* service.updateAssembly({
        file,
        operations: [
          { op: "set-name", name: "Case" },
          { op: "add-part", id: "case", path: "case.stl" },
        ],
      });
      const results = yield* Effect.all(
        ["First", "Second"].map((name) =>
          Effect.exit(
            service.updateAssembly({
              file,
              expectedRevision: initial.revision,
              operations: [{ op: "set-name", name }],
            }),
          ),
        ),
        { concurrency: 2 },
      );
      expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect(results.filter((r) => r._tag === "Failure")).toHaveLength(1);
      const current = yield* service.assembly(file);
      expect(["First", "Second"]).toContain(current.assembly.name);
      expect(current.revision).not.toBe(initial.revision);
      const text = yield* fs.readFileString(`${root}/${file.path}`);
      expect(text.endsWith("\n")).toBe(true);
      expect(text).toContain('"units": "mm"');
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
it.effect(
  "leaves the original file unchanged when a later operation fails or a newer version is read-only",
  () =>
    Effect.gen(function* () {
      const { fs, root, service, file } = yield* setup;
      yield* service.updateAssembly({ file, operations: [{ op: "set-name", name: "Original" }] });
      const before = yield* fs.readFileString(`${root}/${file.path}`);
      const createConflict = yield* Effect.exit(
        service.updateAssembly({
          file,
          createOnly: true,
          operations: [{ op: "set-name", name: "Other" }],
        }),
      );
      expect(createConflict._tag).toBe("Failure");
      expect(yield* fs.readFileString(`${root}/${file.path}`)).toBe(before);
      const failure = yield* Effect.exit(
        service.updateAssembly({
          file,
          operations: [
            { op: "set-name", name: "Changed" },
            { op: "move-part", id: "missing", by: [1, 0, 0] },
          ],
        }),
      );
      expect(failure._tag).toBe("Failure");
      expect(yield* fs.readFileString(`${root}/${file.path}`)).toBe(before);
      const newer = JSON.stringify({
        format: "loom-assembly",
        version: 3,
        name: "Future",
        parts: [],
        clearances: [],
        enclosure: null,
        extra: { preserved: true },
      });
      yield* fs.writeFileString(`${root}/${file.path}`, newer);
      expect((yield* service.assembly(file)).readOnly).toBe(true);
      const rejected = yield* Effect.exit(
        service.updateAssembly({ file, operations: [{ op: "set-name", name: "Lost" }] }),
      );
      expect(rejected._tag).toBe("Failure");
      expect(yield* fs.readFileString(`${root}/${file.path}`)).toBe(newer);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
it.effect("uses content revisions even when a hand edit preserves file size", () =>
  Effect.gen(function* () {
    const { fs, root, service, file } = yield* setup;
    const first = yield* service.updateAssembly({
      file,
      operations: [{ op: "set-name", name: "Alpha" }],
    });
    const content = yield* fs.readFileString(`${root}/${file.path}`);
    yield* fs.writeFileString(`${root}/${file.path}`, content.replace("Alpha", "Bravo"));
    const second = yield* service.assembly(file);
    expect(second.revision).not.toBe(first.revision);
    const result = yield* Effect.exit(
      service.updateAssembly({
        file,
        expectedRevision: first.revision,
        operations: [{ op: "set-name", name: "Other" }],
      }),
    );
    expect(result._tag).toBe("Failure");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
