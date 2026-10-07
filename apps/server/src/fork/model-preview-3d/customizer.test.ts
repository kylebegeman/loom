import { describe, expect, it } from "@effect/vitest";
import { parseCustomizer, validateLiteral } from "./customizer.ts";
describe("OpenSCAD customizer", () => {
  it("reads groups, descriptions, range and dropdown hints while skipping expressions and hidden parameters", () => {
    const values = parseCustomizer(
      `/* [Size] */\n// Wall thickness\nwall = 2; // [1:0.5:10]\nquality = 10; // [10:Small,20:Large]\ncolor = "red"; // [red,blue]\nflag = true;\nposition = [1,2,3];\nexpression = 1 + 2;\n/* [Hidden] */\nsecret = 4;\nmodule shape() {}\nlate = 7;`,
    );
    expect(values.map((p) => p.name)).toEqual(["wall", "quality", "color", "flag", "position"]);
    expect(values[0]).toMatchObject({
      group: "Size",
      description: "Wall thickness",
      range: { min: 1, max: 10, step: 0.5 },
    });
    expect(values[1]?.options).toEqual([
      { value: "10", label: "Small" },
      { value: "20", label: "Large" },
    ]);
    expect(values[2]?.options?.[0]?.value).toBe('"red"');
  });
  it("validates literal types and refuses extra OpenSCAD statements", () => {
    expect(validateLiteral("number", "-1.5e2")).toBe(true);
    expect(validateLiteral("string", '"a\\"b"')).toBe(true);
    expect(validateLiteral("vector", "[1,2,true]")).toBe(true);
    expect(validateLiteral("number", "1; cube(9)")).toBe(false);
    expect(validateLiteral("string", '"unterminated')).toBe(false);
    expect(validateLiteral("vector", "[1, foo()]")).toBe(false);
  });
});

it("ignores assignments and braces in block comments and nested scopes", () => {
  expect(
    parseCustomizer(`/* long comment
{
fake=1;
}
*/
// Actual description
size=3; // [1:9]
if(true) {
nested=4;
}
label="text { ; }";
/* [Hidden] */
hidden=1;
/* [Visible] */
visible=true;`).map((p) => p.name),
  ).toEqual(["size", "label", "visible"]);
});
