import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useParameterPreview } from "./useParameterPreview";
type State = Parameters<typeof useParameterPreview>[0];
let renderer: ReactTestRenderer | null;
let preview: ReturnType<typeof useParameterPreview>;
function Harness({
  current,
  ready = true,
  automatic,
}: {
  current: State;
  ready?: boolean;
  automatic: boolean;
}) {
  const result = useParameterPreview(current, ready, automatic);
  useLayoutEffect(() => {
    preview = result;
  });
  return null;
}
async function update(current: State, automatic: boolean, ready = true) {
  await act(async () => {
    const node = <Harness current={current} ready={ready} automatic={automatic} />;
    if (renderer) renderer.update(node);
    else renderer = create(node);
  });
}
beforeEach(() => {
  renderer = null;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("initializes from remembered values when loading finishes, even with auto preview paused", async () => {
  await update({ overrides: {}, setName: null }, false, false);
  const remembered = { overrides: { width: "65" }, setName: "wide" };
  await update(remembered, false);
  expect(preview.applied).toEqual(remembered);
  expect(preview.hasUnapplied).toBe(false);
});
it("retains the applied mesh parameters until Apply, including parameter-set changes", async () => {
  const initial = { overrides: { width: "40" }, setName: null };
  await update(initial, false);
  const edited = { overrides: { width: "60" }, setName: "wide" };
  await update(edited, false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(preview.applied).toEqual(initial);
  expect(preview.hasUnapplied).toBe(true);
  await act(async () => preview.apply());
  expect(preview.applied).toEqual(edited);
  expect(preview.hasUnapplied).toBe(false);
});
it("coalesces rapid edits, cancels a pending automatic update on pause, and resumes it", async () => {
  const initial = { overrides: { width: "40" }, setName: null };
  await update(initial, true);
  await update({ overrides: { width: "50" }, setName: null }, true);
  await act(async () => vi.advanceTimersByTime(200));
  const final = { overrides: { width: "60" }, setName: null };
  await update(final, true);
  await act(async () => vi.advanceTimersByTime(200));
  expect(preview.applied).toEqual(initial);
  await update(final, false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(preview.applied).toEqual(initial);
  await update(final, true);
  await act(async () => vi.advanceTimersByTime(300));
  expect(preview.applied).toEqual(final);
});
it("cancels unpublished edits when the file panel closes", async () => {
  await update({ overrides: {}, setName: null }, true);
  await update({ overrides: { width: "80" }, setName: null }, true);
  await act(async () => renderer!.unmount());
  renderer = null;
  expect(vi.getTimerCount()).toBe(0);
});
