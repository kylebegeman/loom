import type {
  PcbChangeSet,
  PcbChangeRegion,
  PcbInspection,
  PcbView,
} from "@t3tools/contracts/fork";
import { useOverlayScale } from "./SvgViewport";
export function ChangeHighlights({
  set,
  regions,
  view,
  sheet,
  before,
  after,
}: {
  set: PcbChangeSet;
  regions: readonly PcbChangeRegion[];
  view: PcbView;
  sheet: string;
  before: PcbInspection;
  after: PcbInspection;
}) {
  const size = useOverlayScale() * 5;
  const visible = (p: { sheet?: string | undefined } | undefined) =>
    !!p && (view === "pcb" || p.sheet === sheet);
  const tones = { added: "success", removed: "destructive", moved: "info", changed: "warning" };
  return (
    <g pointerEvents="none" fill="none" strokeWidth={0.3 * size}>
      {set.components.map((c) => {
        const loc = c[view],
          a = loc?.from,
          b = loc?.to,
          p = c.kind === "removed" ? a : b;
        if (!p || !visible(p)) return null;
        return (
          <g key={c.reference} stroke={`var(--color-${tones[c.kind]})`}>
            {c.kind === "removed" ? (
              <path
                d={`M ${p.x - 1.4 * size} ${p.y - 1.4 * size} l ${2.8 * size} ${2.8 * size} M ${p.x - 1.4 * size} ${p.y + 1.4 * size} l ${2.8 * size} ${-2.8 * size}`}
              />
            ) : (
              <circle cx={p.x} cy={p.y} r={1.8 * size} />
            )}
            {c.kind === "moved" && a && b && visible(a) && visible(b) && (
              <g>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <path
                  transform={`translate(${b.x} ${b.y}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})`}
                  d={`M ${-size} ${-0.6 * size} L 0 0 L ${-size} ${0.6 * size}`}
                />
              </g>
            )}
          </g>
        );
      })}
      {set.nets.flatMap((n) =>
        (["joined", "left"] as const).flatMap((kind) =>
          n[kind].flatMap((m) => {
            const p = (kind === "joined" ? after : before).components
              .find((c) => c.reference === m.reference)
              ?.pins.find((p) => p.number === m.pin)?.[view];
            return p && visible(p)
              ? [
                  <rect
                    key={`${n.name}:${kind}:${m.reference}:${m.pin}`}
                    x={p.x - 0.3 * size}
                    y={p.y - 0.3 * size}
                    width={0.6 * size}
                    height={0.6 * size}
                    stroke={`var(--color-${kind === "joined" ? "success" : "destructive"})`}
                  />,
                ]
              : [];
          }),
        ),
      )}
      {regions.map((r) => (
        <rect
          key={`${r.x}:${r.y}:${r.width}:${r.height}`}
          {...r}
          stroke="var(--color-muted-foreground)"
          strokeDasharray={`${size} ${size}`}
        />
      ))}
    </g>
  );
}
