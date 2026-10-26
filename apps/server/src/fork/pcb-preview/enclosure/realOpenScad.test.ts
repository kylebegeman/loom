import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnclosureRequirements, EnclosureStarterParams, partMatrix } from "@t3tools/contracts/fork";
import * as ProcessRunner from "../../../processRunner.ts";
import { checkEnclosure } from "../../model-preview-3d/check/enclosure.ts";
import { weld } from "../../model-preview-3d/check/mesh.ts";
import { readStl } from "../../model-preview-3d/check/readStl.ts";
import { topologyOf } from "../../model-preview-3d/check/topology.ts";
import type { BoardFeatures } from "./features.ts";
import { planEnclosure } from "./plan.ts";
import { writeScad } from "./scad.ts";

const decodeParams = Schema.decodeUnknownEffect(EnclosureStarterParams);
const decodeRequirements = Schema.decodeUnknownEffect(EnclosureRequirements);
const executable = process.env.LOOM_TEST_OPENSCAD;
const realTest = it.live.runIf(executable);
const features: BoardFeatures = {
  revision: "fixture",
  kind: "kicad",
  frame: { sx: 1, sy: -1, ox: 0, oy: 0, mirrored: false, matched: 3 },
  body: { top: 0, bottom: -1.6, box: { min: [0, 0, -1.6], max: [60, 40, 0] } },
  outline: {
    source: "bounds",
    outer: 0,
    loops: [
      [
        [0, 0],
        [60, 0],
        [60, 40],
        [0, 40],
      ],
    ],
  },
  holes: [{ x: 5, y: 5, diameter: 3.2, footprint: "MountingHole" }],
  parts: [
    {
      reference: "U1",
      side: "front",
      assumed: false,
      box: { min: [28, 18, 0], max: [32, 22, 12] },
    },
  ],
  connectors: [],
  warnings: [],
};
realTest(
  "renders generated base, lid and fit with the real CLI and checks the assembled case",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        runner = yield* ProcessRunner.ProcessRunner,
        root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-enclosure-scad-" }),
        plan = planEnclosure(features, yield* decodeParams({})),
        requirements = yield* decodeRequirements({});
      yield* fs.writeFileString(`${root}/case.scad`, writeScad(plan, "board.kicad_pro"));
      const meshes = new Map<string, ReturnType<typeof weld>>();
      for (const part of ["base", "lid", "fit"]) {
        const result = yield* runner.run({
          command: executable!,
          args: ["-o", `${root}/${part}.stl`, "-D", `part="${part}"`, `${root}/case.scad`],
          cwd: root,
          timeout: "20 seconds",
        });
        expect(result.code, result.stderr).toBe(0);
        expect(result.stderr).not.toMatch(/WARNING:|ERROR:/);
        const bytes = yield* fs.readFile(`${root}/${part}.stl`),
          mesh = weld(readStl([{ name: `${part}.stl`, bytes }], { maxTriangles: 100_000 }));
        expect(mesh.triangles.length).toBeGreaterThan(0);
        if (part !== "fit") {
          expect(topologyOf(mesh).watertight).toBe(true);
          meshes.set(part, mesh);
        }
        if (part === "base") {
          for (const axis of [0, 1]) {
            const values = Array.from(mesh.vertices).filter((_, i) => i % 3 === axis);
            expect(Math.max(...values) - Math.min(...values)).toBeCloseTo(plan.outerMm[axis]!, 2);
          }
        }
      }
      const report = checkEnclosure(
        {
          board: "board",
          caseParts: ["base", "lid"],
          features,
          requirements,
        },
        partMatrix([0, 0, 0], [0, 0, 0]),
        meshes,
        [],
      );
      expect(report.status, JSON.stringify(report.findings)).toBe("fits");
      expect(report.findings.find((f) => f.id === "hole:1")?.hole?.state).toBe("seated");
      expect(report.findings.find((f) => f.id === "above:summary")?.measuredMm).toBeCloseTo(1, 2);
    }).pipe(
      Effect.scoped,
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
  { timeout: 60_000 },
);
