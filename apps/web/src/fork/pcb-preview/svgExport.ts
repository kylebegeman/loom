import type { PcbBounds } from "@t3tools/contracts/fork";
export const LIGHT_CANVAS = "#f1f3f5";
export const MAX_EXPORT_PIXELS = 16_777_216;
export const MAX_EXPORT_SIDE = 8192;
export const SVG_EXPORT_MAX_BYTES = 32 * 1024 * 1024;
const SVG_NS = "http://www.w3.org/2000/svg";
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** Keeps PNG exports within the browser's canvas area and side limits. */
export function exportFactor(width: number, height: number, wanted: number) {
  if (![width, height, wanted].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("The drawing has no exportable area.");
  let factor = Math.min(
    wanted,
    MAX_EXPORT_SIDE / width,
    MAX_EXPORT_SIDE / height,
    Math.sqrt(MAX_EXPORT_PIXELS / width / height),
  );
  while (Math.ceil(width * factor) * Math.ceil(height * factor) > MAX_EXPORT_PIXELS)
    factor = Math.min(
      (Math.ceil(width * factor) - 1) / width,
      (Math.ceil(height * factor) - 1) / height,
    );
  return { factor, reduced: factor < wanted };
}

/** Maps a panned/zoomed viewport back to clipped physical drawing coordinates. */
export function visibleArea(
  view: { x: number; y: number; scale: number },
  viewport: { width: number; height: number },
  drawing: { width: number; height: number },
  physical: PcbBounds,
): PcbBounds {
  if (view.scale <= 0 || drawing.width <= 0 || drawing.height <= 0)
    throw new Error("The drawing has no exportable area.");
  const x = physical.x + ((-view.x / view.scale) * physical.width) / drawing.width,
    y = physical.y + ((-view.y / view.scale) * physical.height) / drawing.height,
    right = x + ((viewport.width / view.scale) * physical.width) / drawing.width,
    bottom = y + ((viewport.height / view.scale) * physical.height) / drawing.height,
    left = Math.max(physical.x, Math.min(physical.x + physical.width, x)),
    top = Math.max(physical.y, Math.min(physical.y + physical.height, y));
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.min(physical.x + physical.width, right) - left),
    height: Math.max(0, Math.min(physical.y + physical.height, bottom) - top),
  };
}
export type SvgLayer = { svg: string; opacity: number };

const parseSvg = (source: string) => {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg")
    throw new Error("The drawing contains invalid SVG.");
  return doc.documentElement;
};
const escapePattern = (value: string) => value.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&");
const localReference = (value: string) => value.startsWith("#") || /^data:image\//i.test(value);

/** Removes active/external content and isolates each layer's ids and class rules. */
function prepareSvg(source: string, prefix: string) {
  const svg = parseSvg(source);
  svg.querySelectorAll("script,foreignObject").forEach((node) => node.remove());
  const elements = [svg, ...svg.querySelectorAll("*")],
    ids = new Map<string, string>();
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (id) {
      ids.set(id, prefix + "-" + id);
      element.setAttribute("id", prefix + "-" + id);
    }
  }
  const references = (value: string) =>
    value.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (_whole, target: string) =>
      target.startsWith("#")
        ? "url(#" + (ids.get(target.slice(1)) ?? prefix + "-" + target.slice(1)) + ")"
        : localReference(target)
          ? "url(" + target + ")"
          : "none",
    );
  for (const element of elements) {
    for (const attribute of element
      .getAttributeNames()
      .map((name) => element.getAttributeNode(name)!)) {
      const name = attribute.name.toLowerCase(),
        value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name === "src" ||
        ((name === "href" || name.endsWith(":href")) && !localReference(value))
      ) {
        element.removeAttribute(attribute.name);
      } else if ((name === "href" || name.endsWith(":href")) && value.startsWith("#")) {
        element.setAttribute(
          attribute.name,
          "#" + (ids.get(value.slice(1)) ?? prefix + "-" + value.slice(1)),
        );
      } else element.setAttribute(attribute.name, references(attribute.value));
    }
    if (element.localName === "style") {
      let css = references(element.textContent ?? "").replace(/@import[^;]*;/gi, "");
      for (const [oldId, newId] of ids)
        css = css.replace(
          new RegExp("#" + escapePattern(oldId) + "(?=[^A-Za-z0-9_-]|$)", "g"),
          () => "#" + newId,
        );
      element.textContent = css.replace(
        /([^{}]+)\{([^{}]*)\}/g,
        (_rule, selectors: string, body: string) =>
          selectors.trim().startsWith("@")
            ? selectors + "{" + body + "}"
            : selectors
                .split(",")
                .map((selector) => "#" + prefix + " " + selector.trim())
                .join(",") +
              "{" +
              body +
              "}",
      );
    }
  }
  return svg;
}
function placeSvg(svg: Element) {
  const frame = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    !frame ||
    frame.length !== 4 ||
    !frame.every(Number.isFinite) ||
    frame[2]! <= 0 ||
    frame[3]! <= 0
  )
    throw new Error("The drawing has no physical SVG frame.");
  for (const [i, name] of ["x", "y", "width", "height"].entries())
    svg.setAttribute(name, String(frame[i]));
}

/** Composes editable SVG layers in millimetres, followed by pinned markup. */
export function composeSvg(input: {
  area: PcbBounds;
  layers: readonly SvgLayer[];
  overlay: string | null;
  background: string | null;
  title: string;
}): string {
  const { area } = input;
  if (!Object.values(area).every(Number.isFinite) || area.width <= 0 || area.height <= 0)
    throw new Error("There is no drawing in the visible area.");
  const doc = document.implementation.createDocument(SVG_NS, "svg", null),
    root = doc.documentElement;
  root.setAttribute("width", String(area.width) + "mm");
  root.setAttribute("height", String(area.height) + "mm");
  root.setAttribute("viewBox", [area.x, area.y, area.width, area.height].join(" "));
  const title = doc.createElementNS(SVG_NS, "title");
  title.textContent = input.title;
  root.append(title);
  if (input.background) {
    const background = doc.createElementNS(SVG_NS, "rect");
    for (const name of ["x", "y", "width", "height"] as const)
      background.setAttribute(name, String(area[name]));
    background.setAttribute("fill", input.background);
    root.append(background);
  }
  let size = 0;
  const append = (source: string, prefix: string, opacity: number) => {
    size += bytes(source);
    if (size > SVG_EXPORT_MAX_BYTES)
      throw new Error("This drawing is too large to save as SVG. Save a PNG instead.");
    const svg = prepareSvg(source, prefix);
    placeSvg(svg);
    const group = doc.createElementNS(SVG_NS, "g");
    group.setAttribute("id", prefix);
    group.setAttribute("opacity", String(Math.max(0, Math.min(1, opacity))));
    group.append(doc.importNode(svg, true));
    root.append(group);
  };
  input.layers.forEach((layer, index) => {
    if (Number.isFinite(layer.opacity) && layer.opacity > 0)
      append(layer.svg, "layer-" + (index + 1), layer.opacity);
  });
  if (input.overlay) append(input.overlay, "overlay", 1);
  const result = new XMLSerializer().serializeToString(root);
  if (bytes(result) > SVG_EXPORT_MAX_BYTES)
    throw new Error("This drawing is too large to save as SVG. Save a PNG instead.");
  return result;
}
