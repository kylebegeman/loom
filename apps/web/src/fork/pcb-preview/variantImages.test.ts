import { expect, it } from "vite-plus/test";
import { alignSvgPair } from "./variantImages";
it("aligns physical drawings to their union without scaling or changing content", () => {
  const [a, b] = alignSvgPair(
    '<svg width="20mm" height="10mm" viewBox="-10 -5 20 10"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 -10 40 20"><circle cx="2" cy="3" r="1"/></svg>',
  );
  for (const svg of [a, b]) {
    expect(svg).toContain('viewBox="-10 -10 50 20"');
    expect(svg).toContain('width="50mm"');
  }
  expect(a).toContain('<path d="M0 0L1 1"/>');
  expect(b).toContain('<circle cx="2" cy="3" r="1"/>');
  expect(() => alignSvgPair('<svg viewBox="0 0 0 1"/>', b)).toThrow("physical");
});

it("preserves an empty SVG's self-closing root", () => {
  const [svg] = alignSvgPair('<svg viewBox="0 0 20 10"/>', '<svg viewBox="0 0 40 10"/>');
  expect(svg).toBe('<svg width="40mm" height="10mm" viewBox="0 0 40 10"/>');
});
