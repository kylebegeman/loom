import type {
  PcbReviewResult,
  PcbCheckResult,
  PcbFinding,
  PcbPoint,
} from "@t3tools/contracts/fork";

/** Marker metadata stays local; the shared wire finding contains only drawing information. */
export type DrawingFinding = PcbFinding & { excluded: boolean; otherPoints: readonly PcbPoint[] };
export function checkFindings(
  result:
    | { outcome: string; violations: readonly PcbCheckResult["violations"][number][] }
    | null
    | undefined,
  source: "erc" | "drc" | "fab",
  { showExcluded }: { showExcluded: boolean },
): DrawingFinding[] {
  if (!result || result.outcome === "failed" || result.outcome === "timed-out") return [];
  return result.violations.flatMap((v, index) => {
    if (v.excluded && !showExcluded) return [];
    const points = v.items.flatMap((item) =>
      Number.isFinite(item.x) && Number.isFinite(item.y) ? [{ x: item.x!, y: item.y! }] : [],
    );
    if (!points[0]) return [];
    return [
      {
        id: source === "fab" ? `fab:${v.id ?? index}` : (v.id ?? `${source}-${index}`),
        source,
        severity: v.severity,
        message: v.description,
        ...(source === "erc" && v.sheetId ? { sheet: v.sheetId } : {}),
        pointMm: points[0],
        excluded: v.excluded,
        otherPoints: points.slice(1),
      },
    ];
  });
}
export function orderFindings<A extends PcbFinding>(
  findings: readonly A[],
  sheetOrder: readonly string[],
): A[] {
  const severity = { error: 0, warning: 1, info: 2 };
  const sheetIndex = (sheet?: string) => {
    const index = sheetOrder.indexOf(sheet ?? "");
    return index < 0 ? sheetOrder.length : index;
  };
  return findings.toSorted(
    (a, b) =>
      severity[a.severity] - severity[b.severity] ||
      sheetIndex(a.sheet) - sheetIndex(b.sheet) ||
      Math.round(a.pointMm.y * 10) - Math.round(b.pointMm.y * 10) ||
      a.pointMm.x - b.pointMm.x ||
      a.id.localeCompare(b.id),
  );
}
export function stepFinding<A extends PcbFinding>(
  ordered: readonly A[],
  activeId: string | null,
  direction: 1 | -1,
) {
  if (!ordered.length) return null;
  const active = ordered.findIndex((finding) => finding.id === activeId);
  const next = active < 0 ? (direction === 1 ? 0 : ordered.length - 1) : active + direction;
  const index = (next + ordered.length) % ordered.length;
  return {
    finding: ordered[index]!,
    index,
    wrapped: active >= 0 && (next < 0 || next >= ordered.length),
  };
}
export function hitFinding<A extends PcbFinding>(
  findings: readonly A[],
  point: PcbPoint,
  unitsPerPixel: number,
): A | null {
  if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) return null;
  let nearest: A | null = null,
    distance = 8 * unitsPerPixel;
  for (const finding of findings) {
    const next = Math.hypot(finding.pointMm.x - point.x, finding.pointMm.y - point.y);
    if (next <= distance) {
      distance = next;
      nearest = finding;
    }
  }
  return nearest;
}
export const markerSize = (unitsPerPixel: number) => ({
  radius: 5 * unitsPerPixel,
  ring: 9 * unitsPerPixel,
  stroke: 1.5 * unitsPerPixel,
});
/** Keep local metadata out of the bounded agent snapshot. */
export const snapshotFinding = ({
  id,
  source,
  severity,
  message,
  sheet,
  layer,
  pointMm,
}: PcbFinding): PcbFinding => ({
  id,
  source,
  severity,
  message,
  ...(sheet ? { sheet } : {}),
  ...(layer ? { layer } : {}),
  pointMm,
});

export function reviewFindings(
  result: PcbReviewResult | null | undefined,
  surface: "schematic" | "pcb",
  { showExcluded }: { showExcluded: boolean },
): DrawingFinding[] {
  if (!result || result.outcome === "failed") return [];
  return result.findings.flatMap((f) => {
    const point = surface === "pcb" ? f.board : f.schematic;
    if (!point || (f.waived && !showExcluded)) return [];
    return [
      {
        id: f.id,
        source: "review",
        severity: f.severity,
        message: f.message,
        pointMm: { x: point.x, y: point.y },
        ...(point.sheet ? { sheet: point.sheet } : {}),
        ...(point.layer ? { layer: point.layer } : {}),
        excluded: f.waived,
        otherPoints: [],
      },
    ];
  });
}
