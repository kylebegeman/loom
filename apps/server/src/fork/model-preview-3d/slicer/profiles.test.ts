// @effect-diagnostics nodeBuiltinImport:off -- Test fixtures use isolated temporary host folders.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeEffectPath from "@effect/platform-node/NodePath";
import { afterAll, beforeAll, expect, it } from "@effect/vitest";
import {
  parsePrusaConfig,
  flattenProfile,
  profileCompatible,
  profileHash,
  selectProfileRoots,
  type ProfileRoot,
} from "./profiles.ts";
let directory: string;
let roots: ProfileRoot[];
beforeAll(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-slicer-profiles-"));
  roots = [
    { source: "user", vendor: null, directory: NodePath.join(directory, "user"), version: null },
    {
      source: "system",
      vendor: "BBL",
      directory: NodePath.join(directory, "BBL"),
      version: "02.08.00.09",
    },
  ];
  for (const root of roots)
    await NodeFSP.mkdir(NodePath.join(root.directory, "machine"), { recursive: true });
  const write = (root: number, name: string, json: unknown) =>
    NodeFSP.writeFile(
      NodePath.join(roots[root]!.directory, "machine", `${name}.json`),
      JSON.stringify(json),
    );
  await write(1, "common", {
    name: "common",
    type: "machine",
    printable_area: [1, 2, 3, 4],
    nozzle_diameter: ["0.4"],
    inherits: "",
  });
  await write(1, "H2D", {
    name: "H2D",
    type: "machine",
    inherits: "common",
    printable_area: [9, 8],
    instantiation: "true",
  });
  await write(0, "Mine", {
    name: "Mine",
    type: "machine",
    inherits: "H2D",
    printer_model: "Custom",
  });
  await write(1, "loopA", { inherits: "loopB" });
  await write(1, "loopB", { inherits: "loopA" });
  await write(1, "missing", { inherits: "absent" });
});
afterAll(async () => {
  await NodeFSP.rm(directory, { force: true, recursive: true });
});
const provide = <A, E>(
  effect: Effect.Effect<A, E, import("effect/FileSystem").FileSystem | import("effect/Path").Path>,
) => effect.pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodeEffectPath.layer)));
it.effect(
  "flattens leaf overrides, user parents and arrays without writing installed profiles",
  () =>
    provide(
      Effect.gen(function* () {
        const { json } = yield* flattenProfile(roots, "machine", "Mine");
        expect(json).toEqual({
          name: "Mine",
          type: "machine",
          printable_area: [9, 8],
          nozzle_diameter: ["0.4"],
          printer_model: "Custom",
          instantiation: "true",
          inherits: "H2D",
          from: "User",
        });
      }),
    ),
);
it.effect("rejects inheritance loops and missing parents with the profile name", () =>
  provide(
    Effect.gen(function* () {
      const loop = yield* flattenProfile(roots, "machine", "loopA").pipe(Effect.flip);
      expect(loop.message).toContain("loopA");
      const missing = yield* flattenProfile(roots, "machine", "missing").pipe(Effect.flip);
      expect(missing.message).toContain("absent");
    }),
  ),
);
it("selects higher vendor versions and preserves canonical hash and compatibility", () => {
  expect(
    selectProfileRoots([...roots, { ...roots[1]!, version: "02.08.00.06", directory: "/old" }]),
  ).toEqual(roots);
  expect(profileHash({ b: [1, 2], a: { y: 2, x: 1 } })).toBe(
    profileHash({ a: { x: 1, y: 2 }, b: [1, 2] }),
  );
  expect(profileCompatible({ compatible_printers: [] }, "H2D")).toBe(true);
  expect(profileCompatible({ compatible_printers: ["H2D"] }, "H2C")).toBe(false);
  expect(profileCompatible({ compatible_printers_condition: "unknown syntax" }, "H2D")).toBe(true);
});

it("reads Prusa slot metadata and rejects a partial preset", () => {
  const json = parsePrusaConfig(
    "nozzle_diameter = 0.4\nlayer_height = 0.2\nfilament_diameter = 1.75;2.85\nfilament_density = 1.24;1.27\nfilament_cost = 20;30",
  );
  expect(json.filament_density).toEqual(["1.24", "1.27"]);
  expect(json.filament_cost).toEqual(["20", "30"]);
  expect(() => parsePrusaConfig("layer_height = 0.2")).toThrow("complete PrusaSlicer config");
});
