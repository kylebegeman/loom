import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  appleRunKindLabel,
  formatRunSummaryForAgent,
  type AppleDestination,
  type AppleIssue,
  type AppleRunRecord,
  type AppleRunSummary,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { shellEnvironment } from "~/state/shell";
import { LogView } from "./LogView";
import { Alert, CopyButton, Muted, failureOf, formatDuration, useAction, valueOf } from "./parts";
import { statusBadge } from "./RunHistory";
import { apple, downloadRunLog, isActiveRun, runAppleCommand } from "./state";

const DEVICE_UNAVAILABLE =
  "The device is locked or disconnected. Unlock it, keep it on the same network or cable, and try again.";

const destinationLabel = (destination: AppleDestination) =>
  destination._tag === "simulator" || destination._tag === "device"
    ? destination.name
    : destination._tag === "mac"
      ? "this Mac"
      : `any ${destination.platform} destination`;

const issueKey = (issue: AppleIssue) => `${issue.line ?? ""}:${issue.message}`;

/**
 * Issues by file, files in first-seen order and issues without a file last. Repeats (one per
 * architecture or target) are shown once.
 */
export function groupIssuesByFile(issues: ReadonlyArray<AppleIssue>) {
  const groups = new Map<string, AppleIssue[]>();
  for (const issue of issues) {
    const key = issue.file ?? "";
    const group = groups.get(key) ?? [];
    if (!group.some((seen) => issueKey(seen) === issueKey(issue))) group.push(issue);
    groups.set(key, group);
  }
  const other = groups.get("");
  groups.delete("");
  return [...groups.entries(), ...(other ? ([["", other]] as const) : [])];
}

function Issues({ issues }: { issues: ReadonlyArray<AppleIssue> }) {
  return (
    <div className="flex flex-col gap-2">
      {groupIssuesByFile(issues).map(([file, fileIssues]) => (
        <div key={file || "other"} className="flex flex-col gap-1">
          <p className="break-all font-mono text-xs">{file || "No file"}</p>
          <ul className="flex flex-col gap-1 pl-3">
            {fileIssues.map((issue) => (
              <li key={issueKey(issue)} className="text-sm">
                <span className="text-muted-foreground">
                  {issue.line === undefined ? "" : `${issue.line}: `}
                </span>
                <span className="whitespace-pre-wrap break-words">{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Failure({ run, summary }: { run: AppleRunRecord; summary: AppleRunSummary | null }) {
  if (run.status === "interrupted") return <Alert>Interrupted (server restarted).</Alert>;
  if (summary?.hint === "device-unavailable")
    return (
      <div className="flex flex-col gap-1">
        <Alert>{DEVICE_UNAVAILABLE}</Alert>
        {summary.failureReason && (
          <pre className="whitespace-pre-wrap break-words text-muted-foreground text-xs">
            {summary.failureReason}
          </pre>
        )}
      </div>
    );
  return summary?.failureReason ? <Alert>{summary.failureReason}</Alert> : null;
}

export function RunSummary({
  environmentId,
  threadRef,
  run,
  isLocal,
  canReveal,
  canStart,
  onTestOnly,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  run: AppleRunRecord;
  /** The environment is this desktop app's own machine. */
  isLocal: boolean;
  canReveal: boolean;
  canStart: boolean;
  onTestOnly: (run: AppleRunRecord, identifier: string) => void;
}) {
  const detailAtom = apple.run({ environmentId, input: { runId: run.id } });
  const detailResult = useAtomValue(detailAtom);
  const detail = valueOf(detailResult);
  // The record changes as the run moves on; fetch the summary again when it does.
  const revision = `${run.status}:${run.phase}`;
  const fetchedAt = useRef(revision);
  useEffect(() => {
    if (fetchedAt.current === revision) return;
    fetchedAt.current = revision;
    appAtomRegistry.refresh(detailAtom);
  }, [detailAtom, revision]);
  const active = isActiveRun(run);
  // Open while a run goes, until the user chooses.
  const [logChoice, setLogChoice] = useState<boolean | null>(null);
  const showLog = logChoice ?? active;
  const [notice, setNotice] = useState<string | null>(null);
  const action = useAction();
  const summary = detail?.run.id === run.id ? detail.summary : null;
  const build = summary?.build;
  const tests = summary?.tests;
  const errors = build?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = build?.issues.filter((issue) => issue.severity !== "error") ?? [];

  const addToComposer = () => {
    const drafts = useComposerDraftStore.getState();
    const text = formatRunSummaryForAgent(run, summary);
    const previous = drafts.getComposerDraft(threadRef)?.prompt ?? "";
    drafts.setPrompt(threadRef, previous ? `${previous}\n\n${text}` : text);
    setNotice("Added to your draft.");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{appleRunKindLabel(run.kind)}</span>
          {statusBadge(run.status)}
          {run.finishedAt && (
            <span className="text-muted-foreground">
              {formatDuration(run.startedAt, run.finishedAt, 0)}
            </span>
          )}
          {run.startedBy === "agent" && (
            <span className="text-muted-foreground">started by an agent</span>
          )}
        </div>
        <p className="break-all font-mono text-muted-foreground text-xs">{run.commandLine}</p>
      </div>
      {failureOf(detailResult) && <Alert>{failureOf(detailResult)}</Alert>}
      {!active && <Failure run={run} summary={summary} />}
      {errors.length > 0 && <Issues issues={errors} />}
      {warnings.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {build?.warningCount ?? warnings.length} warning
            {(build?.warningCount ?? warnings.length) === 1 ? "" : "s"}
          </summary>
          <div className="pt-2">
            <Issues issues={warnings} />
          </div>
        </details>
      )}
      {tests && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Tests: {tests.passed} of {tests.total} passed, {tests.failed} failed, {tests.skipped}{" "}
            skipped
            {tests.expectedFailures > 0 && `, ${tests.expectedFailures} expected failures`}
            {tests.environment && (
              <span className="text-muted-foreground"> ({tests.environment})</span>
            )}
          </p>
          <ul className="flex flex-col gap-2">
            {tests.failures.map((failure) => (
              <li key={failure.identifier} className="flex flex-col gap-1 rounded-md border p-2">
                <p className="break-all font-mono text-xs">{failure.identifier}</p>
                <p className="whitespace-pre-wrap break-words text-sm">{failure.message}</p>
                {failure.file && (
                  <p className="break-all text-muted-foreground text-xs">
                    {failure.file}
                    {failure.line === undefined ? "" : `:${failure.line}`}
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  <CopyButton value={failure.identifier} label="Copy identifier" />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canStart}
                    onClick={() => onTestOnly(run, failure.identifier)}
                  >
                    Test only this
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary?.launched && (
        <Muted>
          Launched {summary.launched.bundleId} on {destinationLabel(summary.launched.destination)}.
        </Muted>
      )}
      {summary?.xcodegen && <Muted>Generated {summary.xcodegen.generatedProject}.</Muted>}
      {!active &&
        run.status === "succeeded" &&
        !tests &&
        !summary?.launched &&
        !summary?.xcodegen && (
          <Muted>
            {run.counts.warnings > 0
              ? "Succeeded with warnings."
              : "Succeeded with no errors or warnings."}
          </Muted>
        )}
      {!active && (
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="outline" onClick={addToComposer}>
            Add to composer
          </Button>
          {isLocal && run.hasResultBundle && (
            <Button
              size="xs"
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                void action.act(() =>
                  runAppleCommand(apple.openResultBundle, {
                    environmentId,
                    input: { runId: run.id },
                  }),
                )
              }
            >
              Open in Xcode
            </Button>
          )}
          {isLocal && canReveal && detail && (
            <Button
              size="xs"
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                void action.act(() =>
                  runAppleCommand(shellEnvironment.openInEditor, {
                    environmentId,
                    input: { cwd: detail.logPath, editor: "file-manager", reveal: true },
                  }),
                )
              }
            >
              Reveal log
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={action.busy}
            onClick={() => void action.act(() => downloadRunLog(environmentId, run.id))}
          >
            Download log
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {action.error && <Alert>{action.error}</Alert>}
      <div className="flex flex-col gap-1">
        <Button
          size="xs"
          variant="ghost-muted"
          aria-expanded={showLog}
          onClick={() => setLogChoice(!showLog)}
        >
          {showLog ? "Hide log" : "Show log"}
        </Button>
        {showLog && <LogView key={run.id} environmentId={environmentId} runId={run.id} />}
      </div>
    </div>
  );
}
