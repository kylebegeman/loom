import { beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
const state = vi.hoisted(() => ({
  result: { _tag: "Initial", waiting: false } as Record<string, unknown>,
  listeners: [] as ((value: Record<string, unknown>) => void)[],
  leases: 0,
}));
vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: {
    refresh: () => {},
    mount: () => {
      state.leases++;
      return () => {
        state.leases--;
      };
    },
    get: () => state.result,
    subscribe: (_atom: unknown, callback: (value: Record<string, unknown>) => void) => {
      state.listeners.push(callback);
      return () => {
        state.listeners = state.listeners.filter((item) => item !== callback);
      };
    },
  },
}));
vi.mock("./state", () => ({
  models: { slice: { resultAtom: () => ({}) } },
  modelUrl: () => "url",
}));
vi.mock("./printers", () => ({ usePrinterLibrary: () => undefined }));
import { slicingRequestKey, startSliceRequest } from "./useSlicing";
beforeEach(() => {
  state.result = { _tag: "Initial", waiting: false };
  state.leases = 0;
  state.listeners = [];
});
it("query completion releases its RPC lease and cancellation rejects without retaining a subscription", async () => {
  const input = {
    file: { threadId: ThreadId.make("thread"), path: "cube.stl" },
    overrides: {},
    parameterSet: null,
  };
  const request = startSliceRequest(EnvironmentId.make("env"), input);
  expect(state.leases).toBe(1);
  state.result = { _tag: "Success", waiting: false, value: { status: "none" } };
  state.listeners[0]?.(state.result);
  await expect(request.promise).resolves.toEqual({ status: "none" });
  expect(state.leases).toBe(0);
  expect(state.listeners).toEqual([]);
  state.result = { _tag: "Initial", waiting: false };
  const next = startSliceRequest(EnvironmentId.make("env"), input);
  const rejected = expect(next.promise).rejects.toThrow("cancelled");
  next.cancel();
  await rejected;
  expect(state.leases).toBe(0);
  expect(state.listeners).toEqual([]);
  next.cancel();
  expect(state.leases).toBe(0);
});
it("source, orientation and profile changes invalidate estimates while parameter order does not", () => {
  const input = {
    threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
    path: "cube.scad",
    format: "scad",
    geometryRevision: "mesh",
    session: { applied: { b: "2", a: "1" }, setName: null },
    settings: DEFAULT_MODEL_PREVIEW_SETTINGS,
    orientation: null,
    active: true,
    enabled: true,
  };
  expect(slicingRequestKey(input, "bambu-h2d")).toBe(
    slicingRequestKey(
      { ...input, session: { applied: { a: "1", b: "2" }, setName: null } },
      "bambu-h2d",
    ),
  );
  expect(slicingRequestKey(input, "bambu-h2d")).not.toBe(
    slicingRequestKey({ ...input, geometryRevision: "new" }, "bambu-h2d"),
  );
  expect(slicingRequestKey(input, "bambu-h2d")).not.toBe(slicingRequestKey(input, "bambu-h2c"));
});
