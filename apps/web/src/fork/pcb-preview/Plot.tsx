import { useEffect, useRef, useState } from "react";
import { decadeTicks, formatEng, niceTicks } from "./units";
import k from "./inspector.module.css";

export type PlotTrace = { name: string; color: string; values: readonly number[] };
const HEIGHT = 176,
  PAD = { left: 46, right: 10, top: 10, bottom: 22 };

/** Index of the sample nearest `value` in an ascending axis. */
function nearest(axis: readonly number[], value: number) {
  let lo = 0,
    hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((axis[mid] ?? 0) < value) lo = mid;
    else hi = mid;
  }
  return Math.abs((axis[hi] ?? 0) - value) < Math.abs((axis[lo] ?? 0) - value) ? hi : lo;
}

/**
 * A static SVG line plot sized to its container. Each pixel column keeps only its extremes, so
 * ten thousand samples draw as a few hundred points, and nothing repaints until the pointer moves.
 */
export function Plot({
  x,
  xUnit,
  yUnit,
  log,
  traces,
}: {
  x: readonly number[];
  xUnit: string;
  yUnit: string;
  log: boolean;
  traces: readonly PlotTrace[];
}) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(0),
    [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry?.contentRect.width ?? 0)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const xs = log ? x.filter((v) => v > 0) : x;
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  let yMin = Infinity,
    yMax = -Infinity;
  for (const t of traces)
    for (const v of t.values)
      if (Number.isFinite(v)) {
        yMin = Math.min(yMin, v);
        yMax = Math.max(yMax, v);
      }
  if (!Number.isFinite(yMin)) [yMin, yMax] = [0, 1];
  if (yMin === yMax) [yMin, yMax] = [yMin - 1, yMax + 1];
  const yPad = (yMax - yMin) * 0.06;
  yMin -= yPad;
  yMax += yPad;
  const plotW = Math.max(1, width - PAD.left - PAD.right),
    plotH = HEIGHT - PAD.top - PAD.bottom;
  const fx = (v: number) =>
    log
      ? (Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin) || 1)
      : (v - xMin) / (xMax - xMin || 1);
  const sx = (v: number) => PAD.left + fx(v) * plotW,
    sy = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const path = (values: readonly number[]) => {
    const points: string[] = [];
    let column = -1,
      low = 0,
      high = 0;
    const flush = () => {
      if (column < 0) return;
      points.push(`${column},${sy(low).toFixed(1)}`);
      if (high !== low) points.push(`${column},${sy(high).toFixed(1)}`);
    };
    for (let i = 0; i < x.length; i++) {
      const xv = x[i]!,
        v = values[i];
      if (v === undefined || !Number.isFinite(v) || (log && xv <= 0)) continue;
      const px = Math.round(sx(xv));
      if (px !== column) {
        flush();
        column = px;
        low = high = v;
      } else {
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
    }
    flush();
    return points.length ? `M${points.join("L")}` : "";
  };
  const xTicks = log
    ? decadeTicks(xMin, xMax)
    : niceTicks(xMin, xMax, Math.max(2, Math.floor(plotW / 70)));
  const yTicks = niceTicks(yMin, yMax, 4).filter((t) => t >= yMin && t <= yMax);
  const at = hover;
  const hoverX = at === null ? 0 : sx(x[at] ?? xMin);
  return (
    <div ref={ref} className={k.plot}>
      {width > 0 && xs.length > 1 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${traces.map((t) => t.name).join(", ") || "No signals"} against ${log ? "frequency" : "time"}`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - box.left - PAD.left) / plotW;
            if (ratio < 0 || ratio > 1) return setHover(null);
            const value = log
              ? 10 ** (Math.log10(xMin) + ratio * (Math.log10(xMax) - Math.log10(xMin)))
              : xMin + ratio * (xMax - xMin);
            setHover(nearest(x, value));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <g className={k.plotGrid}>
            {yTicks.map((t) => (
              <line key={`y${t}`} x1={PAD.left} x2={PAD.left + plotW} y1={sy(t)} y2={sy(t)} />
            ))}
            {xTicks.map((t) => (
              <line key={`x${t}`} x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={PAD.top + plotH} />
            ))}
          </g>
          <g className={k.plotAxis}>
            {yTicks.map((t) => (
              <text
                key={`y${t}`}
                x={PAD.left - 6}
                y={sy(t)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatEng(t, yUnit, 3)}
              </text>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={sx(t)} y={HEIGHT - 6} textAnchor="middle">
                {formatEng(t, xUnit, 3)}
              </text>
            ))}
          </g>
          {traces.map((t) => (
            <path key={t.name} d={path(t.values)} fill="none" stroke={t.color} strokeWidth={1.5} />
          ))}
          {at !== null && (
            <g>
              <line
                className={k.plotCursor}
                x1={hoverX}
                x2={hoverX}
                y1={PAD.top}
                y2={PAD.top + plotH}
              />
              {traces.map((t) => {
                const v = t.values[at];
                return v === undefined || !Number.isFinite(v) ? null : (
                  <circle key={t.name} cx={hoverX} cy={sy(v)} r={3} fill={t.color} />
                );
              })}
            </g>
          )}
        </svg>
      )}
      {at !== null && (
        <div
          className={k.plotReadout}
          data-side={hoverX > width / 2 ? "left" : "right"}
          style={{ left: hoverX }}
        >
          <span>{formatEng(x[at] ?? Number.NaN, xUnit, 4)}</span>
          {traces.map((t) => (
            <span key={t.name}>
              <i style={{ background: t.color }} aria-hidden="true" />
              {t.name}
              <b>{formatEng(t.values[at] ?? Number.NaN, yUnit, 4)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
