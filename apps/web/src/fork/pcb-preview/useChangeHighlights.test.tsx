// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vite-plus/test";
import type { PcbInspection } from "@t3tools/contracts/fork";
import { useChangeHighlights } from "./useChangeHighlights";
vi.mock("./drawingDiff", () => ({
  drawingRegions: vi.fn(async () => ({ regions: [], truncated: false })),
}));
it("keeps the last seen version across unmount and replaces changes after another save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  let root = createRoot(host);
  let result: ReturnType<typeof useChangeHighlights>;
  const inspection = (hash: string, x: number): PcbInspection => ({
    sourceHash: hash,
    components: [
      { id: "R1", reference: "R1", value: "10k", footprint: "", pcb: { x, y: 0 }, pins: [] },
    ],
    nets: [],
    layers: [],
    bounds: null,
    thickness: 1.6,
    mountingHoles: [],
    warnings: [],
  });
  function Harness({
    hash,
    x,
    suspended = false,
  }: {
    hash: string;
    x: number;
    suspended?: boolean;
  }) {
    const value = useChangeHighlights({
      key: "hook-test",
      inspection: inspection(hash, x),
      display: null,
      customLayers: null,
      suspended,
    });
    useLayoutEffect(() => {
      result = value;
    }, [value]);
    return null;
  }
  await act(async () => root.render(<Harness hash="a" x={1} />));
  expect(result!.pair).toBeNull();
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Harness hash="b" x={3} />));
  expect(result!.counts.moved).toBe(1);
  expect(result!.chip).toBe(true);
  await act(async () => result!.show(true));
  expect(result!.state()?.shown).toBe(true);
  await act(async () => result!.dismiss());
  expect(result!.chip).toBe(false);
  await act(async () => root.render(<Harness hash="c" x={4} />));
  expect(result!.chip).toBe(true);
  expect(result!.state()?.fromSourceHash).toBe("b");
  await act(async () => root.render(<Harness hash="d" x={5} suspended />));
  expect(result!.shown).toBe(false);
  expect(result!.state()?.toSourceHash).toBe("c");
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
