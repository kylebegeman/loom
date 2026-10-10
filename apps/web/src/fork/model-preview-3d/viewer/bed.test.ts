import { expect, it } from "vite-plus/test";
import { bedLines } from "./bed";

const xs = (positions: number[]) =>
  positions.filter((_, i) => i % 6 === 0 && positions[i + 1] !== positions[i + 4]);

it("steps 10 mm lines out from the centre with every fifth one major", () => {
  const { minor, major } = bedLines(100, 60, "grid-mm");
  expect(xs(major)).toEqual([0]);
  expect(xs(minor)).toEqual([-40, -30, -20, -10, 10, 20, 30, 40]);
});
it("keeps grid lines off the outline when the size divides evenly", () => {
  const { minor, major } = bedLines(120, 120, "grid-mm");
  expect(xs([...minor, ...major]).sort((a, b) => a - b)).toEqual([
    -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50,
  ]);
});
it("draws quarter-inch cells with a major line every inch", () => {
  const { major } = bedLines(110, 110, "grid-inch");
  expect(xs(major).map((x) => Math.round(x * 10) / 10)).toEqual([-50.8, -25.4, 0, 25.4, 50.8]);
});
it("draws only the outline for a plain bed", () => {
  const { minor, major, outline } = bedLines(300, 200, "plain");
  expect(minor).toEqual([]);
  expect(major).toEqual([]);
  expect(outline).toHaveLength(4 * 6);
});
