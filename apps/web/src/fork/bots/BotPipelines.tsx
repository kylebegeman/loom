import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotPipeline,
} from "@t3tools/contracts/fork";
import { applyPipelineRunChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryPermission } from "../project-library/state";
import { PipelineEditor } from "./PipelineEditor";
import { PipelineRunList, PipelineRunView } from "./PipelineRunView";
import { bots, usePipelines } from "./state";

type Editing = { readonly pipeline: BotPipeline | null } | null;

/** The Pipelines tab: saved pipelines, their recent runs and the selected run. */
export function BotPipelines({
  environmentId,
  allBots,
  connected,
  selectedRunId,
  onSelectRun,
  onRun,
  onOpenBatch,
}: {
  readonly environmentId: EnvironmentId;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly connected: boolean;
  readonly selectedRunId: string | undefined;
  readonly onSelectRun: (pipelineRunId: string | undefined) => void;
  readonly onRun: (pipeline: BotPipeline) => void;
  readonly onOpenBatch: (batchId: string) => void;
}) {
  const { changes, list, pipelines } = usePipelines(environmentId, true, connected);
  const runsQuery = useEnvironmentQuery(
    bots.listPipelineRuns({ environmentId, input: { limit: BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT } }),
  );
  const runs = applyPipelineRunChanges(runsQuery.data?.runs ?? [], changes, { includeNew: true });
  const canSave = useLibraryPermission(bots.savePipeline, environmentId) && connected;
  const canDelete = useLibraryPermission(bots.deletePipeline, environmentId) && connected;
  const canRun = useLibraryPermission(bots.runPipeline, environmentId) && connected;
  const canCancel = useLibraryPermission(bots.cancelPipelineRun, environmentId) && connected;
  const canResume = useLibraryPermission(bots.resumePipelineRun, environmentId) && connected;
  const remove = useAtomCommand(bots.deletePipeline, { reportFailure: false });
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  // Changes missed while disconnected never arrive, so a reconnect refetches the lists.
  const refreshList = list.refresh;
  const refreshRuns = runsQuery.refresh;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) {
      refreshList();
      refreshRuns();
    }
    wasConnected.current = connected;
  }, [connected, refreshList, refreshRuns]);

  const deletePipeline = async (pipeline: BotPipeline) => {
    setError(null);
    try {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete ${pipeline.name}? Its past runs stay listed; the pipeline itself cannot be restored.`,
      );
      if (!confirmed) return;
      const result = await remove({ environmentId, input: { pipelineId: pipeline.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the pipeline.");
    }
  };

  return (
    <section className="space-y-4" aria-label="Pipelines">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Pipelines</h3>
        <Button
          size="xs"
          variant="outline"
          disabled={!canSave}
          onClick={() => setEditing({ pipeline: null })}
        >
          New pipeline
        </Button>
      </div>
      {list.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {list.error}
        </p>
      ) : list.isPending && !list.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading pipelines…
        </p>
      ) : pipelines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pipelines yet. A pipeline runs bots one after another, passing what each found to the
          next.
        </p>
      ) : (
        <ul className="grid gap-2">
          {pipelines.map((pipeline) => (
            <li
              key={pipeline.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="font-medium">{pipeline.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {pipeline.steps.map((step) => step.id).join(" → ")}
                  {pipeline.description ? ` · ${pipeline.description}` : ""}
                </span>
              </div>
              <div className="flex gap-1">
                <Button size="xs" disabled={!canRun} onClick={() => onRun(pipeline)}>
                  Run
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canSave}
                  onClick={() => setEditing({ pipeline })}
                >
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canDelete}
                  onClick={() => void deletePipeline(pipeline)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {selectedRunId !== undefined ? (
        <PipelineRunView
          key={selectedRunId}
          environmentId={environmentId}
          pipelineRunId={selectedRunId}
          changes={changes}
          canRun={canResume}
          canCancel={canCancel}
          onOpenBatch={onOpenBatch}
          onClose={() => onSelectRun(undefined)}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Recent pipeline runs</h3>
        <Button
          size="xs"
          variant="ghost"
          disabled={!connected || runsQuery.isPending}
          onClick={runsQuery.refresh}
        >
          Refresh
        </Button>
      </div>
      {runsQuery.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {runsQuery.error}
        </p>
      ) : runsQuery.isPending && !runsQuery.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading pipeline runs…
        </p>
      ) : (
        <PipelineRunList
          runs={runs}
          selectedId={selectedRunId}
          onSelect={(run) => onSelectRun(run.id)}
          emptyMessage="No pipeline has run yet."
        />
      )}
      {runsQuery.data?.hasMore ? (
        <p className="text-xs text-muted-foreground">
          Showing the {BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT} most recent pipeline runs.
        </p>
      ) : null}
      {editing ? (
        <PipelineEditor
          environmentId={environmentId}
          pipeline={editing.pipeline}
          allBots={allBots}
          canSave={canSave}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
