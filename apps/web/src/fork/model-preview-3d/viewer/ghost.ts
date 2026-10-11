import {
  BufferGeometry,
  FrontSide,
  Line,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Points,
  Texture,
} from "three";

export const GHOST_TRIANGLE_LIMIT = 1_000_000;

/** Takes ownership of a replaced model without cloning its geometry or world transform. */
export function createGhost(parent: Object3D, requestRender: () => void) {
  let object: Object3D | null = null;
  let material: MeshBasicMaterial | null = null;
  let visible = false;
  let dark = false;
  let planes: readonly Plane[] = [];
  const clear = () => {
    if (object) {
      parent.remove(object);
      const geometries = new Set<BufferGeometry>();
      object.traverse((node) => {
        if (node instanceof Mesh || node instanceof Line || node instanceof Points)
          geometries.add(node.geometry);
      });
      for (const geometry of geometries) geometry.dispose();
      material?.dispose();
    }
    object = null;
    material = null;
  };
  return {
    set(next: Object3D | null) {
      if (next === object) return;
      clear();
      if (next) {
        material = new MeshBasicMaterial({
          color: dark ? 0xa3acb9 : 0x6b7480,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          depthTest: true,
          side: FrontSide,
          clippingPlanes: [...planes],
        });
        const originals = new Set<Material>(),
          textures = new Set<Texture>(),
          images = new Set<{ close: () => void }>();
        next.traverse((node) => {
          if (node instanceof Mesh || node instanceof Line || node instanceof Points) {
            for (const original of Array.isArray(node.material) ? node.material : [node.material])
              originals.add(original);
            node.material = material!;
            if (!(node instanceof Mesh)) node.visible = false;
          }
        });
        for (const original of originals) {
          for (const value of Object.values(original))
            if (value instanceof Texture) textures.add(value);
          original.dispose();
        }
        for (const texture of textures) {
          const image: unknown = texture.source.data;
          if (
            image &&
            typeof image === "object" &&
            "close" in image &&
            typeof image.close === "function"
          )
            images.add(image as { close: () => void });
          texture.dispose();
        }
        for (const image of images) image.close();
        object = next;
        object.visible = visible;
        parent.add(object);
      }
      requestRender();
    },
    setVisible(value: boolean) {
      visible = value;
      if (object) object.visible = value;
      requestRender();
    },
    setTheme(value: boolean) {
      dark = value;
      material?.color.setHex(dark ? 0xa3acb9 : 0x6b7480);
      requestRender();
    },
    setClipping(value: readonly Plane[]) {
      planes = value;
      if (material) material.clippingPlanes = [...value];
      requestRender();
    },
    dispose() {
      clear();
      requestRender();
    },
  };
}
