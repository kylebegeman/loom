import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { ScrollView, View } from "react-native";
import { EnvironmentId, type ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
  isActiveBotPipelineRunStatus,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineRun,
  type BotPipelineRunStatus,
} from "@t3tools/contracts/fork";
import {
  applyPipelineAttemptChanges,
  applyPipelineChanges,
  applyPipelineRunChanges,
  type BotPipelineChanges,
} from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { useMarkdownPreviewStyles } from "../../features/files/FileMarkdownPreview";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { openThreadUrlExternally } from "../preview-links/navigation";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { BotNotice, BotPage, BotSection } from "./BotControls";
import { BotPipelineEditor } from "./BotPipelineEditor";
import { BotParameterFields, RunChoice } from "./BotRunScreen";
import { useBotActionLifetime } from "./useBotActionLifetime";
import { confirmBotAutomation } from "./botAutomationActions";
import { pipelineNeedsProject } from "./botAutomationLogic";
import {
  checkoutChoices,
  commandValue,
  failureMessage,
  fixedProject,
  initialRunValues,
  parameterInputs,
  runsInCheckout,
  runTime,
  VERDICT_LABELS,
} from "./runLogic";
import {
  bots,
  useBotPipelineChanges,
  useBotsCapabilities,
  useBotsCollection,
  useBotsReconnect,
} from "./state";

const PIPELINE_STATUS: Record<BotPipelineRunStatus, string> = {
  running: "Running",
  waiting: "Waiting for budget",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  cancelled: "Cancelled",
};

function PipelineRunForm({
  environmentId,
  pipeline,
  allBots,
  canRun,
  unavailable,
  onStarted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly canRun: boolean;
  readonly unavailable?: string;
  readonly onStarted: (run: BotPipelineRun) => void;
  readonly onClose: () => void;
}) {
  const active = useBotActionLifetime();
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const shells = useThreadShells().filter((shell) => shell.environmentId === environmentId);
  const stepBots = pipeline.steps.flatMap(
    (step) => allBots.find((bot) => bot.id === step.botId) ?? [],
  );
  const pickProject = pipelineNeedsProject(pipeline, allBots);
  const [projectId, setProjectId] = useState(
    pickProject ? ((projects[0]?.id as string) ?? "") : "",
  );
  const checkoutBots = stepBots.filter(runsInCheckout);
  const fixedProjects = [...new Set(checkoutBots.flatMap((bot) => fixedProject(bot) ?? []))];
  const checkoutProject = projectId || (fixedProjects.length === 1 ? fixedProjects[0] : "") || "";
  const checkouts = checkoutChoices(shells, checkoutProject);
  const [checkoutThreadId, setCheckoutThreadId] = useState("");
  const checkout = checkouts.find((choice) => choice.threadId === checkoutThreadId);
  const [values, setValues] = useState(() => initialRunValues(pipeline));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = useAtomCommand(bots.runPipeline, { reportFailure: false });
  const start = async () => {
    if (busy || !canRun) return;
    if (pickProject && !projectId) {
      setError("Choose a project for this pipeline.");
      return;
    }
    if (checkoutThreadId !== "" && !checkout) {
      setError(
        "This checkout is no longer available. Choose another checkout or the project root.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    await Promise.resolve()
      .then(() => {
        const inputs = parameterInputs(pipeline.parameters, values);
        return run({
          environmentId,
          input: {
            pipelineId: pipeline.id,
            inputs,
            ...(projectId ? { projectId: projectId as ProjectId } : {}),
            ...(checkout ? { checkoutThreadId: checkout.threadId as ThreadId } : {}),
          },
        });
      })
      .then((result) => {
        const started = commandValue(result);
        if (active.current) onStarted(started);
      })
      .catch((cause: unknown) => {
        if (active.current) setError(failureMessage(cause, "Could not start the pipeline."));
      });
    if (active.current) setBusy(false);
  };
  return (
    <Sheet title={`Run ${pipeline.name}`} dismissible={!busy} onClose={onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View className="gap-4 p-4 pb-12">
          <Text>{pipeline.description || "Fill in the inputs, then start the pipeline."}</Text>
          <Text>
            Reviewing pipeline version {pipeline.version}. Each step uses its saved bot version and
            conditions.
          </Text>
          <BotParameterFields
            parameters={pipeline.parameters}
            values={values}
            disabled={busy}
            onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
          />
          {projects.length > 0 || pickProject ? (
            <RunChoice
              label={
                pickProject ? "Project" : "Project for steps without a saved project (optional)"
              }
              value={projectId}
              disabled={busy}
              choices={[
                ...(pickProject ? [] : [{ value: "", label: "Use each bot's saved project" }]),
                ...projects.map((project) => ({ value: project.id, label: project.title })),
              ]}
              onChange={(next) => {
                setProjectId(next);
                setCheckoutThreadId("");
              }}
            />
          ) : null}
          {checkoutProject ? (
            <RunChoice
              label="Checkout for caller-checkout steps"
              value={checkoutThreadId}
              disabled={busy}
              choices={[
                { value: "", label: "Project root" },
                ...checkouts.map((choice) => ({ value: choice.threadId, label: choice.label })),
                ...(checkoutThreadId !== "" && !checkout
                  ? [{ value: checkoutThreadId, label: "Unavailable checkout", disabled: true }]
                  : []),
              ]}
              onChange={setCheckoutThreadId}
            />
          ) : null}
          <BotNotice
            error={error}
            detail={unavailable ?? (!canRun ? "This connection cannot run pipelines." : undefined)}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={busy ? "Starting…" : "Run pipeline"}
              tone="primary"
              disabled={busy || !canRun}
              onPress={() => void start()}
            />
            <Button label="Cancel" disabled={busy} onPress={onClose} />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

function PipelineRunDetail({
  environmentId,
  runId,
  changes,
  onClose,
  onChanged,
  onRunAgain,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: string;
  readonly changes: BotPipelineChanges;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly onRunAgain: (pipelineId: string) => void;
}) {
  const activeLifetime = useBotActionLifetime();
  const navigation = useNavigation();
  const caps = useBotsCapabilities(environmentId);
  const query = useEnvironmentQuery(
    bots.getPipelineRun({ environmentId, input: { pipelineRunId: runId } }),
  );
  const cancelAllowed = useAtomValue(bots.cancelPipelineRun.permissionAtom(environmentId));
  const resumeAllowed = useAtomValue(bots.resumePipelineRun.permissionAtom(environmentId));
  const runAllowed = useAtomValue(bots.runPipeline.permissionAtom(environmentId));
  const cancel = useAtomCommand(bots.cancelPipelineRun, { reportFailure: false });
  const resume = useAtomCommand(bots.resumePipelineRun, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const reportStyle = useMarkdownPreviewStyles();
  const detail = query.data ? applyPipelineAttemptChanges(query.data, changes) : null;
  const progress = detail
    ? `${detail.run.status}:${detail.attempts.map((attempt) => `${attempt.seq}:${attempt.state}:${attempt.finishedAt}`).join(",")}`
    : "";
  const refreshRun = query.refresh;
  const previous = useRef(progress);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the pipeline run from the server when its streamed progress changes
  useEffect(() => {
    if (previous.current === progress) return;
    const initial = previous.current === "";
    previous.current = progress;
    if (!initial) refreshRun();
  }, [progress, refreshRun]);
  useBotsReconnect(caps.connected, query.refresh);
  const act = async (work: () => Promise<void>) => {
    if (busy || !caps.connected) return;
    setBusy(true);
    setError(null);
    await work()
      .then(() => {
        if (activeLifetime.current) {
          query.refresh();
          onChanged();
        }
      })
      .catch((cause: unknown) => {
        if (activeLifetime.current)
          setError(failureMessage(cause, "Could not update the pipeline run."));
      });
    if (activeLifetime.current) setBusy(false);
  };
  if (!detail)
    return (
      <View className="gap-2">
        <BotNotice
          error={query.error}
          detail={query.isPending ? "Loading pipeline run…" : undefined}
        />
        <Button label="Close run" onPress={onClose} />
        <Button label="Refresh run" disabled={!caps.connected} onPress={query.refresh} />
      </View>
    );
  const { run, attempts } = detail;
  const active = isActiveBotPipelineRunStatus(run.status);
  const resumable = run.status === "stopped" || run.status === "failed";
  return (
    <>
      <BotSection
        title={run.pipelineName}
        description={`Version ${run.pipelineVersion} · ${runTime(run.createdAt)}`}
      >
        <Text className="font-t3-semibold">
          {PIPELINE_STATUS[run.status]}
          {run.finalVerdict ? ` · ${VERDICT_LABELS[run.finalVerdict]}` : ""}
          {run.cursorStepId && active ? ` · ${run.cursorStepId}` : ""}
        </Text>
        {run.retryAt ? <Text>Tries again at {runTime(run.retryAt)}.</Text> : null}
        <BotNotice error={error ?? run.error ?? query.error} />
        <View className="flex-row flex-wrap gap-2">
          {active ? (
            <Button
              label="Cancel pipeline"
              tone="danger"
              disabled={busy || !caps.connected || !cancelAllowed}
              onPress={() =>
                void act(async () => {
                  if (
                    !(await confirmBotAutomation(
                      "Cancel pipeline?",
                      "The running step and pipeline will stop. Completed steps stay in its history.",
                      "Cancel pipeline",
                    )) ||
                    !activeLifetime.current
                  )
                    return;
                  commandValue(await cancel({ environmentId, input: { pipelineRunId: run.id } }));
                })
              }
            />
          ) : null}
          {resumable ? (
            <Button
              label={
                run.status === "failed" ? "Retry failed step" : "Retry stopped step and continue"
              }
              tone="primary"
              disabled={busy || !caps.connected || !resumeAllowed}
              onPress={() =>
                void act(async () => {
                  commandValue(await resume({ environmentId, input: { pipelineRunId: run.id } }));
                })
              }
            />
          ) : null}
          {!active ? (
            <Button
              label="Run pipeline again"
              disabled={busy || !caps.connected || !runAllowed}
              onPress={() => onRunAgain(run.pipelineId)}
            />
          ) : null}
          <Button
            label="Refresh run"
            disabled={!caps.connected || query.isPending}
            onPress={query.refresh}
          />
          <Button label="Close run" onPress={onClose} />
        </View>
        {resumable ? (
          <Text>
            Retry runs the stopped step again in the same round, using this run's pinned bot
            versions, then continues.
          </Text>
        ) : null}
      </BotSection>
      <BotSection title="Step attempts">
        {attempts.length === 0 ? <Text>No steps have started yet.</Text> : null}
        {attempts.map((attempt) => (
          <View key={attempt.seq} className="gap-2 rounded-xl border border-border-subtle p-3">
            <Text className="font-t3-semibold">
              {attempt.stepId} · Round {attempt.round} · {attempt.outcome?.status ?? attempt.state}
              {attempt.outcome?.verdict ? ` · ${VERDICT_LABELS[attempt.outcome.verdict]}` : ""}
            </Text>
            {attempt.botVersion !== null ? (
              <Text className="text-xs text-foreground-muted">
                Bot version {attempt.botVersion}
              </Text>
            ) : null}
            {attempt.outcome?.summary ? <Text>{attempt.outcome.summary}</Text> : null}
            {[...new Set(attempt.notes)].map((note) => (
              <Text key={note} className="text-sm text-foreground-muted">
                {note}
              </Text>
            ))}
            <View className="flex-row flex-wrap gap-2">
              {attempt.runId ? (
                <Button
                  label="Open bot run"
                  onPress={() =>
                    navigation.navigate("BotsRunDetail", { environmentId, runId: attempt.runId! })
                  }
                />
              ) : null}
              {attempt.batchId && caps.batchesSupported ? (
                <Button
                  label="Open batch"
                  onPress={() =>
                    navigation.navigate("BotsBatches", { environmentId, batchId: attempt.batchId! })
                  }
                />
              ) : null}
            </View>
          </View>
        ))}
      </BotSection>
      {query.data?.report ? (
        <BotSection title="Report">
          <SelectableMarkdownText
            markdown={query.data.report.markdown}
            textStyle={reportStyle.nativeTextStyle}
            onLinkPress={(url) => {
              void openThreadUrlExternally(environmentId, url, "markdown-link");
            }}
          />
          {query.data.report.truncated ? <Text>The report was cut to its size limit.</Text> : null}
        </BotSection>
      ) : null}
    </>
  );
}

export function BotPipelinesRouteScreen({
  route,
}: StaticScreenProps<{
  environmentId: string;
  botId?: string;
  pipelineId?: string;
  runId?: string;
}>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  return (
    <PipelinesScreen
      key={`${environmentId}:${route.params.pipelineId ?? "all"}:${route.params.botId ?? "all"}:${route.params.runId ?? "none"}`}
      environmentId={environmentId}
      pipelineId={route.params.pipelineId}
      botId={route.params.botId}
      runId={route.params.runId}
    />
  );
}

function PipelinesScreen({
  environmentId,
  pipelineId,
  botId,
  runId,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineId?: string;
  readonly botId?: string;
  readonly runId?: string;
}) {
  const caps = useBotsCapabilities(environmentId);
  const supported = caps.supported && caps.pipelinesSupported;
  const collection = useBotsCollection(environmentId);
  const changes = useBotPipelineChanges(environmentId, supported && caps.connected);
  const query = useEnvironmentQuery(
    supported ? bots.listPipelines({ environmentId, input: {} }) : null,
  );
  const allPipelines = applyPipelineChanges(query.data?.pipelines ?? [], changes);
  const pipelines = allPipelines.filter(
    (pipeline) =>
      (!pipelineId || pipeline.id === pipelineId) &&
      (!botId || pipeline.steps.some((step) => step.botId === botId)),
  );
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [pastRuns, setPastRuns] = useState<ReadonlyArray<BotPipelineRun>>([]);
  const firstRunsAtom = bots.listPipelineRuns({
    environmentId,
    input: { limit: BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT, ...(pipelineId ? { pipelineId } : {}) },
  });
  const refreshFirstRuns = useAtomRefresh(firstRunsAtom);
  const runsQuery = useEnvironmentQuery(
    supported
      ? before
        ? bots.listPipelineRuns({
            environmentId,
            input: {
              limit: BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
              ...(pipelineId ? { pipelineId } : {}),
              before,
            },
          })
        : firstRunsAtom
      : null,
  );
  const runs = applyPipelineRunChanges([...pastRuns, ...(runsQuery.data?.runs ?? [])], changes, {
    includeNew: true,
    ...(pipelineId ? { pipelineId } : {}),
  });
  const saveAllowed = useAtomValue(bots.savePipeline.permissionAtom(environmentId));
  const deleteAllowed = useAtomValue(bots.deletePipeline.permissionAtom(environmentId));
  const runAllowed = useAtomValue(bots.runPipeline.permissionAtom(environmentId));
  const remove = useAtomCommand(bots.deletePipeline, { reportFailure: false });
  const [editing, setEditing] = useState<{ readonly pipeline: BotPipeline | null } | null>(null);
  const [running, setRunning] = useState<BotPipeline | null>(null);
  const [selectedRun, setSelectedRun] = useState(runId);
  const activeLifetime = useBotActionLifetime();
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const connected = caps.connected;
  const refreshPipelines = query.refresh,
    refreshBots = collection.refresh;
  const refresh = useCallback(() => {
    if (!supported || !connected) return;
    refreshPipelines();
    refreshBots();
    setPastRuns([]);
    setBefore(undefined);
    refreshFirstRuns();
  }, [supported, connected, refreshPipelines, refreshBots, refreshFirstRuns]);
  useBotsReconnect(caps.connected, refresh);
  useFocusEffect(
    useCallback(() => {
      if (caps.connected && supported) refresh();
    }, [caps.connected, supported, refresh]),
  );
  const deletePipeline = async (pipeline: BotPipeline) => {
    if (busy || !caps.connected || !deleteAllowed) return;
    setBusy(true);
    setError(null);
    await confirmBotAutomation(
      `Delete ${pipeline.name}?`,
      "Its triggers, webhook URLs and secrets are deleted too. Past runs remain. The pipeline cannot be restored.",
      "Delete",
    )
      .then(async (confirmed) => {
        if (!confirmed || !activeLifetime.current) return;
        commandValue(await remove({ environmentId, input: { pipelineId: pipeline.id } }));
        if (activeLifetime.current) query.refresh();
      })
      .catch((cause: unknown) => {
        if (activeLifetime.current)
          setError(failureMessage(cause, "Could not delete the pipeline."));
      });
    if (activeLifetime.current) setBusy(false);
  };
  return (
    <BotPage title="Bot pipelines">
      <Text>
        Run bots in order, pass their findings to later steps, and control how each outcome
        continues.
      </Text>
      <BotNotice
        error={error ?? query.error ?? collection.query.error}
        detail={
          !caps.connected
            ? `${caps.label} is offline. Reconnect to manage pipelines.`
            : !supported
              ? "Update this computer to use bot pipelines."
              : undefined
        }
      />
      {supported ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="New pipeline"
              tone="primary"
              disabled={!caps.connected || !saveAllowed}
              onPress={() => setEditing({ pipeline: null })}
            />
            <Button
              label="Refresh"
              disabled={!caps.connected || query.isPending}
              onPress={refresh}
            />
          </View>
          {query.isPending && !query.data ? (
            <Text>Loading pipelines…</Text>
          ) : !query.error && pipelines.length === 0 ? (
            <Text>No pipelines here yet. Add steps to connect bots into a workflow.</Text>
          ) : null}
          {pipelines.length ? (
            <SettingsSection>
              {pipelines.map((pipeline, index) => (
                <View
                  key={pipeline.id}
                  className={cn("gap-3 p-4", index > 0 && "border-t border-border-subtle")}
                >
                  <Text accessibilityRole="header" className="text-lg font-t3-semibold">
                    {pipeline.name}
                  </Text>
                  {pipeline.description ? <Text>{pipeline.description}</Text> : null}
                  <Text className="text-sm text-foreground-muted">
                    Version {pipeline.version} · {pipeline.steps.map((step) => step.id).join(" → ")}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label={`Run ${pipeline.name}`}
                      tone="primary"
                      disabled={!caps.connected || !runAllowed}
                      onPress={() => setRunning(pipeline)}
                    />
                    <Button
                      label={`Edit ${pipeline.name}`}
                      disabled={!caps.connected || !saveAllowed}
                      onPress={() => setEditing({ pipeline })}
                    />
                    <Button
                      label={`Delete ${pipeline.name}`}
                      tone="danger"
                      disabled={busy || !caps.connected || !deleteAllowed}
                      onPress={() => void deletePipeline(pipeline)}
                    />
                  </View>
                </View>
              ))}
            </SettingsSection>
          ) : null}
          {selectedRun ? (
            <PipelineRunDetail
              key={selectedRun}
              environmentId={environmentId}
              runId={selectedRun}
              changes={changes}
              onClose={() => setSelectedRun(undefined)}
              onChanged={runsQuery.refresh}
              onRunAgain={(id) => {
                const pipeline = allPipelines.find((candidate) => candidate.id === id);
                if (pipeline) setRunning(pipeline);
                else setError("This pipeline has been deleted. Its saved runs remain available.");
              }}
            />
          ) : null}
          <BotSection title="Recent pipeline runs">
            <BotNotice
              error={runsQuery.error}
              detail={
                runsQuery.isPending && runs.length === 0 ? "Loading pipeline runs…" : undefined
              }
            />
            {!runsQuery.error && !runsQuery.isPending && runs.length === 0 ? (
              <Text>No pipeline runs yet.</Text>
            ) : null}
            {runs.map((run) => (
              <View key={run.id} className="gap-2 rounded-xl border border-border-subtle p-3">
                <Text className="font-t3-semibold">
                  {run.pipelineName} · {PIPELINE_STATUS[run.status]}
                  {run.finalVerdict ? ` · ${VERDICT_LABELS[run.finalVerdict]}` : ""}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {runTime(run.createdAt)} · Version {run.pipelineVersion}
                  {run.cursorStepId && isActiveBotPipelineRunStatus(run.status)
                    ? ` · At ${run.cursorStepId}`
                    : ""}
                </Text>
                <Button
                  label={selectedRun === run.id ? "Viewing run" : "View pipeline run"}
                  onPress={() => setSelectedRun(run.id)}
                />
              </View>
            ))}
            {runsQuery.data?.hasMore ? (
              <Button
                label="Load older runs"
                disabled={!caps.connected || runsQuery.isPending}
                onPress={() => {
                  const last = runsQuery.data?.runs.at(-1);
                  if (last) {
                    setPastRuns(runs);
                    setBefore(last.createdAt);
                  }
                }}
              />
            ) : null}
          </BotSection>
          {editing ? (
            <BotPipelineEditor
              environmentId={environmentId}
              pipeline={editing.pipeline}
              allBots={collection.bots}
              canSave={caps.connected && saveAllowed}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                query.refresh();
              }}
            />
          ) : null}
          {running ? (
            <PipelineRunForm
              environmentId={environmentId}
              pipeline={running}
              allBots={collection.bots}
              canRun={
                caps.connected &&
                runAllowed &&
                allPipelines.some(
                  (pipeline) => pipeline.id === running.id && pipeline.version === running.version,
                )
              }
              unavailable={
                !allPipelines.some(
                  (pipeline) => pipeline.id === running.id && pipeline.version === running.version,
                )
                  ? "This pipeline changed or was deleted. Close this form and reopen the latest version to review it before running."
                  : undefined
              }
              onClose={() => setRunning(null)}
              onStarted={(run) => {
                setRunning(null);
                setSelectedRun(run.id);
                runsQuery.refresh();
              }}
            />
          ) : null}
        </>
      ) : null}
    </BotPage>
  );
}
