import { useAtomValue } from "@effect/atom-react";
import {
  CheckIcon,
  CircleDashedIcon,
  ImageUpIcon,
  MinusIcon,
  PauseIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import type { DeviceQaFlowView } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type {
  DeviceQaRun,
  DeviceQaRunStatus,
  DeviceQaSnapshotArtifacts,
  DeviceQaStep,
} from "@t3tools/contracts/fork";
import { useAssetUrlState } from "~/assets/assetUrls";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { ensureLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { Alert, Meta, Muted, failureOf, formatElapsed, useAction, useNow, valueOf } from "./parts";
import { deviceQa, runCommand } from "./state";

const RUN_LABEL: Record<DeviceQaRunStatus, string> = {
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  error: "Error",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export const flowName = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.yaml$/, "");

function StepIcon({ status }: { status: DeviceQaStep["status"] }) {
  if (status === "pass") return <CheckIcon className="size-3.5 shrink-0 text-success-foreground" />;
  if (status === "skip") return <MinusIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  return <XIcon className="size-3.5 shrink-0 text-destructive-foreground" />;
}

const RUN_GLYPH_TONE: Record<DeviceQaRunStatus, string> = {
  running: "bg-info/12 text-info-foreground",
  passed: "bg-success/12 text-success-foreground",
  failed: "bg-destructive/12 text-destructive-foreground",
  error: "bg-destructive/12 text-destructive-foreground",
  cancelled: "bg-muted text-muted-foreground",
  interrupted: "bg-warning/12 text-warning-foreground",
};

/** A run's outcome as a tinted round mark; `size` follows where it is shown. */
function RunGlyph({ status, size }: { status: DeviceQaRunStatus; size: "sm" | "lg" }) {
  const Icon =
    status === "passed"
      ? CheckIcon
      : status === "cancelled"
        ? MinusIcon
        : status === "interrupted"
          ? PauseIcon
          : XIcon;
  return (
    <span
      role="img"
      aria-label={RUN_LABEL[status]}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        size === "lg" ? "size-8 [&_svg]:size-4" : "size-5 [&_svg]:size-3",
        RUN_GLYPH_TONE[status],
      )}
    >
      {status === "running" ? <Spinner /> : <Icon strokeWidth={2.5} />}
    </span>
  );
}

const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

const runTitle = (run: DeviceQaRun) =>
  run.flows.length === 1 ? flowName(run.flows[0]!.path) : `${run.flows.length} flows`;

function SnapshotImage({
  environmentId,
  threadId,
  label,
  path,
}: {
  environmentId: EnvironmentId;
  threadId: ScopedThreadRef["threadId"];
  label: string;
  path: string;
}) {
  const asset = useAssetUrlState(environmentId, { _tag: "media-file", threadId, path });
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1">
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
      <div className="flex aspect-[9/19] items-center justify-center overflow-hidden rounded border bg-muted">
        {asset._tag === "Success" ? (
          <a href={asset.url} target="_blank" rel="noreferrer" className="size-full">
            <img
              src={asset.url}
              alt={`${label} snapshot`}
              loading="lazy"
              className="size-full object-contain"
            />
          </a>
        ) : asset._tag === "Loading" ? (
          <Spinner className="size-4" />
        ) : (
          <span className="px-2 text-center text-muted-foreground text-xs">Not available</span>
        )}
      </div>
    </figure>
  );
}

function SnapshotTrio({
  threadRef,
  artifacts,
}: {
  threadRef: ScopedThreadRef;
  artifacts: DeviceQaSnapshotArtifacts;
}) {
  const images = (
    [
      ["Baseline", artifacts.baseline],
      ["Current", artifacts.current],
      ["Diff", artifacts.diff],
    ] as const
  ).flatMap(([label, path]) => (path === undefined ? [] : [[label, path] as const]));
  if (images.length === 0) return null;
  return (
    <div className="flex gap-2">
      {images.map(([label, path]) => (
        <SnapshotImage
          key={label}
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          label={label}
          path={path}
        />
      ))}
    </div>
  );
}

const stepDetail = (step: DeviceQaStep) =>
  step.message ?? step.target ?? step.tool ?? step.flow ?? null;

function StepRow({ threadRef, step }: { threadRef: ScopedThreadRef; step: DeviceQaStep }) {
  const failed = step.status === "fail" || step.status === "error";
  const detail = stepDetail(step);
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-md px-2 py-1",
        failed && "bg-destructive/8 py-2",
      )}
      style={{ marginLeft: `${(step.depth ?? 0) * 14}px` }}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <StepIcon status={step.status} />
        <span className="shrink-0 font-medium">{step.kind}</span>
        {detail !== null && (
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{detail}</span>
        )}
        {step.durationMs !== undefined && (
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
            {formatDuration(step.durationMs)}
          </span>
        )}
      </div>
      {step.reason && (
        // argent also gives passing snapshot steps a reason, such as the diff they stayed under.
        <p
          className={cn(
            "whitespace-pre-wrap break-words pl-5.5 text-xs leading-relaxed",
            failed ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {step.reason}
        </p>
      )}
      {step.warning && (
        <p className="whitespace-pre-wrap break-words pl-5.5 text-warning-foreground text-xs leading-relaxed">
          {step.warning}
        </p>
      )}
      {failed && step.artifacts && (
        <div className="pt-1 pl-5.5">
          <SnapshotTrio threadRef={threadRef} artifacts={step.artifacts} />
        </div>
      )}
    </li>
  );
}

const FLOW_STATUS_LABEL: Record<DeviceQaFlowView["status"], string> = {
  pending: "Waiting",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  error: "Error",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

function FlowSteps({
  threadRef,
  flow,
  single,
}: {
  threadRef: ScopedThreadRef;
  flow: DeviceQaFlowView;
  single: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {!single && (
        <div className="flex items-center gap-2 px-2 pt-1 text-sm">
          {flow.status === "running" ? (
            <Spinner className="size-3.5" />
          ) : flow.status === "pending" ? (
            <CircleDashedIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <StepIcon
              status={
                flow.status === "passed"
                  ? "pass"
                  : flow.status === "skipped" || flow.status === "cancelled"
                    ? "skip"
                    : "fail"
              }
            />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{flowName(flow.path)}</span>
          <span className="text-muted-foreground text-xs">{FLOW_STATUS_LABEL[flow.status]}</span>
        </div>
      )}
      {flow.steps.length > 0 ? (
        <ol className="flex flex-col gap-0.5">
          {flow.steps.map((step, position) => (
            // oxlint-disable-next-line react/no-array-index-key -- Steps only append, and argent step indexes repeat across nested subflows.
            <StepRow key={position} threadRef={threadRef} step={step} />
          ))}
        </ol>
      ) : (
        flow.status === "pending" && (
          <p className="px-2 text-muted-foreground text-xs">Starts after the flows before it.</p>
        )
      )}
    </div>
  );
}

/** One run: live steps while it runs, then the result with snapshot images for failures. */
export function FlowRunView({ threadRef, run }: { threadRef: ScopedThreadRef; run: DeviceQaRun }) {
  const { environmentId, threadId } = threadRef;
  const viewResult = useAtomValue(deviceQa.runView({ environmentId, runId: run.id }));
  const view = valueOf(viewResult);
  const current = view?.finished ?? run;
  const running = current.status === "running";
  const now = useNow(running);
  const cancel = useAction();
  const again = useAction();
  const failedPaths = current.flows
    .filter((flow) => flow.status === "failed" || flow.status === "error")
    .map((flow) => flow.path);
  const snapshotFailed = (view?.flows ?? []).some((flow) =>
    flow.steps.some((step) => step.status === "fail" && step.artifacts?.diff !== undefined),
  );
  const flowErrors = current.flows.filter((flow) => flow.error !== null);

  const rerun = (paths: ReadonlyArray<string>, updateBaselines: boolean) =>
    void again.act(async () => {
      if (updateBaselines) {
        const confirmed = await ensureLocalApi().dialogs.confirm(
          `Replace the saved baseline images of ${paths.length === 1 ? flowName(paths[0]!) : `${paths.length} flows`} with what the device shows now? Commit the change to keep it.`,
        );
        if (!confirmed) return;
      }
      await runCommand(deviceQa.runFlows, {
        environmentId,
        input: { threadId, target: current.target, paths, updateBaselines },
      });
    });

  const steps = (view?.flows ?? []).flatMap((flow) => flow.steps);
  const passedSteps = steps.filter((step) => step.status === "pass").length;
  const single = (view?.flows.length ?? 0) <= 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <RunGlyph status={current.status} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-medium text-sm">{runTitle(current)}</p>
            <Meta
              items={[
                RUN_LABEL[current.status],
                formatElapsed(current.startedAt, current.finishedAt, now),
                steps.length > 0 &&
                  `${passedSteps} of ${steps.length} ${steps.length === 1 ? "step" : "steps"} passed`,
                current.startedBy === "agent" && "Started by the agent",
                current.updateBaselines && "Updating baselines",
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {running ? (
            <Button
              size="xs"
              variant="outline"
              disabled={cancel.busy}
              onClick={() =>
                void cancel.act(() =>
                  runCommand(deviceQa.cancelRun, { environmentId, input: { runId: run.id } }),
                )
              }
            >
              <SquareIcon />
              Cancel
            </Button>
          ) : (
            <>
              {failedPaths.length > 0 && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={again.busy}
                  onClick={() => rerun(failedPaths, false)}
                >
                  <RotateCcwIcon />
                  Run failed again
                </Button>
              )}
              {snapshotFailed && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={again.busy}
                  onClick={() => rerun(failedPaths, true)}
                >
                  <ImageUpIcon />
                  Update baselines
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {cancel.error && <Alert>{cancel.error}</Alert>}
      {again.error && <Alert>{again.error}</Alert>}
      {flowErrors.map((flow) => (
        <Alert key={flow.path}>
          {flowName(flow.path)}: {flow.error}
        </Alert>
      ))}
      {failureOf(viewResult) ? (
        <Alert>{failureOf(viewResult)}</Alert>
      ) : !view ? (
        <Muted>Loading steps...</Muted>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-1.5">
          {view.flows.length === 0 ? (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              {running ? "Waiting for the first step..." : "This run recorded no steps."}
            </p>
          ) : (
            view.flows.map((flow) => (
              <FlowSteps key={flow.path} threadRef={threadRef} flow={flow} single={single} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The project's recent runs, newest first. */
export function RunHistory({
  runs,
  selectedId,
  deviceName,
  onSelect,
}: {
  runs: ReadonlyArray<DeviceQaRun>;
  selectedId: string | null;
  deviceName: (run: DeviceQaRun) => string;
  onSelect: (runId: string) => void;
}) {
  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            aria-current={run.id === selectedId}
            className={cn(
              "flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
              run.id === selectedId && "bg-accent hover:bg-accent",
            )}
            onClick={() => onSelect(run.id)}
          >
            <RunGlyph status={run.status} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm">{runTitle(run)}</span>
              <Meta
                items={[
                  RUN_LABEL[run.status],
                  deviceName(run),
                  run.startedBy === "agent" && "Agent",
                ]}
              />
            </span>
            <time
              className="shrink-0 self-start pt-0.5 text-muted-foreground text-xs tabular-nums"
              dateTime={run.startedAt}
            >
              {new Date(run.startedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </button>
        </li>
      ))}
    </ul>
  );
}
