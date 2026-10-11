import { memo } from "react";
import type { PcbFinding, PcbPoint } from "@t3tools/contracts/fork";
import { useOverlayScale } from "./SvgViewport";
import { markerSize } from "./findings";

const colors = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
};
/** The viewport owns picking; markers stay passive and are included in SVG/PNG captures. */
export const CheckMarkers = memo(function CheckMarkers({
  findings,
  activeId,
  activePoints,
  stale,
  excludedIds,
  addedIds,
}: {
  findings: readonly PcbFinding[];
  activeId: string | null;
  activePoints: readonly PcbPoint[];
  stale: boolean;
  excludedIds?: ReadonlySet<string>;
  addedIds?: readonly string[] | undefined;
}) {
  const size = markerSize(useOverlayScale());
  const active = findings.find((f) => f.id === activeId);
  return (
    <g opacity={stale ? 0.45 : 1} pointerEvents="none" strokeWidth={size.stroke}>
      {findings
        .toSorted((a, b) => Number(a.severity === "error") - Number(b.severity === "error"))
        .map((f) => (
          <circle
            key={f.id}
            cx={f.pointMm.x}
            cy={f.pointMm.y}
            r={size.radius}
            fill={excludedIds?.has(f.id) ? "none" : colors[f.severity]}
            stroke={excludedIds?.has(f.id) ? colors[f.severity] : "var(--color-background)"}
          />
        ))}
      {findings
        .filter((f) => addedIds?.includes(f.id))
        .map((f) => (
          <circle
            key={`new-${f.id}`}
            cx={f.pointMm.x}
            cy={f.pointMm.y}
            r={size.ring}
            fill="none"
            stroke={colors[f.severity]}
          />
        ))}
      {active && (
        <g fill="none" stroke={colors[active.severity]}>
          <circle cx={active.pointMm.x} cy={active.pointMm.y} r={size.ring} />
          {[...new Map(activePoints.map((point) => [`${point.x}:${point.y}`, point])).values()].map(
            (point) => (
              <g key={`${point.x}:${point.y}`}>
                <polyline
                  points={`${active.pointMm.x},${active.pointMm.y} ${point.x},${point.y}`}
                />
                <circle cx={point.x} cy={point.y} r={size.radius} />
              </g>
            ),
          )}
        </g>
      )}
    </g>
  );
});
