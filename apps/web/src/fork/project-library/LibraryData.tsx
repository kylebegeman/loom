import type { LibraryWorkflowTone } from "@t3tools/client-runtime/fork";
import type { ReactNode } from "react";
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
 * One series as a line over a soft area, for trends inside a table cell. Too small for axes, so
 * the caller states the total beside it and `label` carries the reading.
 */
export function Sparkline({
  values,
  label,
}: {
  readonly values: readonly number[];
  readonly label: string;
}) {
  const top = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const points = values.map((value, index) => `${index * step},${22 - (value / top) * 20}`);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="h-6 w-24 shrink-0 text-(--project-color)"
    >
      {values.length > 1 ? (
        <>
          <polygon points={`0,24 ${points.join(" ")} 100,24`} fill="currentColor" opacity={0.12} />
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
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
}: {
  /** A tick without a tone is an empty slot, so a short history still reads as a full track. */
  readonly ticks: readonly { readonly key: string; readonly tone: LibraryWorkflowTone | null }[];
  readonly label: string;
  /** `fill` stretches the ticks across the strip's container, for a strip that leads a panel. */
  readonly size?: "sm" | "lg" | "fill";
  /** With `onFocusTick`, the strip becomes a readout: hovering a tick dims the others. */
  readonly focused?: number | null;
  readonly onFocusTick?: (index: number | null) => void;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      onPointerLeave={onFocusTick ? () => onFocusTick(null) : undefined}
      className={cn(
        "items-stretch gap-0.5",
        size === "fill" ? "flex h-8 w-full" : "inline-flex",
        size === "lg" ? "h-7" : size === "sm" && "h-4",
      )}
    >
      {ticks.map((tick, index) => (
        <span
          key={tick.key}
          onPointerEnter={onFocusTick ? () => onFocusTick(index) : undefined}
          className={cn(
            "block shrink-0 rounded-xs transition-opacity duration-150",
            size === "fill" ? "max-w-3 min-w-1 flex-1" : size === "lg" ? "w-1.5" : "w-1",
            tick.tone ? TICK_TONES[tick.tone] : "bg-muted dark:bg-accent/60",
            focused != null && focused !== index && "opacity-35",
          )}
        />
      ))}
    </span>
  );
}
