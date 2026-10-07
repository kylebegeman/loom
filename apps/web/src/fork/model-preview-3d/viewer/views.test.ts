import { expect, it } from "vite-plus/test";
import { Box3, Vector3 } from "three";
import { fitDistance, viewDirection } from "./views";
it("uses Z-up views and fits a box at portrait and landscape aspect ratios", () => {
  expect(viewDirection("front").toArray()).toEqual([0, -1, 0]);
  expect(viewDirection("top").toArray()).toEqual([0, 0, 1]);
  expect(viewDirection("right").toArray()).toEqual([1, 0, 0]);
  expect(viewDirection("iso").z).toBeGreaterThan(0);
  const box = new Box3(new Vector3(0, 0, 0), new Vector3(10, 20, 30));
  expect(fitDistance(box, 40, 1)).toBeGreaterThan(30);
  expect(fitDistance(box, 40, 0.5)).toBeGreaterThan(fitDistance(box, 40, 2));
});
