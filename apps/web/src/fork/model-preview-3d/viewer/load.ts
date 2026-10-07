import JSZip from "jszip";
import {
  Box3,
  BufferGeometry,
  LoadingManager,
  Mesh,
  Line,
  Points,
  Material,
  Texture,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { THREE_MF_UNIT_MM, type ModelFormat } from "@t3tools/contracts/fork";
export function disposeModel(model: Object3D) {
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    textures = new Set<Texture>(),
    images = new Set<{ close: () => void }>();
  model.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line || object instanceof Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const image: unknown = texture.source.data;
    if (image && typeof image === "object" && "close" in image && typeof image.close === "function")
      images.add(image as { close: () => void });
    texture.dispose();
  }
  // GLTFLoader's ImageBitmaps own decoded image memory beyond GPU texture disposal.
  for (const image of images) image.close();
}
export function meshStats(model: Object3D) {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) throw new Error("The file contains no visible geometry.");
  if (![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite))
    throw new Error("The file contains invalid coordinates.");
  let triangles = 0;
  model.traverse((object) => {
    if (object instanceof Mesh)
      triangles +=
        (object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count ?? 0) / 3;
  });
  return { box, size: box.getSize(new Vector3()).toArray(), triangles: Math.round(triangles) };
}
/** glTF resources are restricted to the signed model directory. No external fetches. */
export function resourceUrl(base: string, uri: string) {
  if (uri.startsWith("data:")) return uri;
  const target = new URL(uri, base),
    root = new URL(".", base);
  if (
    target.origin !== root.origin ||
    !target.pathname.startsWith(root.pathname) ||
    uri.includes("\\") ||
    decodeURIComponent(uri).split("/").includes("..")
  )
    throw new Error("glTF resources must be below the model directory.");
  return target.href;
}
export async function parseModel(
  bytes: ArrayBuffer,
  format: ModelFormat,
  url: string,
  signal?: AbortSignal,
): Promise<Object3D> {
  if (format === "stl") {
    const geometry = new STLLoader().parse(bytes);
    geometry.computeVertexNormals();
    return new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0xa8b4c5, roughness: 0.65, metalness: 0.05 }),
    );
  }
  if (format === "obj") return new OBJLoader().parse(new TextDecoder().decode(bytes));
  if (format === "3mf") {
    // ThreeMFLoader reads unit metadata but does not apply it. Normalize each model to mm.
    const zip = await JSZip.loadAsync(bytes);
    let changed = false;
    for (const entry of Object.values(zip.files).filter((file) => file.name.endsWith(".model"))) {
      const document = new DOMParser().parseFromString(
        await entry.async("string"),
        "application/xml",
      );
      const root = document.documentElement;
      const unit = root.getAttribute("unit") ?? "millimeter";
      const factor = THREE_MF_UNIT_MM[unit as keyof typeof THREE_MF_UNIT_MM];
      if (!factor) throw new Error(`Unsupported 3MF unit: ${unit}`);
      if (factor !== 1) {
        changed = true;
        for (const vertex of document.getElementsByTagName("vertex"))
          for (const axis of ["x", "y", "z"])
            vertex.setAttribute(axis, String(Number(vertex.getAttribute(axis)) * factor));
        for (const element of document.querySelectorAll("[transform]")) {
          const values = element.getAttribute("transform")!.trim().split(/\s+/).map(Number);
          for (const index of [9, 10, 11]) values[index] = values[index]! * factor;
          element.setAttribute("transform", values.join(" "));
        }
        for (const element of document.querySelectorAll("beam,ball,beamlattice"))
          for (const attribute of ["r1", "r2", "r", "minlength", "ballradius"])
            if (element.hasAttribute(attribute))
              element.setAttribute(
                attribute,
                String(Number(element.getAttribute(attribute)) * factor),
              );
        root.setAttribute("unit", "millimeter");
        zip.file(entry.name, new XMLSerializer().serializeToString(document));
      }
    }
    return new ThreeMFLoader().parse(
      changed ? await zip.generateAsync({ type: "arraybuffer" }) : bytes,
    );
  }
  if (format === "gltf" || format === "glb") {
    const manager = new LoadingManager();
    // Embedded GLB/glTF images become blob URLs inside GLTFLoader. Validate authored
    // resource URIs before loading, then allow the loader's generated image URLs.
    manager.setURLModifier((uri) => (uri.startsWith("blob:") ? uri : resourceUrl(url, uri)));
    const loader = new GLTFLoader(manager).register((parser) => {
      const resources: unknown[] = [...(parser.json.buffers ?? []), ...(parser.json.images ?? [])];
      for (const resource of resources)
        if (
          resource &&
          typeof resource === "object" &&
          "uri" in resource &&
          typeof resource.uri === "string"
        )
          resourceUrl(url, resource.uri);
      return { name: "loom_signed_resources" };
    });
    const abort = () => manager.abort();
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    let gltf;
    try {
      gltf = await loader.parseAsync(
        format === "gltf" ? new TextDecoder().decode(bytes) : bytes,
        new URL(".", url).href,
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    // glTF is Y-up and specifies metres. Loom's build plate and other formats are Z-up, mm.
    gltf.scene.rotation.x = Math.PI / 2;
    gltf.scene.scale.multiplyScalar(1000);
    return gltf.scene;
  }
  throw new Error("This file cannot be loaded as a mesh.");
}
export async function loadModel(
  url: string,
  format: ModelFormat,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "The file was deleted, moved, or its URL expired."
        : "Could not download the model.",
    );
  const total = Number(response.headers.get("content-length")) || 0;
  let bytes: ArrayBuffer;
  if (response.body) {
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      length += value.length;
      onProgress(length, total);
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }
    bytes = joined.buffer;
  } else bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  onProgress(total, total);
  const model = await parseModel(bytes, format, url, signal);
  if (signal.aborted) {
    disposeModel(model);
    signal.throwIfAborted();
  }
  return model;
}
