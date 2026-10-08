import type { PcbBounds, PcbInspection, PcbView } from "@t3tools/contracts/fork";
const attribute = (tag: string, name: string) =>
  tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1];
const value = (tag: string, name: string) => Number(attribute(tag, name));
/** Keep every KiCad layer on the same physical canvas, including otherwise empty layers. */
export function cropPhysicalSvg(svg: string, frame: PcbBounds): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const attributes = tag.replace(/\s(?:width|height|viewBox)=["'][^"']*["']/g, "");
    return attributes.replace(
      />$/,
      ` width="${frame.width}mm" height="${frame.height}mm" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}">`,
    );
  });
}
/** tscircuit exports pixels. Convert the drawing into the millimetre coordinates used by inspection. */
export function normalizeCircuitSvg(svg: string, inspection: PcbInspection, view: PcbView): string {
  const root = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!root) throw new Error("Invalid circuit SVG.");
  const width = value(root, "width"),
    height = value(root, "height");
  let sx: number, sy: number, tx: number, ty: number;
  if (view === "schematic") {
    const matrix = attribute(root, "data-real-to-screen-transform")
      ?.match(/matrix\(([^)]+)\)/)?.[1]
      ?.split(/[\s,]+/)
      .map(Number);
    if (!matrix || matrix.length !== 6 || matrix[1] !== 0 || matrix[2] !== 0)
      throw new Error("Unsupported schematic coordinate transform.");
    [sx, sy, tx, ty] = [matrix[0]!, -matrix[3]!, matrix[4]!, matrix[5]!];
  } else {
    const board = inspection.bounds;
    const outline = [...svg.matchAll(/<path\b[^>]*>/g)]
      .map((m) => m[0])
      .find((tag) => attribute(tag, "data-type") === "pcb_board");
    const coordinates = attribute(outline ?? "", "d")
      ?.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)
      ?.map(Number);
    if (
      !board ||
      board.width <= 0 ||
      board.height <= 0 ||
      !coordinates ||
      coordinates.length < 6 ||
      coordinates.length % 2
    )
      throw new Error("The circuit board has no physical outline.");
    const xs = coordinates.filter((_, i) => i % 2 === 0),
      ys = coordinates.filter((_, i) => i % 2 === 1);
    sx = (Math.max(...xs) - Math.min(...xs)) / board.width;
    sy = (Math.max(...ys) - Math.min(...ys)) / board.height;
    tx = Math.min(...xs) - sx * board.x;
    ty = Math.min(...ys) - sy * board.y;
  }
  if (
    ![sx, sy, tx, ty, width, height].every(Number.isFinite) ||
    sx <= 0 ||
    sy <= 0 ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Invalid circuit coordinate transform.");
  const frame = { x: -tx / sx, y: -ty / sy, width: width / sx, height: height / sy };
  const physical = cropPhysicalSvg(svg, frame);
  return physical
    .replace(
      /(<svg\b[^>]*>)/,
      `$1<g transform="matrix(${1 / sx} 0 0 ${1 / sy} ${-tx / sx} ${-ty / sy})">`,
    )
    .replace(/<\/svg>\s*$/, "</g></svg>");
}
