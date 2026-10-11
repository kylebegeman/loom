import { expect, it } from "vite-plus/test";
import { read3mf } from "./read3mf.ts";
const limits = { maxTriangles: 10 };
const xml = (name: string, source: string) => ({ name, bytes: new TextEncoder().encode(source) });
const mesh =
  '<mesh><vertices><vertex x="1" y="2" z="3"/><vertex x="2" y="2" z="3"/><vertex x="1" y="3" z="3"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
const part = (unit: string, contents: string, build = '<item objectid="1"/>') =>
  `<model unit="${unit}"><resources>${contents}</resources><build>${build}</build></model>`;
it.each([
  ["micron", 0.001],
  ["millimeter", 1],
  ["centimeter", 10],
  ["inch", 25.4],
  ["foot", 304.8],
  ["meter", 1000],
] as const)("normalizes %s units like the viewer", (unit, factor) => {
  const output = read3mf(
    [xml("3D/3dmodel.model", part(unit, `<object id="1">${mesh}</object>`))],
    limits,
  );
  expect(output[0]).toBe(Math.fround(factor));
  expect(output[1]).toBe(Math.fround(2 * factor));
  expect(output[2]).toBe(Math.fround(3 * factor));
});
it("honors start relationships and applies non-symmetric row-major build transforms", () => {
  const transform = "0 1 0 -1 0 0 0 0 1 4 5 6";
  const output = read3mf(
    [
      xml(
        "_rels/.rels",
        '<Relationships><Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/main.model"/></Relationships>',
      ),
      xml(
        "3D/main.model",
        part(
          "inch",
          `<object id="1">${mesh}</object>`,
          `<item objectid="1" transform="${transform}"/>`,
        ),
      ),
    ],
    limits,
  );
  expect(output[0]).toBeCloseTo(2 * 25.4, 4);
  expect(output[1]).toBeCloseTo(6 * 25.4, 4);
  expect(output[2]).toBeCloseTo(9 * 25.4, 4);
});
it("expands components and build references across production parts with each part's units", () => {
  const files = [
    xml("3D/child.model", part("inch", `<object id="7">${mesh}</object>`, "")),
    xml(
      "3D/3dmodel.model",
      part(
        "millimeter",
        '<object id="1"><components><component objectid="7" p:path="/3D/child.model" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components></object>',
        '<item objectid="1"/><item objectid="7" p:path="/3D/child.model"/>',
      ),
    ),
  ];
  const output = read3mf(files, limits);
  expect(output).toHaveLength(18);
  expect(output[0]).toBeCloseTo(35.4, 4);
  expect(output[9]).toBeCloseTo(25.4, 4);
  expect(() => read3mf(files, { maxTriangles: 1 })).toThrow("Too many triangles");
});
it("refuses production paths inside a non-root part and components deeper than eight", () => {
  const child = xml(
    "3D/child.model",
    part(
      "millimeter",
      '<object id="1"><components><component objectid="7" p:path="/3D/3dmodel.model"/></components></object>',
      "",
    ),
  );
  const root = xml(
    "3D/3dmodel.model",
    part(
      "millimeter",
      `<object id="7">${mesh}</object>`,
      '<item objectid="1" p:path="/3D/child.model"/>',
    ),
  );
  expect(() => read3mf([child, root], limits)).toThrow("non-root part");
  const chain = Array.from(
    { length: 10 },
    (_, i) =>
      `<object id="${i + 1}">${i === 9 ? mesh : `<components><component objectid="${i + 2}"/></components>`}</object>`,
  ).join("");
  expect(() => read3mf([xml("3D/3dmodel.model", part("millimeter", chain))], limits)).toThrow(
    "nests components too deeply",
  );
});
it("skips support and other objects and rejects malformed geometry and unsafe paths", () => {
  const source = part(
    "millimeter",
    `<object id="1" type="support">${mesh}</object><object id="2" type="other">${mesh}</object>`,
    '<item objectid="1"/><item objectid="2"/>',
  );
  expect(read3mf([xml("3D/3dmodel.model", source)], limits)).toHaveLength(0);
  expect(() =>
    read3mf(
      [
        xml(
          "3D/3dmodel.model",
          part("millimeter", `<object id="1">${mesh.replace('v3="2"', 'v3="9"')}</object>`),
        ),
      ],
      limits,
    ),
  ).toThrow("triangle indices");
  expect(() =>
    read3mf(
      [
        xml(
          "3D/3dmodel.model",
          part(
            "millimeter",
            `<object id="1">${mesh}</object>`,
            '<item objectid="1" p:path="/../secret.model"/>',
          ),
        ),
      ],
      limits,
    ),
  ).toThrow("invalid part path");
  expect(() =>
    read3mf(
      [
        xml(
          "3D/3dmodel.model",
          part(
            "millimeter",
            `<object id="1">${mesh}</object>`,
            '<item objectid="1" transform="1 2"/>',
          ),
        ),
      ],
      limits,
    ),
  ).toThrow("invalid transform");
});
