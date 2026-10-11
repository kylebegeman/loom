import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { EnclosureRequirements, partMatrix } from "@t3tools/contracts/fork";
import type { BoardFeatures } from "../../pcb-preview/enclosure/features.ts";
import { checkEnclosure } from "./enclosure.ts";
import { cubeSoup, joinSoup } from "./fixtures.ts";
import { weld } from "./mesh.ts";
const f: BoardFeatures = {
  revision: "board-r1",
  kind: "kicad",
  frame: { sx: 1, sy: -1, ox: 0, oy: 0, mirrored: false, matched: 3 },
  body: { top: 1.6, bottom: 0, box: { min: [0, 0, 0], max: [60, 40, 1.6] } },
  outline: {
    outer: 0,
    source: "bounds",
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
      box: { min: [28, 18, 1.6], max: [32, 22, 13.6] },
    },
  ],
  connectors: [],
  warnings: [],
};
const requirements = Schema.decodeUnknownSync(EnclosureRequirements)({});
const check = (
  soup: Float32Array,
  features: BoardFeatures = f,
  position: [number, number, number] = [0, 0, 0],
) => {
  const meshes = new Map(
    Array.from(
      { length: Math.ceil(soup.length / 108) },
      (_, i) => [`case-${i}`, weld(soup.slice(i * 108, (i + 1) * 108))] as const,
    ),
  );
  return checkEnclosure(
    { board: "board", caseParts: [...meshes.keys()], features, requirements },
    partMatrix(position, [0, 0, 0]),
    meshes,
    [],
  );
};
const tray = joinSoup(
  cubeSoup([2, 45, 18], [-2.5, -2.5, -4]),
  cubeSoup([2, 45, 18], [60.5, -2.5, -4]),
  cubeSoup([61, 2, 18], [-0.5, -2.5, -4]),
  cubeSoup([61, 2, 18], [-0.5, 40.5, -4]),
  cubeSoup([65, 45, 2], [-2.5, -2.5, -5]),
  cubeSoup([6, 6, 3], [2, 2, -3]),
  cubeSoup([65, 45, 2], [-2.5, -2.5, 14.1]),
);
it("measures wall and lid gaps, seats bosses and detects a moved board", () => {
  const report = check(tray);
  expect(report.findings.find((v) => v.id === "wall:+x")?.measuredMm).toBeCloseTo(0.5, 3);
  expect(report.findings.find((v) => v.id === "above:U1")).toMatchObject({
    status: "tight",
    measuredMm: expect.closeTo(0.5, 3),
  });
  expect(report.findings.find((v) => v.id === "hole:1")?.hole?.state).toBe("solid");
  expect(report.findings.find((v) => v.id === "below:summary")?.measuredMm).toBeCloseTo(3, 3);
  expect(check(tray, f, [0.8, 0, 0]).findings.find((v) => v.id === "wall:+x")?.status).toBe(
    "interferes",
  );
  const gap = check(tray, f, [0, 0, 1]);
  expect(gap.findings.find((v) => v.id === "hole:1")?.hole?.state).toBe("gap");
  expect(gap.suggestedMove?.[2]).toBeCloseTo(-1, 5);
  const inside = check(tray, f, [0, 0, -0.5]);
  expect(inside.findings.find((v) => v.id === "hole:1")?.hole?.state).toBe("inside");
  expect(inside.suggestedMove?.[2]).toBeCloseTo(0.5, 3);
});
it("distinguishes blocked, margin-limited and clear connector openings", () => {
  const features = {
    ...f,
    holes: [],
    connectors: [
      {
        reference: "J1",
        box: {
          min: [58, 18, 2],
          max: [61, 22, 8],
        } as import("../../pcb-preview/enclosure/features.ts").Box,
        facing: "+x" as const,
        edgeMm: -1,
      },
    ],
  };
  const solid = check(cubeSoup([2, 45, 18], [62, -2.5, -4]), features);
  expect(solid.findings.find((v) => v.id === "connector:J1")?.status).toBe("interferes");
  expect(solid.findings.find((v) => v.id === "connector:J1")?.connector?.setbackMm).toBeCloseTo(
    1,
    3,
  );
  const narrow = check(
    joinSoup(cubeSoup([2, 20.5, 18], [62, -2.5, -4]), cubeSoup([2, 20.5, 18], [62, 22, -4])),
    features,
  );
  expect(narrow.findings.find((v) => v.id === "connector:J1")?.status).toBe("tight");
  const open = check(
    joinSoup(cubeSoup([2, 19.5, 18], [62, -2.5, -4]), cubeSoup([2, 19.5, 18], [62, 23, -4])),
    features,
  );
  expect(open.findings.find((v) => v.id === "connector:J1")?.status).toBe("ok");
});
it("reports missing and off-centre bosses with a corrective move and treats open geometry as unchecked", () => {
  const missing = check(cubeSoup([2, 45, 18], [60.5, -2.5, -4]));
  expect(missing.findings.find((v) => v.id === "hole:1")?.hole?.state).toBe("missing");
  const offset = check(cubeSoup([6, 6, 3], [3, 2, -3]));
  expect(offset.findings.find((v) => v.id === "hole:1")?.hole?.state).toBe("off-centre");
  expect(offset.suggestedMove?.[0]).toBeCloseTo(1, 1);
  const open = check(cubeSoup([2, 45, 18], [59.5, -2.5, -4]).slice(0, -9));
  expect(open.findings.find((v) => v.id === "wall:+x")?.status).toBe("unchecked");
  expect(open.findings.some((v) => v.status === "interferes")).toBe(false);
});
it("measures a closed hollow case without treating its cavity as solid", () => {
  const inner = cubeSoup([61, 41, 16], [-0.5, -0.5, -3]);
  for (let i = 0; i < inner.length; i += 9)
    for (let a = 0; a < 3; a++) {
      const tmp = inner[i + 3 + a]!;
      inner[i + 3 + a] = inner[i + 6 + a]!;
      inner[i + 6 + a] = tmp;
    }
  const mesh = weld(joinSoup(cubeSoup([65, 45, 20], [-2.5, -2.5, -5]), inner));
  const report = checkEnclosure(
    { board: "board", caseParts: ["case"], features: { ...f, holes: [] }, requirements },
    partMatrix([0, 0, 0], [0, 0, 0]),
    new Map([["case", mesh]]),
    [],
  );
  expect(report.findings.find((v) => v.id === "wall:+x")?.measuredMm).toBeCloseTo(0.5, 3);
  expect(report.findings.find((v) => v.id === "wall:+x")?.status).toBe("ok");
});
