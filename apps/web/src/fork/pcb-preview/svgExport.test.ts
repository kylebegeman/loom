// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import {
  composeSvg,
  exportFactor,
  visibleArea,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
} from "./svgExport";
const layer =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50"><defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><style>.wire{stroke:red}#wire{fill:none}</style><path id="wire" class="wire" clip-path="url(#clip)" d="M10 20L20 30"/></svg>';
it("caps actual canvas dimensions and retains scale below limits", () => {
  expect(exportFactor(400, 200, 2)).toEqual({ factor: 2, reduced: false });
  for (const [width, height] of [
    [10000, 10000],
    [20000, 200],
    [9001, 7001],
  ]) {
    const result = exportFactor(width!, height!, 2);
    expect(result.reduced).toBe(true);
    expect(
      Math.ceil(width! * result.factor) * Math.ceil(height! * result.factor),
    ).toBeLessThanOrEqual(MAX_EXPORT_PIXELS);
    expect(Math.ceil(Math.max(width!, height!) * result.factor)).toBeLessThanOrEqual(
      MAX_EXPORT_SIDE,
    );
  }
  expect(() => exportFactor(0, 50, 2)).toThrow();
});
it("maps visible pixels into clipped millimetres under pan and zoom", () => {
  const physical = { x: 10, y: 20, width: 100, height: 50 },
    drawing = { width: 1000, height: 500 };
  expect(visibleArea({ x: 0, y: 0, scale: 1 }, drawing, drawing, physical)).toEqual(physical);
  expect(
    visibleArea({ x: -200, y: -100, scale: 2 }, { width: 1000, height: 500 }, drawing, physical),
  ).toEqual({ x: 20, y: 25, width: 50, height: 25 });
  expect(visibleArea({ x: 500, y: 0, scale: 1 }, drawing, drawing, physical).width).toBe(50);
});
it("isolates editable layers and aligns their physical geometry with markup", () => {
  const result = composeSvg({
    area: { x: 10, y: 20, width: 100, height: 50 },
    layers: [
      { svg: layer, opacity: 0.5 },
      { svg: layer, opacity: 1 },
      { svg: "<not-svg>", opacity: 0 },
    ],
    overlay:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50"><text x="20" y="30">Note</text></svg>',
    background: "#f1f3f5",
    title: "Board & <marks>",
  });
  const doc = new DOMParser().parseFromString(result, "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  expect(doc.documentElement.getAttribute("width")).toBe("100mm");
  expect(doc.documentElement.getAttribute("height")).toBe("50mm");
  expect(doc.querySelector("title")?.textContent).toBe("Board & <marks>");
  expect([...doc.documentElement.querySelectorAll(":scope > g")].map((node) => node.id)).toEqual([
    "layer-1",
    "layer-2",
    "overlay",
  ]);
  expect(doc.querySelector("#layer-1-wire")?.getAttribute("clip-path")).toBe("url(#layer-1-clip)");
  expect(doc.querySelector("#layer-2-wire")?.getAttribute("clip-path")).toBe("url(#layer-2-clip)");
  expect(doc.querySelector("#layer-1 style")?.textContent).toContain("#layer-1 .wire");
  expect(doc.querySelector("#layer-1")?.getAttribute("opacity")).toBe("0.5");
});
it("removes active content and external references", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><foreignObject/><image href="https://example.test/x"/><style>@import url(https://example.test/x);.x{fill:url(https://example.test/y)}</style><path style="fill:url(https://example.test/z)" d="M0 0L1 1"/></svg>';
  const result = composeSvg({
    area: { x: 0, y: 0, width: 10, height: 10 },
    layers: [{ svg: source, opacity: 1 }],
    overlay: null,
    background: null,
    title: "Safe",
  });
  expect(result).not.toMatch(/script|foreignObject|onload|https:\/\/example|@import/);
});
it("rejects empty viewports and oversize documents", () => {
  expect(() =>
    composeSvg({
      area: { x: 0, y: 0, width: 0, height: 10 },
      layers: [],
      overlay: null,
      background: null,
      title: "",
    }),
  ).toThrow("no drawing");
  expect(() =>
    composeSvg({
      area: { x: 0, y: 0, width: 10, height: 10 },
      layers: [{ svg: "x".repeat(32 * 1024 * 1024 + 1), opacity: 1 }],
      overlay: null,
      background: null,
      title: "",
    }),
  ).toThrow("Save a PNG instead");
});
