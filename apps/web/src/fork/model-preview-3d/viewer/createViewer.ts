import type {
  ModelCamera,
  ModelPoint,
  ModelSection,
  ModelMeasurement,
  ModelAnnotation,
} from "@t3tools/contracts/fork";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AxesHelper,
  Box3,
  Plane,
  Raycaster,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  SphereGeometry,
  MeshBasicMaterial,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MOUSE,
  TOUCH,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { disposeModel, meshStats } from "./load";
import { fitDistance, STANDARD_VIEWS, viewDirection, type View } from "./views";

export type NavigationMode = "orbit" | "pan";

/** One coalesced frame per interaction. OrbitControls damping stays disabled. */
export function createViewer(host: HTMLElement) {
  const scene = new Scene(),
    camera = new PerspectiveCamera(40, 1, 0.01, 1000000);
  camera.up.set(0, 0, 1);
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.localClippingEnabled = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  // Metallic glTF materials need reflected light as well as direct lights.
  const room = new RoomEnvironment(),
    pmrem = new PMREMGenerator(renderer),
    environment = pmrem.fromScene(room);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.append(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "3D model. Drag to orbit, right drag to pan, scroll to zoom.",
  );
  renderer.domElement.tabIndex = 0;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  scene.add(new AmbientLight(0xffffff, 0.3));
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(200, -300, 500);
  scene.add(key);
  const overlay = new Group();
  scene.add(overlay);
  let section: ModelSection = { enabled: false, axis: "z", offset: 0, flipped: false };
  let pickMode: "measure" | "annotate" | null = null;
  let onPick: ((points: ModelPoint[]) => void) | null = null;
  let onCamera: ((camera: ModelCamera) => void) | null = null;
  let restoring = false;
  const plane = new Plane();
  const applySection = () => {
    const sign = section.flipped ? -1 : 1;
    plane.normal.set(
      section.axis === "x" ? sign : 0,
      section.axis === "y" ? sign : 0,
      section.axis === "z" ? sign : 0,
    );
    plane.constant = -section.offset * sign;
    model?.traverse((object) => {
      if (object instanceof Mesh)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.clippingPlanes = section.enabled ? [plane] : [];
    });
  };
  const raycaster = new Raycaster();
  const pick = (event: PointerEvent): ModelPoint | null => {
    if (!model) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster
      .intersectObject(model, true)
      .find((hit) => !section.enabled || plane.distanceToPoint(hit.point) >= 0);
    return hit ? hit.point.toArray() : null;
  };
  let picked: ModelPoint[] = [];
  let down: { x: number; y: number } | null = null;
  const pointerDown = (event: PointerEvent) => {
    if (!pickMode || event.button !== 0) return;
    renderer.domElement.focus();
    down = { x: event.clientX, y: event.clientY };
    const point = pick(event);
    picked = point ? [point] : [];
    renderer.domElement.setPointerCapture?.(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!down || pickMode !== "annotate" || picked.length >= 64) return;
    const point = pick(event);
    if (
      point &&
      (!picked.length ||
        new Vector3(...point).distanceTo(new Vector3(...picked.at(-1)!)) >
          box.getSize(new Vector3()).length() / 100)
    )
      picked.push(point);
  };
  const pointerUp = (event: PointerEvent) => {
    if (!down || !pickMode) return;
    if (pickMode === "annotate" || Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) {
      if (picked.length) onPick?.(picked);
    }
    down = null;
    picked = [];
  };
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointermove", pointerMove);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  const pointerCancel = () => {
    down = null;
    picked = [];
  };
  renderer.domElement.addEventListener("pointercancel", pointerCancel);
  const clearOverlay = () => {
    overlay.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
      if (object instanceof Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
    overlay.clear();
  };
  const label = (text: string, position: Vector3, scale: number) => {
    const bitmap = document.createElement("canvas");
    bitmap.width = 512;
    bitmap.height = 56;
    const context = bitmap.getContext("2d");
    if (!context) return;
    context.fillStyle = "#16202c";
    context.fillRect(0, 0, 512, 56);
    context.font = "24px sans-serif";
    context.fillStyle = "white";
    context.textAlign = "center";
    context.fillText(text, 256, 36);
    const sprite = new Sprite(
      new SpriteMaterial({ map: new CanvasTexture(bitmap), depthTest: false }),
    );
    sprite.position.copy(position);
    sprite.scale.set(scale * 5, scale * 0.55, 1);
    sprite.renderOrder = 10;
    overlay.add(sprite);
  };
  const drawOverlay = (
    measurements: readonly ModelMeasurement[],
    annotations: readonly ModelAnnotation[],
    pendingPoint: ModelPoint | null,
  ) => {
    clearOverlay();
    const scale = Math.max(box.getSize(new Vector3()).length() / 30, 0.2);
    const dot = (point: ModelPoint, color: number) => {
      const marker = new Mesh(
        new SphereGeometry(scale / 7, 12, 8),
        new MeshBasicMaterial({ color, depthTest: false }),
      );
      marker.position.fromArray(point);
      marker.renderOrder = 9;
      overlay.add(marker);
    };
    for (const measurement of measurements)
      if (measurement.visible) {
        const start = new Vector3(...measurement.start),
          end = new Vector3(...measurement.end);
        const line = new Line(
          new BufferGeometry().setFromPoints([start, end]),
          new LineBasicMaterial({ color: 0x3984ff, depthTest: false }),
        );
        line.renderOrder = 9;
        overlay.add(line);
        dot(measurement.start, 0x3984ff);
        dot(measurement.end, 0x3984ff);
        label(
          `${measurement.name}: ${start.distanceTo(end).toFixed(2)} mm`,
          start.clone().lerp(end, 0.5),
          scale,
        );
      }
    for (const annotation of annotations)
      if (annotation.status !== "accepted") {
        const points = annotation.points.map((p) => new Vector3(...p));
        const color = 0xf3ab48;
        if (points.length > 1)
          overlay.add(
            new Line(
              new BufferGeometry().setFromPoints(points),
              new LineBasicMaterial({ color, depthTest: false }),
            ),
          );
        dot(annotation.points[0]!, color);
        label(annotation.name, points[0]!, scale);
      }
    if (pendingPoint) dot(pendingPoint, 0x3984ff);
    requestRender();
  };
  const helpers = new Group();
  scene.add(helpers);
  let model: Object3D | null = null,
    box = new Box3(),
    grid: GridHelper | null = null,
    axes: AxesHelper | null = null;
  let frame: number | null = null,
    disposed = false,
    visible = true,
    gridVisible = true,
    axesVisible = false,
    wireframe = false,
    navigationMode: NavigationMode = "orbit";
  let onNavigate: (() => void) | null = null;
  const navigationStarted = () => onNavigate?.();
  controls.addEventListener("start", navigationStarted);
  const setNavigationMode = (mode: NavigationMode) => {
    navigationMode = mode;
    controls.mouseButtons.LEFT = mode === "pan" ? MOUSE.PAN : MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = mode === "pan" ? MOUSE.ROTATE : MOUSE.PAN;
    controls.touches.ONE = mode === "pan" ? TOUCH.PAN : TOUCH.ROTATE;
    renderer.domElement.style.cursor = pickMode ? "crosshair" : mode === "pan" ? "move" : "grab";
  };
  const render = () => {
    if (!disposed && visible) renderer.render(scene, camera);
  };
  const requestRender = () => {
    if (frame === null && visible && !disposed)
      frame = requestAnimationFrame(() => {
        frame = null;
        render();
      });
  };
  const controlsChanged = () => {
    requestRender();
    if (!restoring) onCamera?.(snapshot());
  };
  controls.addEventListener("change", controlsChanged);
  const resize = () => {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const theme = () => {
    const dark = document.documentElement.classList.contains("dark");
    scene.background = new Color(dark ? 0x151920 : 0xf1f3f5);
    requestRender();
  };
  const themeObserver = new MutationObserver(theme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  theme();
  const setView = (view: View) => {
    if (!model) return;
    const center = box.getCenter(new Vector3()),
      distance = fitDistance(box, camera.fov, camera.aspect);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(viewDirection(view), distance);
    camera.near = Math.max(distance / 10000, 0.01);
    camera.far = Math.max(distance * 100, 10000);
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  };
  const applyWireframe = () =>
    model?.traverse((object) => {
      if (object instanceof Mesh)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          if ("wireframe" in material) material.wireframe = wireframe;
    });
  const setBuildVolume = (volume: readonly [number, number, number]) => {
    if (grid) {
      helpers.remove(grid);
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material])
        material.dispose();
    }
    if (axes) {
      helpers.remove(axes);
      axes.geometry.dispose();
      for (const material of Array.isArray(axes.material) ? axes.material : [axes.material])
        material.dispose();
    }
    grid = new GridHelper(1, 20, 0x78808b, 0x737b87);
    grid.rotation.x = Math.PI / 2;
    grid.scale.set(volume[0], 1, volume[1]);
    grid.visible = gridVisible;
    helpers.add(grid);
    axes = new AxesHelper(Math.min(...volume) / 4);
    axes.visible = axesVisible;
    helpers.add(axes);
    requestRender();
  };
  const snapshot = (): ModelCamera => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    near: camera.near,
    far: camera.far,
    wireframe,
    gridVisible,
    axesVisible,
    navigationMode,
    section,
  });
  return {
    snapshot,
    setPickMode(mode: typeof pickMode, callback: typeof onPick) {
      pointerCancel();
      pickMode = mode;
      onPick = callback;
      controls.enabled = mode === null;
      renderer.domElement.style.cursor = mode
        ? "crosshair"
        : navigationMode === "pan"
          ? "move"
          : "grab";
    },
    onCameraChange(callback: typeof onCamera) {
      onCamera = callback;
    },
    setSection(next: ModelSection) {
      section = next;
      applySection();
      requestRender();
    },
    setOverlays: drawOverlay,
    focus() {
      renderer.domElement.focus();
    },
    setNavigationMode,
    onNavigate(callback: (() => void) | null) {
      onNavigate = callback;
    },
    zoom(factor: number) {
      if (!model || !Number.isFinite(factor) || factor <= 0) return;
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.max(
        camera.near * 10,
        Math.min(camera.far / 10, offset.length() * factor),
      );
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
      navigationStarted();
      requestRender();
    },
    restore(state: ReturnType<typeof snapshot>) {
      restoring = true;
      camera.position.fromArray(state.position);
      controls.target.fromArray(state.target);
      camera.near = state.near;
      camera.far = state.far;
      wireframe = state.wireframe;
      gridVisible = state.gridVisible;
      axesVisible = state.axesVisible;
      setNavigationMode(state.navigationMode);
      section = state.section ?? section;
      applySection();
      applyWireframe();
      if (grid) grid.visible = gridVisible;
      if (axes) axes.visible = axesVisible;
      camera.updateProjectionMatrix();
      controls.update();
      restoring = false;
      requestRender();
    },
    setModel(next: Object3D, keepCamera: boolean) {
      let stats: ReturnType<typeof meshStats>;
      try {
        stats = meshStats(next);
      } catch (error) {
        disposeModel(next);
        throw error;
      }
      if (model) {
        scene.remove(model);
        disposeModel(model);
      }
      model = next;
      box = stats.box;
      scene.add(model);
      applyWireframe();
      applySection();
      if (!keepCamera) setView("iso");
      requestRender();
      return stats;
    },
    setView,
    refit() {
      if (!model) return;
      const direction = camera.position.clone().sub(controls.target).normalize();
      const center = box.getCenter(new Vector3()),
        distance = fitDistance(box, camera.fov, camera.aspect);
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = Math.max(distance / 10000, 0.01);
      camera.far = Math.max(distance * 100, 10000);
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
    },
    fit() {
      setView("iso");
    },
    setBuildVolume,
    setWireframe(value: boolean) {
      wireframe = value;
      applyWireframe();
      requestRender();
    },
    setGrid(value: boolean) {
      gridVisible = value;
      if (grid) grid.visible = value;
      requestRender();
    },
    setAxes(value: boolean) {
      axesVisible = value;
      if (axes) axes.visible = value;
      requestRender();
    },
    setVisible(value: boolean) {
      visible = value;
      if (visible) {
        resize();
        requestRender();
      }
    },
    async capture(four: boolean): Promise<Blob> {
      if (!model) throw new Error("Load a model before capturing it.");
      const size = renderer.getSize(new Vector2()),
        pixelRatio = renderer.getPixelRatio();
      const position = camera.position.clone(),
        target = controls.target.clone(),
        aspect = camera.aspect,
        near = camera.near,
        far = camera.far;
      const output = document.createElement("canvas");
      output.width = four ? 1600 : 1200;
      output.height = four ? 1200 : Math.max(1, Math.round(1200 / aspect));
      const context = output.getContext("2d");
      if (!context) throw new Error("Image capture is unavailable.");
      const controlsEnabled = controls.enabled;
      controls.enabled = false;
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(four ? 800 : 1200, four ? 600 : output.height, false);
        camera.aspect = four ? 4 / 3 : aspect;
        camera.updateProjectionMatrix();
        for (const [index, view] of (four ? STANDARD_VIEWS : [null]).entries()) {
          if (view) setView(view);
          renderer.render(scene, camera);
          const x = four ? (index % 2) * 800 : 0,
            y = four ? Math.floor(index / 2) * 600 : 0;
          context.drawImage(renderer.domElement, x, y);
          if (view) {
            context.fillStyle = "#18202b";
            context.fillRect(x + 12, y + 12, 64, 26);
            context.fillStyle = "white";
            context.font = "14px sans-serif";
            context.fillText(view, x + 20, y + 30);
          }
        }
        return new Promise<Blob>((resolve, reject) =>
          output.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Capture failed."))),
            "image/png",
          ),
        );
      } finally {
        controls.enabled = controlsEnabled;
        camera.position.copy(position);
        controls.target.copy(target);
        camera.aspect = aspect;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(size.x, size.y, false);
        controls.update();
        requestRender();
      }
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      controls.removeEventListener("change", controlsChanged);
      clearOverlay();
      onCamera = null;
      onPick = null;
      controls.removeEventListener("start", navigationStarted);
      onNavigate = null;
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      controls.dispose();
      if (model) disposeModel(model);
      helpers.traverse((object) => {
        if (object instanceof GridHelper || object instanceof AxesHelper) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
export type ModelViewer = ReturnType<typeof createViewer>;
