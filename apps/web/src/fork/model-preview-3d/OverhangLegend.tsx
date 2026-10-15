import { useEffect, useState, type RefObject } from "react";
import { OVERHANG_ANGLE, overhangStats, type OverhangStats } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "~/components/ui/tooltip";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Chip, Scrub } from "./controls";
import { formatArea, useDisplayPrecision, useDisplayUnits } from "./units";
import type { ModelViewer } from "./viewer/createViewer";
import type { useOverhangAngleSetting } from "./overhangSettings";

/** The shader updates immediately; its area summary runs only when the browser is idle. */
export function OverhangLegend({
  viewerRef,
  sourceRevision,
  angleControl,
  adjustable,
  wireframe,
  onHide,
}: {
  viewerRef: RefObject<ModelViewer | null>;
  sourceRevision: string;
  angleControl: ReturnType<typeof useOverhangAngleSetting>;
  adjustable: boolean;
  wireframe: boolean;
  onHide: () => void;
}) {
  const units = useDisplayUnits();
  const precision = useDisplayPrecision();
  const angle = adjustable ? angleControl.angle : OVERHANG_ANGLE.default;
  const [result, setResult] = useState<{
    revision: string;
    angle: number;
    stats: OverhangStats;
    unsupported: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const analyse = () => {
      const viewer = viewerRef.current;
      const input = viewer?.overhangInput();
      if (!viewer || !input || !active) return;
      const stats = overhangStats(input, { thresholdDegrees: angle });
      if (active)
        setResult({
          revision: sourceRevision,
          angle,
          stats,
          unsupported: viewer.unsupportedOverhangMaterials(),
        });
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(analyse) : window.setTimeout(analyse, 0);
    return () => {
      active = false;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [angle, sourceRevision, viewerRef]);
  const current = result?.revision === sourceRevision && result.angle === angle ? result : null;
  const tooltip = [
    current
      ? `${formatArea(current.stats.overhangAreaMm2, units, precision)} of the surface (${current.stats.overhangPercent.toFixed(1)}%)`
      : "Calculating overhang area...",
    wireframe ? "Overhangs show on solid faces." : "",
    current?.unsupported ? "Some parts use materials that can't be shaded." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tooltip>
      <Popover>
        <PopoverTrigger
          render={
            <TooltipTrigger
              render={
                <button
                  className="rounded-md text-left"
                  aria-label={`Overhangs at ${angle} degrees`}
                />
              }
            />
          }
        >
          <Chip {...(current?.stats.overhangAreaMm2 ? { tone: "warning" as const } : {})}>
            {current?.stats.overhangAreaMm2 === 0 ? "No overhangs" : "Overhangs"} over {angle}°
          </Chip>
        </PopoverTrigger>
        <PopoverPopup side="top" align="end" width="sm">
          <PopoverTitle>Overhangs</PopoverTitle>
          {adjustable && (
            <fieldset
              disabled={!angleControl.canSave}
              className="mt-3 flex flex-col gap-2"
              onPointerUp={() => void angleControl.commit()}
              onPointerCancel={() => void angleControl.commit()}
              onBlur={() => void angleControl.commit()}
              onKeyUp={(event) => {
                if (
                  [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "Enter",
                  ].includes(event.key)
                )
                  void angleControl.commit();
              }}
            >
              <Scrub
                label="Overhang angle"
                value={angle}
                unit="°"
                range={{ min: OVERHANG_ANGLE.minimum, max: OVERHANG_ANGLE.maximum, step: 1 }}
                disabled={!angleControl.canSave}
                onChange={angleControl.setAngle}
              />
              <input
                type="range"
                aria-label="Overhang angle slider"
                min={OVERHANG_ANGLE.minimum}
                max={OVERHANG_ANGLE.maximum}
                step={1}
                value={angle}
                onChange={(event) => angleControl.setAngle(Number(event.target.value))}
              />
            </fieldset>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Angle from vertical. Downward faces tilted more than this are shaded.
          </p>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {tooltip}
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onHide}>
              Hide overhangs
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
