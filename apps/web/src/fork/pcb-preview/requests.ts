import type {
  PcbChangeRequest,
  PcbRequestAnchor,
  PcbInspection,
  PcbView,
  PcbComparison,
} from "@t3tools/contracts/fork";
export const requestStatus = (r: PcbChangeRequest, hash: string | null) =>
  r.status === "accepted"
    ? "Accepted"
    : r.status === "review"
      ? "Ready for review"
      : hash && r.sourceHash !== hash
        ? "Design changed"
        : !r.sentAt
          ? "Draft"
          : "Requested";
export function anchorPoint(
  anchor: PcbRequestAnchor,
  inspection: PcbInspection | null,
  view: PcbView,
  sheet: string,
) {
  if (anchor.kind === "area")
    return { x: anchor.box.x + anchor.box.width / 2, y: anchor.box.y + anchor.box.height / 2 };
  if (!inspection) return null;
  if (anchor.kind === "component") {
    const p = inspection.components.find((c) => c.reference === anchor.reference)?.[view];
    return p && (view === "pcb" || p.sheet === sheet) ? p : null;
  }
  const points = inspection.components.flatMap((c) =>
    c.pins
      .filter((p) => p.net === anchor.name)
      .flatMap((p) => {
        const pos = p[view];
        return pos && (view === "pcb" || pos.sheet === sheet) ? [pos] : [];
      }),
  );
  return points.length
    ? {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      }
    : null;
}
export const describeAnchor = (a: PcbRequestAnchor) =>
  a.kind === "component"
    ? a.reference
    : a.kind === "net"
      ? `net ${a.name}`
      : `area ${a.box.width.toFixed(1)} × ${a.box.height.toFixed(1)} mm at (${a.box.x.toFixed(1)}, ${a.box.y.toFixed(1)})`;
export function changesNearAnchor(
  comparison: PcbComparison,
  anchor: PcbRequestAnchor,
  view: PcbView,
  sheet = "",
  marginMm = 2,
) {
  const refs = new Set<string>();
  if (anchor.kind === "component") refs.add(anchor.reference);
  for (const inspected of [comparison.before, comparison.after]) {
    const nets =
      anchor.kind === "net"
        ? new Set([anchor.name])
        : anchor.kind === "component"
          ? new Set(
              inspected.components
                .find((c) => c.reference === anchor.reference)
                ?.pins.map((p) => p.net)
                .filter(Boolean),
            )
          : new Set<string>();
    for (const c of inspected.components) {
      if (anchor.kind === "area") {
        const p = c[view],
          b = anchor.box;
        if (
          p &&
          (view === "pcb" || p.sheet === sheet) &&
          p.x >= b.x - marginMm &&
          p.x <= b.x + b.width + marginMm &&
          p.y >= b.y - marginMm &&
          p.y <= b.y + b.height + marginMm
        )
          refs.add(c.reference);
      } else if (c.pins.some((p) => nets.has(p.net))) refs.add(c.reference);
    }
  }
  return {
    near: comparison.changes.filter((c) => refs.has(c.reference)),
    elsewhere: comparison.changes.filter((c) => !refs.has(c.reference)),
  };
}
export function requestPrompt(
  requests: readonly PcbChangeRequest[],
  design: string,
  revision: string,
) {
  return `PCB change requests: ${design}\nDesign revision: ${revision}\n${requests.map((r, i) => `${i + 1}. ${r.title} (${describeAnchor(r.anchor)}, ${r.view}; sheet ${r.sheet}; requestId ${r.id})\n${r.request}`).join("\n")}\nThe attached captures mark each request by number. Change only what each request asks and keep unrelated parts, nets and placement. When one is done, mark it ready for review with loom_pcb_update_change_request and say what you changed.`;
}
