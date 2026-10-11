// @vitest-environment jsdom
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
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
    setLengthFormat: vi.fn(),
    setProjection: vi.fn(),
    setSection: vi.fn(),
    setPickMode: vi.fn(),
    setOverlays: vi.fn(),
    invalidate: vi.fn(),
    onSnapStatus: vi.fn(),
    onSectionCapsStatus: vi.fn(),
    onObjectPick: vi.fn(),
    snapPointDetailed: vi.fn(async (point) => ({ point, kind: "free" })),
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
vi.mock("../model-preview-3d/viewer/createViewer", () => ({
  createViewer: () => mocks.viewer,
  shownIn: () => true,
}));
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
  const model = new Group(),
    material = new MeshStandardMaterial();
  material.name = "board";
  model.add(new Mesh(new BoxGeometry(20, 10, 1.6), material));
  mocks.load.mockResolvedValue(model);
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
it("measures snapped picks, bounds transient measurements and restores controlled display", async () => {
  const onDisplay = vi.fn();
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <Board3D
          threadRef={{
            environmentId: EnvironmentId.make("env"),
            threadId: ThreadId.make("thread"),
          }}
          designId="board"
          sourceHash="one"
          handle={handle}
          onCancel={vi.fn()}
          onDisplay={onDisplay}
        />
      </RegistryContext.Provider>,
    ),
  );
  await act(async () => handle.current!.chooseTool("distance"));
  await act(async () => mocks.viewer.setPickMode.mock.lastCall![1]([[0, 0, 0]], "vertex"));
  await act(async () => mocks.viewer.setPickMode.mock.lastCall![1]([[3, 4, 0]], "free"));
  expect(handle.current!.state().measurements3d[0]).toMatchObject({
    lengthMm: 5,
    snaps: ["vertex", "free"],
  });
  for (let i = 0; i < 20; i++)
    await act(async () => {
      await handle.current!.measure(
        [
          [i, 0, 0],
          [i + 1, 0, 0],
        ],
        false,
      );
    });
  expect(handle.current!.state().measurements3d).toHaveLength(20);
  expect(handle.current!.state().measurements3d[0]!.start).toEqual([0, 0, 0]);
  await act(async () => handle.current!.clearMeasurements());
  expect(handle.current!.state().measurements3d).toHaveLength(0);
  expect(() => handle.current!.displayLayers({ copper: false })).toThrow("no separate copper");
  const camera = {
    ...handle.current!.snapshot(),
    projection: "orthographic" as const,
    section: { enabled: true, axis: "z" as const, offset: 0, flipped: false, caps: true },
  };
  await act(async () => handle.current!.restore(camera));
  expect(onDisplay).toHaveBeenCalledWith(
    expect.objectContaining({ projection: "orthographic", section: camera.section }),
  );
});
it("keeps measurement tools read-only in historical boards", async () => {
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <Board3D
          threadRef={{
            environmentId: EnvironmentId.make("env"),
            threadId: ThreadId.make("thread"),
          }}
          designId="board"
          sourceHash="one"
          handle={handle}
          onCancel={vi.fn()}
          readOnly
        />
      </RegistryContext.Provider>,
    ),
  );
  expect(() => handle.current!.chooseTool("distance")).toThrow("current version");
  await expect(
    handle.current!.measure([
      [0, 0, 0],
      [1, 0, 0],
    ]),
  ).rejects.toThrow("current version");
});
