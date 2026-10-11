import { useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  activeBed,
  fitBed,
  listBeds,
  selectBed,
  type ModelPreviewSettings,
} from "@t3tools/contracts/fork";
import { useBuildPlate } from "./BedPicker";
import { describeFit, describeZoneFit } from "./buildPlate";
import { formatLength, formatLengths, useDisplayUnits } from "./units";
import { Chip, SectionHead, Tip } from "./controls";
import styles from "./workspace.module.css";

const GROUPS = [
  { kind: "printer", label: "Printers" },
  { kind: "surface", label: "Surfaces" },
  { kind: "custom", label: "Custom" },
] as const;

/** Compare the loaded part with every bed and choose the environment's active bed. */
export function BedFitList({
  environmentId,
  settings,
  size,
}: {
  environmentId: EnvironmentId;
  settings: ModelPreviewSettings;
  size: readonly [number, number, number];
}) {
  const units = useDisplayUnits();
  const { plate, canSave, save } = useBuildPlate(environmentId, settings);
  const rows = useMemo(
    () => listBeds(plate).map((bed) => ({ bed, result: fitBed(size, bed) })),
    [size, plate],
  );
  const activeId = activeBed(plate).id;
  const count = rows.filter(({ result }) => result.fit.status !== "too-big").length;
  const summary = (
    <Chip>
      Fits {count} of {rows.length}
    </Chip>
  );
  return (
    <section className={styles["model-bed-fit-list"]} aria-label="Which beds fit?">
      <SectionHead title="Which beds fit?">
        {canSave ? (
          summary
        ) : (
          <Tip label="This connection cannot change model settings.">
            <span tabIndex={0}>{summary}</span>
          </Tip>
        )}
      </SectionHead>
      {GROUPS.map((group) => (
        <div key={group.kind} className={styles["model-bed-fit-group"]}>
          <h4>{group.label}</h4>
          <ul>
            {rows
              .filter(({ bed }) => bed.kind === group.kind)
              .map(({ bed, result }) => {
                const { fit } = result;
                const zone = describeZoneFit(result, bed.zones ?? [], (mm) =>
                  formatLength(mm, units),
                );
                const active = bed.id === activeId;
                const content = (
                  <>
                    <span className={styles["model-bed-fit-name"]}>
                      <span className={styles["model-row-name"]}>{bed.label}</span>
                      <span className={styles["model-row-detail"]}>
                        {formatLengths(bed.volumeMm, units, { trim: true })}
                      </span>
                    </span>
                    <span className={styles["model-bed-fit-status"]}>
                      {active && <Chip>Active</Chip>}
                      {fit.status === "too-big" ? (
                        <span className={styles["model-bed-fit-over"]}>
                          {describeFit(fit, (mm) => formatLength(mm, units))}
                        </span>
                      ) : (
                        <Chip {...(fit.status === "fits" ? { tone: "success" as const } : {})}>
                          {zone?.short ?? describeFit(fit, (mm) => formatLength(mm, units))}
                        </Chip>
                      )}
                    </span>
                  </>
                );
                return (
                  <li key={bed.id}>
                    {canSave ? (
                      <button
                        type="button"
                        className={styles["model-bed-fit-row"]}
                        aria-pressed={active}
                        data-active={active}
                        disabled={active}
                        onClick={() => void save(selectBed(plate, bed.id))}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className={styles["model-bed-fit-row"]} data-active={active}>
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
