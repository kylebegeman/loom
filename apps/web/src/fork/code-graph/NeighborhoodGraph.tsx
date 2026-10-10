import { useMemo } from "react";
import type { CodeGraphNeighborhood } from "@t3tools/contracts/fork";
import { radialLayout, type PlacedNode } from "./radialLayout";

/** The square the layout fills; the SVG scales to the panel width. */
const SIZE = 320;
const RADIUS = [7, 5, 3];
const LABEL_CHARS = 18;

const shortLabel = (label: string) =>
  label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label;

/** Labels sit outside their node, away from the center. */
function labelPlacement(entry: PlacedNode) {
  if (entry.depth === 0) return { x: entry.x, y: entry.y + 18, anchor: "middle" as const };
  const right = entry.x >= SIZE / 2;
  return {
    x: entry.x + (right ? 9 : -9),
    y: entry.y + 3.5,
    anchor: right ? "start" : "end",
  } as const;
}

/**
 * A static radial picture of a node's neighborhood. Selecting a node refocuses on it. Second-hop
 * nodes are unlabeled dots with a tooltip so the picture stays legible.
 */
export function NeighborhoodGraph({
  hood,
  onFocus,
}: {
  hood: CodeGraphNeighborhood;
  onFocus: (nodeId: string) => void;
}) {
  const layout = useMemo(() => radialLayout(hood, SIZE), [hood]);
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full max-w-96 self-center overflow-visible"
      role="group"
      aria-label={`Neighborhood of ${hood.focus.label}`}
    >
      <g className="stroke-border">
        {layout.edges.map(({ from, to }) => (
          <line
            key={`${from.node.id}->${to.node.id}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={from.depth === 0 || to.depth === 0 ? 1.25 : 0.75}
          />
        ))}
      </g>
      {layout.nodes.map((entry) => {
        const label = labelPlacement(entry);
        const focus = entry.depth === 0;
        return (
          <g
            key={entry.node.id}
            role={focus ? "img" : "button"}
            tabIndex={focus ? undefined : 0}
            aria-label={`${entry.node.label}, ${entry.node.kind} in ${entry.node.file}`}
            className={
              focus
                ? undefined
                : "cursor-pointer outline-none [&:focus-visible>circle]:stroke-ring [&:hover>circle]:stroke-foreground"
            }
            onClick={focus ? undefined : () => onFocus(entry.node.id)}
            onKeyDown={
              focus
                ? undefined
                : (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onFocus(entry.node.id);
                    }
                  }
            }
          >
            <title>{`${entry.node.label} (${entry.node.file})`}</title>
            <circle
              cx={entry.x}
              cy={entry.y}
              r={RADIUS[entry.depth] ?? 3}
              strokeWidth={1.5}
              className={
                focus
                  ? "fill-primary stroke-primary"
                  : entry.node.kind === "file"
                    ? "fill-background stroke-muted-foreground"
                    : "fill-muted-foreground stroke-background"
              }
            />
            {entry.depth < 2 && (
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                className={
                  focus ? "fill-foreground font-medium text-2xs" : "fill-muted-foreground text-3xs"
                }
              >
                {shortLabel(entry.node.label)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
