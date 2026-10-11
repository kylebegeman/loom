import type { ZoneRect } from "@t3tools/contracts/fork";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";

/** A strip's centre in bed coordinates, whose front-left corner is (-width/2, -depth/2). */
export const stripPlacement = (bed: readonly [number, number], strip: ZoneRect) => ({
  x: -bed[0] / 2 + strip.offsetMm[0] + strip.footprintMm[0] / 2,
  y: -bed[1] / 2 + strip.offsetMm[1] + strip.footprintMm[1] / 2,
});

// Keep the legend's model-zone-swatch colours in workspace.module.css in sync.
export const ZONE_TINT = { dark: 0x262236, light: 0xdcd6ea };

/** Flat nozzle reach strips, between the plate fill and grid lines. */
export function createZoneStrips(bed: readonly [number, number], strips: readonly ZoneRect[]) {
  const object = new Group();
  object.name = "nozzle-zones";
  const material = new MeshBasicMaterial({
    color: ZONE_TINT.light,
    depthTest: false,
    depthWrite: false,
  });
  const geometries = strips.map((strip) => {
    const geometry = new PlaneGeometry(...strip.footprintMm);
    const mesh = new Mesh(geometry, material);
    const { x, y } = stripPlacement(bed, strip);
    mesh.position.set(x, y, 0);
    mesh.renderOrder = -3.5;
    object.add(mesh);
    return geometry;
  });
  return {
    object,
    setTheme(dark: boolean) {
      material.color.setHex(dark ? ZONE_TINT.dark : ZONE_TINT.light);
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}
