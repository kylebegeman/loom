import { useState } from "react";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { PROJECT_WORKFLOWS_FEATURE } from "@t3tools/contracts/fork";
import { useEnvironments } from "~/state/environments";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { projectLibrary, useLibraryPermission } from "./state";
import { LibraryErrorNotice } from "./LibraryControls";

export function ProjectOperationHistory({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: string;
}) {
  const { environments } = useEnvironments();
  const supported = supportsLoomFeature(
    environments.find((entry) => entry.environmentId === environmentId)?.serverConfig?.environment
      .capabilities,
    PROJECT_WORKFLOWS_FEATURE,
  );
  const query = useEnvironmentQuery(
    supported
      ? projectLibrary.operations({ environmentId, input: projectId ? { projectId } : {} })
      : null,
  );
  const resume = useAtomCommand(projectLibrary.resumeOperation, { reportFailure: false });
  const cancel = useAtomCommand(projectLibrary.cancelOperation, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.resumeOperation, environmentId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (id: string, kind: "resume" | "cancel") => {
    setBusy(true);
    setError(null);
    const result = await (kind === "resume" ? resume : cancel)({
      environmentId,
      input: { operationId: id },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update this operation.");
    }
    query.refresh();
    setBusy(false);
  };
  if (!supported)
    return (
      <p className="text-sm text-muted-foreground">
        Connect an updated computer to view its operations.
      </p>
    );
  return (
    <section aria-label="Project operations" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Operations on this computer</h2>
        <Button size="xs" variant="ghost" onClick={query.refresh}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Work continues when the window closes. After a restart, Loom resumes safe steps using a
        current authorized session. Running file changes must finish before cancellation.
      </p>
      <LibraryErrorNotice error={error ?? query.error} onRetry={query.refresh} />
      {!query.data?.length ? (
        <p className="text-sm text-muted-foreground">
          {query.isPending ? "Loading operations..." : "No operations recorded here yet."}
        </p>
      ) : null}
      {query.data?.map((operation) => (
        <div key={operation.id} className="space-y-1 py-2">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-medium">
              {operation.kind}: {operation.phase}
            </p>
            <span className="text-xs text-muted-foreground">{operation.state}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Updated {new Date(operation.updatedAt).toLocaleString()}
          </p>
          {operation.error ? (
            <p role="status" className="text-sm text-destructive">
              {operation.error}
            </p>
          ) : null}
          {["failed", "needs-input", "queued"].includes(operation.state) ? (
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={!allowed || busy}
                onClick={() => void act(operation.id, "resume")}
              >
                Resume
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={!allowed || busy}
                onClick={() => void act(operation.id, "cancel")}
              >
                Cancel remaining steps
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
