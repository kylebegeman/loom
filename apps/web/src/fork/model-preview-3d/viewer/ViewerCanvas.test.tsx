import { act, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Group } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ModelViewer } from "./createViewer";

const { createViewer, loadModel, disposeModel } = vi.hoisted(() => ({
  createViewer: vi.fn(),
  loadModel: vi.fn(),
  disposeModel: vi.fn(),
}));
vi.mock("./createViewer", () => ({ createViewer }));
vi.mock("./load", () => ({ loadModel, disposeModel }));
import ViewerCanvas from "./ViewerCanvas";

const camera: ReturnType<ModelViewer["snapshot"]> = {
  position: [40, -50, 60],
  target: [5, 10, 15],
  near: 0.01,
  far: 10000,
  wireframe: false,
  gridVisible: true,
  axesVisible: false,
  navigationMode: "orbit",
  section: { enabled: false, axis: "z", offset: 0, flipped: false },
};
let renderer: ReactTestRenderer | null = null;
let viewers: ReturnType<typeof makeViewer>[];
let loads: { signal: AbortSignal; resolve: (model: Group) => void }[];
function makeViewer() {
  return {
    snapshot: vi.fn(() => camera),
    dispose: vi.fn(),
    setModel: vi.fn(),
    restore: vi.fn(),
    setVisible: vi.fn(),
    setBuildVolume: vi.fn(),
    onNavigate: vi.fn(),
    setSection: vi.fn(),
    setOverlays: vi.fn(),
    setPickMode: vi.fn(),
    onCameraChange: vi.fn(),
    setNavigationMode: vi.fn(),
    setWireframe: vi.fn(),
    setGrid: vi.fn(),
    setAxes: vi.fn(),
  };
}
const viewerRef = { current: null as ModelViewer | null };
const savedViewRef = { current: null as typeof camera | null };
const callbacks = { onStats: vi.fn(), onProgress: vi.fn(), onError: vi.fn() };
async function mount() {
  await act(async () => {
    renderer = create(
      <StrictMode>
        <ViewerCanvas
          url="/cube.stl"
          format="stl"
          volume={[350, 320, 325]}
          visible
          viewerRef={viewerRef}
          savedViewRef={savedViewRef}
          {...callbacks}
        />
      </StrictMode>,
      { createNodeMock: () => ({}) },
    );
  });
}
async function load() {
  await act(async () => loads.at(-1)!.resolve(new Group()));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  viewers = [];
  loads = [];
  viewerRef.current = null;
  savedViewRef.current = null;
  createViewer.mockImplementation(() => {
    const viewer = makeViewer();
    viewers.push(viewer);
    return viewer;
  });
  loadModel.mockImplementation(
    (_url, _format, signal) =>
      new Promise<Group>((resolve) => {
        loads.push({ signal, resolve });
      }),
  );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it("reports unavailable WebGL without starting a download or leaving loading progress", async () => {
  createViewer.mockImplementation(() => {
    throw new Error("WebGL is unavailable.");
  });
  await mount();
  expect(callbacks.onError).toHaveBeenCalledWith(
    "WebGL 2 is unavailable. Use a browser or device that supports it.",
  );
  expect(loadModel).not.toHaveBeenCalled();
  expect(callbacks.onProgress).not.toHaveBeenCalled();
});

describe("camera persistence", () => {
  it("fits the first mesh after StrictMode replays setup before loading", async () => {
    await mount();
    expect(viewers.length).toBe(2);
    expect(loads[0]!.signal.aborted).toBe(true);
    expect(savedViewRef.current).toBeNull();
    await load();
    expect(viewers.at(-1)!.setModel).toHaveBeenCalledWith(expect.any(Group), false);
    expect(viewers.at(-1)!.restore).not.toHaveBeenCalled();
    await act(async () => loads[0]!.resolve(new Group()));
    expect(disposeModel).toHaveBeenCalledOnce();
  });
  it("preserves a loaded camera across release and setup replay on remount", async () => {
    await mount();
    await load();
    await act(async () => renderer!.unmount());
    renderer = null;
    expect(savedViewRef.current).toEqual(camera);
    await mount();
    expect(savedViewRef.current).toEqual(camera);
    await load();
    expect(viewers.at(-1)!.setModel).toHaveBeenCalledWith(expect.any(Group), true);
    expect(viewers.at(-1)!.restore).toHaveBeenCalledWith(camera);
  });
});
