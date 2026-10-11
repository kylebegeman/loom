import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
  Raycaster,
  OrthographicCamera,
  PerspectiveCamera,
  Sprite,
  MOUSE,
  TOUCH,
} from "three";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
const doubles = vi.hoisted(() => ({
  renderer: null as unknown,
  controls: null as unknown,
  environment: null as unknown,
  resized: null as (() => void) | null,
}));
vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: vi.fn(function () {
    return doubles.renderer;
  }),
  PMREMGenerator: class {
    fromScene() {
      return doubles.environment;
    }
    dispose() {}
  },
}));
vi.mock("~/lib/observeResize", () => ({
  observeResize: (_element: Element, callback: () => void) => {
    doubles.resized = callback;
    return () => {};
  },
}));
vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: vi.fn(function () {
    return doubles.controls;
  }),
}));
import { createViewer } from "./createViewer";
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let change: (() => void) | undefined;
let pointerHandlers: Record<string, (event: PointerEvent) => void>;
function renderer() {
  return {
    domElement: {
      addEventListener: vi.fn((name, callback) => {
        pointerHandlers[name] = callback;
      }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
      focus: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      remove: vi.fn(),
      tabIndex: 0,
      style: { cursor: "" },
    },
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
}
let gpu: ReturnType<typeof renderer>;
let env: { texture: Texture; dispose: ReturnType<typeof vi.fn> };
function flushFrame() {
  const pending = [...frames.values()];
  frames.clear();
  for (const frame of pending) frame(0);
}
beforeEach(() => {
  pointerHandlers = {};
  frames = new Map();
  sequence = 0;
  gpu = renderer();
  doubles.renderer = gpu;
  env = { texture: new Texture(), dispose: vi.fn() };
  doubles.environment = env;
  doubles.controls = {
    target: new Vector3(),
    enableDamping: false,
    mouseButtons: { LEFT: 0, MIDDLE: 1, RIGHT: 2 },
    touches: { ONE: 0 },
    addEventListener: (event: string, callback: () => void) => {
      if (event === "change") change = callback;
    },
    removeEventListener: (event: string) => {
      if (event === "change") change = undefined;
    },
    update: () => change?.(),
    dispose: vi.fn(),
  };
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { documentElement: { classList: { contains: () => true } } });
  const observer = class {
    observe() {}
    disconnect() {}
  };
  vi.stubGlobal("MutationObserver", observer);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
function host() {
  return { clientWidth: 600, clientHeight: 400, append: vi.fn() } as unknown as HTMLElement;
}
it("coalesces interactions into one frame and leaves no frame loop while idle or hidden", () => {
  const viewer = createViewer(host());
  gpu.render.mockClear();
  viewer.setBed([350, 320], "grid-mm");
  viewer.setGrid(false);
  viewer.setAxes(true);
  change?.();
  expect(frames.size).toBe(1);
  flushFrame();
  expect(gpu.render).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  expect(gpu.render.mock.calls[0]![0].environment).toBe(env.texture);
  viewer.setVisible(false);
  viewer.setGrid(true);
  change?.();
  expect(frames.size).toBe(0);
  viewer.setVisible(true);
  expect(gpu.render).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(0);
  viewer.dispose();
});
it("repaints in the same frame as a resize, which clears the canvas", () => {
  const viewer = createViewer(host());
  flushFrame();
  gpu.render.mockClear();
  doubles.resized!();
  expect(gpu.setSize).toHaveBeenLastCalledWith(600, 400);
  expect(gpu.render).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  viewer.dispose();
});
it("cancels queued rendering and releases model, lighting and WebGL resources on close", () => {
  const viewer = createViewer(host()),
    geometry = new BoxGeometry(),
    material = new MeshStandardMaterial();
  const geometryDispose = vi.spyOn(geometry, "dispose"),
    materialDispose = vi.spyOn(material, "dispose");
  viewer.setModel(new Mesh(geometry, material), false);
  expect(frames.size).toBe(1);
  viewer.dispose();
  expect(frames.size).toBe(0);
  expect(geometryDispose).toHaveBeenCalledOnce();
  expect(materialDispose).toHaveBeenCalledOnce();
  expect(env.dispose).toHaveBeenCalledOnce();
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(gpu.forceContextLoss).toHaveBeenCalledOnce();
  expect(gpu.domElement.remove).toHaveBeenCalledOnce();
  change?.();
  expect(frames.size).toBe(0);
});

it("switches drag tools and zooms around the target without creating an idle frame loop", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(20, 30, 40), new MeshStandardMaterial()), false);
  flushFrame();
  viewer.setNavigationMode("pan");
  const controls = doubles.controls as {
    mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
    touches: { ONE: number };
  };
  expect(controls.mouseButtons).toEqual({
    LEFT: MOUSE.PAN,
    MIDDLE: MOUSE.PAN,
    RIGHT: MOUSE.ROTATE,
  });
  expect(controls.touches.ONE).toBe(TOUCH.PAN);
  const before = viewer.snapshot();
  viewer.zoom(0.5);
  const after = viewer.snapshot();
  const distance = (state: typeof before) =>
    new Vector3(...state.position).distanceTo(new Vector3(...state.target));
  expect(distance(after)).toBeCloseTo(distance(before) / 2);
  expect(after.target).toEqual(before.target);
  expect(after.navigationMode).toBe("pan");
  expect(frames.size).toBe(1);
  flushFrame();
  expect(frames.size).toBe(0);
  viewer.setNavigationMode("orbit");
  viewer.restore(before);
  expect(controls.mouseButtons.LEFT).toBe(MOUSE.PAN);
  viewer.dispose();
});

it("surface picking respects clipping, disables navigation and removes pointer listeners on dispose", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial()), false);
  viewer.setSection({ enabled: true, axis: "z", offset: 0, flipped: false });
  viewer.setProjection("orthographic");
  const rayCamera = vi.spyOn(Raycaster.prototype, "setFromCamera");
  const callback = vi.fn();
  viewer.setPickMode("measure", callback);
  expect((doubles.controls as { enabled: boolean }).enabled).toBe(false);
  const hits = vi
    .spyOn(Raycaster.prototype, "intersectObject")
    .mockReturnValue([
      { point: new Vector3(1, 2, -3) },
      { point: new Vector3(1, 2, 3) },
    ] as ReturnType<Raycaster["intersectObject"]>);
  const event = { button: 0, clientX: 300, clientY: 200, pointerId: 1 } as PointerEvent;
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(callback).toHaveBeenCalledWith([[1, 2, 3]]);
  expect(rayCamera.mock.calls[0]![1]).toBeInstanceOf(OrthographicCamera);
  viewer.setNavigationMode("pan");
  expect(gpu.domElement.style.cursor).toBe("crosshair");
  viewer.setPickMode(null, null);
  expect((doubles.controls as { enabled: boolean }).enabled).toBe(true);
  flushFrame();
  expect(frames.size).toBe(0);
  viewer.dispose();
  expect(gpu.domElement.removeEventListener).toHaveBeenCalledWith(
    "pointerup",
    expect.any(Function),
  );
  hits.mockRestore();
  rayCamera.mockRestore();
});

it("cancels unfinished picks when tools change", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), false);
  vi.spyOn(Raycaster.prototype, "intersectObject").mockReturnValue([
    { point: new Vector3(1, 2, 3) },
  ] as ReturnType<Raycaster["intersectObject"]>);
  const callback = vi.fn();
  const event = { button: 0, clientX: 300, clientY: 200, pointerId: 1 } as PointerEvent;
  viewer.setPickMode("annotate", callback);
  pointerHandlers.pointerdown!(event);
  viewer.setPickMode(null, null);
  viewer.setPickMode("measure", callback);
  pointerHandlers.pointerup!(event);
  expect(callback).not.toHaveBeenCalled();
  viewer.dispose();
  vi.restoreAllMocks();
});

it.each(["perspective", "orthographic"] as const)(
  "captures four orthographic views and restores %s before encoding finishes",
  async (projection) => {
    let finish: BlobCallback | null = null;
    const bitmap = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn() }),
      toBlob: (callback: BlobCallback) => {
        finish = callback;
      },
    };
    vi.stubGlobal("document", {
      documentElement: { classList: { contains: () => true } },
      createElement: () => bitmap,
    });
    Object.assign(gpu, {
      getSize: (size: import("three").Vector2) => size.set(600, 400),
      getPixelRatio: () => 1,
    });
    const viewer = createViewer(host());
    viewer.setModel(new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial()), false);
    viewer.setView("front");
    viewer.setProjection(projection);
    const original = viewer.snapshot();
    const onCamera = vi.fn();
    viewer.onCameraChange(onCamera);
    gpu.render.mockClear();
    const capture = viewer.capture(true);
    expect(gpu.render).toHaveBeenCalledTimes(4);
    for (const [, viewCamera] of gpu.render.mock.calls)
      expect(viewCamera).toBeInstanceOf(OrthographicCamera);
    expect(onCamera).not.toHaveBeenCalled();
    expect(viewer.snapshot()).toEqual(original);
    expect((doubles.controls as { enabled: boolean }).enabled).not.toBe(false);
    finish!(new Blob(["png"]));
    await capture;
    viewer.dispose();
  },
);

it("places the bed under the model's footprint without moving the model", () => {
  const viewer = createViewer(host());
  viewer.setBed([350, 320], "grid-mm");
  const geometry = new BoxGeometry(100, 40, 20);
  geometry.translate(50, 20, 15);
  const model = new Mesh(geometry, new MeshStandardMaterial());
  viewer.setModel(model, false);
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  expect(scene.getObjectByName("bed")!.position.toArray()).toEqual([50, 20, 5]);
  expect(model.position.toArray()).toEqual([0, 0, 0]);
  viewer.setBed([250, 250], "plain");
  flushFrame();
  expect(scene.getObjectsByProperty("name", "bed")).toHaveLength(1);
  expect(scene.getObjectByName("bed")!.position.toArray()).toEqual([50, 20, 5]);
  viewer.dispose();
});

it("switches projection without moving the rig and restores each saved projection", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial()), false);
  const perspective = viewer.snapshot();
  viewer.setProjection("orthographic");
  const orthographic = viewer.snapshot();
  expect(orthographic).toEqual({ ...perspective, projection: "orthographic" });
  expect(viewer.activeCamera()).toBeInstanceOf(OrthographicCamera);
  viewer.restore(perspective);
  expect(viewer.snapshot()).toEqual(perspective);
  expect(viewer.activeCamera()).toBeInstanceOf(PerspectiveCamera);
  viewer.restore(orthographic);
  expect(viewer.snapshot()).toEqual(orthographic);
  flushFrame();
  expect(frames.size).toBe(0);
  viewer.dispose();
});

it("keeps orthographic dots the same screen size through zoom and restores perspective sizing", () => {
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => true } },
    createElement: () => ({
      getContext: () => ({ arc: vi.fn(), fill: vi.fn(), stroke: vi.fn() }),
    }),
  });
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial()), false);
  viewer.setOverlays([], [], [0, 0, 0]);
  viewer.setProjection("orthographic");
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  const dots = scene.getObjectsByProperty("type", "Sprite") as Sprite[];
  expect(dots).toHaveLength(1);
  const camera = viewer.activeCamera() as OrthographicCamera;
  const screenSize = dots[0]!.scale.x / camera.top;
  viewer.zoom(0.5);
  flushFrame();
  expect(dots[0]!.scale.x / camera.top).toBeCloseTo(screenSize);
  viewer.setProjection("perspective");
  flushFrame();
  expect(dots[0]!.scale.x).toBe(0.015);
  viewer.dispose();
});

it("restores projection, framing and navigation when capturing fails", async () => {
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => true } },
    createElement: () => ({
      getContext: () => ({ drawImage: vi.fn() }),
    }),
  });
  Object.assign(gpu, {
    getSize: (size: import("three").Vector2) => size.set(600, 400),
    getPixelRatio: () => 2,
  });
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial()), false);
  viewer.setView("right");
  viewer.setNavigationMode("pan");
  const original = viewer.snapshot();
  gpu.render.mockImplementationOnce(() => {
    throw new Error("Capture renderer failed");
  });
  await expect(viewer.capture(true)).rejects.toThrow("Capture renderer failed");
  expect(viewer.snapshot()).toEqual(original);
  expect((doubles.controls as { enabled: boolean }).enabled).not.toBe(false);
  expect(gpu.setPixelRatio).toHaveBeenLastCalledWith(2);
  expect(gpu.setSize).toHaveBeenLastCalledWith(600, 400, false);
  viewer.dispose();
});

it.each(["perspective", "orthographic"] as const)(
  "captures the current view using %s",
  async (projection) => {
    vi.stubGlobal("document", {
      documentElement: { classList: { contains: () => true } },
      createElement: () => ({
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: BlobCallback) => callback(new Blob(["png"])),
      }),
    });
    Object.assign(gpu, {
      getSize: (size: import("three").Vector2) => size.set(600, 400),
      getPixelRatio: () => 1,
    });
    const viewer = createViewer(host());
    viewer.setModel(new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial()), false);
    viewer.setProjection(projection);
    const original = viewer.snapshot();
    gpu.render.mockClear();
    await viewer.capture(false);
    expect(gpu.render).toHaveBeenCalledOnce();
    expect(gpu.render.mock.calls[0]![1]).toBeInstanceOf(
      projection === "orthographic" ? OrthographicCamera : PerspectiveCamera,
    );
    expect(viewer.snapshot()).toEqual(original);
    viewer.dispose();
  },
);

it("picks visible orthographic faces behind the eye when zoomed inside the model", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial()), false);
  viewer.restore({
    ...viewer.snapshot(),
    projection: "orthographic",
    position: [0, 0, 2],
    target: [0, 0, 0],
  });
  const callback = vi.fn();
  viewer.setPickMode("measure", callback);
  const event = { button: 0, clientX: 300, clientY: 200, pointerId: 1 } as PointerEvent;
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(callback).toHaveBeenCalledWith([[0, 0, 10]]);
  viewer.dispose();
});
