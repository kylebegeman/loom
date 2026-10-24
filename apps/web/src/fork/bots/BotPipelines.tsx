import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotPipeline,
} from "@t3tools/contracts/fork";
import { applyPipelineRunChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  HistoryIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibrarySection,
} from "../project-library/LibraryControls";
import { useLibraryPermission } from "../project-library/state";
import { BotRowsSkeleton, BotsEmptyList } from "./BotRuns";
import { PipelineEditor } from "./PipelineEditor";
import { PipelineRunList, PipelineRunView, PipelineSteps } from "./PipelineRunView";
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
        `Delete ${pipeline.name}? Its triggers, with their webhook URLs and secrets, are deleted too. Its past runs stay listed; the pipeline itself cannot be restored.`,
      );
      if (!confirmed) return;
      const result = await remove({ environmentId, input: { pipelineId: pipeline.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the pipeline.");
    }
  };

  return (
    <section className="flex flex-col gap-8" aria-label="Pipelines">
      <LibrarySection
        title="Pipelines"
        icon={WorkflowIcon}
        count={pipelines.length}
        action={
          pipelines.length > 0 ? (
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={!canSave}
              onClick={() => setEditing({ pipeline: null })}
            >
              <PlusIcon />
              New pipeline
            </Button>
          ) : null
        }
      >
        <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
        {list.error && !list.data ? null : list.isPending && !list.data ? (
          <BotRowsSkeleton label="Loading pipelines" />
        ) : pipelines.length === 0 ? (
          <BotsEmptyList
            icon={WorkflowIcon}
            message="No pipelines yet. A pipeline runs bots one after another, passing what each found to the next."
            action={
              <Button
                shape="pill"
                size="sm"
                disabled={!canSave}
                onClick={() => setEditing({ pipeline: null })}
              >
                <PlusIcon />
                New pipeline
              </Button>
            }
          />
        ) : (
          <ul
            className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}
          >
            {pipelines.map((pipeline) => (
              <li
                key={pipeline.id}
                className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{pipeline.name}</p>
                    {pipeline.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {pipeline.description}
                      </p>
                    ) : null}
                  </div>
                  <PipelineSteps pipeline={pipeline} />
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    shape="pill"
                    size="xs"
                    variant="outline"
                    disabled={!canRun}
                    onClick={() => onRun(pipeline)}
                  >
                    <PlayIcon />
                    Run
                  </Button>
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit ${pipeline.name}`}
                    disabled={!canSave}
                    onClick={() => setEditing({ pipeline })}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost-destructive"
                    aria-label={`Delete ${pipeline.name}`}
                    disabled={!canDelete}
                    onClick={() => void deletePipeline(pipeline)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <LibraryErrorNotice error={error} />
      </LibrarySection>
      <LibrarySection
        title="Recent runs"
        icon={HistoryIcon}
        action={
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!connected || runsQuery.isPending}
            onClick={runsQuery.refresh}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      >
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
            pipelines={pipelines}
          />
        ) : null}
        <LibraryErrorNotice error={runsQuery.error} onRetry={runsQuery.refresh} />
        {runsQuery.error && !runsQuery.data ? null : runsQuery.isPending && !runsQuery.data ? (
          <BotRowsSkeleton label="Loading pipeline runs" />
        ) : (
          <PipelineRunList
            runs={runs}
            selectedId={selectedRunId}
            onSelect={(run) => onSelectRun(run.id)}
            emptyMessage="No pipeline has run yet. Each run and the report it leaves collect here."
          />
        )}
        {runsQuery.data?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            Showing the {BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT} most recent pipeline runs.
          </p>
        ) : null}
      </LibrarySection>
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
