import type { EnclosurePlan } from "./plan.ts";
import { facingVector } from "./features.ts";
import { generatedSource, literal } from "./scad.ts";
export function writeBuild123d(p: EnclosurePlan) {
  const v = p.params,
    first = p.standoffs[0],
    common = p.standoffs.every((h) => h.diameter === first?.diameter && h.pilot === first?.pilot);
  return generatedSource(
    `from typing import Annotated, Literal
from build123d import *

BOARD_OUTLINE = ${literal(p.outline)}
BOARD_BOTTOM = ${literal(p.boardBottom)}
BOARD_TOP = ${literal(p.boardTop)}
PARTS_ABOVE = ${literal(p.partsAbove)}
HOLES = ${literal(p.standoffs.map((h) => [h.x, h.y, common ? 1 : h.diameter, common ? 1 : h.pilot]))}
CUTOUTS = ${literal(p.cutouts.map((c) => [...c.box.min, ...c.box.max, ...facingVector(c.facing)]))}
PROXIES = ${literal(p.proxies.map((b) => [...b.min, ...b.max]))}

def model(
    part: Literal["fit", "base", "lid"] = "fit",
    wall: Annotated[float, {"min": 0.8, "max": 10, "step": 0.1, "group": "Case"}] = ${literal(v.wallMm)},
    floor_thickness: Annotated[float, {"min": 0.8, "max": 10, "step": 0.1}] = ${literal(v.floorMm)},
    lid_thickness: Annotated[float, {"min": 0.8, "max": 10, "step": 0.1}] = ${literal(v.lidMm)},
    corner_radius: Annotated[float, {"min": 0, "max": 20, "step": 0.5}] = ${literal(v.cornerRadiusMm)},
    side_gap: Annotated[float, {"min": 0, "max": 10, "step": 0.1}] = ${literal(v.sideGapMm)},
    top_gap: Annotated[float, {"min": 0, "max": 30, "step": 0.1}] = ${literal(v.topGapMm)},
    standoff_height: Annotated[float, {"min": 0, "max": 50, "step": 0.5}] = ${literal(v.standoffHeightMm)},
    standoff_diameter: Annotated[float, {"min": 0.1, "max": 20, "step": 0.1}] = ${literal(common ? (first?.diameter ?? 6) : 1)},
    pilot_diameter: Annotated[float, {"min": 0, "max": 10, "step": 0.1}] = ${literal(common ? (first?.pilot ?? 2.6) : 1)},
    cutout_margin: Annotated[float, {"min": 0, "max": 5, "step": 0.1}] = ${literal(v.cutoutMarginMm)},
    lid_lip: Annotated[float, {"min": 0, "max": 10, "step": 0.1}] = ${literal(v.lidLipMm)},
    lid_lip_gap: Annotated[float, {"min": 0, "max": 2, "step": 0.05}] = ${literal(v.lidLipGapMm)},
):
    def shape(grow):
        polygon = Polygon(BOARD_OUTLINE, align=(Align.NONE, Align.NONE))
        if corner_radius == 0:
            return offset(polygon, amount=grow, kind=Kind.INTERSECTION)
        return offset(offset(polygon, amount=grow-corner_radius, kind=Kind.INTERSECTION), amount=corner_radius, kind=Kind.ARC)
    floor_top = BOARD_BOTTOM-standoff_height
    case_bottom = floor_top-floor_thickness
    lid_bottom = BOARD_TOP+PARTS_ABOVE+top_gap
    tray = Pos(0,0,case_bottom)*extrude(shape(side_gap+wall), amount=lid_bottom-case_bottom)
    tray -= Pos(0,0,floor_top)*extrude(shape(side_gap), amount=lid_bottom-floor_top+0.1)
    for x,y,d,p in HOLES:
        tray += Pos(x,y,floor_top-0.01)*Cylinder(d*standoff_diameter/2, standoff_height+0.01, align=(Align.CENTER,Align.CENTER,Align.MIN))
    for x,y,d,p in HOLES:
        if p*pilot_diameter > 0:
            tray -= Pos(x,y,case_bottom-0.1)*Cylinder(p*pilot_diameter/2, BOARD_BOTTOM-case_bottom+0.2, align=(Align.CENTER,Align.CENTER,Align.MIN))
    lid = Pos(0,0,lid_bottom)*extrude(shape(side_gap+wall), amount=lid_thickness)
    if lid_lip > 0:
        lid += Pos(0,0,lid_bottom-lid_lip)*extrude(shape(side_gap-lid_lip_gap)-shape(side_gap-lid_lip_gap-wall), amount=lid_lip)
    for x0,y0,z0,x1,y1,z1,dx,dy,dz in CUTOUTS:
        # Axis-aligned extrusion of the connector box through the outward wall.
        x0 -= cutout_margin-${literal(v.cutoutMarginMm)}
        y0 -= cutout_margin-${literal(v.cutoutMarginMm)}
        z0 -= cutout_margin-${literal(v.cutoutMarginMm)}
        x1 += cutout_margin-${literal(v.cutoutMarginMm)}
        y1 += cutout_margin-${literal(v.cutoutMarginMm)}
        z1 += cutout_margin-${literal(v.cutoutMarginMm)}
        cut = Pos(min(x0,x0+25*dx),min(y0,y0+25*dy),z0)*Box(x1-x0+25*abs(dx),y1-y0+25*abs(dy),z1-z0,align=(Align.MIN,Align.MIN,Align.MIN))
        tray -= cut
        lid -= cut
    if part == "base":
        return tray
    if part == "lid":
        return lid
    proxy = Pos(0,0,BOARD_BOTTOM)*extrude(Polygon(BOARD_OUTLINE,align=(Align.NONE,Align.NONE)),amount=BOARD_TOP-BOARD_BOTTOM)
    for x0,y0,z0,x1,y1,z1 in PROXIES:
        proxy += Pos(x0,y0,z0)*Box(max(0.001,x1-x0),max(0.001,y1-y0),max(0.001,z1-z0),align=(Align.MIN,Align.MIN,Align.MIN))
    return Compound(children=[tray, Pos(0,0,10)*lid, proxy])
`,
    "build123d",
  );
}
