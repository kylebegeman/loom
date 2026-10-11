import type { Pcb3dHeights, Pcb3dMeasurement } from "@t3tools/contracts/fork";
import { EyeIcon, RulerIcon, ScissorsIcon, ArrowUpDownIcon } from "lucide-react";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { ToolButton } from "./ToolButton";
import {
  availableLayers,
  type BoardParts,
  type Board3dDisplay,
  type Board3dLayer,
} from "./board3dParts";
import { useLengthUnit } from "./preferences";
import { formatLength } from "./length";
import styles from "./workspace.module.css";
export type Board3dTool = "none" | "distance" | "height";
const LAYERS: Record<Board3dLayer, string> = {
  board: "Board",
  soldermask: "Solder mask",
  copper: "Copper",
  silkscreen: "Silkscreen",
  topComponents: "Top components",
  bottomComponents: "Bottom components",
};
export function Board3DTools({
  ready,
  readOnly,
  display,
  onDisplay,
  parts,
  heights,
  tool,
  onTool,
  measurements,
  pending,
  snap,
  onClear,
  onHeight,
}: {
  ready: boolean;
  readOnly: boolean;
  display: Board3dDisplay;
  onDisplay: (next: Board3dDisplay) => void;
  parts: BoardParts | null;
  heights: Pcb3dHeights | null;
  tool: Board3dTool;
  onTool: (tool: Board3dTool) => void;
  measurements: readonly Pcb3dMeasurement[];
  pending: boolean;
  snap: string;
  onClear: () => void;
  onHeight: (reference: string) => void;
}) {
  const unit = useLengthUnit(),
    available = parts && availableLayers(parts),
    last = measurements.at(-1);
  return (
    <>
      <div
        className={`${styles.shelf} ${styles.toolShelf}`}
        role="toolbar"
        aria-label="3D board tools"
      >
        <Menu>
          <MenuTrigger
            render={<button className={styles.tool} disabled={!ready} aria-label="3D display" />}
          >
            <EyeIcon />
            <span>Display{display.hidden.size ? ` · ${display.hidden.size} hidden` : ""}</span>
          </MenuTrigger>
          <MenuPopup>
            <MenuCheckboxItem
              checked={display.projection === "orthographic"}
              onCheckedChange={(checked) =>
                onDisplay({ ...display, projection: checked ? "orthographic" : "perspective" })
              }
            >
              Orthographic
            </MenuCheckboxItem>
            {(Object.keys(LAYERS) as Board3dLayer[]).map((layer) => (
              <MenuCheckboxItem
                key={layer}
                checked={!display.hidden.has(layer)}
                disabled={!available?.[layer]}
                onCheckedChange={(checked) => {
                  const hidden = new Set(display.hidden);
                  if (checked) hidden.delete(layer);
                  else hidden.add(layer);
                  onDisplay({ ...display, hidden });
                }}
              >
                {LAYERS[layer]}
                {!available?.[layer] && (
                  <span className="ml-2 text-muted-foreground text-xs">
                    {parts?.kind === "tscircuit" && (layer === "copper" || layer === "silkscreen")
                      ? "Drawn on board surface"
                      : "Not in this export"}
                  </span>
                )}
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu>
        <ToolButton
          label="Measure in 3D"
          hint="Measure in 3D (M)"
          disabled={!ready || readOnly}
          aria-pressed={tool !== "none"}
          onClick={() => onTool(tool === "none" ? "distance" : "none")}
        >
          <RulerIcon />
        </ToolButton>
        <ToolButton
          label="Section plane"
          disabled={!ready}
          aria-pressed={display.section.enabled}
          onClick={() =>
            onDisplay({
              ...display,
              section: { ...display.section, enabled: !display.section.enabled },
            })
          }
        >
          <ScissorsIcon />
        </ToolButton>
        <Popover>
          <PopoverTrigger
            render={
              <button className={styles.tool} disabled={!ready} aria-label="Component heights" />
            }
          >
            <ArrowUpDownIcon />
            <span>Heights</span>
          </PopoverTrigger>
          <PopoverPopup side="top" width="md">
            <PopoverTitle>Component heights</PopoverTitle>
            {!heights ? (
              <p>Heights need the board body in the 3D export.</p>
            ) : (
              <>
                <p>Board: {formatLength(heights.boardThicknessMm, unit)}</p>
                <p>
                  Above board: {formatLength(heights.above?.heightMm ?? 0, unit)}
                  {heights.above?.reference ? ` · ${heights.above.reference}` : ""}
                </p>
                <p>
                  Below board: {formatLength(heights.below?.heightMm ?? 0, unit)}
                  {heights.below?.reference ? ` · ${heights.below.reference}` : ""}
                </p>
                {!heights.partCount && (
                  <p>
                    No component models in this 3D board. Install the footprint 3D models in KiCad,
                    then retry.
                  </p>
                )}
                <div className="mt-3 max-h-64 overflow-auto">
                  {heights.parts.map((part) => (
                    <button
                      key={part.reference}
                      disabled={readOnly}
                      className={styles.heightRow}
                      onClick={() => onHeight(part.reference)}
                    >
                      {part.reference} · {part.side === "front" ? "Top" : "Bottom"} ·{" "}
                      {formatLength(Math.max(part.aboveMm, part.belowMm), unit)}
                    </button>
                  ))}
                </div>
                {heights.partCount > heights.parts.length && (
                  <p>
                    Showing {heights.parts.length} named parts of {heights.partCount} component
                    models.
                  </p>
                )}
              </>
            )}
          </PopoverPopup>
        </Popover>
      </div>
      {ready && tool !== "none" && (
        <div
          className={`${styles.shelf} ${styles.toolHint} ${styles.boardMeasureHint}`}
          role="group"
          aria-label="3D measurement"
        >
          <button
            className={styles.textButton}
            aria-pressed={tool === "distance"}
            onClick={() => onTool("distance")}
          >
            Distance
          </button>
          <button
            className={styles.textButton}
            disabled={!heights}
            aria-pressed={tool === "height"}
            onClick={() => onTool("height")}
          >
            Height
          </button>
          <span>
            {tool === "height"
              ? "Click a point for its height"
              : pending
                ? "Click the second point"
                : "Click two points"}
            . Alt places a free point.
          </span>
          <span>
            {snap === "building"
              ? "Building snapping…"
              : snap === "off"
                ? "Snapping is off for boards this large"
                : snap === "failed"
                  ? "Snapping unavailable; points are free"
                  : snap === "ready"
                    ? "Snapping ready"
                    : "Points are free"}
          </span>
          {last && (
            <strong>
              {last.kind === "height"
                ? last.side === "back"
                  ? "Below board: "
                  : "Above board: "
                : "Distance: "}
              {formatLength(last.lengthMm, unit)}
            </strong>
          )}
          <button className={styles.textButton} onClick={onClear}>
            Clear
          </button>
          <button className={styles.textButton} onClick={() => onTool("none")}>
            Done
          </button>
        </div>
      )}
    </>
  );
}
