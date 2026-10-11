import {
  BoxGeometry,
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
  expect(callback).toHaveBeenCalledWith([[0, 0, 10]]);
  viewer.dispose();
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
  viewer.setSection({ enabled: true, axis: "x", offset: 100, flipped: false });
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
  expect(callback).toHaveBeenCalledWith([[0, 0, 5]]);
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
    sourceRevision: "one",
    visible: true,
    start: [0, 0, 0] as const,
    end: [25.4, 0, 0] as const,
  };
  viewer.setOverlays([measurement], [], null);
  flushFrame();
  const label = elements.find((element) => element.textContent === "25.4 mm")!;
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
  viewer.dispose();
  vi.restoreAllMocks();
});
