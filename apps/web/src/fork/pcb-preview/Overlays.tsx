import type { PcbComponent, PcbPoint, PcbWorkspace, PcbView } from "@t3tools/contracts/fork";
import { measurementLabel } from "./geometry";
export function DrawingOverlays({
  data,
  sourceHash,
  view,
  sheet,
  selected,
  net,
  components,
  pending,
}: {
  data: PcbWorkspace;
  sourceHash: string;
  view: PcbView;
  sheet: string;
  selected: string | null;
  net: string | null;
  components: readonly PcbComponent[];
  pending: readonly PcbPoint[];
}) {
  const markers = components.flatMap((c) => {
    const p = view === "pcb" ? c.pcb : c.schematic;
    if (!p || (view === "schematic" && p.sheet !== sheet)) return [];
    if (net)
      return c.pins
        .filter((pin) => pin.net === net)
        .flatMap((pin) => {
          const pos = view === "pcb" ? pin.pcb : pin.schematic;
          return pos && (view === "pcb" || pos.sheet === sheet)
            ? [{ key: `${c.reference}:${pin.number}:${pos.x}:${pos.y}`, ...pos }]
            : [];
        });
    return c.reference === selected ? [{ key: c.reference, ...p }] : [];
  });
  return (
    <g fill="none" stroke="var(--color-primary)" strokeWidth=".35" pointerEvents="none">
      {markers.map((p) => (
        <g key={p.key}>
          <circle cx={p.x} cy={p.y} r="1.4" />
          <circle cx={p.x} cy={p.y} r=".25" fill="var(--color-primary)" />
        </g>
      ))}
      {data.measurements
        .filter(
          (m) =>
            m.sourceHash === sourceHash && m.view === view && (view === "pcb" || m.sheet === sheet),
        )
        .map((m) => (
          <g key={m.id}>
            <polyline
              points={m.points.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="var(--color-warning)"
            />
            <text
              x={m.points[0]!.x}
              y={m.points[0]!.y - 1}
              fill="var(--color-warning)"
              stroke="none"
              fontFamily="sans-serif"
              fontSize="1.8"
            >
              {measurementLabel(m)}
            </text>
          </g>
        ))}
      {data.annotations
        .filter(
          (a) =>
            a.sourceHash === sourceHash && a.view === view && (view === "pcb" || a.sheet === sheet),
        )
        .map((a) => (
          <g key={a.id}>
            <circle cx={a.point.x} cy={a.point.y} r=".6" fill="var(--color-chart-4)" />
            <text
              x={a.point.x + 1}
              y={a.point.y}
              fill="var(--color-chart-4)"
              stroke="none"
              fontFamily="sans-serif"
              fontSize="2"
            >
              {a.text}
            </text>
          </g>
        ))}
      {pending.map((p) => (
        <circle key={`${p.x}:${p.y}`} cx={p.x} cy={p.y} r=".5" fill="var(--color-warning)" />
      ))}
    </g>
  );
}
