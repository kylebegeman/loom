import { useMemo } from "react";
import type { PcbChangeRequest, PcbInspection, PcbView } from "@t3tools/contracts/fork";
import { anchorPoint } from "./requests";
import { useOverlayScale } from "./SvgViewport";
export function RequestPins({
  requests,
  inspection,
  view,
  sheet,
  only,
}: {
  requests: readonly PcbChangeRequest[];
  inspection: PcbInspection | null;
  view: PcbView;
  sheet: string;
  only?: readonly string[] | null | undefined;
}) {
  const size = useOverlayScale();
  const positions = useMemo(
    () => new Map(requests.map((r) => [r.id, anchorPoint(r.anchor, inspection, view, sheet)])),
    [requests, inspection, view, sheet],
  );
  const numbers = useMemo(
    () => new Map((only ?? requests.map((r) => r.id)).map((id, i) => [id, i + 1])),
    [requests, only],
  );
  return (
    <g pointerEvents="none">
      {requests
        .filter(
          (r) =>
            (!only || only.includes(r.id)) &&
            r.view === view &&
            (view === "pcb" || r.sheet === sheet),
        )
        .map((r) => {
          const p = positions.get(r.id);
          if (!p) return null;
          const number = numbers.get(r.id);
          const color = `var(--color-${r.status === "accepted" ? "muted-foreground" : r.status === "review" ? "warning" : "primary"})`;
          return (
            <g key={r.id} stroke={color} strokeWidth={size * 1.5} fill="none">
              {r.anchor.kind === "area" && (
                <rect {...r.anchor.box} strokeDasharray={`${size * 4} ${size * 3}`} />
              )}
              <circle cx={p.x} cy={p.y} r={size * 9} fill="var(--color-background)" />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={size * 11}
                stroke="none"
                fill={color}
              >
                {number}
              </text>
            </g>
          );
        })}
    </g>
  );
}
