import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { designSet, designSeeds } from "./designFiles.ts";
const set = (kind: "kicad" | "tscircuit", entry: string, files: Record<string, string>) =>
  designSet({
    kind,
    seeds: designSeeds(kind, entry, "pcb"),
    projectDirectory: "pcb",
    io: {
      read: (path) => Effect.succeed(files[path] ?? null),
      exists: (path) =>
        Effect.succeed(
          path in files || Object.keys(files).some((name) => name.startsWith(path + "/")),
        ),
      list: (path) =>
        Effect.succeed(Object.keys(files).filter((name) => name.startsWith(path + "/"))),
    },
  });
it.effect("tracks the stem, sub-sheets and local libraries without a neighbouring board", () =>
  Effect.gen(function* () {
    const files = {
      "pcb/main.kicad_pro": "",
      "pcb/main.kicad_pcb": "",
      "pcb/main.kicad_sch":
        '(property "Sheetfile" "sub/power.kicad_sch") (property "Sheetfile" "../../outside.kicad_sch")',
      "pcb/sub/power.kicad_sch": "",
      "pcb/other.kicad_pcb": "",
      "pcb/sym-lib-table": '(uri "${KIPRJMOD}/parts.kicad_sym") (uri "${GLOBAL}/skip.kicad_sym")',
      "pcb/parts.kicad_sym": "",
      "pcb/fp-lib-table": '(uri "${KIPRJMOD}/parts.pretty")',
      "pcb/parts.pretty/part.kicad_mod": "",
    };
    const result = yield* set("kicad", "pcb/main.kicad_pro", files);
    expect(result.design).toEqual([
      "pcb/main.kicad_pcb",
      "pcb/main.kicad_pro",
      "pcb/main.kicad_sch",
      "pcb/sub/power.kicad_sch",
    ]);
    expect(result.supporting).toContain("pcb/parts.pretty/part.kicad_mod");
    expect(result.supporting).toContain("pcb/parts.kicad_sym");
  }),
);
it.effect("resolves local imports and assets while excluding installed packages", () =>
  Effect.gen(function* () {
    const result = yield* set("tscircuit", "pcb/main.tsx", {
      "pcb/main.tsx":
        'import x from "./parts"; const model = "./body.stl"; const bad = "./node_modules/a.ts"',
      "pcb/parts/index.tsx": "",
      "pcb/body.stl": "mesh",
      "pcb/node_modules/a.ts": "",
      "pcb/package.json": "{}",
      "pcb/other.tsx": "",
    });
    expect(result.design).toEqual(["pcb/main.tsx", "pcb/parts/index.tsx"]);
    expect(result.supporting).toEqual(["pcb/body.stl", "pcb/package.json"]);
  }),
);
