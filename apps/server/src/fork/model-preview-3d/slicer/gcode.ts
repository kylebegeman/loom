import { ModelPreviewError, type PrintEstimate, type SliceRole } from "@t3tools/contracts/fork";
import { createLayerBuffer } from "./layers.ts";
export const parseDuration = (text: string): number | null => {
  let total = 0,
    matched = false;
  for (const match of text.matchAll(/([\d.]+)\s*([dhms])/gi)) {
    total += Number(match[1]) * ({ d: 86400, h: 3600, m: 60, s: 1 }[match[2]!.toLowerCase()] ?? 0);
    matched = true;
  }
  return matched && Number.isFinite(total)
    ? total
    : /^\d+(?:\.\d+)?$/.test(text.trim())
      ? Number(text)
      : null;
};
const roles: Readonly<Record<string, SliceRole>> = {
  "outer wall": "outer-wall",
  "external perimeter": "outer-wall",
  "inner wall": "inner-wall",
  perimeter: "inner-wall",
  "overhang wall": "outer-wall",
  "overhang perimeter": "outer-wall",
  "sparse infill": "infill",
  "internal infill": "infill",
  "internal solid infill": "solid-infill",
  "solid infill": "solid-infill",
  "top surface": "top",
  "top solid infill": "top",
  "bottom surface": "bottom",
  bridge: "bridge",
  "bridge infill": "bridge",
  support: "support",
  "support material": "support",
  "support interface": "support-interface",
  "support material interface": "support-interface",
  "support transition": "support-interface",
  skirt: "skirt",
  brim: "skirt",
  "skirt/brim": "skirt",
};
const extrusionRole = (name: string): SliceRole => roles[name.toLowerCase().trim()] ?? "other";
const numericList = (value: string): number[] =>
  value
    .split(",")
    .map(Number)
    .filter((number) => Number.isFinite(number) && number >= 0)
    .slice(0, 16);
/** A feed interface keeps large G-code files streaming, with bounded layer geometry. */
export const createGcodeParser = (currency = "USD", limit?: number) => {
  const buffer = createLayerBuffer(limit);
  let x = 0,
    y = 0,
    z = 0,
    tool = 0,
    absolute = true,
    absoluteE = true,
    role: SliceRole = "other",
    layer = -1,
    layerPending = false,
    hasLayerMarker = false,
    layerZ: number | null = null,
    height = 0.2;
  const extruders = new Map<number, number>();
  const supportLength: number[] = [],
    lengths: number[] = [],
    grams: number[] = [];
  let printSeconds: number | null = null,
    totalGrams: number | null = null,
    reportedLayers: number | null = null,
    reportedCost: number | null = null;
  const feed = (line: string): void => {
    const comment = /;\s*(.*)/.exec(line)?.[1]?.trim() ?? "";
    const duration =
      /total estimated time:\s*([^;]+)|estimated printing time(?:\s*\(normal mode\))?\s*=\s*(.*)/i.exec(
        comment,
      );
    if (duration) printSeconds = parseDuration(duration[1] ?? duration[2]!);
    const totals = /^(?:total )?filament (?:used |length |weight )?\[(mm|g)\]\s*[:=]\s*(.*)/i.exec(
      comment,
    );
    if (totals) {
      const values = numericList(totals[2]!);
      if (totals[1]!.toLowerCase() === "mm") lengths.splice(0, lengths.length, ...values);
      else grams.splice(0, grams.length, ...values);
    }
    const total = /^total filament (?:used|weight) \[g\]\s*[:=]\s*(.*)/i.exec(comment);
    if (total) {
      const values = numericList(total[1]!);
      totalGrams = values.reduce((sum, value) => sum + value, 0);
    }
    const layers = /^(?:total layer number|total layers count)\s*[:=]\s*(\d+)/i.exec(comment);
    if (layers) reportedLayers = Number(layers[1]);
    const cost = /^(?:total )?filament cost\s*[:=]\s*([\d.]+)/i.exec(comment);
    if (cost) reportedCost = Number(cost[1]);
    if (/^(?:CHANGE_LAYER|LAYER_CHANGE)\b/i.test(comment)) {
      if (!hasLayerMarker) {
        buffer.reset();
        supportLength.length = 0;
        layer = -1;
        hasLayerMarker = true;
      }
      layerPending = true;
      layerZ = null;
    }
    const level = /^Z:\s*([-+\d.e]+)/i.exec(comment);
    if (level && Number.isFinite(Number(level[1]))) layerZ = Number(level[1]);
    const thickness = /^(?:LAYER_HEIGHT|HEIGHT):\s*([\d.e+-]+)/i.exec(comment);
    if (thickness && Number(thickness[1]) > 0) height = Number(thickness[1]);
    const feature = /^(?:FEATURE|TYPE):\s*(.*)/i.exec(comment);
    if (feature) role = extrusionRole(feature[1]!);
    const instruction = line.split(";", 1)[0]!.trim(),
      command = /^([GMT]\d+)\b/i.exec(instruction)?.[1]?.toUpperCase();
    if (!command) return;
    const params = new Map<string, number>();
    for (const match of instruction
      .slice(command.length)
      .matchAll(/([XYZEFIJR])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
      const value = Number(match[2]);
      if (Number.isFinite(value)) params.set(match[1]!, value);
    }
    if (command === "G90") {
      absolute = true;
      return;
    }
    if (command === "G91") {
      absolute = false;
      return;
    }
    if (command === "M82") {
      absoluteE = true;
      return;
    }
    if (command === "M83") {
      absoluteE = false;
      return;
    }
    if (command.startsWith("T")) {
      const next = Number(command.slice(1));
      if (next >= 0 && next < 16) tool = next;
      return;
    }
    if (command === "G92") {
      if (params.has("E")) extruders.set(tool, params.get("E")!);
      return;
    }
    if (!["G0", "G1", "G2", "G3"].includes(command)) return;
    const nextX = params.has("X") ? params.get("X")! + (absolute ? 0 : x) : x,
      nextY = params.has("Y") ? params.get("Y")! + (absolute ? 0 : y) : y,
      nextZ = params.has("Z") ? params.get("Z")! + (absolute ? 0 : z) : z;
    const oldE = extruders.get(tool) ?? 0,
      nextE = params.has("E") ? params.get("E")! + (absoluteE ? 0 : oldE) : oldE,
      extrusion = nextE - oldE;
    if (extrusion > 0) {
      if (role === "support" || role === "support-interface")
        supportLength[tool] = (supportLength[tool] ?? 0) + extrusion;
      if (layerPending || layer === -1) {
        layer = buffer.layer(layerZ ?? nextZ, height);
        layerPending = false;
      }
      if (
        (command === "G2" || command === "G3") &&
        (params.has("I") || params.has("J") || params.has("R"))
      ) {
        let cx = x + (params.get("I") ?? 0),
          cy = y + (params.get("J") ?? 0);
        if (params.has("R")) {
          const radius = Math.abs(params.get("R")!),
            dx = nextX - x,
            dy = nextY - y,
            chord = Math.hypot(dx, dy);
          if (!chord || chord > radius * 2)
            throw new ModelPreviewError({
              reason: "command-failed",
              message: "The slicer emitted an invalid arc.",
            });
          const offset =
            Math.sqrt(radius * radius - (chord * chord) / 4) *
            ((command === "G2") === params.get("R")! > 0 ? -1 : 1);
          cx = (x + nextX) / 2 - (dy / chord) * offset;
          cy = (y + nextY) / 2 + (dx / chord) * offset;
        }
        const radius = Math.hypot(x - cx, y - cy),
          start = Math.atan2(y - cy, x - cx);
        let delta = Math.atan2(nextY - cy, nextX - cx) - start;
        if (command === "G2") {
          if (delta >= 0) delta -= Math.PI * 2;
        } else if (delta <= 0) delta += Math.PI * 2;
        const chords = Math.max(1, Math.ceil((Math.abs(delta) * radius) / 2));
        if (chords > 1000000)
          throw new ModelPreviewError({
            reason: "too-large",
            message: "The slicer emitted an arc too large to preview.",
          });
        let previousX = x,
          previousY = y;
        for (let i = 1; i <= chords; i++) {
          const px = i === chords ? nextX : cx + Math.cos(start + (delta * i) / chords) * radius,
            py = i === chords ? nextY : cy + Math.sin(start + (delta * i) / chords) * radius;
          buffer.add(layer, previousX, previousY, px, py, role);
          previousX = px;
          previousY = py;
        }
      } else if (nextX !== x || nextY !== y) buffer.add(layer, x, y, nextX, nextY, role);
    }
    x = nextX;
    y = nextY;
    z = nextZ;
    extruders.set(tool, nextE);
  };
  return {
    feed,
    finish() {
      const layers = buffer.finish();
      const estimate: PrintEstimate = {
        printSeconds,
        layerCount: reportedLayers ?? layers.layerCount,
        filaments: Array.from({ length: Math.max(lengths.length, grams.length) }, (_, slot) => ({
          slot,
          type: null,
          colorHex: null,
          lengthMm: lengths[slot] ?? null,
          grams: grams[slot] ?? null,
        })),
        totalGrams:
          totalGrams ?? (grams.length ? grams.reduce((sum, value) => sum + value, 0) : null),
        supportUsed: supportLength.some((length) => length > 0),
        supportGrams: null,
        cost: reportedCost,
        currency,
      };
      return { estimate, layers, supportLength };
    },
  };
};
