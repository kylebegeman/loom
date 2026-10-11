import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { AssemblyPart } from "@t3tools/contracts/fork";
import { makeBoardFeatures } from "./boardFeatures.ts";
const decodePart = Schema.decodeUnknownSync(AssemblyPart);
it.effect("loads old board references from bounded JSON without reading binary mesh data", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-reference-" });
      const json = JSON.stringify({
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        materials: [{ name: "board" }],
        accessors: [{ min: [0, -0.0016, -0.04], max: [0.06, 0, 0] }],
      });
      const n = Math.ceil(json.length / 4) * 4,
        bytes = new Uint8Array(20 + n + 4096),
        header = new DataView(bytes.buffer);
      header.setUint32(0, 0x46546c67, true);
      header.setUint32(4, 2, true);
      header.setUint32(8, bytes.length, true);
      header.setUint32(12, n, true);
      header.setUint32(16, 0x4e4f534a, true);
      bytes.fill(32, 20, 20 + n);
      bytes.set(new TextEncoder().encode(json), 20);
      yield* fs.writeFile(`${root}/board.glb`, bytes);
      yield* fs.writeFileString(
        `${root}/board.json`,
        JSON.stringify({
          designId: "board.kicad_pro",
          sourceHash: "r1",
          units: "mm",
          glbUnits: "metres",
          bounds: { x: 0, y: 0, width: 60, height: 40 },
          thickness: 1.6,
          mountingHoles: [],
          components: [],
          note: "",
        }),
      );
      const guarded = FileSystem.FileSystem.of({
        ...fs,
        readFile: () => Effect.die("Must read only the JSON chunk"),
      });
      const load = yield* makeBoardFeatures((file) =>
        Effect.succeed({ absolute: `${root}/${file.path}` }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, guarded));
      const file = { threadId: ThreadId.make("board-features"), path: "board.loom-assembly.json" },
        part = decodePart({ id: "board", name: "Board", path: "board.glb" });
      const features = yield* load(file, part);
      expect(features.body.bottom).toBeCloseTo(-1.6);
      expect(features.revision).toBe("r1");
      expect(features.outline.source).toBe("bounds");
      yield* fs.writeFileString(`${root}/board.json`, "{}");
      expect((yield* load(file, part).pipe(Effect.flip)).message).toContain("no reference data");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
