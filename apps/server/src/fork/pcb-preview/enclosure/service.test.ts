import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ThreadId } from "@t3tools/contracts";
import { PcbReferenceMetadata, ModelAssembly } from "@t3tools/contracts/fork";
import { makeEnclosure } from "./service.ts";
const decodeMetadata = Schema.decodeUnknownSync(PcbReferenceMetadata);
const decodeAssembly = Schema.decodeUnknownEffect(Schema.fromJsonString(ModelAssembly));

it.effect(
  "previews without workspace writes, creates a portable assembly and protects edited sources",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path,
          root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-enclosure-" });
        let exports = 0,
          race = false;
        const guarded = FileSystem.FileSystem.of({
          ...fs,
          exists: (destination) =>
            Effect.gen(function* () {
              const exists = yield* fs.exists(destination);
              if (race && destination.endsWith("board.loom-assembly.json")) {
                race = false;
                yield* fs.writeFileString(destination, "concurrent assembly");
              }
              return exists;
            }),
        });
        const metadata = decodeMetadata({
          designId: "board.kicad_pro",
          sourceHash: "0123456789abcdef",
          units: "mm",
          glbUnits: "metres",
          bounds: { x: 0, y: 0, width: 60, height: 40 },
          thickness: 1.6,
          mountingHoles: [],
          components: [],
          note: "",
        });
        const json = {
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
          materials: [{ name: "board" }],
          accessors: [{ min: [0, -0.0016, -0.04], max: [0.06, 0, 0] }],
        };
        const generate = yield* makeEnclosure({
          referenceData: () => Effect.succeed({ json, metadata }),
          workspace: () => Effect.succeed({ root }),
          exportReference: (i) =>
            Effect.sync(() => {
              exports++;
              return {
                path: path.join(root, "board.glb"),
                relativePath: "board.glb",
                metadataPath: path.join(root, "board.json"),
                sourceHash: metadata.sourceHash,
                targetThreadId: i.threadId,
              };
            }),
          directory: (r, p) =>
            fs
              .makeDirectory(path.join(r, p), { recursive: true })
              .pipe(Effect.as(path.join(r, p)), Effect.orDie),
          refresh: () => Effect.void,
        }).pipe(Effect.provideService(FileSystem.FileSystem, guarded));
        const input = { threadId: ThreadId.make("enclosure"), designId: metadata.designId };
        const preview = yield* generate({ ...input, preview: true, build123d: true });
        expect(preview.files).toHaveLength(2);
        expect(preview.files[0]?.source).toContain("module base()");
        expect(exports).toBe(0);
        expect(yield* fs.readDirectory(root)).toEqual([]);
        const result = yield* generate(input);
        expect(result.assembly?.created).toBe(true);
        const doc = yield* decodeAssembly(
          yield* fs.readFileString(path.join(root, result.assembly!.path)),
        );
        expect(doc.version).toBe(2);
        expect(doc.enclosure?.board).toBe("board");
        expect(doc.parts[0]?.path).toBe("board.glb");
        const file = path.join(root, result.files[0]!.path),
          edit = (yield* fs.readFileString(file)) + "// changed\n";
        yield* fs.writeFileString(file, edit);
        expect((yield* generate(input).pipe(Effect.flip)).message).toContain("was edited");
        expect(yield* fs.readFileString(file)).toBe(edit);
        const overwritten = yield* generate({ ...input, overwrite: true });
        expect(overwritten.assembly?.created).toBe(false);
        expect(yield* fs.readFileString(file)).not.toBe(edit);
        const assemblyPath = path.join(root, result.assembly!.path);
        yield* fs.remove(assemblyPath);
        race = true;
        const concurrent = yield* generate(input);
        expect(concurrent.assembly?.created).toBe(false);
        expect(yield* fs.readFileString(assemblyPath)).toBe("concurrent assembly");
        expect(concurrent.warnings.some((w) => w.includes("already exists"))).toBe(true);
        expect(
          (yield* generate({ ...input, outputDir: "../elsewhere", preview: true }).pipe(
            Effect.flip,
          )).message,
        ).toContain("inside this workspace");
      }),
    ).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer)), Effect.orDie),
);
