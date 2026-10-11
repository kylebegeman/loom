import { expect, it } from "vite-plus/test";
import { capTurnModels, dependentModels, modelCandidates } from "./turnModels.ts";
import { workspaceFiles } from "../turnFiles.ts";

it("strips repository prefixes and excludes siblings and invalid workspace paths", () => {
  expect(
    workspaceFiles("design/", [
      "design/part.STL",
      "outside/a.scad",
      "design-other/b.scad",
      "design/../escape.scad",
      "/design/c.scad",
    ]),
  ).toEqual(["part.STL"]);
  expect(workspaceFiles("", ["part.scad", "../a.scad", "a\\b.scad"])).toEqual(["part.scad"]);
});
it("keeps written model order across meshes and STEP while excluding ordinary code", () => {
  expect(modelCandidates(["z.STL", "a.stp", "b.scad", "code.ts", "z.STL"], new Map())).toEqual([
    { path: "z.STL", format: "stl", reason: "written", via: null },
    { path: "a.stp", format: "step", reason: "written", via: null },
    { path: "b.scad", format: "scad", reason: "written", via: null },
  ]);
});
it("closes include chains and cycles with the first changed input as the reason", () => {
  const reverse = new Map([
    ["c.scad", new Set(["b.scad"])],
    ["b.scad", new Set(["a.scad"])],
    ["a.scad", new Set(["c.scad"])],
  ]);
  const result = dependentModels(["c.scad", "b.scad"], reverse);
  expect(result.models.get("a.scad")).toBe("c.scad");
  expect(result.truncated).toBe(false);
  expect(modelCandidates(["c.scad"], result.models)).toEqual([
    { path: "c.scad", format: "scad", reason: "written", via: null },
    { path: "a.scad", format: "scad", reason: "dependency", via: "c.scad" },
    { path: "b.scad", format: "scad", reason: "dependency", via: "c.scad" },
  ]);
});
it("bounds dependency closure and caps valid models at fifty", () => {
  const reverse = new Map([
    ["gear.scad", new Set(Array.from({ length: 201 }, (_, i) => `${i}.scad`))],
  ]);
  expect(dependentModels(["gear.scad"], reverse).models.size).toBe(200);
  expect(dependentModels(["gear.scad"], reverse).truncated).toBe(true);
  const candidates = modelCandidates(
    Array.from({ length: 51 }, (_, i) => `${i}.stl`),
    new Map(),
  );
  expect(capTurnModels(candidates)).toMatchObject({ truncated: true, models: expect.any(Array) });
  expect(capTurnModels(candidates).models).toHaveLength(50);
});

it("preserves Python source format on written and dependent model offers", () => {
  expect(
    modelCandidates(["bracket.b3d.py", "helper.py"], new Map([["other.b3d.py", "helper.py"]])),
  ).toEqual([
    { path: "bracket.b3d.py", format: "build123d", reason: "written", via: null },
    { path: "other.b3d.py", format: "build123d", reason: "dependency", via: "helper.py" },
  ]);
});
