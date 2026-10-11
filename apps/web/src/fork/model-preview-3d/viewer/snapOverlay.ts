import styles from "../workspace.module.css";
import type { SnapKind } from "./snap";
/** Hover marks stay outside the scene and captures, and never request a WebGL frame. */
export function createSnapOverlay(host: HTMLElement) {
  let element: HTMLDivElement | null = null,
    marker: HTMLDivElement | null = null,
    path: SVGPolylineElement | null = null,
    label: HTMLDivElement | null = null;
  const ensure = () => {
    if (element) return;
    element = document.createElement("div");
    element.className = styles["model-snap"]!;
    marker = document.createElement("div");
    marker.className = styles["model-snap-marker"]!;
    label = document.createElement("div");
    label.className = styles["model-snap-label"]!;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("class", styles["model-snap-path"]!);
    svg.append(path);
    element.append(svg, marker, label);
    host.append(element);
  };
  return {
    show(kind: SnapKind, x: number, y: number, points: number[] | null, text?: string) {
      ensure();
      element!.hidden = false;
      marker!.hidden = kind === "face";
      marker!.dataset.kind = kind;
      marker!.style.transform = `translate(${x}px, ${y}px)`;
      path!.setAttribute("points", points?.join(" ") ?? "");
      label!.hidden = !text;
      label!.textContent = text ?? "";
      label!.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    },
    hide() {
      if (element) element.hidden = true;
    },
    dispose() {
      element?.remove();
      element = null;
      marker = null;
      path = null;
      label = null;
    },
  };
}
