import { expect, it, vi } from "vite-plus/test";
import { Mesh, MeshBasicMaterial } from "three";
import { BUILD_PLATE_PRESETS, singleZoneStrips } from "@t3tools/contracts/fork";
import { createZoneStrips, stripPlacement, ZONE_TINT } from "./zones";

it("places nozzle strips from the plate's front-left corner", () => {
  const strips = singleZoneStrips(BUILD_PLATE_PRESETS["bambu-h2d"].zones);
  expect(strips.map((strip) => stripPlacement([350, 320], strip))).toEqual([
    { x: -162.5, y: 0 },
    { x: 162.5, y: 0 },
  ]);
  expect(stripPlacement([100, 80], { offsetMm: [10, 15], footprintMm: [20, 10] })).toEqual({
    x: -30,
    y: -20,
  });
});

it("draws flat planes under the grid, themes them and disposes their resources", () => {
  const strips = singleZoneStrips(BUILD_PLATE_PRESETS["bambu-h2c"].zones);
  const zones = createZoneStrips([330, 320], strips);
  const meshes = zones.object.children.filter((object) => object instanceof Mesh);
  expect(meshes).toHaveLength(2);
  const first = meshes[0]!;
  const material = first.material;
  if (!(material instanceof MeshBasicMaterial)) throw new Error("Expected one shared material");
  expect(meshes[1]!.material).toBe(material);
  expect(material.depthTest).toBe(false);
  expect(material.depthWrite).toBe(false);
  expect(material.transparent).toBe(false);
  for (const mesh of meshes) {
    expect(mesh.renderOrder).toBe(-3.5);
    expect(mesh.position.z).toBe(0);
  }
  const geometries = meshes.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
  const disposed = vi.spyOn(material, "dispose");
  zones.setTheme(true);
  expect(material.color.getHex()).toBe(ZONE_TINT.dark);
  zones.setTheme(false);
  expect(material.color.getHex()).toBe(ZONE_TINT.light);
  zones.dispose();
  for (const geometry of geometries) expect(geometry).toHaveBeenCalledOnce();
  expect(disposed).toHaveBeenCalledOnce();
});
