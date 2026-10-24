import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { SLICER_LABELS } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { isElectron } from "~/env";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { Chip, EmptyNote, SectionHead } from "./controls";
import { OperationStatus } from "./OperationStatus";
import { formatCost, formatEstimate } from "./slicing";
import { models, modelUrl, runModelCommand } from "./state";
import type { SlicingControl } from "./useSlicing";
import styles from "./workspace.module.css";

/** Keeps an estimate visible while its source changes and requires an explicit refresh. */
export function PrintInspector({
  environmentId,
  slicing,
  format,
}: {
  environmentId: EnvironmentId;
  slicing: SlicingControl;
  format: string;
}) {
  const primary = usePrimaryEnvironmentId();
  const canOpen = useAtomValue(models.openSlice.permissionAtom(environmentId));
  const [failure, setFailure] = useState<string | null>(null),
    [opening, setOpening] = useState(false);
  const { result, running, stale } = slicing;
  const supported = ["scad", "stl", "3mf", "obj", "build123d", "step"].includes(format);
  const estimate = result?.estimate;
  const cost = estimate ? formatCost(estimate.cost, estimate.currency) : null;
  const localDesktop = isElectron && primary === environmentId;
  const open = async () => {
    if (!result?.key) return;
    setOpening(true);
    setFailure(null);
    await runModelCommand(models.openSlice, { environmentId, input: { key: result.key } })
      .catch((cause: unknown) => {
        setFailure(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setOpening(false);
      });
  };
  return (
    <section data-stale={stale}>
      <SectionHead title="Print">
        {stale ? (
          <Chip tone="warning">Out of date</Chip>
        ) : result?.cached ? (
          <Chip>Cached</Chip>
        ) : null}
      </SectionHead>
      {running && (
        <OperationStatus
          label="Estimating print"
          detail="The slicer runs on this environment's host."
        />
      )}
      {estimate ? (
        <div className="flex flex-col gap-2 px-3 text-xs">
          <strong>{formatEstimate(estimate)}</strong>
          <span>
            {[
              estimate.layerCount === null
                ? null
                : `${estimate.layerCount.toLocaleString()} layers`,
              estimate.supportUsed === null
                ? "Support unknown"
                : estimate.supportUsed
                  ? `Support: ${estimate.supportGrams === null ? "amount unavailable" : `${estimate.supportGrams.toFixed(1)} g`}`
                  : "No support",
              cost,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="text-muted-foreground">
            {result?.app ? SLICER_LABELS[result.app] : "Slicer"}
            {result?.profiles
              ? ` · ${result.profiles.machine}${result.profiles.process ? ` · ${result.profiles.process}` : ""}`
              : ""}
          </span>
          <details>
            <summary>About this estimate</summary>
            <p className="py-2 text-muted-foreground">
              Times and filament use come from the slicer's toolpaths. Support weight uses its
              extrusion lengths and the filament profile. Cost appears when every used filament has
              a saved price. Review the project in your slicer before printing.
            </p>
          </details>
        </div>
      ) : (
        !running && (
          <EmptyNote>
            {supported
              ? "Choose profiles in Loom settings, then estimate this part."
              : "Print estimates support STL, 3MF, OBJ, OpenSCAD, STEP and build123d models."}
          </EmptyNote>
        )
      )}
      {(slicing.error || failure) && (
        <p role="alert" className="px-3 text-xs text-warning">
          {failure ?? slicing.error}
        </p>
      )}
      {result?.warnings.map((warning) => (
        <p key={warning} className="px-3 text-xs text-warning">
          {warning}
        </p>
      ))}
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {running ? (
          <Button variant="outline" size="xs" onClick={slicing.cancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            size="xs"
            disabled={!slicing.canRun || !supported}
            onClick={() => void slicing.run()}
          >
            {estimate || slicing.error ? "Estimate again" : "Estimate print"}
          </Button>
        )}
        {result?.layers && (
          <Button
            variant="ghost-muted"
            size="xs"
            disabled={running || stale}
            onClick={() =>
              void slicing
                .toggleLayers()
                .catch((cause) =>
                  setFailure(cause instanceof Error ? cause.message : String(cause)),
                )
            }
          >
            {slicing.shown ? "Hide layers" : "Show layers"}
          </Button>
        )}
        {result?.project &&
          (localDesktop ? (
            <Button
              variant="ghost-muted"
              size="xs"
              disabled={!canOpen || opening || stale}
              onClick={() => void open()}
            >
              {opening
                ? "Opening..."
                : `Open in ${result.app ? SLICER_LABELS[result.app] : "slicer"}`}
            </Button>
          ) : (
            <Button
              variant="ghost-muted"
              size="xs"
              render={
                <a
                  href={modelUrl(environmentId, result.project.relativeUrl)}
                  download={`print.${result.app === "prusa-slicer" ? "gcode" : "3mf"}`}
                />
              }
            >
              Download {result.app === "prusa-slicer" ? "G-code" : "sliced 3MF"}
            </Button>
          ))}
        <Button variant="ghost-muted" size="xs" render={<Link to="/settings/loom" />}>
          Slicer settings
        </Button>
      </div>
      {!!result?.log.length && (
        <details className="px-3 py-2 text-xs">
          <summary>Slicer log</summary>
          <div className={styles["model-log"]}>
            {result.log.map((line, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- Slicer logs are immutable snapshots and may repeat lines.
              <div key={index} data-level={line.level}>
                {line.text}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
