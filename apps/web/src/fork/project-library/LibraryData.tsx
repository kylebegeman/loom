import type { LibraryWorkflowTone } from "@t3tools/client-runtime/fork";
import { useId, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * The overview table every Library index page shares: a hairline outline, a quiet header and
 * dense rows. A real table, so screen readers can move by column.
 */
export function LibraryTable({
  label,
  columns,
  children,
}: {
  readonly label: string;
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    /** Width and responsive visibility, shared by the header and every cell in the column. */
    readonly className?: string;
    readonly align?: "start" | "end";
    /** For a column of row actions, whose purpose the buttons already say. */
    readonly hideLabel?: boolean;
  }[];
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table aria-label={label} className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 dark:bg-accent/30">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "h-8 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground",
                  column.align === "end" ? "text-end" : "text-start",
                  column.className,
                )}
              >
                {column.hideLabel ? <span className="sr-only">{column.label}</span> : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

/** A table row the whole of which opens its item; the first cell holds the real button. */
export const LIBRARY_TABLE_ROW =
  "group relative transition-colors duration-150 hover:bg-accent/40 focus-within:bg-accent/40";

/** Stretches a row's first button over the row, so the target is the row and not just its name. */
export const LIBRARY_ROW_TARGET =
  "rounded-sm text-start outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

export const LIBRARY_CELL = "px-3 py-2.5 align-middle";

/**
 * `sm` sits in a table cell or a `LibraryVital` line, whose h-5 it must not overflow. `fill`
 * stretches across its container at panel height; `chart` is tall enough to lead a tab.
 */
const SPARKLINE_SIZE = {
  sm: "h-5 w-24",
  fill: "h-16 w-full",
  chart: "h-48 w-full",
} as const;

/**
 * One series as a line over a soft area, for trends inside a table cell or along a panel. Too
 * small for axes, so the caller states the total beside it and `label` carries the reading. The
 * area fades out toward the baseline: a flat fill reads as a solid box when a series stays high.
 */
export function Sparkline({
  values,
  label,
  size = "sm",
}: {
  readonly values: readonly number[];
  readonly label: string;
  readonly size?: keyof typeof SPARKLINE_SIZE;
}) {
  const top = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const points = values.map((value, index) => `${index * step},${22 - (value / top) * 20}`);
  const fadeId = `${useId().replaceAll(":", "")}-fade`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={cn("shrink-0 text-(--project-color)", SPARKLINE_SIZE[size])}
    >
      {values.length > 1 ? (
        <>
          <defs>
            <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity={0.2} />
              <stop offset="1" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={`0,24 ${points.join(" ")} 100,24`} fill={`url(#${fadeId})`} />
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={size === "sm" ? 1.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}
    </svg>
  );
}

const TICK_TONES: Record<LibraryWorkflowTone, string> = {
  neutral: "bg-muted-foreground/30",
  active: "bg-(--project-color)",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export type LibraryTick = {
  readonly key: string;
  /** A tick without a tone is an empty slot, so a short history still reads as a full track. */
  readonly tone: LibraryWorkflowTone | null;
  /** What the tick stands for, read out when ticks are buttons. */
  readonly label?: string;
};

/**
 * A row of thin status bars, one per item, oldest first: the uptime-strip shape status pages use,
 * so a run of failures reads as a block of color before any label is read.
 */
export function TickStrip({
  ticks,
  label,
  size = "sm",
  focused,
  onFocusTick,
  onSelectTick,
}: {
  readonly ticks: readonly LibraryTick[];
  readonly label: string;
  /**
   * `fill` stretches the ticks across the strip's container, for a strip that leads a panel.
   * `grid` wraps them into rows at a fixed pitch, for hundreds of items such as a batch.
   */
  readonly size?: "sm" | "lg" | "fill" | "grid";
  /** With `onFocusTick`, the strip becomes a readout: pointing at a tick dims the others. */
  readonly focused?: number | null;
  readonly onFocusTick?: (index: number | null) => void;
  /** Makes each toned tick a button that opens its item, such as the run behind it. */
  readonly onSelectTick?: (index: number) => void;
}) {
  return (
    <span
      role={onSelectTick ? "group" : "img"}
      aria-label={label}
      onPointerLeave={onFocusTick ? () => onFocusTick(null) : undefined}
      className={cn(
        "items-stretch gap-0.5",
        size === "fill" && "flex h-8 w-full",
        size === "grid" && "grid w-full grid-cols-[repeat(auto-fill,minmax(0.5rem,1fr))] gap-1",
        (size === "sm" || size === "lg") && "inline-flex",
        size === "lg" ? "h-7" : size === "sm" && "h-4",
      )}
    >
      {ticks.map((tick, index) => {
        const className = cn(
          "block shrink-0 rounded-xs transition-opacity duration-150",
          size === "fill"
            ? "max-w-3 min-w-1 flex-1"
            : size === "grid"
              ? "h-5"
              : size === "lg"
                ? "w-1.5"
                : "w-1",
          tick.tone ? TICK_TONES[tick.tone] : "bg-muted dark:bg-accent/60",
          focused != null && focused !== index && "opacity-35",
        );
        const hover = onFocusTick ? () => onFocusTick(index) : undefined;
        return onSelectTick && tick.tone ? (
          <button
            key={tick.key}
            type="button"
            aria-label={tick.label}
            onPointerEnter={hover}
            onFocus={hover}
            onBlur={onFocusTick ? () => onFocusTick(null) : undefined}
            onClick={() => onSelectTick(index)}
            className={cn(
              className,
              "cursor-pointer outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          />
        ) : (
          <span
            key={tick.key}
            aria-hidden={onSelectTick ? true : undefined}
            onPointerEnter={hover}
            className={className}
          />
        );
      })}
    </span>
  );
}

/**
 * How much of a limit is used, as a thin track in one hue. The fill turns to a status tone only
 * at the threshold, so a meter shouts when it matters and stays quiet otherwise. Always labelled.
 */
export function LibraryMeter({
  value,
  max,
  label,
  warnAt = 0.8,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  /** The share of `max` at which the fill turns to a warning. */
  readonly warnAt?: number;
}) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted dark:bg-accent"
    >
      <span
        className={cn(
          "absolute inset-y-0 start-0 rounded-full",
          share >= 1 ? "bg-destructive" : share >= warnAt ? "bg-warning" : "bg-(--project-color)",
        )}
        style={{ width: `${share * 100}%` }}
      />
    </span>
  );
}

/**
 * One magnitude as a thin bar beside its value, for comparing rows in a table column. The value
 * stays in text ink; the bar carries the item's color. `share` is the row's part of the largest.
 */
export function LibraryBar({
  share,
  children,
}: {
  readonly share: number;
  readonly children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="relative h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-muted dark:bg-accent"
      >
        <span
          className="absolute inset-y-0 start-0 rounded-full bg-(--project-color)/70"
          style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
        />
      </span>
      <span className="shrink-0 tabular-nums">{children}</span>
    </span>
  );
}
