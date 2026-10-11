import { EnclosureFitSection } from "./EnclosureFitSection";
import { useState } from "react";
import { ASSEMBLY_MAX_CLEARANCES, type AssemblyPairResult } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Chip, EmptyNote } from "./controls";
import { OperationStatus } from "./OperationStatus";
import { formatLength, formatLengths, useDisplayUnits } from "./units";
import { BedFitList } from "./BedFitList";
import { pairIdentity } from "./assemblyEditing";
import type { AssemblyInspectorProps } from "./AssemblyInspector";
import styles from "./AssemblyInspector.module.css";

const STATUS_LABELS = {
  clear: "Clear",
  touching: "Touching",
  intersects: "Intersects",
  inside: "Inside",
} as const;
function PairFinding({
  pair,
  nameOf,
  onFocus,
}: {
  pair: AssemblyPairResult;
  nameOf: (id: string) => string;
  onFocus: () => void;
}) {
  const units = useDisplayUnits();
  const measured =
    pair.minDistanceMm !== null
      ? formatLength(pair.minDistanceMm, units, { digits: 3, trim: true })
      : pair.atLeastMm !== null
        ? `At least ${formatLength(pair.atLeastMm, units, { digits: 3, trim: true })}`
        : null;
  return (
    <button
      type="button"
      className={styles.pair}
      data-status={pair.status}
      data-tight={pair.clearance === "tight"}
      onClick={onFocus}
    >
      <span className={styles.row}>
        <strong>
          {nameOf(pair.a)} / {nameOf(pair.b)}
        </strong>
        <Chip
          {...(pair.status === "intersects" ||
          pair.status === "inside" ||
          pair.clearance === "tight"
            ? { tone: "warning" as const }
            : pair.status === "clear"
              ? { tone: "success" as const }
              : {})}
        >
          {STATUS_LABELS[pair.status]}
        </Chip>
      </span>
      {measured && (
        <span>
          {measured}
          {pair.requiredMm !== null
            ? `; required ${formatLength(pair.requiredMm, units, { digits: 3, trim: true })}`
            : ""}
        </span>
      )}
      {pair.clearance === "tight" && (
        <span className={`${styles.note} ${styles.warning}`}>Less than the required gap.</span>
      )}
      {!pair.complete && <span className={styles.note}>Partly checked.</span>}
      {(pair.regions.length > 0 || pair.closest) && (
        <span className={styles.note}>
          {pair.regions.length
            ? `${pair.regions.length} ${pair.regions.length === 1 ? "region" : "regions"}. `
            : ""}
          Select to frame the fit pins.
        </span>
      )}
    </button>
  );
}

export function AssemblyFitSection(props: AssemblyInspectorProps) {
  const { snapshot, report, onApply, onFocusPair } = props;
  const [adding, setAdding] = useState(false),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [required, setRequired] = useState("0.3"),
    [label, setLabel] = useState("");
  const parts = snapshot.assembly.parts,
    units = useDisplayUnits(),
    disabled = props.readOnly || props.busy;
  const nameOf = (id: string) => parts.find((part) => part.id === id)?.name ?? id;
  const selectedA = a || parts[0]?.id || "",
    selectedB = b || parts.find((part) => part.id !== selectedA)?.id || "";
  const gap = Number(required),
    validGap = required.trim() !== "" && Number.isFinite(gap) && gap >= 0 && gap <= 50;
  const duplicate = snapshot.assembly.clearances.some(
    (clearance) => pairIdentity(clearance.a, clearance.b) === pairIdentity(selectedA, selectedB),
  );
  const canAdd =
    validGap &&
    selectedA !== selectedB &&
    selectedA &&
    selectedB &&
    !duplicate &&
    snapshot.assembly.clearances.length < ASSEMBLY_MAX_CLEARANCES;
  const checkedBounds = report?.parts.filter(
    (part) => parts.find((candidate) => candidate.id === part.id)?.visible,
  );
  const size =
    props.size ??
    (checkedBounds?.length
      ? [0, 1, 2].map(
          (axis) =>
            Math.max(...checkedBounds.map((part) => part.bounds.max[axis]!)) -
            Math.min(...checkedBounds.map((part) => part.bounds.min[axis]!)),
        )
      : null);
  return (
    <>
      <EnclosureFitSection {...props} />
      <section className={styles.section}>
        <div className={styles.row}>
          <h3>Fit check</h3>
          {props.stale && report && <Chip tone="warning">Out of date</Chip>}
        </div>
        {size && (
          <p className={styles.note}>
            {props.stale && !props.size ? "Last checked size" : "Assembly size"}:{" "}
            {formatLengths(size, units, { trim: true })}
          </p>
        )}
        <p className={styles.note}>
          Check intersections, contact and required gaps in the assembled positions.
        </p>
        <div className={styles.row}>
          {props.checking ? (
            <Button variant="outline" size="xs" onClick={props.onCancelCheck}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={props.canCheck === false || props.busy || parts.length < 2}
              onClick={props.onCheck}
            >
              Check fit
            </Button>
          )}
        </div>
        {props.checking && <OperationStatus label="Checking assembly fit" />}
        {report && (
          <p className={styles.note}>
            {report.complete ? "Checked" : "Partly checked"} {report.summary.pairsTested}{" "}
            {report.summary.pairsTested === 1 ? "pair" : "pairs"}. {report.summary.intersecting}{" "}
            intersecting, {report.summary.touching} touching, {report.summary.tight} tight.
            {report.cached ? " Cached result." : ""}
          </p>
        )}
      </section>
      {size && props.environmentId && props.settings && (
        <BedFitList
          environmentId={props.environmentId}
          settings={props.settings}
          size={size as readonly [number, number, number]}
        />
      )}
      <section className={styles.section} aria-label="Required clearances">
        <div className={styles.row}>
          <h4>Required clearances</h4>
          <Button
            variant="outline"
            size="xs"
            disabled={
              disabled ||
              parts.length < 2 ||
              snapshot.assembly.clearances.length >= ASSEMBLY_MAX_CLEARANCES
            }
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? "Cancel" : "Add clearance"}
          </Button>
        </div>
        {snapshot.assembly.clearances.length ? (
          <ul className={styles.list}>
            {snapshot.assembly.clearances.map((clearance) => {
              const result = report?.pairs.find((pair) => pair.clearanceId === clearance.id);
              return (
                <li key={clearance.id} className={styles.pair}>
                  <div className={styles.row}>
                    <strong>
                      {clearance.label ?? `${nameOf(clearance.a)} / ${nameOf(clearance.b)}`}
                    </strong>
                    <div className="flex-1" />
                    <Button
                      variant="ghost-muted"
                      size="xs"
                      disabled={disabled}
                      onClick={() => void onApply([{ op: "remove-clearance", id: clearance.id }])}
                    >
                      Remove
                    </Button>
                  </div>
                  <label className={styles.formLabel}>
                    Required gap (mm)
                    <Input
                      key={clearance.requiredMm}
                      aria-label={`Required gap for ${nameOf(clearance.a)} and ${nameOf(clearance.b)}`}
                      size="sm"
                      type="number"
                      min="0"
                      max="50"
                      step="0.1"
                      defaultValue={clearance.requiredMm}
                      disabled={disabled}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (
                          event.target.value.trim() &&
                          Number.isFinite(value) &&
                          value >= 0 &&
                          value <= 50 &&
                          value !== clearance.requiredMm
                        )
                          void onApply([
                            {
                              op: "set-clearance",
                              id: clearance.id,
                              a: clearance.a,
                              b: clearance.b,
                              requiredMm: value,
                            },
                          ]);
                        else event.target.value = String(clearance.requiredMm);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          event.currentTarget.value = String(clearance.requiredMm);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  {result && (
                    <button
                      type="button"
                      className={styles.note}
                      onClick={() => onFocusPair(result)}
                    >
                      {STATUS_LABELS[result.status]}
                      {result.minDistanceMm !== null
                        ? `: ${formatLength(result.minDistanceMm, units, { digits: 3, trim: true })}`
                        : ""}
                      {props.stale ? " (out of date)" : ""}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.note}>
            Add a pair to check a minimum gap, such as a board and its case.
          </p>
        )}
        {adding && (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (canAdd)
                void onApply([
                  {
                    op: "set-clearance",
                    a: selectedA,
                    b: selectedB,
                    requiredMm: gap,
                    label: label.trim() || null,
                  },
                ]).then(() => setAdding(false));
            }}
          >
            <label className={styles.formLabel}>
              First part
              <select
                className={styles.select}
                aria-label="First clearance part"
                value={selectedA}
                disabled={disabled}
                onChange={(event) => setA(event.target.value)}
              >
                {parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.formLabel}>
              Second part
              <select
                className={styles.select}
                aria-label="Second clearance part"
                value={selectedB}
                disabled={disabled}
                onChange={(event) => setB(event.target.value)}
              >
                {parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.formLabel}>
              Required gap (mm)
              <Input
                size="sm"
                aria-label="New required clearance in mm"
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={required}
                disabled={disabled}
                onChange={(event) => setRequired(event.target.value)}
              />
            </label>
            <label className={styles.formLabel}>
              Label (optional)
              <Input
                size="sm"
                aria-label="Clearance label"
                maxLength={100}
                value={label}
                disabled={disabled}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            {duplicate && (
              <p className={`${styles.note} ${styles.full}`}>
                This pair already has a required clearance.
              </p>
            )}
            <div className={styles.full}>
              <Button variant="outline" size="xs" type="submit" disabled={disabled || !canAdd}>
                Save clearance
              </Button>
            </div>
          </form>
        )}
      </section>
      <section
        className={`${styles.section} ${styles.results}`}
        data-stale={props.stale}
        aria-label="Fit results"
      >
        <h4>Results</h4>
        {report ? (
          <>
            {report.pairs.length ? (
              report.pairs.map((pair) => (
                <PairFinding
                  key={`${pair.a}-${pair.b}-${pair.clearanceId ?? ""}`}
                  pair={pair}
                  nameOf={nameOf}
                  onFocus={() => onFocusPair(pair)}
                />
              ))
            ) : (
              <p className={styles.note}>No intersections, contact or clearance findings.</p>
            )}
            {report.skipped.map((part) => (
              <p key={part.id} className={`${styles.note} ${styles.warning}`}>
                {nameOf(part.id)}: {part.reason}
              </p>
            ))}
          </>
        ) : (
          !props.checking && <EmptyNote>Run Check fit to inspect the assembly.</EmptyNote>
        )}
      </section>
    </>
  );
}
