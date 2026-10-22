import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  BOTS_RUN_NOTE_MAX,
  isTerminalBotRunStatus,
  type BotRun,
  type BotRunRating,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { applyRunChanges } from "@t3tools/client-runtime/fork";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotPage, BotNotice } from "./BotControls";
import {
  bots,
  useBotsCapabilities,
  useBotsCollection,
  useBotsReconnect,
  useRefreshWhenBotsChangesPruned,
} from "./state";
import { RunChoice } from "./BotRunScreen";
import { BotModelField } from "./BotModelField";
import { useBotActionLifetime } from "./useBotActionLifetime";
import {
  commandValue,
  failureMessage,
  RUN_STATUS,
  VERDICT_LABELS,
  runSummary,
  runTime,
} from "./runLogic";

export function BotRunSummary({ run }: { readonly run: BotRun }) {
  return (
    <View className="gap-1">
      <Text className="font-t3-semibold">
        {run.botName} · {RUN_STATUS[run.status]}
        {run.verdict ? ` · ${VERDICT_LABELS[run.verdict.verdict]}` : ""}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {runTime(run.finishedAt ?? run.startedAt ?? run.createdAt)} · v{run.botVersion}
        {run.modelSelection ? ` · ${run.modelSelection.model}` : ""}
      </Text>
      {run.ranOn ? (
        <Text className="text-sm text-foreground-muted">Ran on {run.ranOn.label}</Text>
      ) : null}
      {run.requestedBy ? (
        <Text className="text-sm text-foreground-muted">Requested by {run.requestedBy.label}</Text>
      ) : null}
      {runSummary(run) ? (
        <Text numberOfLines={2} className="text-sm text-foreground-muted">
          {runSummary(run)}
        </Text>
      ) : null}
      {run.verdict ? <Text>{run.verdict.summary}</Text> : null}
      {run.error ? <BotNotice error={run.error} /> : null}
    </View>
  );
}

export function BotRunHistory({
  environmentId,
  botId,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId?: string;
}) {
  return (
    <RunHistory
      key={`${environmentId}:${botId ?? "all"}`}
      environmentId={environmentId}
      botId={botId}
    />
  );
}

function RunHistory({
  environmentId,
  botId,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId?: string;
}) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const { changes } = useBotsCollection(environmentId);
  const [verdict, setVerdict] = useState<BotVerdictValue | "">("");
  const [before, setBefore] = useState<string | undefined>();
  const [earlier, setEarlier] = useState<ReadonlyArray<BotRun>>([]);
  const query = useEnvironmentQuery(
    capabilities.supported
      ? bots.listRuns({
          environmentId,
          input: {
            ...(botId ? { botId } : {}),
            ...(before ? { before } : {}),
            ...(verdict ? { verdict } : {}),
            limit: BOTS_LIST_RUNS_MAX_LIMIT,
          },
        })
      : null,
  );
  const refresh = () => {
    setBefore(undefined);
    setEarlier([]);
    query.refresh();
  };
  useRefreshWhenBotsChangesPruned(changes, refresh);
  useBotsReconnect(capabilities.connected, refresh);
  const runs = applyRunChanges([...earlier, ...(query.data?.runs ?? [])], changes, {
    botId,
    ...(verdict ? { verdict } : {}),
    includeNew: true,
  });
  return (
    <View className="gap-3">
      <Text className="text-lg font-t3-semibold">Run history</Text>
      <RunChoice
        label="Verdict"
        value={verdict}
        choices={[
          { value: "", label: "All runs" },
          ...Object.entries(VERDICT_LABELS).map(([value, label]) => ({ value, label })),
        ]}
        onChange={(value) => {
          setVerdict(value as BotVerdictValue | "");
          setBefore(undefined);
          setEarlier([]);
        }}
      />
      <Button
        label="Refresh history"
        disabled={!capabilities.connected || query.isPending}
        onPress={refresh}
      />
      <BotNotice
        error={query.error}
        detail={
          query.error
            ? null
            : query.isPending && !runs.length
              ? "Loading runs…"
              : !query.isPending && !runs.length
                ? "No runs yet."
                : null
        }
      />
      {runs.map((run) => (
        <View key={run.id} className="gap-3 rounded-2xl bg-grouped-card p-4">
          <BotRunSummary run={run} />
          <Button
            label="View run"
            onPress={() => navigation.navigate("BotsRunDetail", { environmentId, runId: run.id })}
          />
        </View>
      ))}
      {query.data?.hasMore ? (
        <Button
          label="Older runs"
          disabled={query.isPending || !capabilities.connected}
          onPress={() => {
            const last = query.data?.runs.at(-1);
            if (!last) return;
            setEarlier(runs);
            setBefore(last.createdAt);
          }}
        />
      ) : null}
    </View>
  );
}

export function BotRunActions({
  environmentId,
  run,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly refresh: () => void;
}) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const cancelAllowed = useAtomValue(bots.cancel.permissionAtom(environmentId));
  const retryAllowed = useAtomValue(bots.retry.permissionAtom(environmentId));
  const dismissAllowed = useAtomValue(bots.dismiss.permissionAtom(environmentId));
  const promoteAllowed = useAtomValue(bots.promote.permissionAtom(environmentId));
  const rateAllowed = useAtomValue(bots.rateRun.permissionAtom(environmentId));
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const retry = useAtomCommand(bots.retry, { reportFailure: false });
  const dismiss = useAtomCommand(bots.dismiss, { reportFailure: false });
  const promote = useAtomCommand(bots.promote, { reportFailure: false });
  const rate = useAtomCommand(bots.rateRun, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const live = useBotActionLifetime();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState(run.note ?? "");
  const [chooseModel, setChooseModel] = useState(false);
  const [model, setModel] = useState<ModelSelection | null>(run.modelSelection ?? null);
  const active = !isTerminalBotRunStatus(run.status);
  const disabled = busy || !capabilities.connected;
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (live.current) refresh();
    } catch (cause) {
      if (live.current) setError(failureMessage(cause, "Could not update this run."));
    }
    if (live.current) setBusy(false);
  };
  const rerun = (selection?: ModelSelection) =>
    act(async () => {
      const result = await retry({
        environmentId,
        input: { runId: run.id, ...(selection ? { modelSelection: selection } : {}) },
      });
      const started = commandValue(result);
      if (!live.current) return;
      setChooseModel(false);
      navigation.navigate("BotsRunDetail", { environmentId, runId: started.id });
    });
  const rateRun = (rating: BotRunRating | null) =>
    act(async () => {
      const result = await rate({
        environmentId,
        input: { runId: run.id, rating, note: note || null },
      });
      commandValue(result);
      setMessage("Feedback saved.");
    });
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {run.status !== "queued" ? (
          <Button
            label="Open thread"
            onPress={() =>
              navigation.navigate("Thread", {
                environmentId: run.ranOn?.environmentId ?? environmentId,
                threadId: run.threadId,
              })
            }
          />
        ) : null}
        {active ? (
          <Button
            label="Cancel run"
            tone="danger"
            disabled={disabled || !cancelAllowed}
            onPress={() =>
              void act(async () => {
                const result = await cancel({ environmentId, input: { runId: run.id } });
                commandValue(result);
              })
            }
          />
        ) : run.pipelineRunId ? (
          <Button
            label="Open pipeline run"
            onPress={() =>
              navigation.navigate("BotsPipelines", {
                environmentId,
                runId: run.pipelineRunId ?? undefined,
              })
            }
          />
        ) : (
          <>
            <Button
              label="Retry"
              disabled={disabled || !retryAllowed}
              onPress={() => void rerun()}
            />
            <Button
              label="Retry on another model"
              disabled={disabled || !retryAllowed}
              onPress={() => setChooseModel((shown) => !shown)}
            />
          </>
        )}
        {!active && capabilities.inboxSupported ? (
          <>
            <Button
              label="Open as thread"
              disabled={disabled || !promoteAllowed}
              onPress={() =>
                void act(async () => {
                  const result = await promote({ environmentId, input: { runId: run.id } });
                  const promoted = commandValue(result);
                  if (!live.current) return;
                  navigation.navigate("Thread", { environmentId, threadId: promoted.threadId });
                })
              }
            />
            <Button
              label={run.dismissedAt ? "Restore to inbox" : "Dismiss from inbox"}
              disabled={disabled || !dismissAllowed}
              onPress={() =>
                void act(async () => {
                  const result = await dismiss({
                    environmentId,
                    input: { runIds: [run.id], dismissed: !run.dismissedAt },
                  });
                  commandValue(result);
                  setMessage(
                    run.dismissedAt
                      ? "Restored to inbox."
                      : "Dismissed. Use Restore to inbox to undo.",
                  );
                })
              }
            />
          </>
        ) : null}
      </View>
      {chooseModel ? (
        <View className="gap-3">
          <BotModelField
            environmentId={environmentId}
            projectId={run.projectId}
            value={model}
            onChange={setModel}
            disabled={disabled}
          />
          <Button
            label="Retry with selected model"
            disabled={disabled || !retryAllowed || !model}
            onPress={() => {
              if (model) void rerun(model);
            }}
          />
        </View>
      ) : null}
      {!active && capabilities.versionsSupported ? (
        <View className="gap-3">
          <Text className="font-t3-semibold">Feedback</Text>
          <TextInput
            accessibilityLabel="Run feedback note"
            value={note}
            maxLength={BOTS_RUN_NOTE_MAX}
            editable={!disabled && rateAllowed}
            onChangeText={setNote}
            multiline
            placeholder="Note (optional)"
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={run.rating === "up" ? "Clear good rating" : "Good result"}
              disabled={disabled || !rateAllowed}
              tone={run.rating === "up" ? "primary" : "secondary"}
              onPress={() => void rateRun(run.rating === "up" ? null : "up")}
            />
            <Button
              label={run.rating === "down" ? "Clear bad rating" : "Bad result"}
              disabled={disabled || !rateAllowed}
              tone={run.rating === "down" ? "primary" : "secondary"}
              onPress={() => void rateRun(run.rating === "down" ? null : "down")}
            />
            <Button
              label="Save note"
              disabled={disabled || !rateAllowed || note === (run.note ?? "")}
              onPress={() => void rateRun(run.rating ?? null)}
            />
          </View>
        </View>
      ) : null}
      <BotNotice error={error} detail={message} />
    </View>
  );
}

function RunDetail({
  environmentId,
  runId,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: string;
}) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const { changes } = useBotsCollection(environmentId);
  const detail = useEnvironmentQuery(
    capabilities.runDetailsSupported ? bots.getRun({ environmentId, input: { runId } }) : null,
  );
  const recent = useEnvironmentQuery(
    capabilities.supported && !capabilities.runDetailsSupported
      ? bots.listRuns({ environmentId, input: { limit: BOTS_LIST_RUNS_MAX_LIMIT } })
      : null,
  );
  const query = capabilities.runDetailsSupported ? detail : recent;
  useRefreshWhenBotsChangesPruned(changes, query.refresh);
  useBotsReconnect(capabilities.connected, query.refresh);
  const run =
    changes.runs.get(runId) ??
    detail.data?.run ??
    recent.data?.runs.find((candidate) => candidate.id === runId);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [raw, setRaw] = useState<boolean | null>(null);
  const rawShown = raw ?? (!run?.verdict || run.verdict.source === "invalid");
  const copy = async (value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setCopyError(null);
    } catch {
      setCopyError("Could not copy. Select the text to copy it manually.");
    }
  };
  return (
    <BotPage title={run?.botName ?? "Bot run"} back>
      <Button
        label="Refresh run"
        disabled={!capabilities.connected || query.isPending}
        onPress={query.refresh}
      />
      <BotNotice
        error={query.error ?? copyError}
        detail={
          !capabilities.connected
            ? "This computer is offline. Saved run details may be out of date."
            : null
        }
      />
      {!run ? (
        <Text>
          {query.isPending
            ? "Loading run…"
            : query.error
              ? "Could not load this run. Try refreshing it."
              : capabilities.runDetailsSupported
                ? "This run is no longer available."
                : "This run is outside this computer's recent history. Update the server to open older run details."}
        </Text>
      ) : (
        <>
          <BotRunSummary run={run} />
          <BotRunActions environmentId={environmentId} run={run} refresh={query.refresh} />
          {run.verdict ? (
            <View className="gap-3">
              <Text className="text-lg font-t3-semibold">Findings</Text>
              {run.verdict.findings.map((finding) => (
                <View
                  key={JSON.stringify(finding)}
                  className="gap-2 rounded-2xl bg-grouped-card p-4"
                >
                  <Text className="font-t3-semibold">{finding.title}</Text>
                  {finding.path ? (
                    <Button
                      label={`${finding.path}${finding.line ? `:${finding.line}` : ""}`}
                      tone="text"
                      accessibilityLabel={`Copy location ${finding.path}${finding.line ? `:${finding.line}` : ""}`}
                      onPress={() =>
                        void copy(`${finding.path}${finding.line ? `:${finding.line}` : ""}`)
                      }
                    />
                  ) : null}
                  <Text selectable>{finding.detail}</Text>
                </View>
              ))}
              {run.verdict.findingsTruncated ? (
                <Text>More findings are available in the thread.</Text>
              ) : null}
            </View>
          ) : null}
          {run.result ? (
            <View className="gap-3">
              <Button
                label={rawShown ? "Hide raw reply" : "Show raw reply"}
                onPress={() => setRaw(!rawShown)}
              />
              {rawShown ? (
                <>
                  <Text selectable>{run.result}</Text>
                  {run.resultTruncated ? (
                    <Text>Reply shortened. Open the thread for the full text.</Text>
                  ) : null}
                  <Button label="Copy reply" onPress={() => void copy(run.result ?? "")} />
                </>
              ) : null}
            </View>
          ) : null}
          {run.usage ? (
            <Text className="text-xs text-foreground-muted">
              {run.usage.inputTokens.toLocaleString()} input tokens ·{" "}
              {run.usage.outputTokens.toLocaleString()} output tokens · Usage {run.usage.status}
            </Text>
          ) : null}
          {run.batchId ? (
            <Button
              label="Open batch"
              onPress={() =>
                navigation.navigate("BotsBatches", {
                  environmentId,
                  batchId: run.batchId ?? undefined,
                })
              }
            />
          ) : null}
          {run.replayId ? (
            <Button
              label="View replay"
              onPress={() =>
                navigation.navigate("BotsReplay", {
                  environmentId,
                  botId: run.botId,
                  replayId: run.replayId ?? "",
                })
              }
            />
          ) : null}
        </>
      )}
    </BotPage>
  );
}

export function BotRunDetailRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: string; runId: string }>) {
  return (
    <RunDetail
      key={`${route.params.environmentId}:${route.params.runId}`}
      environmentId={route.params.environmentId as EnvironmentId}
      runId={route.params.runId}
    />
  );
}
