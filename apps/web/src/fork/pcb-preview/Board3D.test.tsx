// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { PcbAsset } from "@t3tools/contracts/fork";
import { Board3D, type Pcb3dHandle } from "./Board3D";
const mocks = vi.hoisted(() => ({
  asset: vi.fn(),
  load: vi.fn(),
  dispose: vi.fn(),
  viewer: {
    setGrid: vi.fn(),
    setAxes: vi.fn(),
    setModel: vi.fn(),
    fit: vi.fn(),
    zoom: vi.fn(),
    setView: vi.fn(),
    snapshot: vi.fn(),
    restore: vi.fn(),
    capture: vi.fn(),
    onNavigate: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock("./state", () => ({ pcb: { asset: { resultAtom: mocks.asset } } }));
vi.mock("../model-preview-3d/state", () => ({ modelUrl: () => "/board.glb" }));
vi.mock("../model-preview-3d/viewer/createViewer", () => ({ createViewer: () => mocks.viewer }));
vi.mock("../model-preview-3d/viewer/load", () => ({
  loadModel: mocks.load,
  disposeModel: mocks.dispose,
}));
vi.mock("../model-preview-3d/capture", () => ({ attachModelImage: vi.fn() }));
let root: Root, host: HTMLDivElement, registry: AtomRegistry.AtomRegistry;
const handle = createRef<Pcb3dHandle>();
const asset: PcbAsset = {
  format: "glb",
  sourceHash: "one",
  data: "",
  log: "",
  file: {
    relativeUrl: "/board.glb",
    expiresAt: 1,
    sizeBytes: 100,
    modifiedAt: "2026-10-08T00:00:00Z",
    revision: "one",
  },
};
const response = Atom.make(AsyncResult.success(asset));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  registry = AtomRegistry.make();
  mocks.asset.mockReturnValue(response);
  mocks.load.mockResolvedValue({ model: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  registry.dispose();
  host.remove();
  vi.unstubAllGlobals();
});
it("refreshes the 3D asset and prevents stale captures during an export", async () => {
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <Board3D
          threadRef={{
            environmentId: EnvironmentId.make("env"),
            threadId: ThreadId.make("thread"),
          }}
          designId="board.circuit.tsx"
          sourceHash="one"
          handle={handle}
          onCancel={vi.fn()}
        />
      </RegistryContext.Provider>,
    ),
  );
  expect(handle.current!.isReady()).toBe(true);
  await act(async () => handle.current!.refresh());
  expect(mocks.asset.mock.lastCall?.[0].input.force).toBe(true);
  expect(mocks.asset.mock.lastCall?.[0].input.revision).toBe("one:1");
  await act(async () => registry.set(response, AsyncResult.waiting(AsyncResult.success(asset))));
  expect(handle.current!.isReady()).toBe(false);
  expect(handle.current!.isLoading()).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Fit board"]')?.disabled).toBe(
    true,
  );
  expect(() => handle.current!.capture()).toThrow("Wait for the 3D board");
  await act(async () => root.unmount());
  expect(mocks.viewer.dispose).toHaveBeenCalledOnce();
});
