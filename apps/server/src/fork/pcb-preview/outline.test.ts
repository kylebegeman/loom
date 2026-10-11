import { expect, it } from "vite-plus/test";
import { circuitOutline, kicadOutline, kicadOutlineBounds, signedOutlineArea } from "./outline.ts";
import { parseSexp, type Sexp } from "./semantics.ts";
const board = (source: string) => parseSexp(`(kicad_pcb ${source})`)[0] as Sexp[];
const line = (ax: number, ay: number, bx: number, by: number) =>
  `(gr_line (start ${ax} ${ay}) (end ${bx} ${by}) (layer "Edge.Cuts"))`;
it("chains reversed and shuffled edges within the shared join tolerance", () => {
  const result = kicadOutline(
    board(
      [line(10, 10, 0, 10), line(0, 0, 10, 0), line(0, 10, 0, 0), line(10, 10, 10.0005, 0)].join(
        " ",
      ),
    ),
  )!;
  expect(result.loops).toHaveLength(1);
  expect(signedOutlineArea(result.loops[result.outer]!)).toBeCloseTo(100, 1);
  expect(result.loops[0]![0]).not.toEqual(result.loops[0]!.at(-1));
});
it("does not treat a closed cutout as an outer wall when another chain is open", () => {
  expect(
    kicadOutline(
      board(`${line(0, 0, 10, 0)} (gr_circle (center 4 4) (end 5 4) (layer "Edge.Cuts"))`),
    ),
  ).toBeNull();
  expect(kicadOutline(board(""))).toBeNull();
});
it("includes rotated footprint cutouts and exact circle bounds", () => {
  const source = board(
    '(gr_rect (start 0 0) (end 30 20) (layer "Edge.Cuts")) (footprint "cutout" (at 10 10 90) (fp_rect (start 0 0) (end 2 4) (layer "Edge.Cuts")))',
  );
  const result = kicadOutline(source)!;
  expect(result.loops).toHaveLength(2);
  expect(result.loops[1]).toEqual([
    { x: 10, y: 10 },
    { x: 10, y: 8 },
    { x: 14, y: 8 },
    { x: 14, y: 10 },
  ]);
  expect(
    kicadOutlineBounds(
      board(
        '(footprint "circle" (at 10 20) (fp_circle (center 0 0) (end 3 0) (layer "Edge.Cuts")))',
      ),
    ),
  ).toEqual({ x: 7, y: 17, width: 6, height: 6 });
});
it("flattens arcs with bounded chord error while retaining exact extrema", () => {
  const source = board(
    `${line(-5, 0, 5, 0)} (gr_arc (start 5 0) (mid 0 5) (end -5 0) (layer "Edge.Cuts"))`,
  );
  const result = kicadOutline(source)!;
  expect(Math.abs(signedOutlineArea(result.loops[0]!) - (Math.PI * 25) / 2)).toBeLessThan(0.06);
  expect(kicadOutlineBounds(source)?.height).toBeCloseTo(5);
});
it("reads polygons and rejects an ambiguous branch", () => {
  expect(
    kicadOutline(board('(gr_poly (pts (xy 0 0) (xy 10 0) (xy 0 10)) (layer "Edge.Cuts"))'))
      ?.loops[0],
  ).toHaveLength(3);
  expect(
    kicadOutline(board([line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 0, 20, 0)].join(" "))),
  ).toBeNull();
});
it("converts Circuit JSON polygons and rectangles to the drawing frame", () => {
  const polygon = circuitOutline([
    {
      type: "pcb_board",
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
    },
  ])!;
  expect(polygon.source).toBe("circuit-outline");
  expect(polygon.loops[0]).toContainEqual({ x: 0, y: -10 });
  expect(signedOutlineArea(polygon.loops[0]!)).toBeGreaterThan(0);
  expect(
    circuitOutline([{ type: "pcb_board", center: { x: 10, y: 20 }, width: 8, height: 6 }])
      ?.loops[0],
  ).toEqual([
    { x: 6, y: -23 },
    { x: 14, y: -23 },
    { x: 14, y: -17 },
    { x: 6, y: -17 },
  ]);
  expect(
    circuitOutline([{ type: "pcb_board", outline: [{ x: 0, y: NaN }], width: 10, height: 10 }]),
  ).toBeNull();
});
