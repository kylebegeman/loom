import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { RefreshCwIcon } from "lucide-react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { AppleRunRecord, AppleRunRequest, AppleStatus } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { isElectron } from "~/env";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell, useServerConfigs } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import type { ForkPanelProps } from "../panels/types";
import { Alert, Muted, Section, failureOf, useAction, valueOf } from "./parts";
import { ReadinessCard } from "./ReadinessCard";
import { ActiveRunLine, RunControls } from "./RunControls";
import { RunHistory } from "./RunHistory";
import { RunSummary } from "./RunSummary";
import {
  readSelection,
  requestFor,
  writeSelection,
  type AppleAction,
  type AppleSelection,
} from "./selection";
import { ToolchainCard } from "./ToolchainCard";
import { XcodegenCard } from "./XcodegenCard";
import { apple, isActiveRun, noteRuns, runAppleCommand } from "./state";

/** Searched depth of the server's workspace walk (AppleBuildService). */
const SEARCH_DEPTH = 4;

function Loading() {
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Muted>Looking for Xcode projects and Swift packages...</Muted>
    </div>
  );
}

function Workspace({
  threadRef,
  projectId,
  status,
  runs,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
  status: AppleStatus;
  runs: ReadonlyArray<AppleRunRecord>;
}) {
  const { environmentId, threadId } = threadRef;
  const [selection, setSelection] = useState<AppleSelection>(() =>
    readSelection(environmentId, projectId),
  );
  const changeSelection = useCallback(
    (next: AppleSelection) => {
      setSelection(next);
      writeSelection(environmentId, projectId, next);
    },
    [environmentId, projectId],
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const start = useAction();
  const cancel = useAction();
  const config = useServerConfigs().get(environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isLocal = isElectron && primaryEnvironmentId === environmentId;
  const canReveal =
    config?.shellRevealInFileManager === true && config.availableEditors.includes("file-manager");

  const darwin = status.toolchain.platform === "darwin";
  const containers = darwin
    ? status.containers
    : status.containers.filter((container) => container.kind === "package");
  const activeRun = runs.find(isActiveRun) ?? null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const container = containers.find((candidate) => candidate.path === selection.container?.path);

  const launch = (request: AppleRunRequest) =>
    start.act(async () => {
      const run = await runAppleCommand(apple.start, { environmentId, input: request });
      setSelectedRunId(run.id);
    });
  const runAction = (action: AppleAction) => {
    const planned = requestFor(threadId, selection, action);
    if ("missing" in planned) void start.act(() => Promise.reject(new Error(planned.missing)));
    else void launch(planned.request);
  };
  const testOnly = (run: AppleRunRecord, identifier: string) => {
    const { testPlan: _testPlan, onlyTesting: _onlyTesting, ...request } = run.request;
    void launch({
      ...request,
      kind: run.kind === "swiftTest" ? "swiftTest" : "test",
      onlyTesting: [identifier],
    });
  };

  return (
    <>
      {!darwin && (
        <Section title="Toolchain">
          <Muted>
            Apple builds need a macOS environment with Xcode.
            {containers.length > 0 && " Swift packages can still build and test here."}
          </Muted>
          {status.toolchain.tools.xtool && (
            <Muted>
              xtool found. Loom does not run xtool builds yet; use the terminal (xtool dev).
            </Muted>
          )}
        </Section>
      )}
      {darwin && (
        <Section title="Toolchain">
          <ToolchainCard toolchain={status.toolchain} />
        </Section>
      )}
      {containers.length === 0 ? (
        <Section title="Build">
          <Muted>
            No Xcode project, workspace, XcodeGen spec or Swift package found in this workspace
            (searched {SEARCH_DEPTH} folders deep
            {status.truncated ? ", stopped early in a large tree" : ""}).
          </Muted>
          <Muted>{status.cwd}</Muted>
        </Section>
      ) : (
        <Section title="Build">
          {status.lane && (
            <Muted>Builds use the {status.lane.name} lane and wait for a free build slot.</Muted>
          )}
          <RunControls
            environmentId={environmentId}
            threadId={threadId}
            containers={containers}
            selection={selection}
            onSelectionChange={changeSelection}
            busy={activeRun !== null || start.busy}
            onAction={runAction}
          />
          {activeRun && (
            <ActiveRunLine
              run={activeRun}
              cancelling={cancel.busy}
              onCancel={() =>
                void cancel.act(() =>
                  runAppleCommand(apple.cancel, { environmentId, input: { runId: activeRun.id } }),
                )
              }
            />
          )}
          {start.error && <Alert>{start.error}</Alert>}
          {cancel.error && <Alert>{cancel.error}</Alert>}
        </Section>
      )}
      {container?.kind === "xcodegen" && (
        <XcodegenCard
          environmentId={environmentId}
          threadId={threadId}
          container={container}
          canGenerate={activeRun === null && !start.busy}
          onGenerate={() => runAction("generate")}
        />
      )}
      {selectedRun && (
        <Section title={selectedRun.id === activeRun?.id ? "Current run" : "Result"}>
          <RunSummary
            key={selectedRun.id}
            environmentId={environmentId}
            threadRef={threadRef}
            run={selectedRun}
            isLocal={isLocal}
            canReveal={canReveal}
            canStart={activeRun === null && !start.busy}
            onTestOnly={testOnly}
          />
        </Section>
      )}
      {runs.length > 0 && (
        <Section title="History">
          <RunHistory
            runs={runs}
            selectedId={selectedRun?.id ?? null}
            onSelect={setSelectedRunId}
          />
        </Section>
      )}
      {darwin && container && container.kind !== "package" && selection.scheme && (
        <ReadinessCard
          key={`${container.path}:${selection.scheme}`}
          environmentId={environmentId}
          threadId={threadId}
          container={container}
          scheme={selection.scheme}
        />
      )}
    </>
  );
}

function Body({ threadRef, projectId }: { threadRef: ScopedThreadRef; projectId: string }) {
  const input = { threadId: threadRef.threadId };
  const environmentId: EnvironmentId = threadRef.environmentId;
  const statusAtom = apple.status({ environmentId, input });
  const statusResult = useAtomValue(statusAtom);
  const runsResult = useAtomValue(apple.runs({ environmentId, input }));
  const status = valueOf(statusResult);
  const runs = valueOf(runsResult)?.runs;
  useEffect(() => {
    if (runs) noteRuns(threadRef, runs);
  }, [runs, threadRef]);
  const failure = failureOf(statusResult) ?? failureOf(runsResult);
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <h1 className="font-medium text-sm">Apple build</h1>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Look for projects again"
          onClick={() => appAtomRegistry.refresh(statusAtom)}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {failure ? (
        <div className="p-3">
          <Alert>{failure}</Alert>
        </div>
      ) : !status || !runs ? (
        <Loading />
      ) : (
        <Workspace
          key={status.cwd}
          threadRef={threadRef}
          projectId={projectId}
          status={status}
          runs={runs}
        />
      )}
    </div>
  );
}

export default function AppleBuildPanel({ threadRef, visible }: ForkPanelProps) {
  const shell = useThreadShell(threadRef);
  if (!shell)
    return (
      <div className="p-3">
        <Muted>
          Apple builds use this thread's workspace. Send a message to start the thread first.
        </Muted>
      </div>
    );
  // Hidden panels drop their streams; reopening shows the current state again.
  if (!visible) return null;
  return <Body threadRef={threadRef} projectId={shell.projectId} />;
}
