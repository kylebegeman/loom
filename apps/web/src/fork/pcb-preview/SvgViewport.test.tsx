import { expect, it } from "vite-plus/test";
import { fitDrawing, zoomAround } from "./SvgViewport";
it("fits and centers drawings while handling tiny viewports", () => {
  expect(fitDrawing(1048, 548, 1000, 500)).toEqual({ scale: 1, x: 24, y: 24 });
  const tiny = fitDrawing(20, 20, 1000, 500);
  expect(tiny.scale).toBeGreaterThan(0);
  expect(Number.isFinite(tiny.x)).toBe(true);
});
it("keeps the cursor point fixed and bounds extreme zoom", () => {
  const current = { x: 10, y: 30, scale: 2 },
    cursor = { x: 150, y: 100 };
  const next = zoomAround(current, 1.25, cursor.x, cursor.y);
  expect((cursor.x - next.x) / next.scale).toBe((cursor.x - current.x) / current.scale);
  expect((cursor.y - next.y) / next.scale).toBe((cursor.y - current.y) / current.scale);
  expect(zoomAround(current, Infinity, 0, 0).scale).toBe(32);
  expect(zoomAround(current, 0, 0, 0).scale).toBe(0.01);
});
