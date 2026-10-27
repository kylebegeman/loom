import { useState } from "react";
import { CheckIcon, ChevronDownIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { PrintCheckReport, PrintFinding } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Chip, EmptyNote, SectionHead } from "./controls";
import { OperationStatus } from "./OperationStatus";
import { useDisplayUnits, formatLength } from "./units";
import styles from "./workspace.module.css";

const PRINT_CHECK_LABELS = {
  mesh: "Mesh",
  shells: "Bodies",
  "bed-fit": "Bed fit",
  "first-layer": "First layer",
  overhangs: "Overhangs",
  islands: "Islands",
  walls: "Walls",
  "small-features": "Small features",
};
export type PrintCheckView = {
  report: PrintCheckReport | null;
  running: boolean;
  error: string | null;
  stale: boolean;
  run: (force?: boolean) => Promise<void>;
  cancel: () => void;
};
export function PrintCheckSection({
  check,
  selectedId,
  onSelect,
}: {
  check: PrintCheckView;
  selectedId: string | null;
  onSelect: (finding: PrintFinding) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const units = useDisplayUnits();
  const { report, running, error, stale } = check;
  return (
    <section className={styles["model-print-check"]} data-stale={stale}>
      <SectionHead title="Print check">
        {report && (
          <Chip tone={report.verdict === "ready" ? "success" : "warning"}>
            {report.verdict === "ready"
              ? "Ready to print"
              : report.verdict === "blocked"
                ? "Will not print as is"
                : "Check before printing"}
          </Chip>
        )}
      </SectionHead>
      {running && <OperationStatus label={stale ? "Model changed. Checking..." : "Checking..."} />}
      {error && (
        <p role="alert" className="text-xs text-warning">
          {error}
        </p>
      )}
      {report ? (
        <>
          <p className="px-3 text-xs text-muted-foreground">
            {stale ? "Out of date. " : report.cached ? "Cached. " : ""}Nozzle{" "}
            {formatLength(report.settings.nozzleMm, units, { digits: 2 })}; first layer{" "}
            {formatLength(report.settings.firstLayerMm, units, { digits: 2 })};{" "}
            {report.settings.overhangAngleDegrees}° overhang limit.
          </p>
          {report.checks.map((row) => {
            const findings = report.findings.filter((f) => f.check === row.check);
            const Icon =
              row.status === "pass"
                ? CheckIcon
                : row.status === "info" || row.status === "skipped"
                  ? InfoIcon
                  : TriangleAlertIcon;
            return (
              <div key={row.check}>
                <button
                  type="button"
                  className={styles["model-check-row"]}
                  disabled={!findings.length}
                  aria-expanded={expanded === row.check}
                  onClick={() => setExpanded((value) => (value === row.check ? null : row.check))}
                >
                  <Icon aria-hidden="true" data-status={row.status} />
                  <span>
                    <strong>{PRINT_CHECK_LABELS[row.check]}</strong>
                    <small>{row.summary}</small>
                  </span>
                  {findings.length > 0 && <ChevronDownIcon aria-hidden="true" />}
                </button>
                {expanded === row.check &&
                  findings.map((finding) => (
                    <button
                      key={finding.id}
                      type="button"
                      className={styles["model-check-finding"]}
                      data-selected={finding.id === selectedId}
                      disabled={!finding.location}
                      onClick={() => onSelect(finding)}
                    >
                      {finding.message}
                    </button>
                  ))}
              </div>
            );
          })}
          {report.truncated && (
            <p className="px-3 text-xs text-muted-foreground">
              Some findings were omitted. Fix these and check again.
            </p>
          )}
        </>
      ) : (
        !running && !error && <EmptyNote>The print check runs when the model loads.</EmptyNote>
      )}
      <div className="flex gap-2 px-3 py-2">
        {running ? (
          <Button variant="outline" size="xs" onClick={check.cancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="outline" size="xs" onClick={() => void check.run()}>
            {error ? "Try again" : "Check again"}
          </Button>
        )}
      </div>
    </section>
  );
}
