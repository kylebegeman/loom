import { Box3, Color, Group, Mesh, Vector3, type Material, type Object3D } from "three";
import type { AssemblyPart } from "@t3tools/contracts/fork";
import { disposeModel, meshStats } from "./load";
const ASSEMBLY_DISPLAY_TRIANGLE_LIMIT = 5_000_000;
type ColorMaterial = Material & { color?: Color; emissive?: Color; emissiveIntensity?: number };
/** The scene owns each loaded part. Placement wraps the source's authored transform. */
export function createAssemblyScene() {
  const object = new Group(),
    parts = new Map<
      string,
      {
        group: Group;
        triangles: number;
        materials: Map<ColorMaterial, { color?: Color; emissive?: Color; intensity?: number }>;
      }
    >();
  object.name = "assembly";
  return {
    object,
    set(id: string, model: Object3D, allowLarge = false) {
      const stats = meshStats(model),
        total = [...parts.entries()].reduce(
          (count, [key, part]) => count + (key === id ? 0 : part.triangles),
          stats.triangles,
        );
      if (!allowLarge && total > ASSEMBLY_DISPLAY_TRIANGLE_LIMIT) {
        disposeModel(model);
        throw new Error(
          "This assembly exceeds the 5 million triangle display limit. Hide a part or use a simpler mesh.",
        );
      }
      const existing = parts.get(id);
      if (existing) {
        object.remove(existing.group);
        disposeModel(existing.group);
      }
      const group = new Group(),
        materials = new Map<
          ColorMaterial,
          { color?: Color; emissive?: Color; intensity?: number }
        >();
      group.name = id;
      group.userData.assemblyPartId = id;
      group.add(model);
      model.traverse((node) => {
        if (node instanceof Mesh)
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            const colored = material as ColorMaterial;
            if (!materials.has(colored))
              materials.set(colored, {
                ...(colored.color ? { color: colored.color.clone() } : {}),
                ...(colored.emissive ? { emissive: colored.emissive.clone() } : {}),
                ...(colored.emissiveIntensity !== undefined
                  ? { intensity: colored.emissiveIntensity }
                  : {}),
              });
          }
      });
      parts.set(id, { group, triangles: stats.triangles, materials });
      object.add(group);
    },
    remove(id: string) {
      const part = parts.get(id);
      if (!part) return;
      parts.delete(id);
      object.remove(part.group);
      disposeModel(part.group);
    },
    update(
      definitions: readonly AssemblyPart[],
      options: {
        explode?: number;
        isolatedId?: string | null;
        selectedId?: string | null;
        preview?: AssemblyPart | null;
      } = {},
    ) {
      const box = new Box3();
      for (const saved of definitions) {
        const part = options.preview?.id === saved.id ? options.preview : saved,
          loaded = parts.get(part.id);
        if (!loaded) continue;
        loaded.group.position.fromArray(part.position);
        loaded.group.rotation.set(
          ...(part.rotation.map((angle) => (angle * Math.PI) / 180) as [number, number, number]),
          "XYZ",
        );
        loaded.group.visible =
          part.visible && (!options.isolatedId || options.isolatedId === part.id);
        loaded.group.updateWorldMatrix(true, true);
        if (part.visible) box.union(new Box3().setFromObject(loaded.group, true));
      }
      const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3()),
        distance = box.isEmpty() ? 10 : Math.max(10, box.getSize(new Vector3()).length() / 3);
      for (const saved of definitions) {
        const part = options.preview?.id === saved.id ? options.preview : saved,
          loaded = parts.get(part.id);
        if (!loaded) continue;
        if (options.explode) {
          const offset = part.explode
            ? new Vector3(...part.explode)
            : new Box3().setFromObject(loaded.group, true).getCenter(new Vector3()).sub(center);
          if (offset.lengthSq() < 1e-10) offset.set(0, 0, 1);
          if (!part.explode) offset.normalize().multiplyScalar(distance);
          loaded.group.position.addScaledVector(offset, options.explode);
        }
        for (const [material, original] of loaded.materials) {
          if (material.color && original.color)
            material.color.copy(part.color ? new Color(part.color) : original.color);
          if (material.emissive && original.emissive) {
            material.emissive.copy(
              options.selectedId === part.id ? new Color(0x315a83) : original.emissive,
            );
            if (material.emissiveIntensity !== undefined)
              material.emissiveIntensity =
                options.selectedId === part.id ? 0.35 : (original.intensity ?? 1);
          }
        }
      }
      object.updateWorldMatrix(true, true);
      return box.isEmpty() ? null : box;
    },
    count() {
      return [...parts.values()].reduce((count, part) => count + part.triangles, 0);
    },
    has(id: string) {
      return parts.has(id);
    },
    dispose() {
      for (const part of parts.values()) {
        object.remove(part.group);
        disposeModel(part.group);
      }
      parts.clear();
    },
  };
}
