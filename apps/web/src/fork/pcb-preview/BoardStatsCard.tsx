import type { ReactNode } from "react";
import { FilePlusIcon, RulerIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { PcbDesign, PcbInspection } from "@t3tools/contracts/fork";
import { Notice, Section, Stat, Stats, useWrite } from "./InspectorKit";
import { ToolButton } from "./ToolButton";
import { formatArea, formatLength, formatLengths } from "./length";
import { useLengthUnit } from "./preferences";
import { boardStatsText } from "./boardStatsText";

export type BoardStatsCardProps = {
  inspection: PcbInspection;
  design?: Pick<PcbDesign, "kind" | "boardPath"> | undefined;
  canMeasure?: boolean | undefined;
  measureDisabledReason?: string | undefined;
  measuring?: boolean | undefined;
  measureError?: string | null | undefined;
  onMeasure?: (() => Promise<unknown> | void) | undefined;
  onOpenChecks?: (() => void) | undefined;
  onDraft?: ((text: string) => void) | undefined;
};
function Figure({
  value,
  source,
  reason,
}: {
  value: ReactNode | null;
  source?: string | undefined;
  reason?: string | undefined;
}) {
  const text = (
    <>
      {value ?? "Not available"}
      {value !== null && source && <small> {source}</small>}
    </>
  );
  const hint = value === null ? reason : source;
  return hint ? (
    <Tooltip>
      <TooltipTrigger render={<span aria-label={value === null ? reason : undefined} />}>
        {text}
      </TooltipTrigger>
      <TooltipPopup>{hint}</TooltipPopup>
    </Tooltip>
  ) : (
    <span>{text}</span>
  );
}
/** Derived board facts retain provenance so a rule value cannot be mistaken for a measurement. */
export function BoardStatsCard({
  inspection,
  design,
  canMeasure = false,
  measureDisabledReason,
  measuring = false,
  measureError,
  onMeasure,
  onOpenChecks,
  onDraft,
}: BoardStatsCardProps) {
  const unit = useLengthUnit();
  const write = useWrite("Could not measure component heights.");
  const stats = inspection.stats;
  const busy = measuring || write.busy;
  const error = measureError ?? write.error;
  const length = (value: number | null | undefined) =>
    value == null ? null : formatLength(value, unit, { trim: true });
  const minimum = (
    label: string,
    measured: number | null,
    rule: number | null | undefined,
    reason: string,
  ) => (
    <Stat
      label={label}
      value={
        <>
          <Figure value={length(measured)} source="measured" reason={reason} />
          {rule != null && <small> {length(rule)} rule</small>}
        </>
      }
    />
  );
  return (
    <Section
      title="Board stats"
      action={
        stats && (
          <ToolButton
            label="Add board stats to draft"
            hint={
              onDraft
                ? "Add board stats to draft in millimetres"
                : "Open a thread to add board stats to its draft"
            }
            disabled={!onDraft}
            onClick={() => onDraft?.(boardStatsText(stats, inspection))}
          >
            <FilePlusIcon />
          </ToolButton>
        )
      }
    >
      {!stats &&
      !inspection.bounds &&
      (design?.kind !== "tscircuit" || !inspection.components.some((c) => c.pcb)) ? (
        <Notice>Add a board to see board stats.</Notice>
      ) : (
        <Stats>
          <Stat label="Parts" value={inspection.components.length} />
          <Stat label="Nets" value={inspection.nets.length} />
          <Stat
            label="Size"
            value={
              <Figure
                value={
                  stats?.size
                    ? formatLengths([stats.size.width, stats.size.height], unit, { trim: true })
                    : inspection.bounds
                      ? formatLengths([inspection.bounds.width, inspection.bounds.height], unit, {
                          trim: true,
                        })
                      : null
                }
                source="outline bounds"
                reason="No board outline"
              />
            }
          />
          <Stat
            label="Thickness"
            value={<Figure value={length(inspection.thickness)} source="board setup" />}
          />
          <Stat
            label="Copper layers"
            value={
              <Figure
                value={
                  stats?.copperLayers ??
                  inspection.layers.filter(
                    (l) =>
                      l.endsWith(".Cu") || l === "top" || l === "bottom" || /^inner\d+$/.test(l),
                  ).length
                }
                source="board setup"
              />
            }
          />
          {stats ? (
            <>
              <Stat
                label="Area"
                value={
                  <Figure
                    value={stats.areaMm2 === null ? null : formatArea(stats.areaMm2, unit)}
                    source={stats.areaSource === "outline" ? "outline" : "bounding box"}
                    reason="No board outline or bounds"
                  />
                }
              />
              <Stat
                label="Components"
                value={
                  <Figure
                    value={`${stats.components.front} front · ${stats.components.back} back`}
                    source="footprints"
                  />
                }
              />
              <Stat
                label="Holes"
                value={
                  <Figure
                    value={`${stats.holes.plated} plated · ${stats.holes.nonPlated} non-plated`}
                    source="drilled pads"
                  />
                }
              />
              <Stat
                label="Vias"
                value={
                  <Figure
                    value={`${stats.vias.through} through${stats.vias.blindOrMicro ? ` · ${stats.vias.blindOrMicro} blind or micro` : ""}`}
                    source="board"
                  />
                }
              />
              {minimum(
                "Smallest drill",
                stats.measured.drill,
                stats.rules?.drill,
                "No drilled pads or vias",
              )}
              {minimum("Smallest track", stats.measured.track, stats.rules?.track, "No tracks")}
              {minimum(
                "Smallest annular ring",
                stats.measured.annularRing,
                stats.rules?.annularRing,
                "No supported plated pads or vias",
              )}
              {minimum(
                "Smallest via diameter",
                stats.measured.viaDiameter,
                stats.rules?.viaDiameter,
                "No vias",
              )}
              <Stat
                label="Clearance"
                value={
                  <Figure
                    value={length(stats.rules?.clearance)}
                    source="rule"
                    reason="No board-wide clearance rule in the project file"
                  />
                }
              />
              <Stat
                label="Tallest part"
                value={
                  <Figure
                    value={
                      stats.tallest
                        ? `${length(stats.tallest.heightMm)}${stats.tallest.reference ? ` · ${stats.tallest.reference}` : ""}`
                        : null
                    }
                    source={
                      stats.tallest
                        ? `${stats.tallest.side}, ${stats.tallest.source === "glb" ? "3D board" : "Circuit JSON"}`
                        : undefined
                    }
                    reason={
                      stats.heights === "no-models"
                        ? "No 3D component models in this board"
                        : stats.heights === "needs-3d"
                          ? "Build the 3D board to measure component heights"
                          : "Height measurement is unsupported"
                    }
                  />
                }
              />
            </>
          ) : (
            inspection.mountingHoles.length > 0 && (
              <Stat label="Mounting holes" value={inspection.mountingHoles.length} />
            )
          )}
        </Stats>
      )}
      {stats && (
        <>
          <p>
            <ToolButton
              label="Run DRC to measure clearance"
              disabled={!onOpenChecks}
              onClick={onOpenChecks}
            >
              Run DRC to measure
            </ToolButton>
          </p>
          <small>
            Annular ring measurements cover round and rectangular pads and vias with centered
            drills.
          </small>
          {stats.heights === "needs-3d" && (
            <p>
              <ToolButton
                label={busy ? "Measuring component heights" : "Measure component heights"}
                hint={
                  measureDisabledReason ?? "Build the 3D board once to measure component heights"
                }
                disabled={busy || !canMeasure || !onMeasure}
                onClick={() =>
                  void write.run(async () => {
                    await onMeasure?.();
                  })
                }
              >
                <RulerIcon />
                {busy ? "Measuring" : "Measure heights"}
              </ToolButton>
            </p>
          )}
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
        </>
      )}
    </Section>
  );
}
