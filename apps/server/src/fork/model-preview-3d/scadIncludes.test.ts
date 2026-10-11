import { expect, it } from "vite-plus/test";
import { scadReferences, resolveScadReference } from "./scadIncludes.ts";

it("finds literal includes, use libraries, geometry imports and heightmaps", () => {
  expect(
    scadReferences(
      'include <a.scad>\nuse <lib/b.scad>\nimport("part.stl"); import(file="x.3mf"); surface("map.png");',
    ),
  ).toEqual([
    { kind: "include", path: "a.scad" },
    { kind: "use", path: "lib/b.scad" },
    { kind: "import", path: "part.stl" },
    { kind: "import", path: "x.3mf" },
    { kind: "surface", path: "map.png" },
  ]);
});
it("skips comments, variable arguments and reference-looking strings", () => {
  expect(
    scadReferences(
      '// include <old.scad>\n/* use <old.scad> */\nimport(name);\necho("include <fake.scad>"); import("a//b.stl");',
    ),
  ).toEqual([{ kind: "import", path: "a//b.stl" }]);
});
it("keeps escaped paths as written and resolves beside the source", () => {
  const source = String.raw`import("lib\mesh.stl");`;
  expect(scadReferences(source)).toEqual([{ kind: "import", path: String.raw`lib\mesh.stl` }]);
  expect(
    resolveScadReference("/workspace/models/part.scad", { kind: "include", path: "../gear.scad" }),
  ).toBe("/workspace/gear.scad");
});
it("recognizes references across comments without accepting identifier suffixes", () => {
  expect(
    scadReferences(
      'include/* comment */<a.scad>\nmyinclude <fake.scad>\nimport /* c */ (file /* c */ = "b.stl")',
    ),
  ).toEqual([
    { kind: "include", path: "a.scad" },
    { kind: "import", path: "b.stl" },
  ]);
});
