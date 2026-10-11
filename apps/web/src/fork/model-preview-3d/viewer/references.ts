import { SCALE_REFERENCE_LABELS, type ScaleReference } from "@t3tools/contracts/fork";
import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  Vector3,
} from "three";

export const REFERENCE_GAP_MM = 10;
export const REFERENCE_SPECS = {
  card: { label: SCALE_REFERENCE_LABELS.card, size: [53.98, 85.6, 0.76] },
  "coin-us": { label: SCALE_REFERENCE_LABELS["coin-us"], size: [24.26, 24.26, 1.75] },
  "coin-euro": { label: SCALE_REFERENCE_LABELS["coin-euro"], size: [23.25, 23.25, 2.33] },
  "aa-battery": { label: SCALE_REFERENCE_LABELS["aa-battery"], size: [14.5, 50.5, 14.5] },
  "brick-2x4": { label: SCALE_REFERENCE_LABELS["brick-2x4"], size: [15.8, 31.8, 11.3] },
  "m3-screw": { label: SCALE_REFERENCE_LABELS["m3-screw"], size: [5.5, 13, 5.5] },
  hand: { label: SCALE_REFERENCE_LABELS.hand, size: [115, 190, 2] },
} as const satisfies Record<
  Exclude<ScaleReference, "none">,
  { label: string; size: readonly [number, number, number] }
>;

// Authored silhouette in a unit box, wrist at Y=0 and middle fingertip at Y=1.
const HAND_OUTLINE = [
  [0.32, 0],
  [0.76, 0],
  [0.78, 0.12],
  [0.88, 0.22],
  [0.96, 0.35],
  [1, 0.56],
  [0.99, 0.66],
  [0.96, 0.72],
  [0.92, 0.73],
  [0.88, 0.71],
  [0.85, 0.66],
  [0.83, 0.84],
  [0.81, 0.89],
  [0.77, 0.91],
  [0.73, 0.89],
  [0.71, 0.86],
  [0.7, 0.96],
  [0.67, 1],
  [0.62, 1],
  [0.59, 0.97],
  [0.58, 0.88],
  [0.56, 0.94],
  [0.53, 0.97],
  [0.49, 0.96],
  [0.46, 0.93],
  [0.44, 0.85],
  [0.43, 0.65],
  [0.4, 0.81],
  [0.36, 0.83],
  [0.32, 0.81],
  [0.3, 0.76],
  [0.29, 0.59],
  [0.29, 0.49],
  [0.25, 0.48],
  [0.18, 0.53],
  [0.12, 0.57],
  [0.07, 0.57],
  [0, 0.53],
  [0.01, 0.48],
  [0.08, 0.39],
  [0.2, 0.29],
  [0.29, 0.18],
  [0.32, 0.06],
] as const;

/** Low-poly everyday objects in millimetres, centred on X/Y and resting on Z=0. */
export function createReference(kind: ScaleReference) {
  if (kind === "none") return null;
  const object = new Group();
  object.name = "scale-reference";
  const material = new MeshStandardMaterial({ color: 0x8b939c, roughness: 0.8, metalness: 0 });
  const add = (geometry: BoxGeometry | CylinderGeometry | ExtrudeGeometry, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    object.add(mesh);
  };
  const cylinder = (diameter: number, length: number) =>
    new CylinderGeometry(diameter / 2, diameter / 2, length, 32);
  switch (kind) {
    case "card": {
      const width = 53.98,
        height = 85.6,
        radius = 3.18;
      const shape = new Shape();
      shape.moveTo(-width / 2 + radius, -height / 2);
      shape.lineTo(width / 2 - radius, -height / 2);
      shape.absarc(width / 2 - radius, -height / 2 + radius, radius, -Math.PI / 2, 0);
      shape.lineTo(width / 2, height / 2 - radius);
      shape.absarc(width / 2 - radius, height / 2 - radius, radius, 0, Math.PI / 2);
      shape.lineTo(-width / 2 + radius, height / 2);
      shape.absarc(-width / 2 + radius, height / 2 - radius, radius, Math.PI / 2, Math.PI);
      shape.lineTo(-width / 2, -height / 2 + radius);
      shape.absarc(-width / 2 + radius, -height / 2 + radius, radius, Math.PI, Math.PI * 1.5);
      shape.closePath();
      add(new ExtrudeGeometry(shape, { depth: 0.76, bevelEnabled: false, curveSegments: 4 }));
      break;
    }
    case "coin-us":
    case "coin-euro": {
      const [diameter, , thickness] = REFERENCE_SPECS[kind].size;
      add(cylinder(diameter, thickness).rotateX(Math.PI / 2), 0, 0, thickness / 2);
      break;
    }
    case "aa-battery":
      add(cylinder(14.5, 49.5), 0, -0.5, 7.25);
      add(cylinder(5.5, 1), 0, 24.75, 7.25);
      break;
    case "brick-2x4": {
      add(new BoxGeometry(15.8, 31.8, 9.6), 0, 0, 4.8);
      const stud = cylinder(4.8, 1.7).rotateX(Math.PI / 2);
      for (const x of [-4, 4]) for (const y of [-12, -4, 4, 12]) add(stud, x, y, 10.45);
      break;
    }
    case "m3-screw":
      add(cylinder(5.5, 3), 0, -5, 2.75);
      add(cylinder(3, 10), 0, 1.5, 2.75);
      break;
    case "hand": {
      const shape = new Shape();
      for (const [index, [x, y]] of HAND_OUTLINE.entries())
        if (index === 0) shape.moveTo(x * 115, y * 190);
        else shape.lineTo(x * 115, y * 190);
      shape.closePath();
      add(new ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false }));
      break;
    }
  }
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const origin = bounds.getCenter(new Vector3());
  origin.z = bounds.min.z;
  for (const mesh of object.children) mesh.position.sub(origin);
  return {
    object,
    size,
    dispose() {
      const geometries = new Set(object.children.map((mesh) => (mesh as Mesh).geometry));
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}

/** Place its minimum X one gap past the part, centred on its Y and resting on its floor. */
export const placeReference = (box: Box3, size: Vector3) =>
  new Vector3(box.max.x + REFERENCE_GAP_MM + size.x / 2, (box.min.y + box.max.y) / 2, box.min.z);
