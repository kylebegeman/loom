import { useServerConfigs } from "~/state/entities";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useId, useState } from "react";
import type { EnclosureRequirementsPatch } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Chip } from "./controls";
import { formatLength, useDisplayUnits } from "./units";
import type { AssemblyInspectorProps } from "./AssemblyInspector";
import styles from "./AssemblyInspector.module.css";
const GAPS = [
  ["wallGapMm", "Wall gap", 20],
  ["lidGapMm", "Lid gap", 50],
  ["floorGapMm", "Floor gap", 50],
  ["connectorMarginMm", "Connector margin", 10],
  ["standoffToleranceMm", "Standoff tolerance", 5],
  ["edgeMarginMm", "Edge detection margin", 10],
] as const;
export function EnclosureFitSection(props: AssemblyInspectorProps) {
  const doc = props.snapshot.assembly,
    enclosure = doc.enclosure,
    report = props.report?.enclosure,
    disabled = props.readOnly || props.busy,
    units = useDisplayUnits(),
    id = useId();
  const [selected, setSelected] = useState(""),
    [replacement, setReplacement] = useState("");
  const configs = useServerConfigs();
  if (
    props.environmentId &&
    !loomFeaturesOf(configs.get(props.environmentId)?.environment.capabilities).includes(
      "pcb-enclosure-fit",
    )
  )
    return null;
  const boards = doc.parts.filter((p) => /\.glb$/i.test(p.path)),
    board = selected || boards[0]?.id || "";
  const update = (requirements: EnclosureRequirementsPatch) => {
    if (enclosure)
      void props.onApply([{ op: "set-enclosure", board: enclosure.board, requirements }]);
  };
  if (!enclosure)
    return (
      <section className={styles.section}>
        <h3>Board enclosure</h3>
        <p className={styles.note}>
          Choose a PCB reference to check walls, connector openings and mounting holes.
        </p>
        <label htmlFor={`${id}-board`}>Board reference</label>
        <select
          id={`${id}-board`}
          className={styles.select}
          value={board}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a GLB board</option>
          {boards.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || !board}
          onClick={() => void props.onApply([{ op: "set-enclosure", board }])}
        >
          Check as an enclosure
        </Button>
      </section>
    );
  return (
    <section className={styles.section}>
      <div className={styles.row}>
        <h3>Board enclosure</h3>
        {report && (
          <Chip tone={report.status === "fits" ? "success" : "warning"}>
            {props.stale
              ? "Out of date"
              : report.status === "fits"
                ? "Fits"
                : report.status === "tight"
                  ? "Tight"
                  : report.status === "interferes"
                    ? "Interferes"
                    : "Incomplete"}
          </Chip>
        )}
      </div>
      <p className={styles.note}>
        {doc.parts.find((p) => p.id === enclosure.board)?.name ?? enclosure.board} with{" "}
        {enclosure.parts.length ? enclosure.parts.length : "all visible"} case parts. Checks use
        assembled positions.
      </p>
      <div className={styles.fields}>
        {GAPS.map(([key, label, max]) => (
          <label key={key} className={styles.field}>
            {label} (mm)
            <Input
              key={`${key}-${enclosure.requirements[key]}`}
              type="number"
              size="sm"
              min={0}
              max={max}
              step={0.1}
              defaultValue={enclosure.requirements[key]}
              disabled={disabled}
              onBlur={(e) => {
                const value = e.currentTarget.valueAsNumber;
                if (
                  Number.isFinite(value) &&
                  value >= 0 &&
                  value <= max &&
                  value !== enclosure.requirements[key]
                )
                  update({ [key]: value });
                else e.currentTarget.value = String(enclosure.requirements[key]);
              }}
            />
          </label>
        ))}
      </div>
      <details>
        <summary>Case parts and connectors</summary>
        <p className={styles.note}>
          An empty selection checks every visible part except the board.
        </p>
        {doc.parts
          .filter((p) => p.id !== enclosure.board)
          .map((p) => (
            <label key={p.id} className={styles.row}>
              <input
                type="checkbox"
                checked={enclosure.parts.includes(p.id)}
                disabled={disabled}
                onChange={(e) =>
                  void props.onApply([
                    {
                      op: "set-enclosure",
                      board: enclosure.board,
                      parts: e.target.checked
                        ? [...enclosure.parts, p.id]
                        : enclosure.parts.filter((id) => id !== p.id),
                    },
                  ])
                }
              />
              {p.name}
            </label>
          ))}
        {(["include", "exclude"] as const).map((key) => (
          <label className={styles.field} key={key}>
            {key === "include" ? "Include connectors" : "Exclude connectors"}
            <Input
              key={enclosure.requirements.connectors[key].join(",")}
              size="sm"
              defaultValue={enclosure.requirements.connectors[key].join(", ")}
              placeholder="J1, USB1"
              disabled={disabled}
              onBlur={(e) => {
                const values = [...new Set(e.currentTarget.value.split(/[\s,]+/).filter(Boolean))];
                if (
                  values.length <= (key === "include" ? 16 : 64) &&
                  values.every((v) => v.length <= 100)
                )
                  update({ connectors: { ...enclosure.requirements.connectors, [key]: values } });
              }}
            />
          </label>
        ))}
      </details>
      <div className={styles.row}>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || !props.canAlign}
          onClick={() => void props.onApply([{ op: "place-board", id: enclosure.board }])}
        >
          Centre board
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={disabled || !props.canAlign}
          onClick={() => {
            const rotation = doc.parts.find((p) => p.id === enclosure.board)?.rotation[2] ?? 0;
            void props.onApply([
              {
                op: "place-board",
                id: enclosure.board,
                quarterTurns: (((Math.round(rotation / 90) + 1) % 4) + 4) % 4,
              },
            ]);
          }}
        >
          Rotate 90°
        </Button>
      </div>
      <label className={styles.field}>
        New board reference path
        <Input
          size="sm"
          value={replacement}
          placeholder=".loom/pcb-references/board.glb"
          disabled={disabled}
          onChange={(e) => setReplacement(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        size="xs"
        disabled={disabled || !replacement.trim()}
        onClick={() =>
          void props.onApply([{ op: "swap-board", id: enclosure.board, path: replacement.trim() }])
        }
      >
        Replace board reference
      </Button>
      {report ? (
        <>
          <p className={styles.note}>
            Board revision {report.boardRevision.slice(0, 16)}. {report.frame.matchedParts} matched
            components{report.frame.mirrored ? "; mirrored drawing frame" : ""}.
          </p>
          {report.warnings.map((w) => (
            <p key={w} className={styles.note}>
              {w}
            </p>
          ))}
          {report.findings.map((f) => (
            <button
              className={styles.pair}
              type="button"
              key={f.id}
              data-status={f.status === "interferes" ? "intersects" : "clear"}
              data-tight={f.status === "tight"}
              disabled={props.stale}
              onClick={() => props.onFocusEnclosure?.(f)}
            >
              <span className={styles.row}>
                <strong>{f.label}</strong>
                <Chip
                  {...(f.status === "tight" || f.status === "interferes"
                    ? { tone: "warning" as const }
                    : f.status === "ok"
                      ? { tone: "success" as const }
                      : {})}
                >
                  {f.status === "ok"
                    ? "OK"
                    : f.status === "unchecked"
                      ? "Unchecked"
                      : f.status === "tight"
                        ? "Tight"
                        : "Interferes"}
                </Chip>
              </span>
              <span>{f.detail}</span>
              {f.measuredMm !== null && (
                <span>{formatLength(f.measuredMm, units, { digits: 2, trim: true })}</span>
              )}
              {f.hole?.offsetMm && (
                <span>
                  Standoff offset:{" "}
                  {f.hole.offsetMm
                    .map((v) => formatLength(v, units, { digits: 2, trim: true }))
                    .join(", ")}
                </span>
              )}
              {f.connector && (
                <span>
                  {Math.round(f.connector.openFraction * 100)}% open
                  {f.connector.setbackMm !== null
                    ? `; wall setback ${formatLength(f.connector.setbackMm, units, { digits: 2, trim: true })}`
                    : ""}
                </span>
              )}
            </button>
          ))}
          {report.suggestedMove && (
            <Button
              variant="outline"
              size="xs"
              disabled={disabled || props.stale}
              onClick={() =>
                void props.onApply([
                  { op: "move-part", id: enclosure.board, by: report.suggestedMove! },
                ])
              }
            >
              Apply suggested move
            </Button>
          )}
        </>
      ) : (
        <p className={styles.note}>Run Check fit to measure the enclosure.</p>
      )}
      <Button
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => void props.onApply([{ op: "clear-enclosure" }])}
      >
        Stop checking as an enclosure
      </Button>
    </section>
  );
}
