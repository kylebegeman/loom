import type {
  ModelCamera,
  ScaleReference,
  ModelProjection,
  ModelPoint,
  ModelSection,
  ModelMeasurement,
  ModelAnnotation,
  BuildPlatePattern,
  ZoneRect,
  ModelQuaternion,
  ModelWall,
  PrintFinding,
  AssemblyRegion,
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
  Points,
  LineLoop,
  Triangle,
  LineBasicMaterial,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Color,
  DirectionalLight,
  DoubleSide,
  MeshBasicMaterial,
  Group,
  Mesh,
  InstancedMesh,
  Matrix4,
  MOUSE,
  TOUCH,
  Object3D,
  PerspectiveCamera,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { observeResize } from "~/lib/observeResize";
import { markerScale, syncOrthographic } from "./projection";
import { createReference, placeReference } from "./references";
import { createOverhangShading } from "./overhangs";
import { createZoneStrips } from "./zones";
import { createLayers, type LayerData } from "./layers";
import { createGhost, GHOST_TRIANGLE_LIMIT } from "./ghost";
import { buildTopologies } from "./snapTopology";
import {
  circleAt,
  snapNear,
  snapNearPoint,
  topologyPoint,
  SNAP_TRIANGLE_LIMIT,
  type CircleFit,
  type Topology,
  type Snap,
} from "./snap";
import { createSnapOverlay } from "./snapOverlay";
import { createBed } from "./bed";
import { normalizeQuaternion } from "@t3tools/contracts/fork";
import { createOrientationIndex, type FaceRegion } from "./orientation";
import { frameFor } from "./printCheck";
import {
  createSectionCaps,
  closedMesh as closedMeshGeometry,
  sectionSegments,
  insideSection,
  wallAt,
  type SectionGeometry,
} from "./sectionCaps";
import type { Nudge } from "./keyboard";
import { disposeModel, meshStats } from "./load";
import { fitDistance, STANDARD_VIEWS, viewDirection, type View } from "./views";
import styles from "../workspace.module.css";

export type SnapStatus = "idle" | "building" | "ready" | "off" | "failed";
export type NavigationMode = "orbit" | "pan";
/** An annotation with its number in the request list; the overlay falls back to list order. */
export type OverlayAnnotation = ModelAnnotation & { number?: number };
type ViewerMark = {
  kind: "label" | "pin";
  text: string;
  position: Vector3;
  element: HTMLElement;
  lengthMm: number | null;
  prefix: string;
};
const MARK_BLUE = 0x3984ff;

/** Visibility is inherited by drawing, but Three's raycaster still hits hidden descendants. */
export function shownIn(object: Object3D, root: Object3D | null = null) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) return true;
  }
  return true;
}
/** One coalesced frame per interaction. OrbitControls damping stays disabled. */
export function createViewer(host: HTMLElement) {
  const scene = new Scene(),
    camera = new PerspectiveCamera(40, 1, 0.01, 1000000),
    ortho = new OrthographicCamera();
  const shading = createOverhangShading();
  let projection: ModelProjection = "perspective";
  camera.up.set(0, 0, 1);
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    // Section caps use stencil; three defaults the buffer off.
    stencil: true,
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
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  shading.setPixelRatio(pixelRatio);
  host.append(renderer.domElement);
  renderer.domElement.setAttribute("role", "application");
  renderer.domElement.setAttribute("aria-roledescription", "3D viewport");
  renderer.domElement.tabIndex = 0;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  // Slicer convention (Bambu Studio, Orca): hold the scroll wheel to pan. The wheel still zooms.
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  // Stop Windows and Linux browsers from starting middle-click autoscroll over the canvas.
  const preventAutoscroll = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };
  renderer.domElement.addEventListener("mousedown", preventAutoscroll);
  scene.add(new AmbientLight(0xffffff, 0.3));
  const key = new DirectionalLight(0xffffff, 2);
  key.position.set(200, -300, 500);
  scene.add(key);
  const orientationRoot = new Group(),
    overlay = new Group();
  orientationRoot.name = "model-orientation";
  orientationRoot.add(overlay);
  scene.add(orientationRoot);
  let orientation: ModelQuaternion | null = null,
    authoredBox = new Box3(),
    orientationIndex: ReturnType<typeof createOrientationIndex> | null = null,
    highlightedRegion: FaceRegion | null = null,
    faceHighlight: Mesh | null = null;
  const modelToWorld = (point: ModelPoint) =>
    new Vector3(...point).applyMatrix4(orientationRoot.matrixWorld);
  const worldToModel = (point: Vector3): [number, number, number] =>
    point.clone().applyMatrix4(orientationRoot.matrixWorld.clone().invert()).toArray();
  const circleToModel = (circle: CircleFit | null): CircleFit | null =>
    circle && {
      ...circle,
      center: worldToModel(new Vector3(...circle.center)),
      normal: new Vector3(...circle.normal)
        .applyQuaternion(orientationRoot.quaternion.clone().invert())
        .toArray(),
      loop: circle.loop.map((point) => worldToModel(new Vector3(...point))),
    };
  const clearFaceHighlight = () => {
    highlightedRegion = null;
    if (!faceHighlight) return;
    orientationRoot.remove(faceHighlight);
    faceHighlight.geometry.dispose();
    const materials = Array.isArray(faceHighlight.material)
      ? faceHighlight.material
      : [faceHighlight.material];
    for (const material of materials) material.dispose();
    faceHighlight = null;
    requestRender();
  };
  const prepareOrientation = () => {
    if (!model) return null;
    orientationIndex ??= createOrientationIndex(model, orientationRoot);
    return orientationIndex;
  };
  let section: ModelSection = { enabled: false, axis: "z", offset: 0, flipped: false, caps: true };
  let pickMode: "measure" | "annotate" | "lay-flat" | null = null;
  let onPick: ((points: ModelPoint[], snap?: Snap["kind"] | "free") => void) | null = null;
  let onCircle: ((circle: CircleFit | null) => void) | null = null;
  let measureMode: "distance" | "hole" = "distance";
  let snapState: SnapStatus = "idle",
    snapBuild: Promise<void> | null = null,
    snapAbort: AbortController | null = null;
  let topologies = new Map<Mesh, Topology>();
  let snapChanged: ((status: SnapStatus) => void) | null = null;
  let hoverFrame: number | null = null,
    hoverEvent: PointerEvent | null = null;
  const snapOverlay = createSnapOverlay(host);
  const setSnapState = (status: SnapStatus) => {
    snapState = status;
    snapChanged?.(status);
  };
  const resetSnapping = () => {
    snapAbort?.abort();
    snapAbort = null;
    snapBuild = null;
    topologies.clear();
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    hoverEvent = null;
    snapOverlay.hide();
    setSnapState("idle");
  };
  const prepareSnapping = (): Promise<void> => {
    if (snapBuild) return snapBuild;
    if (!model || snapState !== "idle") return Promise.resolve();
    const meshes: Mesh[] = [];
    let triangles = 0;
    model.updateMatrixWorld(true);
    model.traverse((object) => {
      if (object instanceof Mesh && object.geometry.getAttribute("position")) {
        meshes.push(object);
        triangles +=
          Math.floor(
            (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3,
          ) * (object instanceof InstancedMesh ? object.count : 1);
      }
    });
    if (triangles > SNAP_TRIANGLE_LIMIT) {
      setSnapState("off");
      return Promise.resolve();
    }
    const controller = new AbortController();
    snapAbort = controller;
    setSnapState("building");
    snapBuild = buildTopologies(meshes, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        topologies = result;
        setSnapState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setSnapState("failed");
      });
    return snapBuild;
  };
  let onCamera: ((camera: ModelCamera) => void) | null = null;
  let restoring = false;
  const plane = new Plane(),
    caps = createSectionCaps(scene, plane);
  let sectionGeometry: SectionGeometry | null = null,
    closedHint: boolean | null = null,
    onWall: ((start: ModelPoint, end: ModelPoint) => void) | null = null,
    wallLayer: HTMLDivElement | null = null,
    wallLabel: HTMLDivElement | null = null,
    wallLine: SVGLineElement | null = null;
  const updateCaps = () =>
    caps.update({
      enabled: section.enabled,
      caps: section.caps,
      wireframe,
      box,
      dark,
      pixelRatio: renderer.getPixelRatio?.() ?? pixelRatio,
    });
  const getSectionGeometry = () =>
    (sectionGeometry ??= sectionSegments(caps.closedMeshes(), plane, true));
  const hideWall = () => {
    if (wallLayer) wallLayer.hidden = true;
  };
  const capPoint = (surfaceDistance = Infinity) => {
    if (!caps.visible()) return null;
    const point = raycaster.ray.intersectPlane(plane, new Vector3());
    if (!point || point.distanceTo(raycaster.ray.origin) > surfaceDistance + 1e-7) return null;
    return insideSection(getSectionGeometry(), point) ? point : null;
  };
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
    previous?.setClipping(section.enabled ? [plane] : []);
    comparison?.setClipping(section.enabled ? [plane] : []);
    if (faceHighlight && faceHighlight.material instanceof MeshBasicMaterial)
      faceHighlight.material.clippingPlanes = section.enabled ? [plane] : [];
    sectionGeometry = null;
    hideWall();
    updateCaps();
  };
  const raycaster = new Raycaster();
  const pick = (
    event: Pick<PointerEvent, "clientX" | "clientY">,
  ): { point: [number, number, number]; mesh: Mesh | null; faceIndex: number } | null => {
    if (!model) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const viewCamera = activeCamera();
    raycaster.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      viewCamera,
    );
    if (viewCamera instanceof OrthographicCamera) {
      // Three starts ortho rays at the eye plane, but our visible frustum extends behind it.
      raycaster.ray.origin.addScaledVector(raycaster.ray.direction, viewCamera.near);
      raycaster.far = viewCamera.far - viewCamera.near;
    } else raycaster.far = Infinity;
    const hit = raycaster
      .intersectObject(model, true)
      .find(
        (hit) =>
          shownIn(hit.object, model) && (!section.enabled || plane.distanceToPoint(hit.point) >= 0),
      );
    const capped = capPoint(hit?.distance ?? Infinity);
    if (capped && pickMode !== "lay-flat")
      return { point: capped.toArray(), mesh: null, faceIndex: -1 };
    if (!hit) return null;
    const mesh = hit.object instanceof Mesh ? hit.object : null;
    const triangles = mesh
      ? Math.floor((mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3)
      : 0;
    return {
      point: hit.point.toArray(),
      mesh,
      faceIndex: (hit.faceIndex ?? -1) + (hit.instanceId ?? 0) * triangles,
    };
  };
  let onObjectPick: ((object: Object3D | null) => void) | null = null;
  let picked: ModelPoint[] = [];
  let down: { x: number; y: number } | null = null;
  const pointerDown = (event: PointerEvent) => {
    if ((!pickMode && !onObjectPick) || event.button !== 0) return;
    renderer.domElement.focus();
    down = { x: event.clientX, y: event.clientY };
    const point = pick(event);
    picked = point ? [worldToModel(new Vector3(...point.point))] : [];
    renderer.domElement.setPointerCapture?.(event.pointerId);
  };
  const toScreen = (point: [number, number, number]): [number, number] => {
    const projected = new Vector3(...point).project(activeCamera());
    return [
      ((projected.x + 1) * host.clientWidth) / 2,
      ((1 - projected.y) * host.clientHeight) / 2,
    ];
  };
  const keepSnap = (point: [number, number, number]) => {
    const vector = new Vector3(...point),
      projected = vector.clone().project(activeCamera());
    return (
      (!section.enabled || plane.distanceToPoint(vector) >= 0) &&
      projected.z >= -1 &&
      projected.z <= 1
    );
  };
  const snappedHit = (hit: NonNullable<ReturnType<typeof pick>>): Snap => {
    const topology = hit.mesh && topologies.get(hit.mesh);
    return topology
      ? snapNear(
          topology,
          hit.faceIndex,
          hit.point,
          { origin: raycaster.ray.origin.toArray(), direction: raycaster.ray.direction.toArray() },
          toScreen,
          10,
          keepSnap,
        )
      : { kind: "face", point: hit.point, edge: null };
  };
  let circleCache: { topology: Topology; edge: [number, number]; fit: CircleFit | null } | null =
    null;
  const circleHit = (hit: NonNullable<ReturnType<typeof pick>>, snap: Snap) => {
    const topology = hit.mesh && topologies.get(hit.mesh);
    if (!topology) return null;
    const edge = snap.edge;
    if (
      edge &&
      circleCache?.topology === topology &&
      circleCache.edge[0] === edge[0] &&
      circleCache.edge[1] === edge[1]
    )
      return circleCache.fit;
    const fit = circleAt(topology, hit.faceIndex, hit.point, edge);
    const visible = fit && fit.loop.every(keepSnap) ? fit : null;
    if (edge) circleCache = { topology, edge, fit: visible };
    return visible;
  };
  const updateHover = (event: PointerEvent) => {
    if (pickMode !== "measure" || snapState !== "ready" || event.altKey) return snapOverlay.hide();
    const hit = pick(event);
    if (!hit) return snapOverlay.hide();
    const snap = snappedHit(hit),
      [x, y] = toScreen(snap.point);
    if (measureMode === "hole") {
      const circle = circleHit(hit, snap);
      if (!circle) return snapOverlay.hide();
      snapOverlay.show(
        snap.kind,
        x,
        y,
        [...circle.loop, circle.loop[0]!].flatMap(toScreen),
        `Ø${lengthFormat(circle.diameter)}`,
      );
    } else {
      const topology = hit.mesh && topologies.get(hit.mesh);
      snapOverlay.show(
        snap.kind,
        x,
        y,
        snap.edge && topology
          ? snap.edge.flatMap((id) => toScreen(topologyPoint(topology, id)))
          : null,
      );
    }
  };
  const updateWallHover = (event: PointerEvent) => {
    if (pickMode || event.buttons || !caps.visible()) {
      hideWall();
      return;
    }
    const hit = pick(event),
      point = capPoint(hit ? new Vector3(...hit.point).distanceTo(raycaster.ray.origin) : Infinity);
    const wall = point && wallAt(getSectionGeometry(), point);
    if (!point || !wall) {
      hideWall();
      return;
    }
    if (!wallLayer) {
      wallLayer = document.createElement("div");
      wallLayer.className = styles["model-wall-readout"]!;
      wallLayer.style.pointerEvents = "none";
      wallLabel = document.createElement("div");
      wallLabel.className = styles["model-mark-label"]!;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.width = svg.style.height = "100%";
      wallLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      wallLine.setAttribute("stroke", "#3984ff");
      wallLine.setAttribute("stroke-width", "2");
      svg.append(wallLine);
      wallLayer.append(svg, wallLabel);
      host.append(wallLayer);
    }
    wallLayer.hidden = false;
    wallLabel!.textContent = `${lengthFormat(wall.thicknessMm)} wall`;
    const [x, y] = toScreen(point.toArray()),
      [sx, sy] = toScreen(wall.start),
      [ex, ey] = toScreen(wall.end);
    wallLabel!.style.transform = `translate(${x + 12}px, ${y - 24}px)`;
    for (const [name, value] of [
      ["x1", sx],
      ["y1", sy],
      ["x2", ex],
      ["y2", ey],
    ] as const)
      wallLine!.setAttribute(name, String(value));
  };
  const updateFlatHover = (event: PointerEvent) => {
    if (pickMode !== "lay-flat" || event.buttons) return;
    const hit = pick(event),
      index = prepareOrientation(),
      triangles = hit?.mesh
        ? Math.floor(
            (hit.mesh.geometry.index?.count ?? hit.mesh.geometry.getAttribute("position").count) /
              3,
          )
        : 0;
    const region =
      hit?.mesh && index
        ? index.regionAt(
            hit.mesh,
            hit.faceIndex % triangles,
            hit.mesh instanceof InstancedMesh ? Math.floor(hit.faceIndex / triangles) : undefined,
          )
        : null;
    if (region === highlightedRegion) return;
    clearFaceHighlight();
    if (!region || !index) return;
    highlightedRegion = region;
    faceHighlight = new Mesh(
      index.highlightGeometry(region),
      new MeshBasicMaterial({
        color: MARK_BLUE,
        transparent: true,
        opacity: 0.3,
        side: DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    faceHighlight.renderOrder = 2;
    orientationRoot.add(faceHighlight);
    requestRender();
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pickMode || pickMode === "lay-flat") {
      hoverEvent = event;
      if (hoverFrame === null)
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = null;
          if (hoverEvent) {
            if (pickMode === "lay-flat") updateFlatHover(hoverEvent);
            else updateWallHover(hoverEvent);
          }
        });
      return;
    }
    if (pickMode === "measure") {
      if (snapState !== "ready" || event.altKey) return pointerLeave();
      hoverEvent = event;
      if (hoverFrame === null)
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = null;
          if (hoverEvent) updateHover(hoverEvent);
        });
      return;
    }
    if (!down || pickMode !== "annotate" || picked.length >= 64) return;
    const hit = pick(event),
      point = hit?.point;
    if (
      point &&
      (!picked.length ||
        new Vector3(...point).distanceTo(modelToWorld(picked.at(-1)!)) >
          box.getSize(new Vector3()).length() / 100)
    )
      picked.push(worldToModel(new Vector3(...point)));
  };
  const pointerUp = (event: PointerEvent) => {
    if (!down) return;
    if (!pickMode) {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5)
        onObjectPick?.(pick(event)?.mesh ?? null);
      down = null;
      picked = [];
      return;
    }
    if (pickMode === "annotate") {
      if (picked.length) onPick?.(picked);
    } else if (pickMode === "lay-flat") {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) {
        const hit = pick(event);
        if (hit?.mesh) onPick?.([worldToModel(new Vector3(...hit.point))]);
      }
    } else if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) {
      const hit = pick(event);
      if (hit) {
        const snap =
          event.altKey || snapState !== "ready"
            ? { kind: "face" as const, point: hit.point, edge: null }
            : snappedHit(hit);
        if (measureMode === "hole") onCircle?.(circleToModel(circleHit(hit, snap)));
        else
          onPick?.(
            [worldToModel(new Vector3(...snap.point))],
            event.altKey || snapState !== "ready" ? "free" : snap.kind,
          );
      } else if (measureMode === "hole") onCircle?.(null);
    }
    down = null;
    picked = [];
  };
  const pointerLeave = () => {
    hoverEvent = null;
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    snapOverlay.hide();
    hideWall();
    clearFaceHighlight();
  };
  const doubleClick = (event: MouseEvent) => {
    if (pickMode || !onWall || !caps.visible()) return;
    const hit = pick(event),
      point = capPoint(hit ? new Vector3(...hit.point).distanceTo(raycaster.ray.origin) : Infinity);
    const wall = point && wallAt(getSectionGeometry(), point);
    if (wall)
      onWall(worldToModel(new Vector3(...wall.start)), worldToModel(new Vector3(...wall.end)));
  };
  renderer.domElement.addEventListener("dblclick", doubleClick);
  renderer.domElement.addEventListener("pointerdown", pointerDown);
  renderer.domElement.addEventListener("pointermove", pointerMove);
  renderer.domElement.addEventListener("pointerup", pointerUp);
  renderer.domElement.addEventListener("pointerleave", pointerLeave);
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
        if (object.material.map !== dotTexture) object.material.map?.dispose();
        object.material.dispose();
      }
    });
    overlay.clear();
    marksLayer?.replaceChildren();
    marks = [];
  };
  // Labels and pins are DOM elements projected after each frame, so text stays crisp at any
  // zoom. Lines and dots stay in the scene; capture() paints the marks into the image.
  let marksLayer: HTMLDivElement | null = null,
    marks: ViewerMark[] = [],
    dotTexture: CanvasTexture | null = null;
  let lengthFormat = (mm: number) => `${mm.toFixed(2)} mm`;
  const projected = new Vector3();
  const placeMarks = () => {
    const width = host.clientWidth,
      height = host.clientHeight;
    const viewCamera = activeCamera();
    for (const mark of marks) {
      projected.copy(mark.position).applyMatrix4(orientationRoot.matrixWorld).project(viewCamera);
      mark.element.hidden = projected.z < -1 || projected.z > 1;
      const x = ((projected.x + 1) / 2) * width,
        y = ((1 - projected.y) / 2) * height;
      mark.element.style.transform = `translate(${x}px, ${y}px)${mark.kind === "label" ? " translate(-50%, -50%)" : ""}`;
    }
  };
  const addMark = (
    kind: ViewerMark["kind"],
    text: string,
    position: Vector3,
    options?: { status?: string; lengthMm?: number; prefix?: string },
  ) => {
    if (!marksLayer) {
      marksLayer = document.createElement("div");
      marksLayer.className = styles["model-marks"]!;
      host.append(marksLayer);
    }
    const element = document.createElement("div");
    element.className = styles[kind === "label" ? "model-mark-label" : "model-mark-pin"]!;
    if (kind === "pin") {
      const body = document.createElement("span");
      body.dataset.status = options?.status;
      body.append(Object.assign(document.createElement("span"), { textContent: text }));
      element.append(body);
    } else element.textContent = text;
    marksLayer.append(element);
    marks.push({
      kind,
      text,
      position,
      element,
      lengthMm: options?.lengthMm ?? null,
      prefix: options?.prefix ?? "",
    });
  };
  const dot = (point: ModelPoint) => {
    if (!dotTexture) {
      const bitmap = document.createElement("canvas");
      bitmap.width = bitmap.height = 64;
      const context = bitmap.getContext("2d");
      if (context) {
        context.arc(32, 32, 24, 0, Math.PI * 2);
        context.fillStyle = "#fff";
        context.fill();
        context.lineWidth = 9;
        context.strokeStyle = "rgba(0, 0, 0, 0.5)";
        context.stroke();
      }
      dotTexture = new CanvasTexture(bitmap);
    }
    const marker = new Sprite(
      new SpriteMaterial({
        map: dotTexture,
        color: MARK_BLUE,
        depthTest: false,
        sizeAttenuation: false,
      }),
    );
    marker.scale.setScalar(markerScale(projection, camera.position.distanceTo(controls.target)));
    marker.position.fromArray(point);
    marker.renderOrder = 10;
    overlay.add(marker);
  };
  const drawOverlay = (
    measurements: readonly ModelMeasurement[],
    annotations: readonly OverlayAnnotation[],
    pendingPoint: ModelPoint | null,
  ) => {
    clearOverlay();
    for (const measurement of measurements)
      if (measurement.visible) {
        if (measurement.kind === "circle" && measurement.circle) {
          const circle = measurement.circle,
            center = new Vector3(...circle.center),
            normal = new Vector3(...circle.normal).normalize();
          const x = new Vector3(
              Math.abs(normal.x) < 0.9 ? 1 : 0,
              Math.abs(normal.x) < 0.9 ? 0 : 1,
              0,
            )
              .projectOnPlane(normal)
              .normalize(),
            y = normal.clone().cross(x);
          const points = Array.from({ length: 64 }, (_, i) =>
            center
              .clone()
              .addScaledVector(x, (Math.cos((i * Math.PI) / 32) * circle.diameter) / 2)
              .addScaledVector(y, (Math.sin((i * Math.PI) / 32) * circle.diameter) / 2),
          );
          const line = new LineLoop(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: MARK_BLUE, depthTest: false }),
          );
          line.renderOrder = 9;
          overlay.add(line);
          dot(circle.center);
          addMark("label", `Ø${lengthFormat(circle.diameter)}`, center, {
            lengthMm: circle.diameter,
            prefix: "Ø",
          });
          continue;
        }
        const start = new Vector3(...measurement.start),
          end = new Vector3(...measurement.end);
        const line = new Line(
          new BufferGeometry().setFromPoints([start, end]),
          new LineBasicMaterial({ color: MARK_BLUE, depthTest: false }),
        );
        line.renderOrder = 9;
        overlay.add(line);
        dot(measurement.start);
        dot(measurement.end);
        const lengthMm = start.distanceTo(end);
        addMark("label", lengthFormat(lengthMm), start.clone().lerp(end, 0.5), { lengthMm });
      }
    for (const [index, annotation] of annotations.entries()) {
      const points = annotation.points.map((p) => new Vector3(...p));
      if (points.length > 1) {
        const line = new Line(
          new BufferGeometry().setFromPoints(points),
          new LineBasicMaterial({ color: 0xf3ab48, depthTest: false }),
        );
        line.renderOrder = 9;
        overlay.add(line);
      }
      addMark("pin", String(annotation.number ?? index + 1), points[0]!, {
        status: annotation.status,
      });
    }
    if (pendingPoint) dot(pendingPoint);
    requestRender();
  };
  // Paints the current marks over a captured frame of the given size, using their live styles.
  const paintMarks = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    const scale = 1.25;
    const viewCamera = activeCamera();
    for (const mark of marks) {
      projected.copy(mark.position).applyMatrix4(orientationRoot.matrixWorld).project(viewCamera);
      if (projected.z < -1 || projected.z > 1) continue;
      const px = x + ((projected.x + 1) / 2) * width,
        py = y + ((1 - projected.y) / 2) * height;
      const surface = mark.kind === "pin" ? mark.element.firstElementChild! : mark.element;
      const style = getComputedStyle(surface);
      context.save();
      context.translate(px, py);
      context.scale(scale, scale);
      context.textAlign = "center";
      context.textBaseline = "middle";
      if (mark.kind === "label") {
        context.font = `600 11.5px ${style.fontFamily}`;
        const w = context.measureText(mark.text).width + 14;
        context.beginPath();
        context.roundRect(-w / 2, -10, w, 20, 6);
        context.fillStyle = style.backgroundColor;
        context.fill();
        context.strokeStyle = style.borderTopColor;
        context.stroke();
        context.fillStyle = style.color;
        context.fillText(mark.text, 0, 0.5);
      } else {
        // Teardrop: a round head 16px above the point, tapering to it.
        context.beginPath();
        context.arc(0, -16, 11, Math.PI * 0.75, Math.PI * 2.25);
        context.lineTo(0, 0);
        context.closePath();
        context.fillStyle = style.backgroundColor;
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = "rgba(255, 255, 255, 0.9)";
        context.stroke();
        context.font = `700 10.5px ${style.fontFamily}`;
        context.fillStyle = "#fff";
        context.fillText(mark.text, 0, -15.5);
      }
      context.restore();
    }
  };
  const helpers = new Group(),
    ghosts = new Group();
  ghosts.name = "model-ghosts";
  scene.add(helpers, ghosts);
  const comparisonRoot = new Group();
  orientationRoot.add(comparisonRoot);
  const layerPaths = createLayers(() => requestRender());
  scene.add(layerPaths.object);
  let layerData: LayerData | null = null,
    selectedLayer = 0;
  let comparison: ReturnType<typeof createGhost> | null = null;
  let keep = false,
    previous: ReturnType<typeof createGhost> | null = null,
    previousShown = false,
    previousAvailable = false,
    modelTriangles = 0;
  let model: Object3D | null = null,
    currentStats: ReturnType<typeof meshStats> | null = null,
    box = new Box3(),
    bed: ReturnType<typeof createBed> | null = null,
    axes: AxesHelper | null = null,
    sceneRadius = 1,
    reference: ReturnType<typeof createReference> = null,
    referenceKind: ScaleReference = "none",
    overhangPositions: Float32Array | null = null,
    unsupportedMaterials = false;
  const placeLayers = () => {
    if (layerData && model && layerPaths.object.geometry.boundingBox) {
      const center = box.getCenter(new Vector3()),
        pathCenter = layerPaths.object.geometry.boundingBox.getCenter(new Vector3());
      layerPaths.object.position.set(center.x - pathCenter.x, center.y - pathCenter.y, box.min.z);
    }
  };
  const updateSceneRadius = () => {
    const bounds = box.clone();
    if (bed) bounds.union(new Box3().setFromObject(bed.object));
    if (reference?.object.visible) bounds.union(new Box3().setFromObject(reference.object));
    sceneRadius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.5);
  };
  const scaleMarkers = () => {
    const scale = markerScale(projection, camera.position.distanceTo(controls.target));
    for (const object of overlay.children)
      if (object instanceof Sprite) object.scale.setScalar(scale);
  };
  const activeCamera = () => {
    camera.updateMatrixWorld(true);
    if (projection === "perspective") return camera;
    syncOrthographic(ortho, camera, controls.target, sceneRadius);
    return ortho;
  };
  let frame: number | null = null,
    disposed = false,
    visible = true,
    gridVisible = true,
    dark = false,
    axesVisible = false,
    wireframe = false,
    overhangs = false,
    navigationMode: NavigationMode = "orbit";
  let onNavigate: (() => void) | null = null;
  const navigationStarted = () => {
    pointerLeave();
    onNavigate?.();
  };
  controls.addEventListener("start", navigationStarted);
  const setNavigationMode = (mode: NavigationMode) => {
    navigationMode = mode;
    controls.mouseButtons.LEFT = mode === "pan" ? MOUSE.PAN : MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = mode === "pan" ? MOUSE.ROTATE : MOUSE.PAN;
    controls.touches.ONE = mode === "pan" ? TOUCH.PAN : TOUCH.ROTATE;
    renderer.domElement.style.cursor = pickMode ? "crosshair" : mode === "pan" ? "move" : "grab";
  };
  const orientedStats = (refresh = false) => {
    if (!model) return null;
    if (!refresh && currentStats) return currentStats;
    const stats = meshStats(model);
    stats.box = new Box3().setFromObject(model, true);
    stats.size = stats.box.getSize(new Vector3()).toArray();
    currentStats = stats;
    return stats;
  };
  const applyOrientationRoot = () => {
    const center = authoredBox.getCenter(new Vector3());
    orientationRoot.quaternion.fromArray(normalizeQuaternion(orientation ?? [0, 0, 0, 1]));
    orientationRoot.position
      .copy(center)
      .sub(center.clone().applyQuaternion(orientationRoot.quaternion));
    orientationRoot.updateWorldMatrix(true, true);
  };
  let findingMarks: { finding: PrintFinding; number: number; element: HTMLButtonElement }[] = [],
    findingLayer: HTMLDivElement | null = null;
  const clearFindings = () => {
    findingLayer?.remove();
    findingLayer = null;
    findingMarks = [];
  };
  const placeFindings = () => {
    const viewCamera = activeCamera();
    for (const { finding, element } of findingMarks) {
      const point = modelToWorld(finding.location!.point);
      const clipped = section.enabled && plane.distanceToPoint(point) < 0;
      point.project(viewCamera);
      element.hidden = clipped || point.z < -1 || point.z > 1;
      element.style.transform = `translate(${((point.x + 1) * host.clientWidth) / 2}px, ${((1 - point.y) * host.clientHeight) / 2}px) translate(-50%, -50%)`;
    }
  };
  const paintFindings = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    const viewCamera = activeCamera();
    for (const { finding, number } of findingMarks) {
      const point = modelToWorld(finding.location!.point);
      if (section.enabled && plane.distanceToPoint(point) < 0) continue;
      point.project(viewCamera);
      if (point.z < -1 || point.z > 1) continue;
      const px = x + ((point.x + 1) * width) / 2,
        py = y + ((1 - point.y) * height) / 2;
      context.save();
      context.fillStyle =
        finding.severity === "fail"
          ? "#b42318"
          : finding.severity === "warn"
            ? "#a15c12"
            : "#31598b";
      context.beginPath();
      context.roundRect(px - 11, py - 11, 22, 22, 4);
      context.fill();
      context.strokeStyle = "white";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = "white";
      context.font = "700 12px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(number), px, py);
      context.restore();
    }
  };
  const render = () => {
    if (disposed || !visible) return;
    snapOverlay.hide();
    scaleMarkers();
    renderer.render(scene, activeCamera());
    placeMarks();
    placeFindings();
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
  // Resizing clears the canvas, so paint again before the browser does, not on the next frame.
  const resize = () => {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const stopObserving = observeResize(host, resize);
  resize();
  const theme = () => {
    dark = document.documentElement.classList.contains("dark");
    scene.background = new Color(dark ? 0x151920 : 0xf1f3f5);
    bed?.setTheme(dark);
    shading.setTheme(dark);
    previous?.setTheme(dark);
    comparison?.setTheme(dark);
    updateCaps();
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
  const applyWireframe = () => {
    pointerLeave();
    updateCaps();
    shading.setEnabled(overhangs && !wireframe);
    model?.traverse((object) => {
      if (object instanceof Mesh)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          if ("wireframe" in material) material.wireframe = wireframe;
    });
  };
  /** Draws a width × depth bed in mm with the chosen pattern, replacing the current one. */
  const setBed = (
    footprint: readonly [number, number],
    pattern: BuildPlatePattern,
    strips: readonly ZoneRect[] = [],
    shape: "rectangle" | "round" = "rectangle",
  ) => {
    if (bed) {
      helpers.remove(bed.object);
      bed.dispose();
    }
    if (axes) {
      helpers.remove(axes);
      axes.geometry.dispose();
      for (const material of Array.isArray(axes.material) ? axes.material : [axes.material])
        material.dispose();
    }
    bed = createBed(footprint[0], footprint[1], pattern, shape);
    if (strips.length) {
      const zones = createZoneStrips(footprint, strips);
      bed.object.add(zones.object);
      const setTheme = bed.setTheme,
        dispose = bed.dispose;
      bed.setTheme = (dark) => {
        setTheme(dark);
        zones.setTheme(dark);
      };
      bed.dispose = () => {
        dispose();
        zones.dispose();
      };
    }
    bed.setTheme(dark);
    bed.object.visible = gridVisible;
    placeBed();
    updateSceneRadius();
    helpers.add(bed.object);
    axes = new AxesHelper(Math.min(...footprint) / 4);
    axes.visible = axesVisible;
    helpers.add(axes);
    requestRender();
  };
  // Like a slicer bed, the plate sits under the model's footprint centre at its lowest point.
  // The model keeps its own coordinates, so measurements, annotations and sections stay valid.
  const placeReferenceObject = () => {
    if (!reference) return;
    reference.object.visible = model !== null;
    if (model) reference.object.position.copy(placeReference(box, reference.size));
  };
  const placeBed = () => {
    if (bed) {
      if (!model) bed.object.position.set(0, 0, 0);
      else {
        const center = box.getCenter(new Vector3());
        bed.object.position.set(center.x, center.y, box.min.z);
      }
    }
    placeReferenceObject();
  };
  const clearPrevious = () => {
    previous?.set(null);
    previousAvailable = false;
  };
  const snapshot = (): ModelCamera => ({
    projection,
    overhangs,
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
  const snapAtPoint = async (point: ModelPoint, radiusMm = 1) => {
    await prepareSnapping();
    let best: Snap | null = null,
      distance = Infinity;
    for (const [mesh, topology] of topologies) {
      if (!shownIn(mesh, model)) continue;
      const snap = snapNearPoint(topology, modelToWorld(point).toArray(), radiusMm);
      if (
        snap.kind === "face" ||
        (section.enabled && plane.distanceToPoint(new Vector3(...snap.point)) < 0)
      )
        continue;
      const d = new Vector3(...snap.point).distanceTo(modelToWorld(point));
      if (
        !best ||
        (snap.kind === "vertex" && best.kind !== "vertex") ||
        (snap.kind === best.kind && d < distance)
      ) {
        best = snap;
        distance = d;
      }
    }
    return {
      point: best ? worldToModel(new Vector3(...best.point)) : point,
      kind: best?.kind ?? ("free" as const),
    };
  };
  return {
    nudge(n: Nudge) {
      if (!model) return;
      if (n.kind === "orbit") {
        controls.rotateLeft(n.left);
        controls.rotateUp(n.up);
      } else {
        const height = renderer.domElement.clientHeight;
        controls.pan(n.x * height, n.y * height);
      }
      navigationStarted();
    },
    owns(target: EventTarget | null) {
      return target === renderer.domElement;
    },
    describe(name: string, descriptionId: string) {
      renderer.domElement.setAttribute("aria-label", `${name}, 3D viewport`);
      renderer.domElement.setAttribute("aria-describedby", descriptionId);
    },
    snapshot,
    activeCamera,
    setOrientation(next: ModelQuaternion | null) {
      const normalized = next && normalizeQuaternion(next);
      const unchanged = normalized
        ? orientation?.every((value, index) => value === normalized[index])
        : orientation === null;
      orientation = normalized;
      if (!model) {
        applyOrientationRoot();
        return null;
      }
      if (unchanged) return orientedStats();
      pointerLeave();
      resetSnapping();
      circleCache = null;
      applyOrientationRoot();
      const stats = orientedStats(true)!;
      box = stats.box;
      overhangPositions = null;
      shading.setBedZ(box.min.z);
      caps.syncTransforms();
      sectionGeometry = null;
      if (section.enabled) {
        section = { ...section, offset: box.getCenter(new Vector3())[section.axis] };
        applySection();
      }
      updateCaps();
      placeBed();
      updateSceneRadius();
      const direction = camera.position.clone().sub(controls.target).normalize(),
        center = box.getCenter(new Vector3()),
        distance = fitDistance(box, camera.fov, camera.aspect);
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = Math.max(distance / 10000, 0.01);
      camera.far = Math.max(distance * 100, 10000);
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
      if (pickMode === "measure") void prepareSnapping();
      return stats;
    },
    authoredCentre() {
      return authoredBox.getCenter(new Vector3());
    },
    orientedMinZ() {
      return box.min.z;
    },
    faceOrientationAt(point: ModelPoint) {
      const index = prepareOrientation(),
        region = index?.atPoint(point);
      return region && index ? index.orientationFor(region, orientation) : null;
    },
    autoOrientation() {
      return prepareOrientation()?.auto() ?? null;
    },
    wallThicknessAt(point: ModelPoint): ModelWall | null {
      if (!caps.visible()) return null;
      const projectedPoint = plane.projectPoint(modelToWorld(point), new Vector3()),
        wall = wallAt(getSectionGeometry(), projectedPoint);
      return wall
        ? {
            thicknessMm: wall.thicknessMm,
            start: worldToModel(new Vector3(...wall.start)),
            end: worldToModel(new Vector3(...wall.end)),
          }
        : null;
    },
    setClosedHint(manifold: boolean | null) {
      if (closedHint === manifold) return;
      closedHint = manifold;
      caps.setModel(model, (mesh) => closedHint === true || closedMeshGeometry(mesh.geometry));
      sectionGeometry = null;
      hideWall();
      updateCaps();
      requestRender();
    },
    sectionCapsStatus: caps.state,
    onSectionCapsStatus: caps.onState,
    onWallMeasure(callback: typeof onWall) {
      onWall = callback;
    },
    setFindings(
      findings: readonly PrintFinding[],
      selectedId: string | null,
      onSelect: ((finding: PrintFinding) => void) | null,
    ) {
      clearFindings();
      if (!findings.some((finding) => finding.location)) return;
      findingLayer = document.createElement("div");
      findingLayer.className = styles["model-marks"]!;
      host.append(findingLayer);
      for (const [index, finding] of findings.entries()) {
        if (!finding.location) continue;
        const element = document.createElement("button");
        element.type = "button";
        element.className = styles["model-finding-pin"]!;
        element.dataset.severity = finding.severity;
        element.dataset.selected = String(finding.id === selectedId);
        element.textContent = String(index + 1);
        element.title = finding.message;
        element.setAttribute("aria-label", `${index + 1}: ${finding.message}`);
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelect?.(finding);
        });
        findingLayer.append(element);
        findingMarks.push({ finding, number: index + 1, element });
      }
      placeFindings();
      requestRender();
    },
    setAssemblyPins(
      regions: readonly AssemblyRegion[],
      closest: { a: ModelPoint; b: ModelPoint } | null,
      measurements: readonly ModelMeasurement[] = [],
      annotations: readonly OverlayAnnotation[] = [],
      pendingPoint: ModelPoint | null = null,
    ) {
      drawOverlay(
        [
          ...measurements,
          ...(closest
            ? [
                {
                  id: "assembly-clearance",
                  name: "Clearance",
                  sourceRevision: "",
                  kind: "distance" as const,
                  visible: true,
                  start: closest.a,
                  end: closest.b,
                },
              ]
            : []),
        ],
        annotations,
        pendingPoint,
      );
      for (const [index, region] of regions.entries()) {
        dot(region.point);
        addMark("pin", String(index + 1), new Vector3(...region.point), { status: "open" });
      }
      requestRender();
    },
    frameBounds(min: ModelPoint, max: ModelPoint) {
      const bounds = new Box3(new Vector3(...min), new Vector3(...max)),
        center = bounds.getCenter(new Vector3()),
        direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(center);
      camera.position
        .copy(center)
        .addScaledVector(direction, fitDistance(bounds, camera.fov, camera.aspect));
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
    },
    frameFinding(finding: PrintFinding) {
      if (!finding.location || !model) return;
      const point = modelToWorld(finding.location.point),
        normal = finding.location.normal
          ? new Vector3(...finding.location.normal)
              .applyQuaternion(orientationRoot.quaternion)
              .toArray()
          : null;
      const framing = frameFor(
        point.toArray(),
        normal,
        finding.location.radiusMm,
        camera,
        controls.target,
      );
      camera.position.copy(framing.position);
      controls.target.copy(framing.target);
      camera.updateProjectionMatrix();
      controls.update();
      navigationStarted();
      requestRender();
    },
    keepPrevious(enabled: boolean) {
      keep = enabled;
      if (!enabled) clearPrevious();
    },
    showPrevious(value: boolean) {
      previousShown = value;
      previous?.setVisible(value);
      requestRender();
    },
    clearPrevious,
    hasPrevious() {
      return previousAvailable;
    },
    overhangInput() {
      if (!model) return null;
      if (overhangPositions) return overhangPositions;
      model.updateMatrixWorld(true);
      const meshes: { mesh: Mesh; vertices: number; instances: number }[] = [];
      let vertices = 0;
      model.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        if (!positions) return;
        const count = Math.floor((object.geometry.index?.count ?? positions.count) / 3) * 3;
        const instances = object instanceof InstancedMesh ? object.count : 1;
        meshes.push({ mesh: object, vertices: count, instances });
        vertices += count * instances;
      });
      overhangPositions = new Float32Array(vertices * 3);
      const vertex = new Vector3(),
        instance = new Matrix4(),
        matrix = new Matrix4();
      let offset = 0;
      for (const { mesh, vertices, instances } of meshes) {
        for (let instanceIndex = 0; instanceIndex < instances; instanceIndex++) {
          matrix.copy(mesh.matrixWorld);
          if (mesh instanceof InstancedMesh) {
            mesh.getMatrixAt(instanceIndex, instance);
            matrix.multiply(instance);
          }
          // Mirrored nodes reverse winding; Three flips front faces to keep the exterior outward.
          const mirrored = matrix.determinant() < 0;
          for (let index = 0; index < vertices; index++) {
            const corner = index % 3;
            const sourceIndex = mirrored && corner !== 0 ? index + (corner === 1 ? 1 : -1) : index;
            mesh.getVertexPosition(mesh.geometry.index?.getX(sourceIndex) ?? sourceIndex, vertex);
            vertex.applyMatrix4(matrix).toArray(overhangPositions, offset);
            offset += 3;
          }
        }
      }
      return overhangPositions;
    },
    unsupportedOverhangMaterials() {
      return unsupportedMaterials;
    },
    setOverhangs(value: boolean) {
      overhangs = value;
      shading.setEnabled(value && !wireframe);
      requestRender();
    },
    setOverhangAngle(degrees: number) {
      shading.setAngle(degrees);
      requestRender();
    },
    setProjection(value: ModelProjection) {
      projection = value;
      scaleMarkers();
      requestRender();
    },
    setPickMode(
      mode: typeof pickMode,
      callback: typeof onPick,
      circleCallback: typeof onCircle = null,
    ) {
      pointerCancel();
      pickMode = mode;
      onPick = callback;
      onCircle = circleCallback;
      pointerLeave();
      if (mode === "measure") void prepareSnapping();
      controls.enabled = mode === null;
      renderer.domElement.style.cursor = mode
        ? "crosshair"
        : navigationMode === "pan"
          ? "move"
          : "grab";
    },
    setMeasureMode(mode: "distance" | "hole") {
      measureMode = mode;
      circleCache = null;
      pointerLeave();
    },
    snapStatus() {
      return snapState;
    },
    onSnapStatus(callback: typeof snapChanged) {
      snapChanged = callback;
      callback?.(snapState);
    },
    async snapPoint(point: ModelPoint, radiusMm = 1): Promise<ModelPoint> {
      return (await snapAtPoint(point, radiusMm)).point;
    },
    snapPointDetailed: snapAtPoint,
    invalidate() {
      caps.syncTransforms();
      updateCaps();
      requestRender();
    },
    async circleNear(point: ModelPoint, radiusMm = 1): Promise<CircleFit | null> {
      await prepareSnapping();
      let fit: CircleFit | null = null,
        nearest = radiusMm;
      const target = modelToWorld(point),
        closest = new Vector3(),
        triangle = new Triangle();
      for (const topology of topologies.values()) {
        let seed = -1,
          distance = radiusMm;
        for (let t = 0; t < topology.region.length; t++) {
          triangle.set(
            ...([0, 1, 2].map(
              (c) => new Vector3(...topologyPoint(topology, topology.corners[t * 3 + c]!)),
            ) as [Vector3, Vector3, Vector3]),
          );
          triangle.closestPointToPoint(target, closest);
          const d = closest.distanceTo(target);
          if (d <= distance) {
            seed = t;
            distance = d;
          }
        }
        if (seed < 0) continue;
        const snap = snapNearPoint(topology, [...point], radiusMm),
          candidate = circleAt(topology, seed, target.toArray(), snap.edge);
        if (
          !candidate ||
          candidate.loop.some(
            (p) => section.enabled && plane.distanceToPoint(new Vector3(...p)) < 0,
          )
        )
          continue;
        let rimDistance = Infinity;
        for (let i = 0; i < candidate.loop.length; i++) {
          const a = new Vector3(...candidate.loop[i]!),
            b = new Vector3(...candidate.loop[(i + 1) % candidate.loop.length]!),
            delta = b.sub(a);
          const along = Math.max(
            0,
            Math.min(1, target.clone().sub(a).dot(delta) / delta.lengthSq()),
          );
          rimDistance = Math.min(rimDistance, a.addScaledVector(delta, along).distanceTo(target));
        }
        if (rimDistance <= nearest) {
          fit = candidate;
          nearest = rimDistance;
        }
      }
      return circleToModel(fit);
    },
    onCameraChange(callback: typeof onCamera) {
      onCamera = callback;
    },
    setSection(next: ModelSection) {
      section = next;
      circleCache = null;
      pointerLeave();
      applySection();
      requestRender();
    },
    setOverlays: drawOverlay,
    setLengthFormat(format: (mm: number) => string) {
      lengthFormat = format;
      for (const mark of marks)
        if (mark.lengthMm !== null) {
          mark.text = mark.prefix + format(mark.lengthMm);
          mark.element.textContent = mark.text;
        }
      requestRender();
    },
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
      projection = state.projection;
      overhangs = state.overhangs;
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
      if (bed) bed.object.visible = gridVisible;
      if (axes) axes.visible = axesVisible;
      camera.updateProjectionMatrix();
      controls.update();
      restoring = false;
      requestRender();
    },
    onObjectPick(callback: ((object: Object3D | null) => void) | null) {
      onObjectPick = callback;
    },
    setLayers(data: LayerData | null) {
      layerData = data;
      layerPaths.set(data);
      layerPaths.showThrough(selectedLayer);
      if (model) model.visible = data === null;
      placeLayers();
      requestRender();
    },
    showLayersThrough(index: number) {
      selectedLayer = index;
      layerPaths.showThrough(index);
    },
    setCompareModel(next: Object3D | null) {
      comparison ??= createGhost(comparisonRoot, requestRender);
      comparison.setTheme(dark);
      if (next) {
        const clone = next.clone(true);
        clone.traverse((node) => {
          if (node instanceof Mesh || node instanceof Line || node instanceof Points) {
            node.geometry = node.geometry.clone();
            node.material = new MeshBasicMaterial();
          }
        });
        comparison.set(clone);
      } else comparison.set(null);
      comparison.setVisible(next !== null);
      comparison.setClipping(section.enabled ? [plane] : []);
    },
    refreshModel() {
      if (!model) return null;
      currentStats = null;
      authoredBox = new Box3().setFromObject(model, true);
      orientationIndex = null;
      resetSnapping();
      applyOrientationRoot();
      const stats = orientedStats(true)!;
      box = stats.box;
      modelTriangles = stats.triangles;
      overhangPositions = null;
      shading.setBedZ(box.min.z);
      sectionGeometry = null;
      caps.setModel(model, (mesh) => closedHint === true || closedMeshGeometry(mesh.geometry));
      applyWireframe();
      applySection();
      placeBed();
      updateSceneRadius();
      requestRender();
      return stats;
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
        model.updateWorldMatrix(true, true);
        const world = model.matrixWorld.clone();
        orientationRoot.remove(model);
        model.matrix.copy(world);
        model.matrix.decompose(model.position, model.quaternion, model.scale);
        if (keep && modelTriangles <= GHOST_TRIANGLE_LIMIT) {
          previous ??= createGhost(ghosts, requestRender);
          previous.setTheme(dark);
          previous.set(model);
          previous.setVisible(previousShown);
          previousAvailable = true;
        } else {
          disposeModel(model);
          clearPrevious();
        }
      }
      caps.setModel(null);
      resetSnapping();
      circleCache = null;
      clearFaceHighlight();
      orientationIndex = null;
      sectionGeometry = null;
      model = next;
      model.visible = layerData === null;
      currentStats = null;
      authoredBox = new Box3().setFromObject(next, true);
      orientationRoot.add(model);
      applyOrientationRoot();
      modelTriangles = stats.triangles;
      box = orientedStats()!.box;
      placeLayers();
      overhangPositions = null;
      unsupportedMaterials = false;
      shading.setBedZ(box.min.z);
      model.traverse((object) => {
        if (object instanceof Mesh)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (!shading.patch(material)) unsupportedMaterials = true;
      });
      placeBed();
      updateSceneRadius();
      caps.setModel(model, (mesh) => closedHint === true || closedMeshGeometry(mesh.geometry));
      applyWireframe();
      applySection();
      if (!keepCamera) setView("iso");
      requestRender();
      if (pickMode === "measure") void prepareSnapping();
      return orientedStats()!;
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
    setBed,
    setReference(kind: ScaleReference) {
      if (kind === referenceKind) return;
      if (reference) {
        helpers.remove(reference.object);
        reference.dispose();
      }
      referenceKind = kind;
      reference = createReference(kind);
      if (reference) {
        helpers.add(reference.object);
        placeReferenceObject();
      }
      updateSceneRadius();
      requestRender();
    },
    setWireframe(value: boolean) {
      wireframe = value;
      applyWireframe();
      requestRender();
    },
    setGrid(value: boolean) {
      gridVisible = value;
      if (bed) bed.object.visible = value;
      requestRender();
    },
    setAxes(value: boolean) {
      axesVisible = value;
      if (axes) axes.visible = value;
      requestRender();
    },
    setVisible(value: boolean) {
      visible = value;
      if (visible) resize();
    },
    async capture(four: boolean): Promise<Blob> {
      if (!model) throw new Error("Load a model before capturing it.");
      const size = renderer.getSize(new Vector2()),
        pixelRatio = renderer.getPixelRatio();
      const position = camera.position.clone(),
        target = controls.target.clone(),
        aspect = camera.aspect,
        near = camera.near,
        far = camera.far,
        originalProjection = projection,
        wasRestoring = restoring;
      const output = document.createElement("canvas");
      output.width = four ? 1600 : 1200;
      output.height = four ? 1200 : Math.max(1, Math.round(1200 / aspect));
      const context = output.getContext("2d");
      if (!context) throw new Error("Image capture is unavailable.");
      const controlsEnabled = controls.enabled;
      controls.enabled = false;
      restoring = true;
      try {
        if (four) projection = "orthographic";
        renderer.setPixelRatio(1);
        shading.setPixelRatio(1);
        caps.update({
          enabled: section.enabled,
          caps: section.caps,
          wireframe,
          box,
          dark,
          pixelRatio: 1,
        });
        renderer.setSize(four ? 800 : 1200, four ? 600 : output.height, false);
        camera.aspect = four ? 4 / 3 : aspect;
        camera.updateProjectionMatrix();
        for (const [index, view] of (four ? STANDARD_VIEWS : [null]).entries()) {
          if (view) setView(view);
          scaleMarkers();
          renderer.render(scene, activeCamera());
          const x = four ? (index % 2) * 800 : 0,
            y = four ? Math.floor(index / 2) * 600 : 0;
          context.drawImage(renderer.domElement, x, y);
          paintMarks(context, x, y, four ? 800 : 1200, four ? 600 : output.height);
          paintFindings(context, x, y, four ? 800 : 1200, four ? 600 : output.height);
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
        projection = originalProjection;
        controls.enabled = controlsEnabled;
        camera.position.copy(position);
        controls.target.copy(target);
        camera.aspect = aspect;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(pixelRatio);
        shading.setPixelRatio(pixelRatio);
        caps.update({
          enabled: section.enabled,
          caps: section.caps,
          wireframe,
          box,
          dark,
          pixelRatio,
        });
        renderer.setSize(size.x, size.y, false);
        controls.update();
        restoring = wasRestoring;
        scaleMarkers();
        requestRender();
      }
    },
    dispose() {
      disposed = true;
      resetSnapping();
      snapChanged = null;
      snapOverlay.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
      stopObserving();
      themeObserver.disconnect();
      controls.removeEventListener("change", controlsChanged);
      clearOverlay();
      marksLayer?.remove();
      dotTexture?.dispose();
      onCamera = null;
      onPick = null;
      onCircle = null;
      controls.removeEventListener("start", navigationStarted);
      onNavigate = null;
      renderer.domElement.removeEventListener("dblclick", doubleClick);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      renderer.domElement.removeEventListener("mousedown", preventAutoscroll);
      controls.dispose();
      caps.dispose();
      clearFaceHighlight();
      clearFindings();
      wallLayer?.remove();
      onWall = null;
      orientationIndex = null;
      if (model) disposeModel(model);
      previous?.dispose();
      comparison?.dispose();
      layerPaths.dispose();
      previousAvailable = false;
      overhangPositions = null;
      bed?.dispose();
      reference?.dispose();
      if (axes) {
        axes.geometry.dispose();
        for (const material of Array.isArray(axes.material) ? axes.material : [axes.material])
          material.dispose();
      }
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
export type ModelViewer = ReturnType<typeof createViewer>;
