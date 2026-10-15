import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Path,
  Shape,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Material,
  ShaderLib,
  type WebGLRenderer,
  Box3,
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
import { overhangStats } from "@t3tools/contracts/fork";
const doubles = vi.hoisted(() => ({
  renderer: null as unknown,
  controls: null as unknown,
  environment: null as unknown,
  resized: null as (() => void) | null,
  snapShow: vi.fn(),
  snapHide: vi.fn(),
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
vi.mock("./snapOverlay", () => ({
  createSnapOverlay: () => ({ show: doubles.snapShow, hide: doubles.snapHide, dispose: vi.fn() }),
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
      clientHeight: 400,
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
  doubles.snapShow.mockClear();
  doubles.snapHide.mockClear();
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
    rotateLeft: vi.fn(() => change?.()),
    rotateUp: vi.fn(() => change?.()),
    pan: vi.fn(() => change?.()),
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
  viewer.setSection({ enabled: true, axis: "z", offset: 0, flipped: false, caps: true });
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
  expect(callback).toHaveBeenCalledWith([[1, 2, 3]], "free");
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
    viewer.setReference("card");
    viewer.setProjection(projection);
    const original = viewer.snapshot();
    const onCamera = vi.fn();
    viewer.onCameraChange(onCamera);
    gpu.render.mockClear();
    const capture = viewer.capture(true);
    expect(gpu.render).toHaveBeenCalledTimes(4);
    for (const [scene, viewCamera] of gpu.render.mock.calls) {
      expect(viewCamera).toBeInstanceOf(OrthographicCamera);
      expect(scene.getObjectByName("scale-reference").visible).toBe(true);
    }
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
  expect(callback).toHaveBeenCalledWith([[0, 0, 10]], "free");
  viewer.dispose();
});

it("holds navigation from a touch hold's menu until the finger lifts", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial()), false);
  viewer.restore({
    ...viewer.snapshot(),
    projection: "perspective",
    position: [0, 0, 50],
    target: [0, 0, 0],
  });
  const context = vi.fn();
  viewer.onContextPick(context);
  const controls = doubles.controls as { enabled?: boolean };
  controls.enabled = true;
  const touch = {
    button: 0,
    clientX: 300,
    clientY: 200,
    pointerId: 2,
    pointerType: "touch",
    isPrimary: true,
  } as PointerEvent;
  pointerHandlers.pointerdown!(touch);
  vi.advanceTimersByTime(500);
  expect(context).toHaveBeenCalledTimes(1);
  // A drift under the slop after the menu opens must not turn the camera and close it.
  expect(controls.enabled).toBe(false);
  pointerHandlers.pointermove!({ ...touch, clientX: 304 } as PointerEvent);
  expect(controls.enabled).toBe(false);
  pointerHandlers.pointerup!(touch);
  expect(controls.enabled).toBe(true);
  // A cancelled touch gives navigation back too.
  pointerHandlers.pointerdown!(touch);
  vi.advanceTimersByTime(500);
  expect(controls.enabled).toBe(false);
  pointerHandlers.pointercancel!(touch);
  expect(controls.enabled).toBe(true);
  // A hold that misses the part opens nothing and leaves navigation alone.
  const miss = vi.spyOn(Raycaster.prototype, "intersectObject").mockReturnValue([]);
  pointerHandlers.pointerdown!(touch);
  vi.advanceTimersByTime(500);
  miss.mockRestore();
  expect(controls.enabled).toBe(true);
  viewer.dispose();
  vi.useRealTimers();
});

it("opens the point menu on a still right click, Ctrl+click, a touch hold or the view center", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial()), false);
  viewer.restore({
    ...viewer.snapshot(),
    projection: "perspective",
    position: [0, 0, 50],
    target: [0, 0, 0],
  });
  const context = vi.fn();
  viewer.onContextPick(context);
  const at = (extra: Partial<PointerEvent> = {}) =>
    ({ button: 2, clientX: 300, clientY: 200, pointerId: 1, ...extra }) as PointerEvent;
  // A right drag still pans.
  pointerHandlers.pointerdown!(at());
  pointerHandlers.pointerup!(at({ clientX: 310 }));
  expect(context).not.toHaveBeenCalled();
  pointerHandlers.pointerdown!(at({ clientX: 302 }));
  pointerHandlers.pointerup!(at());
  expect(context).toHaveBeenCalledTimes(1);
  const pick = context.mock.calls[0]![0];
  expect(pick.point[2]).toBeCloseTo(10, 5);
  expect(pick.worldFace.map(Math.round)).toEqual([0, 0, 1]);
  expect(pick.face.map(Math.round)).toEqual([0, 0, 1]);
  expect(pick).toMatchObject({
    x: 300,
    y: 200,
    stage: { left: 0, top: 0, width: 600, height: 400 },
  });
  pointerHandlers.pointerdown!(at({ button: 0, ctrlKey: true }));
  pointerHandlers.pointerup!(at({ button: 0, ctrlKey: true }));
  expect(context).toHaveBeenCalledTimes(2);
  // A miss opens nothing.
  const miss = vi.spyOn(Raycaster.prototype, "intersectObject").mockReturnValue([]);
  pointerHandlers.pointerdown!(at());
  pointerHandlers.pointerup!(at());
  miss.mockRestore();
  expect(context).toHaveBeenCalledTimes(2);
  // A touch held still opens it once, and its release does not also pick.
  const measured = vi.fn();
  viewer.setPickMode("measure", measured);
  const touch = at({ button: 0, pointerType: "touch", isPrimary: true, pointerId: 2 });
  pointerHandlers.pointerdown!(touch);
  vi.advanceTimersByTime(499);
  expect(context).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(context).toHaveBeenCalledTimes(3);
  pointerHandlers.pointerup!(touch);
  expect(measured).not.toHaveBeenCalled();
  // Moving the finger 8 px cancels the hold.
  pointerHandlers.pointerdown!(touch);
  pointerHandlers.pointermove!({ ...touch, clientX: 308 } as PointerEvent);
  vi.advanceTimersByTime(600);
  expect(context).toHaveBeenCalledTimes(3);
  viewer.setPickMode(null, null);
  expect(viewer.contextAtCenter()).toBe(true);
  expect(context).toHaveBeenCalledTimes(4);
  expect(context.mock.calls[3]![0]).toMatchObject({ x: 300, y: 200 });
  const native = { preventDefault: vi.fn() };
  pointerHandlers.contextmenu!(native as unknown as PointerEvent);
  expect(native.preventDefault).toHaveBeenCalled();
  viewer.centerAt([5, 0, 4]);
  expect(viewer.snapshot()).toMatchObject({ target: [5, 0, 4], position: [5, 0, 54] });
  viewer.dispose();
  expect(gpu.domElement.removeEventListener).toHaveBeenCalledWith(
    "contextmenu",
    expect.any(Function),
  );
  vi.useRealTimers();
});

it("keeps references hidden without a model and moves them with reloaded geometry", () => {
  const viewer = createViewer(host());
  viewer.setReference("coin-euro");
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  const reference = scene.getObjectByName("scale-reference")!;
  expect(reference.visible).toBe(false);
  const geometry = new BoxGeometry(40, 20, 10);
  geometry.translate(30, 50, 10);
  const model = new Mesh(geometry, new MeshStandardMaterial());
  const stats = viewer.setModel(model, false);
  flushFrame();
  expect(stats.size).toEqual([40, 20, 10]);
  expect(reference.visible).toBe(true);
  let bounds = new Box3().setFromObject(reference);
  expect(bounds.min.x).toBeCloseTo(stats.box.max.x + 10, 4);
  expect(bounds.getCenter(new Vector3()).y).toBeCloseTo(50, 4);
  expect(bounds.min.z).toBeCloseTo(stats.box.min.z, 4);
  viewer.setBed([350, 320], "grid-mm");
  viewer.setGrid(false);
  viewer.setWireframe(true);
  viewer.setSection({ enabled: true, axis: "x", offset: 100, flipped: false, caps: true });
  flushFrame();
  expect(reference.visible).toBe(true);
  const refMaterial = (reference.children[0] as Mesh).material as MeshStandardMaterial;
  expect(refMaterial.wireframe).toBe(false);
  expect(refMaterial.clippingPlanes).toBeNull();
  const larger = new BoxGeometry(90, 50, 20);
  larger.translate(40, 75, 30);
  const next = viewer.setModel(new Mesh(larger, new MeshStandardMaterial()), true);
  flushFrame();
  bounds = new Box3().setFromObject(reference);
  expect(bounds.min.x).toBeCloseTo(next.box.max.x + 10, 4);
  expect(bounds.getCenter(new Vector3()).y).toBeCloseTo(75, 4);
  expect(bounds.min.z).toBeCloseTo(next.box.min.z, 4);
  viewer.setReference("coin-euro");
  expect(frames.size).toBe(0);
  expect(scene.getObjectByName("scale-reference")).toBe(reference);
  viewer.dispose();
});

it("frames only the part and releases references on replacement and close", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial()), false);
  const original = viewer.snapshot();
  viewer.setReference("hand");
  viewer.fit();
  expect(viewer.snapshot()).toEqual(original);
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  const hand = scene.getObjectByName("scale-reference")!.children[0] as Mesh;
  const handGeometry = vi.spyOn(hand.geometry, "dispose");
  const handMaterial = vi.spyOn(hand.material as MeshStandardMaterial, "dispose");
  viewer.setReference("card");
  expect(handGeometry).toHaveBeenCalledOnce();
  expect(handMaterial).toHaveBeenCalledOnce();
  const card = scene.getObjectByName("scale-reference")!.children[0] as Mesh;
  const cardGeometry = vi.spyOn(card.geometry, "dispose");
  const cardMaterial = vi.spyOn(card.material as MeshStandardMaterial, "dispose");
  viewer.setReference("none");
  expect(scene.getObjectByName("scale-reference")).toBeUndefined();
  expect(cardGeometry).toHaveBeenCalledOnce();
  expect(cardMaterial).toHaveBeenCalledOnce();
  viewer.setReference("coin-us");
  const coin = scene.getObjectByName("scale-reference")!.children[0] as Mesh;
  const coinGeometry = vi.spyOn(coin.geometry, "dispose");
  viewer.dispose();
  expect(coinGeometry).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it("cannot pick a reference but still picks the model beside it", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial()), false);
  viewer.setReference("coin-euro");
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  const reference = scene.getObjectByName("scale-reference")!;
  const x = reference.position.x;
  viewer.restore({
    ...viewer.snapshot(),
    projection: "orthographic",
    position: [x, 0, 100],
    target: [x, 0, 0],
  });
  const callback = vi.fn();
  viewer.setPickMode("measure", callback);
  const event = { button: 0, clientX: 300, clientY: 200, pointerId: 1 } as PointerEvent;
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(callback).not.toHaveBeenCalled();
  viewer.restore({ ...viewer.snapshot(), position: [0, 0, 100], target: [0, 0, 0] });
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(callback).toHaveBeenCalledWith([[0, 0, 5]], "free");
  viewer.dispose();
});

it("updates existing measurement labels and captures without rebuilding millimetre geometry", async () => {
  const context = {
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    measureText: () => ({ width: 40 }),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
  };
  const elements: {
    textContent: string;
    style: Record<string, string>;
    append: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => true } },
    createElement: (tag: string) => {
      if (tag === "canvas")
        return {
          getContext: () => context,
          toBlob: (callback: BlobCallback) => callback(new Blob(["png"])),
        };
      const element = {
        textContent: "",
        style: {},
        append: vi.fn(),
        replaceChildren: vi.fn(),
        remove: vi.fn(),
      };
      elements.push(element);
      return element;
    },
  });
  vi.stubGlobal("getComputedStyle", () => ({ fontFamily: "sans-serif" }));
  Object.assign(gpu, {
    getSize: (size: import("three").Vector2) => size.set(600, 400),
    getPixelRatio: () => 1,
  });
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(40, 40, 10), new MeshStandardMaterial()), false);
  viewer.restore({ ...viewer.snapshot(), position: [0, 0, 200], target: [0, 0, 0] });
  const measurement = {
    id: "m",
    name: "Width",
    kind: "distance" as const,
    sourceRevision: "one",
    visible: true,
    start: [0, 0, 0] as const,
    end: [25.4, 0, 0] as const,
  };
  viewer.setOverlays([measurement], [], null);
  flushFrame();
  const label = elements.find((element) => element.textContent === "25.40 mm")!;
  expect(label).toBeDefined();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  const line = scene.getObjectsByProperty("type", "Line")[0] as import("three").Line;
  const dispose = vi.spyOn(line.geometry, "dispose");
  viewer.setLengthFormat((mm) => `${(mm / 25.4).toFixed(2)} in`);
  expect(label.textContent).toBe("1.00 in");
  expect(dispose).not.toHaveBeenCalled();
  expect(measurement.end).toEqual([25.4, 0, 0]);
  flushFrame();
  expect(frames.size).toBe(0);
  await viewer.capture(false);
  expect(context.fillText).toHaveBeenCalledWith("1.00 in", 0, 0.5);
  viewer.setOverlays(
    [
      {
        ...measurement,
        kind: "circle",
        circle: { center: [0, 0, 0], normal: [0, 0, 1], diameter: 25.4, sides: 64 },
      },
    ],
    [],
    null,
  );
  flushFrame();
  const circle = scene.getObjectsByProperty("type", "LineLoop")[0] as import("three").LineLoop;
  expect(circle.geometry.getAttribute("position").count).toBe(64);
  const circleLabel = elements.find((element) => element.textContent === "Ø1.00 in")!;
  expect(circleLabel).toBeDefined();
  viewer.setLengthFormat((mm) => `${mm.toFixed(2)} mm`);
  expect(circleLabel.textContent).toBe("Ø25.40 mm");
  viewer.dispose();
  vi.restoreAllMocks();
});

it("draws overall dimensions from posed bounds, keeps them through markup redraws and captures them", async () => {
  const context = {
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    measureText: () => ({ width: 40 }),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
  };
  const elements: { textContent: string; remove: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => true } },
    createElement: (tag: string) => {
      if (tag === "canvas")
        return {
          getContext: () => context,
          toBlob: (callback: BlobCallback) => callback(new Blob(["png"])),
        };
      const element = { textContent: "", style: {}, append: vi.fn(), remove: vi.fn() };
      elements.push(element);
      return element;
    },
  });
  vi.stubGlobal("getComputedStyle", () => ({ fontFamily: "sans-serif" }));
  Object.assign(gpu, {
    getSize: (size: import("three").Vector2) => size.set(600, 400),
    getPixelRatio: () => 1,
  });
  const shown = () =>
    elements
      .filter((element) => element.textContent && !element.remove.mock.calls.length)
      .map((element) => element.textContent);
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(30, 20, 10), new MeshStandardMaterial()), false);
  expect(shown()).toEqual([]);
  viewer.setExtents(true);
  expect(shown()).toEqual(["X 30.00 mm", "Y 20.00 mm", "Z 10.00 mm"]);
  const scene = () => gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  flushFrame();
  const lines = scene().getObjectByName("model-extents")!.children;
  // Per axis: two dashed witness lines, the end ticks and the dimension line.
  expect(lines.map((axis) => axis.children.length)).toEqual([4, 4, 4]);
  // Seen end-on in an orthographic standard view, an axis's line and label are left out.
  const label = (text: string) =>
    elements.find((element) => element.textContent === text) as { hidden?: boolean };
  expect(lines.map((axis) => axis.visible)).toEqual([true, true, true]);
  // The real controls aim the camera at their target on update; the double has to as well.
  const controls = doubles.controls as { target: Vector3; update: () => void };
  const perspective = gpu.render.mock.calls.at(-1)![1] as import("three").PerspectiveCamera,
    update = controls.update;
  controls.update = () => {
    perspective.lookAt(controls.target);
    update();
  };
  viewer.setProjection("orthographic");
  viewer.setView("front");
  flushFrame();
  expect(lines.map((axis) => axis.visible)).toEqual([true, false, true]);
  expect(label("Y 20.00 mm").hidden).toBe(true);
  expect(label("X 30.00 mm").hidden).toBe(false);
  viewer.setView("iso");
  flushFrame();
  expect(lines.map((axis) => axis.visible)).toEqual([true, true, true]);
  expect(label("Y 20.00 mm").hidden).toBe(false);
  // Lay the part on its side: the lines follow the posed bounds.
  viewer.setOrientation([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  expect(shown()).toEqual(["X 20.00 mm", "Y 30.00 mm", "Z 10.00 mm"]);
  // Markup redraws do not clear derived lines, and the length format still reaches them.
  viewer.setOverlays([], [], null);
  viewer.setLengthFormat((mm) => `${(mm / 25.4).toFixed(2)} in`);
  expect(shown()).toEqual(["X 0.79 in", "Y 1.18 in", "Z 0.39 in"]);
  await viewer.capture(false);
  expect(context.fillText).toHaveBeenCalledWith("Y 1.18 in", 0, 0.5);
  viewer.setExtents(false);
  expect(shown()).toEqual([]);
  flushFrame();
  expect(scene().getObjectByName("model-extents")!.children).toHaveLength(0);
  viewer.dispose();
  vi.restoreAllMocks();
});

function compileOverhangs(material: Material) {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: { ...ShaderLib.standard.uniforms },
  } as Parameters<Material["onBeforeCompile"]>[0];
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader.uniforms;
}

it("restores overhang shading, suppresses it in wireframe and coalesces angle changes", () => {
  const viewer = createViewer(host());
  const geometry = new BoxGeometry(20, 30, 40);
  geometry.translate(0, 0, 7);
  const material = new MeshStandardMaterial();
  viewer.setModel(new Mesh(geometry, material), false);
  const uniforms = compileOverhangs(material);
  expect(uniforms.loomOverhangBedZ!.value).toBe(-13);
  expect(viewer.snapshot().overhangs).toBe(false);
  viewer.restore({ ...viewer.snapshot(), overhangs: true });
  expect(uniforms.loomOverhangEnabled!.value).toBe(true);
  viewer.setWireframe(true);
  expect(uniforms.loomOverhangEnabled!.value).toBe(false);
  expect(viewer.snapshot().overhangs).toBe(true);
  viewer.setWireframe(false);
  expect(uniforms.loomOverhangEnabled!.value).toBe(true);
  flushFrame();
  gpu.render.mockClear();
  const version = material.version;
  viewer.setOverhangAngle(50);
  viewer.setOverhangAngle(60);
  expect(uniforms.loomOverhangSin!.value).toBeCloseTo(Math.sin((60 * Math.PI) / 180));
  expect(material.version).toBe(version);
  expect(frames.size).toBe(1);
  flushFrame();
  expect(gpu.render).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  viewer.setOverhangs(false);
  expect(uniforms.loomOverhangEnabled!.value).toBe(false);
  viewer.dispose();
});

it("lazily caches indexed geometry in normalized millimetres and resets on replacement", () => {
  const viewer = createViewer(host());
  expect(viewer.overhangInput()).toBeNull();
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 0.002, 0, 0, 0, 0.003, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 0]);
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  const readVertex = vi.spyOn(mesh, "getVertexPosition");
  mesh.position.set(0.001, 0, 0);
  const nested = new Group();
  nested.position.set(0.001, 0.002, 0.003);
  nested.add(mesh);
  const root = new Group();
  root.rotation.x = Math.PI / 2;
  root.scale.setScalar(1000);
  root.add(nested);
  viewer.setModel(root, false);
  // Orientation bounds read vertices once; this assertion concerns the lazy overhang copy.
  readVertex.mockClear();
  viewer.setBed([350, 320], "grid-mm");
  viewer.setReference("hand");
  expect(readVertex).not.toHaveBeenCalled();
  const positions = viewer.overhangInput()!;
  const expected = [2, -3, 2, 4, -3, 2, 2, -3, 5, 2, -3, 5, 4, -3, 2, 2, -3, 2];
  expect(positions).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(positions[index]).toBeCloseTo(value, 5));
  expect(readVertex).toHaveBeenCalledTimes(6);
  expect(viewer.overhangInput()).toBe(positions);
  expect(readVertex).toHaveBeenCalledTimes(6);
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), true);
  const replacement = viewer.overhangInput();
  expect(replacement).not.toBe(positions);
  expect(replacement).toHaveLength(12 * 9);
  readVertex.mockRestore();
  viewer.dispose();
});

it("expands instance transforms into the same world coordinates used by shading", () => {
  const viewer = createViewer(host());
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const mesh = new InstancedMesh(geometry, new MeshStandardMaterial(), 2);
  mesh.position.set(10, 20, 30);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(1, 2, 3));
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(4, 5, 6));
  viewer.setModel(mesh, false);
  expect(Array.from(viewer.overhangInput()!)).toEqual([
    11, 22, 33, 12, 22, 33, 11, 23, 33, 14, 25, 36, 15, 25, 36, 14, 26, 36,
  ]);
  viewer.dispose();
});

it("reports unsupported model materials and clears the warning on replacement", () => {
  const viewer = createViewer(host());
  viewer.setModel(
    new Mesh(new BoxGeometry(), [new MeshStandardMaterial(), new MeshBasicMaterial()]),
    false,
  );
  expect(viewer.unsupportedOverhangMaterials()).toBe(true);
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), true);
  viewer.setReference("hand");
  viewer.setBed([350, 320], "grid-mm");
  expect(viewer.unsupportedOverhangMaterials()).toBe(false);
  viewer.dispose();
});

it("parents nozzle strips to the bed and releases their resources on replacement and close", () => {
  const viewer = createViewer(host());
  const geometry = new BoxGeometry(40, 20, 10);
  geometry.translate(30, 50, 10);
  viewer.setModel(new Mesh(geometry, new MeshStandardMaterial()), false);
  const strips = [{ offsetMm: [0, 0], footprintMm: [30, 320] }] as const;
  viewer.setBed([350, 320], "grid-mm", strips);
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  const zones = scene.getObjectByName("nozzle-zones")!;
  const strip = zones.children[0] as Mesh;
  expect(zones.parent?.name).toBe("bed");
  expect(zones.parent?.position.toArray()).toEqual([30, 50, 5]);
  expect(strip.getWorldPosition(new Vector3()).toArray()).toEqual([-130, 50, 5]);
  expect((strip.material as MeshBasicMaterial).color.getHex()).toBe(0x262236);
  viewer.setGrid(false);
  expect(zones.parent?.visible).toBe(false);
  viewer.setGrid(true);
  expect(zones.parent?.visible).toBe(true);
  const next = new BoxGeometry(40, 20, 10);
  next.translate(60, 80, 30);
  viewer.setModel(new Mesh(next, new MeshStandardMaterial()), true);
  flushFrame();
  expect(zones.parent?.position.toArray()).toEqual([60, 80, 25]);
  const disposeGeometry = vi.spyOn(strip.geometry, "dispose");
  const disposeMaterial = vi.spyOn(strip.material as MeshBasicMaterial, "dispose");
  viewer.setBed([350, 320], "grid-mm", strips);
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(disposeMaterial).toHaveBeenCalledOnce();
  const replacement = scene.getObjectByName("nozzle-zones")!.children[0] as Mesh;
  const closeGeometry = vi.spyOn(replacement.geometry, "dispose");
  const closeMaterial = vi.spyOn(replacement.material as MeshBasicMaterial, "dispose");
  viewer.dispose();
  expect(closeGeometry).toHaveBeenCalledOnce();
  expect(closeMaterial).toHaveBeenCalledOnce();
});

it("preserves outward facet normals for mirrored glTF nodes", () => {
  const viewer = createViewer(host());
  const mesh = new Mesh(new BoxGeometry(20, 30, 40), new MeshStandardMaterial());
  const root = new Group();
  root.scale.set(-1, 1, 1);
  root.add(mesh);
  viewer.setModel(root, false);
  const stats = overhangStats(viewer.overhangInput()!, { thresholdDegrees: 45 });
  expect(stats.totalAreaMm2).toBe(5200);
  expect(stats.overhangAreaMm2).toBe(0);
  expect(stats.regions).toEqual([]);
  viewer.dispose();
});

it("keeps normal replacement disposal when previous retention is disabled", () => {
  const viewer = createViewer(host());
  const first = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const geometryDispose = vi.spyOn(first.geometry, "dispose"),
    materialDispose = vi.spyOn(first.material, "dispose");
  viewer.setModel(first, false);
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), true);
  expect(viewer.hasPrevious()).toBe(false);
  expect(geometryDispose).toHaveBeenCalledOnce();
  expect(materialDispose).toHaveBeenCalledOnce();
  viewer.dispose();
  expect(geometryDispose).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it("retains exactly one previous geometry and releases it on replacement, clear and close", () => {
  const viewer = createViewer(host());
  viewer.keepPrevious(true);
  const first = new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial()),
    second = new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial()),
    third = new Mesh(new BoxGeometry(5, 5, 5), new MeshStandardMaterial());
  const firstDispose = vi.spyOn(first.geometry, "dispose"),
    secondDispose = vi.spyOn(second.geometry, "dispose"),
    thirdDispose = vi.spyOn(third.geometry, "dispose");
  viewer.setModel(first, false);
  expect(viewer.hasPrevious()).toBe(false);
  viewer.setModel(second, true);
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene;
  expect(scene.getObjectByName("model-ghosts")!.children).toEqual([first]);
  expect(first.visible).toBe(false);
  expect(viewer.hasPrevious()).toBe(true);
  expect(firstDispose).not.toHaveBeenCalled();
  viewer.showPrevious(true);
  expect(first.visible).toBe(true);
  viewer.setModel(third, true);
  expect(firstDispose).toHaveBeenCalledOnce();
  expect(second.visible).toBe(true);
  expect(scene.getObjectByName("model-ghosts")!.children).toEqual([second]);
  viewer.keepPrevious(false);
  expect(viewer.hasPrevious()).toBe(false);
  expect(secondDispose).toHaveBeenCalledOnce();
  viewer.clearPrevious();
  viewer.dispose();
  expect(firstDispose).toHaveBeenCalledOnce();
  expect(secondDispose).toHaveBeenCalledOnce();
  expect(thirdDispose).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it("clips previous geometry without changing fit, picking or current geometry statistics", () => {
  const viewer = createViewer(host());
  viewer.keepPrevious(true);
  viewer.setSection({ enabled: true, axis: "z", offset: 0, flipped: false, caps: true });
  const previous = new Mesh(new BoxGeometry(200, 200, 200), new MeshStandardMaterial());
  viewer.setModel(previous, false);
  const stats = viewer.setModel(
    new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial()),
    false,
  );
  expect(stats.size).toEqual([10, 10, 10]);
  const currentCamera = viewer.snapshot();
  viewer.showPrevious(true);
  viewer.fit();
  expect(viewer.snapshot()).toEqual(currentCamera);
  const material = previous.material;
  expect(material).toBeInstanceOf(MeshBasicMaterial);
  expect(material.clippingPlanes?.[0]?.normal.toArray()).toEqual([0, 0, 1]);
  expect(material.color.getHex()).toBe(0xa3acb9);
  viewer.setSection({ enabled: true, axis: "x", offset: 2, flipped: true, caps: true });
  expect(material.clippingPlanes?.[0]?.normal.toArray()).toEqual([-1, 0, 0]);
  expect(material.clippingPlanes?.[0]?.constant).toBe(2);
  viewer.setSection({ enabled: false, axis: "z", offset: 0, flipped: false, caps: true });
  expect(material.clippingPlanes).toEqual([]);
  viewer.restore({
    ...viewer.snapshot(),
    projection: "orthographic",
    position: [0, 0, 300],
    target: [0, 0, 0],
  });
  const callback = vi.fn();
  viewer.setPickMode("measure", callback);
  const event = { button: 0, clientX: 300, clientY: 200, pointerId: 1 } as PointerEvent;
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(callback).toHaveBeenCalledWith([[0, 0, 5]], "free");
  expect(viewer.overhangInput()).toHaveLength(12 * 9);
  viewer.dispose();
});

it("does not retain outgoing models over the triangle cap and clears an earlier ghost", () => {
  const viewer = createViewer(host());
  viewer.keepPrevious(true);
  const first = new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    large = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  // The renderer is mocked; only the index count is needed to exercise the retention cap.
  Object.defineProperty(large.geometry.index!, "count", { value: 3_000_003 });
  const firstDispose = vi.spyOn(first.geometry, "dispose"),
    largeDispose = vi.spyOn(large.geometry, "dispose");
  viewer.setModel(first, false);
  viewer.setModel(large, true);
  expect(viewer.hasPrevious()).toBe(true);
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), true);
  expect(viewer.hasPrevious()).toBe(false);
  expect(firstDispose).toHaveBeenCalledOnce();
  expect(largeDispose).toHaveBeenCalledOnce();
  viewer.dispose();
  vi.restoreAllMocks();
});

it("captures the scene with the live previous visibility and releases its geometry on close", async () => {
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
  viewer.keepPrevious(true);
  const previous = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const dispose = vi.spyOn(previous.geometry, "dispose");
  viewer.setModel(previous, false);
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), true);
  viewer.showPrevious(true);
  gpu.render.mockClear();
  await viewer.capture(false);
  const scene = gpu.render.mock.calls[0]![0] as import("three").Scene;
  expect(scene.getObjectByName("model-ghosts")!.children[0]).toBe(previous);
  expect(previous.visible).toBe(true);
  viewer.showPrevious(false);
  await viewer.capture(false);
  expect(previous.visible).toBe(false);
  viewer.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it("builds snapping lazily, caps large meshes and resets on replacement", async () => {
  const viewer = createViewer(host());
  const geometry = new BoxGeometry();
  Object.defineProperty(geometry.index!, "count", { value: 3_000_003 });
  viewer.setModel(new Mesh(geometry, new MeshStandardMaterial()), false);
  expect(viewer.snapStatus()).toBe("idle");
  const status = vi.fn();
  viewer.onSnapStatus(status);
  viewer.setPickMode("measure", vi.fn());
  expect(viewer.snapStatus()).toBe("off");
  expect(status).toHaveBeenLastCalledWith("off");
  viewer.setPickMode(null, null);
  const next = new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial());
  viewer.setModel(next, false);
  expect(viewer.snapStatus()).toBe("idle");
  expect(await viewer.snapPoint([9.8, 10.1, 10.1], 1)).toEqual([10, 10, 10]);
  expect(viewer.snapStatus()).toBe("ready");
  viewer.dispose();
});
it("coalesces hover, snaps release positions and cancels pending hover when Alt is held", async () => {
  const viewer = createViewer(host()),
    mesh = new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial());
  viewer.setModel(mesh, false);
  viewer.restore({ ...viewer.snapshot(), position: [0, 0, 200], target: [0, 0, 0] });
  await viewer.snapPoint([10, 10, 10]);
  flushFrame();
  gpu.render.mockClear();
  const pick = vi.fn();
  viewer.setPickMode("measure", pick);
  const hits = vi
    .spyOn(Raycaster.prototype, "intersectObject")
    .mockReturnValue([
      { distance: 190, point: new Vector3(9.7, 9.7, 10), object: mesh, faceIndex: 8 },
    ] as ReturnType<Raycaster["intersectObject"]>);
  const event = {
    button: 0,
    clientX: 315,
    clientY: 185,
    pointerId: 1,
    altKey: false,
  } as PointerEvent;
  pointerHandlers.pointermove!(event);
  pointerHandlers.pointermove!(event);
  expect(frames.size).toBe(1);
  flushFrame();
  expect(doubles.snapShow).toHaveBeenCalledOnce();
  expect(gpu.render).not.toHaveBeenCalled();
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(pick).toHaveBeenLastCalledWith([[10, 10, 10]], "vertex");
  pointerHandlers.pointermove!(event);
  pointerHandlers.pointermove!({
    button: event.button,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    altKey: true,
  } as PointerEvent);
  expect(frames.size).toBe(0);
  pointerHandlers.pointerdown!({
    button: event.button,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    altKey: true,
  } as PointerEvent);
  pointerHandlers.pointerup!({
    button: event.button,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    altKey: true,
  } as PointerEvent);
  expect(pick).toHaveBeenLastCalledWith([[9.7, 9.7, 10]], "free");
  viewer.dispose();
  hits.mockRestore();
});
it("wakes a passed hole rim so the empty middle of a through hole picks its center", async () => {
  const outline = new Shape();
  outline.moveTo(-20, -20);
  outline.lineTo(20, -20);
  outline.lineTo(20, 20);
  outline.lineTo(-20, 20);
  outline.closePath();
  outline.holes.push(new Path().absarc(0, 0, 4, 0, Math.PI * 2, false));
  const viewer = createViewer(host()),
    mesh = new Mesh(
      new ExtrudeGeometry(outline, { depth: 5, bevelEnabled: false, curveSegments: 32 }),
      new MeshStandardMaterial(),
    );
  viewer.setModel(mesh, false);
  viewer.restore({ ...viewer.snapshot(), position: [0, 0, 200], target: [0, 0, 0] });
  await viewer.snapPoint([0, 0, 5]);
  const camera = viewer.activeCamera();
  camera.updateMatrixWorld();
  const screen = (x: number, y: number, z: number) => {
    const p = new Vector3(x, y, z).project(camera);
    return { clientX: ((p.x + 1) * 600) / 2, clientY: ((1 - p.y) * 400) / 2 };
  };
  const pick = vi.fn();
  viewer.setPickMode("measure", pick);
  const at = (x: number, y: number) =>
    ({ button: 0, pointerId: 1, altKey: false, ...screen(x, y, 5) }) as PointerEvent;
  // Before the rim is passed, the empty hole offers nothing.
  pointerHandlers.pointermove!(at(0, 0));
  flushFrame();
  expect(doubles.snapShow).not.toHaveBeenCalled();
  // Passing the rim on the plate snaps to its nearer rim corner and wakes the rim.
  pointerHandlers.pointermove!(at(4.3, 0));
  flushFrame();
  expect(doubles.snapShow.mock.lastCall![0]).toBe("vertex");
  pointerHandlers.pointermove!(at(0.2, 0.1));
  flushFrame();
  expect(doubles.snapShow).toHaveBeenLastCalledWith(
    "center",
    expect.any(Number),
    expect.any(Number),
    expect.any(Array),
    "Hole center, ⌀ 8.00 mm",
  );
  pointerHandlers.pointerdown!(at(0.2, 0.1));
  pointerHandlers.pointerup!(at(0.2, 0.1));
  // The top rim's center is nearer the camera than the bottom one's and wins the tie.
  const [point] = pick.mock.lastCall![0] as [[number, number, number]];
  expect(pick.mock.lastCall![1]).toBe("center");
  point.forEach((value, axis) => expect(value).toBeCloseTo([0, 0, 5][axis]!, 4));
  // Alt keeps the free pick, which over empty space picks nothing.
  pick.mockClear();
  pointerHandlers.pointerdown!({ ...at(0.2, 0.1), altKey: true } as PointerEvent);
  pointerHandlers.pointerup!({ ...at(0.2, 0.1), altKey: true } as PointerEvent);
  expect(pick).not.toHaveBeenCalled();
  // A new model forgets the woken rims.
  viewer.setModel(new Mesh(mesh.geometry.clone(), new MeshStandardMaterial()), false);
  await viewer.snapPoint([0, 0, 5]);
  pointerHandlers.pointerdown!(at(0.2, 0.1));
  pointerHandlers.pointerup!(at(0.2, 0.1));
  expect(pick).not.toHaveBeenCalled();
  viewer.dispose();
});
it("finds circles from model-space points regardless of camera and ignores retained ghosts", async () => {
  const viewer = createViewer(host());
  const pin = new Mesh(new CylinderGeometry(1.7, 1.7, 8, 64), new MeshStandardMaterial());
  pin.rotation.x = Math.PI / 2;
  viewer.keepPrevious(true);
  viewer.setModel(pin, false);
  viewer.setModel(new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial()), true);
  expect(await viewer.circleNear([1.7, 0, 4], 1)).toBeNull();
  viewer.setModel(
    new Mesh(
      new CylinderGeometry(1.7, 1.7, 8, 64).rotateX(Math.PI / 2),
      new MeshStandardMaterial(),
    ),
    true,
  );
  const fit = await viewer.circleNear([1.7, 0, 4], 1);
  expect(fit?.diameter).toBeCloseTo(3.4, 5);
  viewer.setProjection("orthographic");
  viewer.setView("front");
  expect((await viewer.circleNear([1.7, 0, 4], 1))?.diameter).toBeCloseTo(fit!.diameter, 5);
  viewer.dispose();
});

it("nudges only loaded geometry and coalesces keyboard navigation into one frame", () => {
  const viewer = createViewer(host());
  const control = doubles.controls as {
    rotateLeft: ReturnType<typeof vi.fn>;
    rotateUp: ReturnType<typeof vi.fn>;
    pan: ReturnType<typeof vi.fn>;
  };
  viewer.nudge({ kind: "orbit", left: 0.2, up: 0.1 });
  expect(control.rotateLeft).not.toHaveBeenCalled();
  expect(viewer.owns(null)).toBe(false);
  expect(viewer.owns(gpu.domElement as unknown as EventTarget)).toBe(true);
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), false);
  flushFrame();
  const navigate = vi.fn();
  viewer.onNavigate(navigate);
  viewer.nudge({ kind: "orbit", left: 0.2, up: 0.1 });
  expect(control.rotateLeft).toHaveBeenCalledWith(0.2);
  expect(control.rotateUp).toHaveBeenCalledWith(0.1);
  viewer.nudge({ kind: "pan", x: 0.1, y: -0.1 });
  expect(control.pan).toHaveBeenCalledWith(40, -40);
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(1);
  flushFrame();
  expect(frames.size).toBe(0);
  viewer.dispose();
});

it("rotates about the authored centre with precise bounds, recentres the section and preserves a ghost pose", () => {
  const viewer = createViewer(host()),
    mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial());
  mesh.position.set(10, 20, 30);
  viewer.keepPrevious(true);
  viewer.setModel(mesh, false);
  viewer.setSection({ enabled: true, axis: "z", offset: 29, flipped: false, caps: true });
  const stats = viewer.setOrientation([Math.SQRT1_2, 0, 0, Math.SQRT1_2])!;
  expect(stats.size[0]).toBeCloseTo(2, 6);
  expect(stats.size[1]).toBeCloseTo(6, 6);
  expect(stats.size[2]).toBeCloseTo(4, 6);
  stats.box
    .getCenter(new Vector3())
    .toArray()
    .forEach((value, index) => expect(value).toBeCloseTo([10, 20, 30][index]!, 6));
  expect(viewer.authoredCentre().toArray()).toEqual([10, 20, 30]);
  expect(viewer.orientedMinZ()).toBeCloseTo(28, 6);
  expect(viewer.snapshot().section.offset).toBeCloseTo(30, 6);
  mesh.updateWorldMatrix(true, true);
  const matrix = mesh.matrixWorld.clone();
  viewer.setModel(new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()), true);
  expect(viewer.hasPrevious()).toBe(true);
  flushFrame();
  expect(mesh.matrixWorld.elements).toEqual(matrix.elements);
  viewer.dispose();
});

it("converts feature snapping and circle results back to model space after orientation", async () => {
  const viewer = createViewer(host()),
    mesh = new Mesh(new BoxGeometry(20, 20, 20), new MeshStandardMaterial());
  mesh.position.set(30, 40, 50);
  viewer.setModel(mesh, false);
  viewer.setOrientation([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  const point = await viewer.snapPoint([39.8, 50.1, 60.1], 1);
  expect(point[0]).toBeCloseTo(40, 6);
  expect(point[1]).toBeCloseTo(50, 6);
  expect(point[2]).toBeCloseTo(60, 6);
  const cylinder = new Mesh(
    new CylinderGeometry(1.7, 1.7, 8, 64).rotateX(Math.PI / 2),
    new MeshStandardMaterial(),
  );
  viewer.setModel(cylinder, false);
  viewer.setOrientation([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const circle = await viewer.circleNear([1.7, 0, 4], 1);
  expect(circle?.diameter).toBeCloseTo(3.4, 5);
  expect(circle?.center[0]).toBeCloseTo(0, 5);
  expect(circle?.center[1]).toBeCloseTo(0, 5);
  expect(circle?.center[2]).toBeCloseTo(4, 5);
  expect(Math.abs(circle!.normal[2])).toBeCloseTo(1, 5);
  viewer.dispose();
});

it("caps a nearer cut for picks and measures a model-space wall after orientation", () => {
  const viewer = createViewer(host()),
    mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()),
    status = vi.fn();
  viewer.setModel(mesh, false);
  viewer.onSectionCapsStatus(status);
  viewer.setOrientation([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  viewer.setSection({ enabled: true, axis: "z", offset: 0, flipped: false, caps: true });
  viewer.restore({ ...viewer.snapshot(), position: [0, 0, -100], target: [0, 0, 0] });
  viewer.activeCamera().up.set(0, 1, 0);
  viewer.activeCamera().lookAt(0, 0, 0);
  expect(viewer.sectionCapsStatus()).toBe("filled");
  const wall = viewer.wallThicknessAt([0, 0, 0]);
  expect(wall?.thicknessMm).toBeCloseTo(2, 6);
  expect(new Vector3(...wall!.start).distanceTo(new Vector3(...wall!.end))).toBeCloseTo(2, 6);
  const pick = vi.fn(),
    keep = vi.fn(),
    event = { button: 0, clientX: 300, clientY: 200, pointerId: 1, altKey: true } as PointerEvent;
  viewer.setPickMode("measure", pick);
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(pick).toHaveBeenCalledOnce();
  pick.mock.calls[0]![0][0].forEach((value: number) => expect(value).toBeCloseTo(0, 6));
  viewer.setPickMode(null, null);
  viewer.onWallMeasure(keep);
  pointerHandlers.dblclick!(event);
  expect(keep).toHaveBeenCalledWith(wall!.start, wall!.end);
  viewer.setWireframe(true);
  expect(viewer.wallThicknessAt([0, 0, 0])).toBeNull();
  expect(status).toHaveBeenLastCalledWith("off");
  viewer.setWireframe(false);
  expect(status).toHaveBeenLastCalledWith("filled");
  viewer.dispose();
});

it("returns face orientation from model coordinates without including scene helpers", () => {
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()), false);
  viewer.setBed([350, 320], "grid-mm");
  viewer.setReference("coin-us");
  const face = viewer.faceOrientationAt([1, 0, 0]);
  expect(face?.areaMm2).toBeCloseTo(24, 6);
  expect(face?.floats).toBe(false);
  expect(viewer.autoOrientation()).not.toBeNull();
  expect(viewer.faceOrientationAt([1000, 1000, 1000])).toBeNull();
  viewer.dispose();
});

it("coalesces wall hover without GPU frames and positions numbered finding pins in model space", () => {
  const elements: {
    tag: string;
    hidden?: boolean;
    textContent?: string;
    style: Record<string, string>;
    dataset: Record<string, string>;
    children: unknown[];
    remove: ReturnType<typeof vi.fn>;
    append: (...children: unknown[]) => void;
    handlers: Record<string, (event: MouseEvent) => void>;
  }[] = [];
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => true } },
    createElement: (tag: string) => makeElement(tag),
    createElementNS: (_namespace: string, tag: string) => makeElement(tag),
  });
  function makeElement(tag: string) {
    const element = {
      tag,
      hidden: false,
      textContent: "",
      style: {},
      dataset: {},
      children: [] as unknown[],
      remove: vi.fn(),
      handlers: {} as Record<string, (event: MouseEvent) => void>,
      append(...children: unknown[]) {
        this.children.push(...children);
      },
      setAttribute: vi.fn(),
      addEventListener(name: string, callback: (event: MouseEvent) => void) {
        this.handlers[name] = callback;
      },
    };
    elements.push(element);
    return element;
  }
  const viewer = createViewer(host());
  viewer.setModel(new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial()), false);
  viewer.setOrientation([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  viewer.setSection({ enabled: true, axis: "z", offset: 0, flipped: false, caps: true });
  viewer.restore({ ...viewer.snapshot(), position: [0, 0, -100], target: [0, 0, 0] });
  viewer.activeCamera().up.set(0, 1, 0);
  viewer.activeCamera().lookAt(0, 0, 0);
  viewer.activeCamera().up.set(0, 1, 0);
  viewer.activeCamera().lookAt(0, 0, 0);
  flushFrame();
  gpu.render.mockClear();
  const event = { buttons: 0, clientX: 300, clientY: 200 } as PointerEvent;
  pointerHandlers.pointermove!(event);
  pointerHandlers.pointermove!(event);
  expect(frames.size).toBe(1);
  flushFrame();
  expect(gpu.render).not.toHaveBeenCalled();
  expect(elements.some((element) => element.textContent === "2.00 mm wall")).toBe(true);
  pointerHandlers.pointerleave!(event);
  expect(elements.find((element) => element.tag === "div")?.hidden).toBe(true);
  const finding = {
    id: "THIN_WALL-1",
    check: "walls",
    code: "THIN_WALL",
    severity: "warn",
    message: "Thin wall",
    value: 0.4,
    limit: 0.8,
    unit: "mm",
    location: { point: [1, 0, 0], normal: [1, 0, 0], radiusMm: 2 },
  } as const;
  const selected = vi.fn();
  viewer.setFindings([finding], finding.id, selected);
  const button = elements.find((element) => element.tag === "button")!;
  expect(button.dataset).toEqual({ severity: "warn", selected: "true" });
  button.handlers.click!({ stopPropagation: vi.fn() } as unknown as MouseEvent);
  expect(selected).toHaveBeenCalledWith(finding);
  viewer.frameFinding(finding);
  expect(viewer.snapshot().target).toEqual([1, 0, 0]);
  viewer.setFindings([], null, null);
  expect(button.remove).not.toHaveBeenCalled();
  viewer.dispose();
});

it("uses capture pixel ratio for section hatching and restores it after capture failure", async () => {
  let ratio = 2;
  Object.assign(gpu, {
    getSize: (size: import("three").Vector2) => size.set(600, 400),
    getPixelRatio: () => ratio,
    setPixelRatio: vi.fn((next: number) => {
      ratio = next;
    }),
  });
  vi.stubGlobal("document", {
    documentElement: { classList: { contains: () => true } },
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {
          throw new Error("capture draw failed");
        },
      }),
    }),
  });
  const viewer = createViewer(host());
  ratio = 2;
  viewer.setModel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), false);
  viewer.setSection({ enabled: true, axis: "z", offset: 0, flipped: false, caps: true });
  flushFrame();
  const scene = gpu.render.mock.calls.at(-1)![0] as import("three").Scene,
    cap = scene.getObjectByName("section-cap") as Mesh,
    material = cap.material as MeshBasicMaterial,
    shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "",
      fragmentShader: "#include <color_fragment>",
    };
  material.onBeforeCompile(
    shader as Parameters<typeof material.onBeforeCompile>[0],
    {} as WebGLRenderer,
  );
  expect(shader.uniforms.loomSectionHatch!.value).toBe(12);
  gpu.render.mockImplementation(() => expect(shader.uniforms.loomSectionHatch!.value).toBe(6));
  await expect(viewer.capture(false)).rejects.toThrow("capture draw failed");
  expect(shader.uniforms.loomSectionHatch!.value).toBe(12);
  expect(ratio).toBe(2);
  viewer.dispose();
});

it("skips hidden ancestors for picks and snaps and coalesces visibility redraws", async () => {
  const viewer = createViewer(host()),
    root = new Group(),
    hidden = new Group(),
    near = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial()),
    far = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
  hidden.add(near);
  root.add(hidden, far);
  far.position.x = 10;
  viewer.setModel(root, false);
  await viewer.snapPoint([1, 1, 1]);
  hidden.visible = false;
  expect((await viewer.snapPointDetailed([1, 1, 1], 0.5)).kind).toBe("free");
  const callback = vi.fn();
  viewer.setPickMode("measure", callback);
  const hits = vi.spyOn(Raycaster.prototype, "intersectObject").mockReturnValue([
    { distance: 1, point: new Vector3(1, 1, 1), object: near },
    { distance: 2, point: new Vector3(11, 1, 1), object: far },
  ] as ReturnType<Raycaster["intersectObject"]>);
  const event = {
    button: 0,
    clientX: 300,
    clientY: 200,
    pointerId: 1,
    altKey: true,
  } as PointerEvent;
  pointerHandlers.pointerdown!(event);
  pointerHandlers.pointerup!(event);
  expect(callback).toHaveBeenCalledWith([[11, 1, 1]], "free");
  flushFrame();
  viewer.invalidate();
  viewer.invalidate();
  expect(frames.size).toBe(1);
  hits.mockRestore();
  viewer.dispose();
});
