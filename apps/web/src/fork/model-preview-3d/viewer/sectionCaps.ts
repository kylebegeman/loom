import {
  AlwaysStencilFunc,
  BackSide,
  Box3,
  BufferGeometry,
  Color,
  DecrementWrapStencilOp,
  DoubleSide,
  FrontSide,
  Group,
  IncrementWrapStencilOp,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  Object3D,
  Plane,
  PlaneGeometry,
  ReplaceStencilOp,
  Scene,
  type StencilOp,
  Vector3,
} from "three";
import { weld } from "./weld";

export type SectionCapState = "none" | "off" | "checking" | "filled" | "partial" | "open-mesh";
type Point2 = readonly [number, number];
type Point3 = [number, number, number];
export type SectionWall = { thicknessMm: number; start: Point3; end: Point3 };
const closedCache = new WeakMap<BufferGeometry, boolean>();

/** Uses the same welded corners as feature snapping, and refuses holes or inconsistent winding. */
export function closedMesh(geometry: BufferGeometry): boolean {
  const cached = closedCache.get(geometry);
  if (cached !== undefined) return cached;
  let closed = false;
  try {
    if (!geometry.getAttribute("position")) return false;
    const welded = weld(geometry),
      first = Math.max(0, geometry.drawRange.start),
      last = Math.min(welded.corners.length, first + geometry.drawRange.count),
      corners = welded.corners.subarray(first, last),
      positions = welded.positions,
      count = positions.length / 3;
    if (first % 3 || corners.length % 3) return false;
    if (!corners.length || count * count * 2 > Number.MAX_SAFE_INTEGER) return false;
    const edges = new Float64Array(corners.length);
    for (let i = 0; i < corners.length; i += 3) {
      const a = corners[i]!,
        b = corners[i + 1]!,
        c = corners[i + 2]!;
      if (a === b || b === c || c === a) return false;
      for (let j = 0; j < 3; j++) {
        const from = corners[i + j]!,
          to = corners[i + ((j + 1) % 3)]!;
        edges[i + j] = (Math.min(from, to) * count + Math.max(from, to)) * 2 + (from > to ? 1 : 0);
      }
    }
    edges.sort();
    closed = true;
    for (let i = 0; i < edges.length; i += 2) {
      if (edges[i]! % 2 || edges[i + 1] !== edges[i]! + 1 || edges[i + 2] === edges[i + 1]) {
        closed = false;
        break;
      }
    }
    return closed;
  } catch {
    return false;
  } finally {
    closedCache.set(geometry, closed);
  }
}

const visibleMesh = (mesh: Object3D) => {
  for (let node: Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false;
  return true;
};

/** Helpers remain outside the model: its statistics, materials, picks and ownership stay intact. */
export function createSectionCaps(scene: Scene, plane: Plane) {
  const group = new Group();
  group.name = "section-caps";
  group.visible = false;
  scene.add(group);
  const stencilMaterial = (side: typeof BackSide | typeof FrontSide, operation: StencilOp) =>
    new MeshBasicMaterial({
      side,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilFunc: AlwaysStencilFunc,
      stencilFail: operation,
      stencilZFail: operation,
      stencilZPass: operation,
      clippingPlanes: [plane],
    });
  const backMaterial = stencilMaterial(BackSide, IncrementWrapStencilOp),
    frontMaterial = stencilMaterial(FrontSide, DecrementWrapStencilOp),
    stripe = { value: new Color(0x95a3b6) },
    hatch = { value: 6 },
    capMaterial = new MeshBasicMaterial({
      color: 0x7f8ea3,
      side: DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: NotEqualStencilFunc,
      stencilFail: ReplaceStencilOp,
      stencilZFail: ReplaceStencilOp,
      stencilZPass: ReplaceStencilOp,
    });
  capMaterial.customProgramCacheKey = () => "loom-section-cap-v1";
  capMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.loomSectionStripe = stripe;
    shader.uniforms.loomSectionHatch = hatch;
    shader.fragmentShader =
      "uniform vec3 loomSectionStripe;\nuniform float loomSectionHatch;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float loomSectionBand = step( 0.5, fract( ( gl_FragCoord.x - gl_FragCoord.y ) / loomSectionHatch ) );
diffuseColor.rgb = mix( diffuseColor.rgb, loomSectionStripe, loomSectionBand );`,
      );
  };
  const cap = new Mesh(new PlaneGeometry(1, 1), capMaterial);
  cap.name = "section-cap";
  cap.renderOrder = 1.1;
  cap.raycast = () => {};
  cap.onAfterRender = (renderer) => renderer.clearStencil();
  group.add(cap);
  let model: Object3D | null = null,
    check: (mesh: Mesh) => boolean = (mesh) => closedMesh(mesh.geometry),
    classified = false,
    current: SectionCapState = "none",
    changed: ((state: SectionCapState) => void) | null = null,
    lastOptions: {
      enabled: boolean;
      caps?: boolean;
      wireframe?: boolean;
      box: Box3;
      dark: boolean;
      pixelRatio?: number;
    } | null = null;
  const closed: Mesh[] = [],
    open: Mesh[] = [],
    copies: { source: Mesh; back: Mesh; front: Mesh }[] = [];
  const setState = (next: SectionCapState) => {
    if (current === next) return;
    current = next;
    changed?.(next);
  };
  const clear = () => {
    for (const { back, front } of copies) {
      group.remove(back, front);
      // Source geometry is owned and disposed by the model, never by these copies.
      if (back instanceof InstancedMesh) back.dispose();
      if (front instanceof InstancedMesh) front.dispose();
    }
    copies.length = closed.length = open.length = 0;
    classified = false;
    group.visible = false;
  };
  const syncTransforms = () => {
    model?.updateWorldMatrix(true, true);
    for (const { source, back, front } of copies) {
      back.matrixWorld.copy(source.matrixWorld);
      front.matrixWorld.copy(source.matrixWorld);
      back.visible = front.visible = visibleMesh(source);
      if (source instanceof InstancedMesh) {
        for (const copy of [back, front]) {
          if (!(copy instanceof InstancedMesh)) continue;
          copy.count = source.count;
          copy.instanceMatrix = source.instanceMatrix;
          copy.instanceColor = source.instanceColor;
        }
      }
    }
  };
  const classify = () => {
    if (classified || !model) return;
    setState("checking");
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (!check(object)) {
        open.push(object);
        return;
      }
      closed.push(object);
      const clone = (material: MeshBasicMaterial) => {
        const copy = object.clone(false);
        copy.material = material;
        copy.matrixAutoUpdate = false;
        copy.matrixWorldAutoUpdate = false;
        copy.renderOrder = 1;
        copy.frustumCulled = false;
        copy.castShadow = false;
        copy.receiveShadow = false;
        copy.raycast = () => {};
        group.add(copy);
        return copy;
      };
      copies.push({ source: object, back: clone(backMaterial), front: clone(frontMaterial) });
    });
    classified = true;
    syncTransforms();
  };
  const update = (options: NonNullable<typeof lastOptions>) => {
    lastOptions = options;
    capMaterial.color.setHex(options.dark ? 0x46566b : 0x7f8ea3);
    stripe.value.setHex(options.dark ? 0x5b6d85 : 0x95a3b6);
    hatch.value = 6 * (options.pixelRatio ?? 1);
    if (!options.enabled || !model) {
      group.visible = false;
      setState("none");
      return;
    }
    if (options.caps === false || options.wireframe) {
      group.visible = false;
      setState("off");
      return;
    }
    classify();
    syncTransforms();
    const closedVisible = closed.some(visibleMesh),
      openVisible = open.some(visibleMesh);
    group.visible = closedVisible;
    setState(closedVisible ? (openVisible ? "partial" : "filled") : "open-mesh");
    const center = plane.projectPoint(options.box.getCenter(new Vector3()), new Vector3()),
      diagonal = Math.max(options.box.getSize(new Vector3()).length(), 1e-6);
    cap.position.copy(center);
    cap.scale.set(diagonal, diagonal, 1);
    cap.lookAt(center.clone().sub(plane.normal));
    cap.updateMatrixWorld(true);
  };
  return {
    setModel(next: Object3D | null, isClosed?: (mesh: Mesh) => boolean) {
      clear();
      model = next;
      check = isClosed ?? ((mesh) => closedMesh(mesh.geometry));
      setState("none");
      if (lastOptions) update(lastOptions);
    },
    syncTransforms,
    update,
    state: () => current,
    visible: () => group.visible,
    closedMeshes: () => closed.filter(visibleMesh),
    onState(callback: typeof changed) {
      changed = callback;
      callback?.(current);
    },
    dispose() {
      clear();
      model = null;
      changed = null;
      lastOptions = null;
      scene.remove(group);
      backMaterial.dispose();
      frontMaterial.dispose();
      capMaterial.dispose();
      cap.geometry.dispose();
    },
  };
}

export type SectionGeometry = {
  /** Directed [startX, startY, endX, endY] segments; solid lies on their left. */
  segments: Float64Array;
  origin: Vector3;
  u: Vector3;
  v: Vector3;
  bounds: readonly [number, number, number, number];
  cellSize: number;
  columns: number;
  rows: number;
  cells: Map<number, number[]>;
};

const cross2 = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const projected = (section: SectionGeometry, point: Vector3): Point2 => {
  const delta = point.clone().sub(section.origin);
  return [delta.dot(section.u), delta.dot(section.v)];
};
const worldPoint = (section: SectionGeometry, x: number, y: number): Point3 =>
  section.origin.clone().addScaledVector(section.u, x).addScaledVector(section.v, y).toArray();

/** Merges only directed collinear chains; never connects an open end to make a fictitious loop. */
const mergeSegments = (segments: number[]) => {
  if (!segments.length) return segments;
  let span = 1;
  for (const value of segments) span = Math.max(span, Math.abs(value));
  const tolerance = span * 1e-9,
    key = (x: number, y: number) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`,
    incoming = new Map<string, number[]>(),
    outgoing = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, id: number) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (let id = 0; id < segments.length / 4; id++) {
    add(outgoing, key(segments[id * 4]!, segments[id * 4 + 1]!), id);
    add(incoming, key(segments[id * 4 + 2]!, segments[id * 4 + 3]!), id);
  }
  const follows = (a: number, b: number) => {
    const ax = segments[a * 4 + 2]! - segments[a * 4]!,
      ay = segments[a * 4 + 3]! - segments[a * 4 + 1]!,
      bx = segments[b * 4 + 2]! - segments[b * 4]!,
      by = segments[b * 4 + 3]! - segments[b * 4 + 1]!;
    return (
      Math.abs(cross2(ax, ay, bx, by)) <= 1e-9 * Math.hypot(ax, ay) * Math.hypot(bx, by) &&
      ax * bx + ay * by > 0
    );
  };
  const predecessor = (id: number) => {
    const node = key(segments[id * 4]!, segments[id * 4 + 1]!),
      a = incoming.get(node),
      b = outgoing.get(node);
    return a?.length === 1 && b?.length === 1 && follows(a[0]!, id) ? a[0]! : null;
  };
  const used = new Set<number>(),
    result: number[] = [];
  for (let id = 0; id < segments.length / 4; id++) {
    if (used.has(id) || predecessor(id) !== null) continue;
    let end = id;
    used.add(end);
    while (true) {
      const node = key(segments[end * 4 + 2]!, segments[end * 4 + 3]!),
        next = outgoing.get(node),
        prev = incoming.get(node);
      if (next?.length !== 1 || prev?.length !== 1 || used.has(next[0]!) || !follows(end, next[0]!))
        break;
      end = next[0]!;
      used.add(end);
    }
    result.push(
      segments[id * 4]!,
      segments[id * 4 + 1]!,
      segments[end * 4 + 2]!,
      segments[end * 4 + 3]!,
    );
  }
  return result;
};

/** Visits crossed cells, with a finite budget even for a ray exactly along a grid boundary. */
const walkGrid = (
  section: SectionGeometry,
  x: number,
  y: number,
  dx: number,
  dy: number,
  visit: (column: number, row: number) => void,
  maximum = Infinity,
) => {
  const [minX, minY, maxX, maxY] = section.bounds;
  let entry = 0,
    exit = maximum;
  for (const [position, direction, low, high] of [
    [x, dx, minX, maxX],
    [y, dy, minY, maxY],
  ]) {
    if (Math.abs(direction!) < 1e-15) {
      if (position! < low! || position! > high!) return;
    } else {
      const a = (low! - position!) / direction!,
        b = (high! - position!) / direction!;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
  }
  if (exit < entry) return;
  const size = section.cellSize,
    clampColumn = (value: number) => Math.max(0, Math.min(section.columns - 1, value)),
    clampRow = (value: number) => Math.max(0, Math.min(section.rows - 1, value));
  let column = clampColumn(Math.floor((x + dx * entry - minX) / size)),
    row = clampRow(Math.floor((y + dy * entry - minY) / size)),
    nextX = dx ? (minX + (column + (dx > 0 ? 1 : 0)) * size - x) / dx : Infinity,
    nextY = dy ? (minY + (row + (dy > 0 ? 1 : 0)) * size - y) / dy : Infinity;
  const stepX = Math.sign(dx),
    stepY = Math.sign(dy),
    deltaX = dx ? size / Math.abs(dx) : Infinity,
    deltaY = dy ? size / Math.abs(dy) : Infinity;
  for (let budget = section.columns + section.rows + 4; budget > 0; budget--) {
    if (column < 0 || column >= section.columns || row < 0 || row >= section.rows) break;
    visit(column, row);
    const next = Math.min(nextX, nextY);
    if (next > exit) break;
    if (nextX === next) {
      column += stepX;
      nextX += deltaX;
    }
    if (nextY === next) {
      row += stepY;
      nextY += deltaY;
    }
  }
};

/** World-space sections support oriented roots, mirrored nodes, instances and disjoint parts. */
export function sectionSegments(
  meshes: readonly Mesh[],
  plane: Plane,
  trustedClosed = false,
): SectionGeometry {
  const normal = plane.normal.clone().normalize(),
    origin = plane.coplanarPoint(new Vector3()),
    reference = Math.abs(normal.z) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1),
    u = reference.addScaledVector(normal, -reference.dot(normal)).normalize(),
    v = new Vector3().crossVectors(normal, u),
    values: number[] = [],
    instance = new Matrix4(),
    matrix = new Matrix4(),
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    face = new Vector3(),
    direction = new Vector3(),
    edgeA = new Vector3(),
    edgeB = new Vector3(),
    start = new Vector3(),
    end = new Vector3(),
    vertices = [a, b, c],
    distances = [0, 0, 0];
  for (const mesh of meshes) {
    if (!visibleMesh(mesh) || (!trustedClosed && !closedMesh(mesh.geometry))) continue;
    mesh.updateWorldMatrix(true, false);
    const first = mesh.geometry.drawRange.start,
      count = Math.min(
        mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count,
        first + mesh.geometry.drawRange.count,
      ),
      instances = mesh instanceof InstancedMesh ? mesh.count : 1;
    for (let i = 0; i < instances; i++) {
      matrix.copy(mesh.matrixWorld);
      if (mesh instanceof InstancedMesh) {
        mesh.getMatrixAt(i, instance);
        matrix.multiply(instance);
      }
      const mirrored = matrix.determinant() < 0,
        segments: number[] = [];
      for (let j = first; j < count; j += 3) {
        mesh.getVertexPosition(mesh.geometry.index?.getX(j) ?? j, a);
        mesh.getVertexPosition(mesh.geometry.index?.getX(j + 1) ?? j + 1, b);
        mesh.getVertexPosition(mesh.geometry.index?.getX(j + 2) ?? j + 2, c);
        a.applyMatrix4(matrix);
        b.applyMatrix4(matrix);
        c.applyMatrix4(matrix);
        const da = plane.distanceToPoint(a),
          db = plane.distanceToPoint(b),
          dc = plane.distanceToPoint(c);
        if ((da >= 0 && db >= 0 && dc >= 0) || (da < 0 && db < 0 && dc < 0)) continue;
        distances[0] = da;
        distances[1] = db;
        distances[2] = dc;
        let crossings = 0;
        for (let edge = 0; edge < 3; edge++) {
          const next = (edge + 1) % 3,
            d = distances[edge]!,
            e = distances[next]!;
          if (d >= 0 === e >= 0) continue;
          (crossings++ === 0 ? start : end)
            .copy(vertices[edge]!)
            .lerp(vertices[next]!, d / (d - e));
        }
        if (crossings !== 2 || start.distanceToSquared(end) < 1e-20) continue;
        face.crossVectors(edgeA.copy(b).sub(a), edgeB.copy(c).sub(a));
        if (mirrored) face.negate();
        direction.crossVectors(normal, face);
        const reverse = edgeA.copy(end).sub(start).dot(direction) < 0;
        start.sub(origin);
        end.sub(origin);
        if (reverse) segments.push(end.dot(u), end.dot(v), start.dot(u), start.dot(v));
        else segments.push(start.dot(u), start.dot(v), end.dot(u), end.dot(v));
      }
      for (const value of mergeSegments(segments)) values.push(value);
    }
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < values.length; i += 2) {
    minX = Math.min(minX, values[i]!);
    maxX = Math.max(maxX, values[i]!);
    minY = Math.min(minY, values[i + 1]!);
    maxY = Math.max(maxY, values[i + 1]!);
  }
  if (!values.length) minX = minY = maxX = maxY = 0;
  const width = maxX - minX,
    height = maxY - minY,
    cellSize = Math.max(
      Math.sqrt((width * height) / Math.max(values.length / 4, 1)) * 2,
      Math.max(width, height) / 2048,
      1e-7,
    ),
    section: SectionGeometry = {
      segments: Float64Array.from(values),
      origin,
      u,
      v,
      bounds: [minX, minY, maxX, maxY],
      cellSize,
      columns: Math.floor(width / cellSize) + 1,
      rows: Math.floor(height / cellSize) + 1,
      cells: new Map(),
    };
  for (let id = 0; id < values.length / 4; id++) {
    const offset = id * 4,
      ax = values[offset]!,
      ay = values[offset + 1]!,
      dx = values[offset + 2]! - ax,
      dy = values[offset + 3]! - ay;
    walkGrid(
      section,
      ax,
      ay,
      dx,
      dy,
      (column, row) => {
        // Neighbour insertion covers endpoints and segments that lie on cell boundaries.
        for (let y = Math.max(0, row - 1); y <= Math.min(section.rows - 1, row + 1); y++)
          for (
            let x = Math.max(0, column - 1);
            x <= Math.min(section.columns - 1, column + 1);
            x++
          ) {
            const key = y * section.columns + x,
              ids = section.cells.get(key);
            if (ids) {
              if (ids[ids.length - 1] !== id) ids.push(id);
            } else section.cells.set(key, [id]);
          }
      },
      1,
    );
  }
  return section;
}

const windingAt = (section: SectionGeometry, [x, y]: Point2): number => {
  const [minX, minY, maxX, maxY] = section.bounds;
  if (x < minX || x > maxX || y < minY || y > maxY) return 0;
  const ids = new Set<number>(),
    row = Math.min(section.rows - 1, Math.floor((y - minY) / section.cellSize));
  for (
    let column = Math.max(0, Math.floor((x - minX) / section.cellSize));
    column < section.columns;
    column++
  )
    for (const id of section.cells.get(row * section.columns + column) ?? []) ids.add(id);
  let winding = 0;
  for (const id of ids) {
    const offset = id * 4,
      ax = section.segments[offset]!,
      ay = section.segments[offset + 1]!,
      bx = section.segments[offset + 2]!,
      by = section.segments[offset + 3]!,
      side = cross2(bx - ax, by - ay, x - ax, y - ay);
    if (ay <= y && by > y && side > 0) winding++;
    else if (ay > y && by <= y && side < 0) winding--;
  }
  return winding;
};

/** Nonzero winding treats overlapping closed parts as material, while preserving hollow regions. */
export function insideSection(section: SectionGeometry, point: Vector3): boolean {
  return windingAt(section, projected(section, point)) !== 0;
}

const rayBoundary = (
  section: SectionGeometry,
  point: Point2,
  dx: number,
  dy: number,
  winding: number,
): number => {
  const ids = new Set<number>();
  walkGrid(section, point[0], point[1], dx, dy, (column, row) => {
    for (const id of section.cells.get(row * section.columns + column) ?? []) ids.add(id);
  });
  const hits: { distance: number; delta: number }[] = [];
  for (const id of ids) {
    const offset = id * 4,
      ax = section.segments[offset]!,
      ay = section.segments[offset + 1]!,
      sx = section.segments[offset + 2]! - ax,
      sy = section.segments[offset + 3]! - ay,
      denominator = cross2(dx, dy, sx, sy);
    if (Math.abs(denominator) < 1e-14) continue;
    const distance = cross2(ax - point[0], ay - point[1], sx, sy) / denominator,
      sideA = cross2(dx, dy, ax - point[0], ay - point[1]),
      sideB = sideA + denominator;
    // A half-open crossing rule cancels tangencies and counts shared corners consistently.
    if (distance > 1e-9 && ((sideA <= 0 && sideB > 0) || (sideA > 0 && sideB <= 0)))
      hits.push({ distance, delta: -Math.sign(denominator) });
  }
  hits.sort((a, b) => a.distance - b.distance);
  for (let i = 0; i < hits.length;) {
    const distance = hits[i]!.distance;
    do {
      winding += hits[i++]!.delta;
    } while (i < hits.length && Math.abs(hits[i]!.distance - distance) < 1e-8);
    if (winding === 0) return distance;
  }
  return Infinity;
};

/** Shortest in-plane chord through a material point, refined to better than a tenth of a degree. */
export function wallAt(section: SectionGeometry, point: Vector3): SectionWall | null {
  const p = projected(section, point),
    winding = windingAt(section, p);
  if (!winding) return null;
  const chord = (angle: number) => {
    const dx = Math.cos(angle),
      dy = Math.sin(angle),
      forward = rayBoundary(section, p, dx, dy, winding),
      backward = rayBoundary(section, p, -dx, -dy, winding);
    return { length: forward + backward, forward, backward, dx, dy };
  };
  const step = Math.PI / 32;
  let bestAngle = 0,
    best = chord(0);
  for (let i = 1; i < 32; i++) {
    const angle = i * step,
      candidate = chord(angle);
    if (candidate.length < best.length) {
      bestAngle = angle;
      best = candidate;
    }
  }
  let low = bestAngle - step,
    high = bestAngle + step;
  while (high - low > Math.PI / 1800) {
    const a = low + (high - low) / 3,
      b = high - (high - low) / 3,
      ca = chord(a),
      cb = chord(b);
    if (ca.length < best.length) {
      best = ca;
      bestAngle = a;
    }
    if (cb.length < best.length) {
      best = cb;
      bestAngle = b;
    }
    if (ca.length < cb.length) high = b;
    else low = a;
  }
  if (!Number.isFinite(best.length) || best.length <= 0) return null;
  return {
    thicknessMm: best.length,
    start: worldPoint(section, p[0] - best.dx * best.backward, p[1] - best.dy * best.backward),
    end: worldPoint(section, p[0] + best.dx * best.forward, p[1] + best.dy * best.forward),
  };
}
