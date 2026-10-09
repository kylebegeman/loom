import { appleRunKindLabel, type AppleRunRecord } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import { formatDuration } from "./parts";

const STATUS: Record<
  AppleRunRecord["status"],
  { label: string; variant: "success" | "error" | "warning" | "outline" | "info" }
> = {
  queued: { label: "Waiting", variant: "outline" },
  running: { label: "Running", variant: "info" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "outline" },
  interrupted: { label: "Interrupted", variant: "warning" },
};

export const statusBadge = (status: AppleRunRecord["status"]) => (
  <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
);

const counts = (run: AppleRunRecord) =>
  [
    run.counts.errors > 0 && `${run.counts.errors} error${run.counts.errors === 1 ? "" : "s"}`,
    run.counts.failedTests > 0 &&
      `${run.counts.failedTests} failed test${run.counts.failedTests === 1 ? "" : "s"}`,
    run.counts.warnings > 0 &&
      `${run.counts.warnings} warning${run.counts.warnings === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(", ");

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function RunHistory({
  runs,
  selectedId,
  onSelect,
}: {
  runs: ReadonlyArray<AppleRunRecord>;
  selectedId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            aria-current={run.id === selectedId ? "true" : undefined}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
              run.id === selectedId && "bg-accent",
            )}
            onClick={() => onSelect(run.id)}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {appleRunKindLabel(run.kind)}
                {run.request.scheme && (
                  <span className="text-muted-foreground"> {run.request.scheme}</span>
                )}
              </span>
              {run.startedBy === "agent" && <Badge variant="outline">Agent</Badge>}
              {statusBadge(run.status)}
            </span>
            <span className="text-muted-foreground text-xs">
              {time(run.startedAt)}
              {run.finishedAt && `, ${formatDuration(run.startedAt, run.finishedAt, 0)}`}
              {counts(run) && `, ${counts(run)}`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
