import { Box3, Mesh, type Object3D } from "three";
import type { ModelProjection, ModelSection } from "@t3tools/contracts/fork";
export type Board3dLayer =
  | "board"
  | "soldermask"
  | "copper"
  | "silkscreen"
  | "topComponents"
  | "bottomComponents";
export type BoardComponent = { node: Object3D; reference: string | null; side: "front" | "back" };
export type BoardParts = {
  kind: "kicad" | "tscircuit" | "unknown";
  groups: Record<Board3dLayer, Object3D[]>;
  components: BoardComponent[];
  top: number | null;
  bottom: number | null;
};
export type Board3dDisplay = {
  projection: ModelProjection;
  section: ModelSection;
  hidden: ReadonlySet<Board3dLayer>;
};
export const defaultBoardDisplay = (): Board3dDisplay => ({
  projection: "perspective",
  section: { enabled: false, axis: "z", offset: 0, flipped: false, caps: true },
  hidden: new Set(),
});
const referenceName = (name: string, references: ReadonlySet<string>) =>
  references.has(name)
    ? name
    : references.has(name.replace(/_\d+$/, ""))
      ? name.replace(/_\d+$/, "")
      : null;
/** Classify material layers first, then named component instances; preserve unnamed parts. */
export function classifyBoard(root: Object3D, references: ReadonlySet<string>): BoardParts {
  root.updateWorldMatrix(true, true);
  const parts: BoardParts = {
    kind: "unknown",
    groups: {
      board: [],
      soldermask: [],
      copper: [],
      silkscreen: [],
      topComponents: [],
      bottomComponents: [],
    },
    components: [],
    top: null,
    bottom: null,
  };
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object.name === "Loom_millimetres_to_metres") parts.kind = "tscircuit";
    if (object instanceof Mesh && object.geometry.getAttribute("position")) meshes.push(object);
  });
  const unclassified: Mesh[] = [];
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const material = materials.find((material) =>
      ["board", "soldermask", "copper", "pad", "silkscreen"].includes(material.name),
    );
    if (material) {
      const group =
        material.name === "pad"
          ? "copper"
          : (material.name as "board" | "soldermask" | "copper" | "silkscreen");
      parts.groups[group].push(mesh);
      if (group === "board") parts.kind = "kicad";
    } else unclassified.push(mesh);
  }
  if (!parts.groups.board.length) {
    const candidates = unclassified.filter((mesh) => {
      for (let node: Object3D | null = mesh; node && node !== root; node = node.parent)
        if (referenceName(node.name, references)) return false;
      return true;
    });
    const body = candidates.toSorted((a, b) => {
      const area = (mesh: Mesh) => {
        const box = new Box3().setFromObject(mesh, true);
        return (box.max.x - box.min.x) * (box.max.y - box.min.y);
      };
      return area(b) - area(a);
    })[0];
    if (body) {
      parts.groups.board.push(body);
      unclassified.splice(unclassified.indexOf(body), 1);
    }
  }
  const boardBox = new Box3();
  for (const node of parts.groups.board) boardBox.union(new Box3().setFromObject(node, true));
  if (!boardBox.isEmpty()) {
    parts.top = boardBox.max.z;
    parts.bottom = boardBox.min.z;
  }
  let assembly = root;
  while (assembly.children.length === 1 && !(assembly.children[0] instanceof Mesh))
    assembly = assembly.children[0]!;
  const components = new Map<Object3D, string | null>();
  for (const mesh of unclassified) {
    let component: Object3D = mesh,
      reference: string | null = null;
    for (let node: Object3D | null = mesh; node && node !== root; node = node.parent) {
      const matched = referenceName(node.name, references);
      if (matched) {
        component = node;
        reference = matched;
        break;
      }
      if (node.parent === assembly) {
        component = node;
        break;
      }
    }
    components.set(component, reference);
  }
  for (const [node, reference] of components) {
    const box = new Box3().setFromObject(node, true);
    const side =
      parts.top !== null &&
      parts.bottom !== null &&
      (box.min.z + box.max.z) / 2 < (parts.top + parts.bottom) / 2
        ? "back"
        : "front";
    parts.components.push({ node, reference, side });
    parts.groups[side === "front" ? "topComponents" : "bottomComponents"].push(node);
  }
  return parts;
}
export function availableLayers(parts: BoardParts): Record<Board3dLayer, boolean> {
  return Object.fromEntries(
    Object.entries(parts.groups).map(([key, nodes]) => [
      key,
      nodes.length > 0 &&
        !(parts.kind === "tscircuit" && (key === "copper" || key === "silkscreen")),
    ]),
  ) as Record<Board3dLayer, boolean>;
}
