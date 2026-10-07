// @effect-diagnostics nodeBuiltinImport:off
// Read authored fixtures directly; these loader tests do not need a server runtime.
import * as NodeFSP from "node:fs/promises";
import { expect, it, vi, afterEach } from "vite-plus/test";
import { disposeModel, meshStats, parseModel, resourceUrl } from "./load";
import { Group, Mesh, Line, BufferGeometry, MeshStandardMaterial, Texture } from "three";
const fixture = async (name: string) => {
  const bytes = await NodeFSP.readFile(new URL(`../__fixtures__/${name}`, import.meta.url));
  return Uint8Array.from(bytes).buffer;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(["stl", "obj"] as const)("loads the %s cuboid in millimetres", async (format) => {
  const model = await parseModel(
    await fixture(`cuboid.${format}`),
    format,
    "https://loom.test/f/token/cuboid",
  );
  const stats = meshStats(model);
  expect(stats.triangles).toBe(12);
  expect(stats.size).toEqual([10, 20, 30]);
  disposeModel(model);
});
it("loads GLB and converts metres/Y-up to mm/Z-up", async () => {
  const model = await parseModel(
    await fixture("triangle.glb"),
    "glb",
    "https://loom.test/f/token/triangle.glb",
  );
  const stats = meshStats(model);
  expect(stats.triangles).toBe(1);
  expect(stats.size[0]).toBeCloseTo(10);
  expect(stats.size[1]).toBeCloseTo(30);
  expect(stats.size[2]).toBeCloseTo(20);
  disposeModel(model);
});
it("loads a glTF external buffer through the same signed directory", async () => {
  const bytes = await fixture("buffers/triangle.bin"),
    requests: string[] = [];
  vi.stubGlobal(
    "ProgressEvent",
    class ProgressEvent extends Event {
      readonly lengthComputable: boolean;
      readonly loaded: number;
      readonly total: number;
      constructor(
        type: string,
        init: { lengthComputable: boolean; loaded: number; total: number },
      ) {
        super(type);
        this.lengthComputable = init.lengthComputable;
        this.loaded = init.loaded;
        this.total = init.total;
      }
    },
  );
  vi.stubGlobal("fetch", async (input: Request) => {
    requests.push(input.url);
    return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
  });
  const model = await parseModel(
    await fixture("triangle.gltf"),
    "gltf",
    "https://loom.test/f/token/triangle.gltf",
  );
  expect(meshStats(model).triangles).toBe(1);
  expect(requests).toEqual(["https://loom.test/f/token/buffers/triangle.bin"]);
  disposeModel(model);
});
it.skipIf(typeof DOMParser === "undefined")(
  "loads 3MF inch units as 25.4 mm (requires DOMParser in the client)",
  async () => {
    const model = await parseModel(
      await fixture("inch-cube.3mf"),
      "3mf",
      "https://loom.test/f/token/inch-cube.3mf",
    );
    expect(meshStats(model).triangles).toBe(12);
    for (const size of meshStats(model).size) expect(size).toBeCloseTo(25.4);
    disposeModel(model);
  },
);
it("refuses glTF traversal and external URLs while permitting nested textures and data", () => {
  const url = "https://loom.test/f/token/model.gltf";
  expect(resourceUrl(url, "textures/red.png")).toBe("https://loom.test/f/token/textures/red.png");
  expect(resourceUrl(url, "data:application/octet-stream;base64,AAAA")).toContain("data:");
  for (const uri of [
    "../secret.bin",
    "%2e%2e/secret.bin",
    "https://other.test/a.bin",
    "/f/other/a.bin",
  ])
    expect(() => resourceUrl(url, uri)).toThrow();
});

it("loads an embedded glTF texture through the loader's generated blob URL", async () => {
  const document = JSON.parse(new TextDecoder().decode(await fixture("triangle.gltf")));
  const buffer = new Uint8Array(await fixture("buffers/triangle.bin"));
  document.buffers[0].uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...buffer))}`;
  document.images = [{ bufferView: 0, mimeType: "image/png" }];
  document.textures = [{ source: 0 }];
  document.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  document.meshes[0].primitives[0].material = 0;
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("ProgressEvent", Event);
  // Image decoding belongs to the browser; exercise the real loader and blob transport here.
  const decodeImage = vi.fn(async () => ({ width: 1, height: 1 }));
  vi.stubGlobal("createImageBitmap", decodeImage);
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const model = await parseModel(
    new TextEncoder().encode(JSON.stringify(document)).buffer,
    "gltf",
    "https://loom.test/f/token/triangle.gltf",
  );
  expect(meshStats(model).triangles).toBe(1);
  expect(decodeImage).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
  disposeModel(model);
});
it("rejects authored blob URLs before glTF image loading", async () => {
  const document = JSON.parse(new TextDecoder().decode(await fixture("triangle.gltf")));
  document.images = [{ uri: "blob:https://loom.test/unrelated-image" }];
  await expect(
    parseModel(
      new TextEncoder().encode(JSON.stringify(document)).buffer,
      "gltf",
      "https://loom.test/f/token/triangle.gltf",
    ),
  ).rejects.toThrow("glTF resources must be below the model directory.");
});

it("disposes shared textures and decoded bitmaps once, including non-mesh geometry", () => {
  const image = { close: vi.fn() };
  const texture = new Texture(image);
  const disposeTexture = vi.spyOn(texture, "dispose");
  const first = new MeshStandardMaterial({ map: texture });
  const second = new MeshStandardMaterial({ map: texture });
  const geometry = new BufferGeometry();
  const disposeGeometry = vi.spyOn(geometry, "dispose");
  const group = new Group();
  group.add(new Mesh(geometry, first), new Line(geometry, second));
  disposeModel(group);
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(disposeTexture).toHaveBeenCalledOnce();
  expect(image.close).toHaveBeenCalledOnce();
});
