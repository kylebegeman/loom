import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  BOTS_LIST_BATCHES_MAX_LIMIT,
  batchCountsLine,
  type BotBatch,
  type BotBatchItem,
  type BotBatchPreview,
  type BotBatchRetryInclude,
  type BotDefinition,
  type BotsBatchInput,
} from "@t3tools/contracts/fork";
import { applyBatchChanges, applyBatchItemChanges } from "@t3tools/client-runtime/fork";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { BotNotice, BotPage, BotToggle } from "./BotControls";
import { BotsOutline, BotsSection } from "./BotIdentity";
import { useBotActionLifetime } from "./useBotActionLifetime";
import {
  BotParameterFields,
  BotRunDestinationFields,
  RunChoice,
  useBotRunDestination,
} from "./BotRunScreen";
import {
  bots,
  useBotBatchChanges,
  useBotsCapabilities,
  useBotsCollection,
  useBotsReconnect,
} from "./state";
import {
  batchSource,
  defaultItemParameter,
  emptyBatchSourceDraft,
  commandValue,
  failureMessage,
  initialRunValues,
  parameterInputs,
  readsFiles,
  RUN_STATUS,
  sourceNeedsProject,
  VERDICT_LABELS,
  runTime,
  type BatchSourceDraft,
  type BatchSourceType,
} from "./runLogic";

const SOURCE_CHOICES: ReadonlyArray<{ value: BatchSourceType; label: string }> = [
  { value: "lines", label: "Pasted lines" },
  { value: "glob", label: "Files matching a pattern" },
  { value: "conflicts", label: "Merge conflicts" },
  { value: "pullRequests", label: "Open pull requests" },
  { value: "search", label: "Search results" },
];

function batchFormInput(
  bot: BotDefinition,
  draft: BatchSourceDraft,
  destination: ReturnType<typeof useBotRunDestination>,
  itemParameter: string,
  values: Record<string, string>,
): { input: BotsBatchInput | null; invalid: string | null } {
  let input: BotsBatchInput | null = null;
  let invalid: string | null = null;
  try {
    const source = batchSource(draft, destination.checkoutThreadId);
    if (!itemParameter) invalid = "This bot has no input for each item to fill.";
    else if (
      destination.usesCheckout &&
      destination.checkoutId !== "" &&
      destination.checkoutThreadId === null
    )
      invalid =
        "The selected checkout is no longer available. Choose another checkout or Project root before continuing.";
    else if (!source) invalid = "Fill in the source, then preview the items.";
    else if (destination.projectRequired && !destination.projectId)
      invalid = "Choose a project first.";
    else
      input = {
        botId: bot.id,
        source,
        itemParameter,
        sharedInputs: parameterInputs(
          bot.parameters.filter((parameter) => parameter.name !== itemParameter),
          values,
        ),
        ...(destination.projectId ? { projectId: destination.projectId as ProjectId } : {}),
      };
  } catch (cause) {
    invalid = failureMessage(cause, "Check the shared inputs.");
  }
  return { input, invalid };
}

function BatchForm({
  environmentId,
  bot,
  onStarted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly onStarted: (batch: BotBatch) => void;
  readonly onClose: () => void;
}) {
  const capabilities = useBotsCapabilities(environmentId);
  const allowed = useAtomValue(bots.runBatch.permissionAtom(environmentId));
  const [draft, setDraft] = useState<BatchSourceDraft>(emptyBatchSourceDraft);
  const [itemParameter, setItemParameter] = useState(() => defaultItemParameter(bot));
  const [values, setValues] = useState(() => initialRunValues(bot));
  const destination = useBotRunDestination(environmentId, bot, {
    sourceProject: sourceNeedsProject(draft.type),
    fileSource: readsFiles(draft.type),
  });
  const [preview, setPreview] = useState<{
    readonly inputKey: string;
    readonly data: BotBatchPreview;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useBotActionLifetime();
  const previewBatch = useAtomQueryRunner(bots.previewBatch, {
    reportFailure: false,
    refresh: true,
  });
  const runBatch = useAtomCommand(bots.runBatch, { reportFailure: false });
  const update = (patch: Partial<BatchSourceDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const { input, invalid } = batchFormInput(bot, draft, destination, itemParameter, values);
  const inputKey = JSON.stringify(input);
  const shown = preview?.inputKey === inputKey ? preview.data : null;
  const canRun = allowed && capabilities.connected && bot.archivedAt === null;
  const ready = shown && shown.total > 0 && !shown.invalid.length;
  const inspect = async () => {
    if (!input || busy || !capabilities.connected) return;
    setBusy(true);
    setError(null);
    await previewBatch({ environmentId, input })
      .then((result) => {
        if (active.current) setPreview({ inputKey, data: commandValue(result) });
      })
      .catch((cause: unknown) => {
        if (active.current) setError(failureMessage(cause, "Could not preview this batch."));
      });
    if (active.current) setBusy(false);
  };
  const submit = async () => {
    if (!input || !ready || busy || !canRun) return;
    setBusy(true);
    setError(null);
    await runBatch({
      environmentId,
      input: {
        ...input,
        ...(destination.target.type === "here" ? {} : { target: destination.target }),
      },
    })
      .then((result) => {
        if (active.current) onStarted(commandValue(result));
      })
      .catch((cause: unknown) => {
        if (active.current) setError(failureMessage(cause, "Could not start this batch."));
      });
    if (active.current) setBusy(false);
  };
  return (
    <BotsOutline>
      <View className="gap-4 p-4">
        <Text className="text-lg font-t3-semibold">Run {bot.name} on many</Text>
        <Text className="text-foreground-muted">
          Choose the source and input each item fills. Every item uses the bot's own limits.
        </Text>
        <RunChoice
          label="Items"
          value={draft.type}
          choices={SOURCE_CHOICES}
          disabled={busy}
          onChange={(value) => update({ type: value as BatchSourceType })}
        />
        {draft.type === "lines" ? (
          <>
            <Text>One item per line</Text>
            <TextInput
              accessibilityLabel="One item per line"
              multiline
              value={draft.lines}
              editable={!busy}
              onChangeText={(lines) => update({ lines })}
            />
          </>
        ) : null}
        {draft.type === "glob" ? (
          <>
            <Text>File pattern</Text>
            <TextInput
              accessibilityLabel="File pattern"
              placeholder="src/**/*.tsx"
              autoCapitalize="none"
              value={draft.pattern}
              editable={!busy}
              onChangeText={(pattern) => update({ pattern })}
            />
          </>
        ) : null}
        {draft.type === "search" ? (
          <RunChoice
            label="Search"
            value={draft.searchMode}
            choices={[
              { value: "files", label: "File names" },
              { value: "contents", label: "File contents" },
            ]}
            disabled={busy}
            onChange={(value) => update({ searchMode: value as "files" | "contents" })}
          />
        ) : null}
        {draft.type === "search" || draft.type === "pullRequests" ? (
          <>
            <Text>
              {draft.type === "search" ? "Search text" : "Pull request filter (optional)"}
            </Text>
            <TextInput
              accessibilityLabel={draft.type === "search" ? "Search text" : "Pull request filter"}
              value={draft.query}
              autoCapitalize="none"
              editable={!busy}
              onChangeText={(query) => update({ query })}
            />
          </>
        ) : null}
        <BotRunDestinationFields
          environmentId={environmentId}
          bot={bot}
          destination={destination}
          disabled={busy}
        />
        {bot.parameters.length > 1 ? (
          <RunChoice
            label="Each item fills"
            value={itemParameter}
            choices={bot.parameters.map((parameter) => ({
              value: parameter.name,
              label: parameter.label,
            }))}
            disabled={busy}
            onChange={setItemParameter}
          />
        ) : null}
        <BotParameterFields
          parameters={bot.parameters.filter((parameter) => parameter.name !== itemParameter)}
          values={values}
          disabled={busy}
          onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
        />
        <BotNotice
          error={error}
          detail={
            invalid ??
            (!canRun
              ? "This connection cannot start this batch. Reconnect or restore the bot if needed."
              : null)
          }
        />
        <Button
          label={busy ? "Working…" : "Preview items"}
          disabled={busy || !input || !capabilities.connected}
          onPress={() => void inspect()}
        />
        {preview && !shown ? <Text>The inputs changed. Preview again before starting.</Text> : null}
        {shown ? (
          <View className="gap-2">
            <Text className="font-t3-semibold">{shown.sourceSummary}</Text>
            {shown.note ? <Text>{shown.note}</Text> : null}
            {shown.items.map((item, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- A preview is one immutable ordered snapshot; repeated lines have no separate identity.
              <Text key={`${index}:${item.label}`}>{item.label}</Text>
            ))}
            {shown.total > shown.items.length ? (
              <Text>{shown.total - shown.items.length} more items.</Text>
            ) : null}
            {shown.invalid.map((item, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- Repeated invalid inputs are distinct entries in this immutable preview snapshot.
              <BotNotice key={`${index}:${item.label}`} error={`${item.label}: ${item.message}`} />
            ))}
            {!shown.total ? <Text>No matching items.</Text> : null}
          </View>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={`Run on ${shown?.total ?? 0} item${shown?.total === 1 ? "" : "s"}`}
            tone="primary"
            disabled={busy || !canRun || !ready}
            onPress={() => void submit()}
          />
          <Button label="Close batch form" disabled={busy} onPress={onClose} />
        </View>
      </View>
    </BotsOutline>
  );
}

export const batchItemOutcome = (item: BotBatchItem) =>
  item.state === "pending"
    ? "Waiting"
    : item.state === "skipped"
      ? "Skipped"
      : item.run === null
        ? "Run no longer stored"
        : item.run.verdict
          ? VERDICT_LABELS[item.run.verdict.verdict]
          : RUN_STATUS[item.run.status];

function BatchDetail({
  environmentId,
  batchId,
  latestVersion,
}: {
  readonly environmentId: EnvironmentId;
  readonly batchId: string;
  readonly latestVersion: (botId: string) => number | null;
}) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const changes = useBotBatchChanges(
    environmentId,
    capabilities.connected && capabilities.batchesSupported,
  );
  const [showReport, setShowReport] = useState(false);
  const [visibleItems, setVisibleItems] = useState(50);
  const query = useEnvironmentQuery(
    capabilities.batchesSupported ? bots.getBatch({ environmentId, input: { batchId } }) : null,
  );
  const report = useEnvironmentQuery(
    capabilities.batchesSupported && showReport
      ? bots.batchReport({ environmentId, input: { batchId } })
      : null,
  );
  useBotsReconnect(capabilities.connected, query.refresh);
  useBotsReconnect(capabilities.connected, report.refresh);
  const page = query.data ? applyBatchItemChanges(query.data, changes) : null;
  const counts = page ? batchCountsLine(page.batch.counts) : "";
  const previousCounts = useRef(counts);
  const refreshReport = report.refresh;
  useEffect(() => {
    if (previousCounts.current === counts) return;
    previousCounts.current = counts;
    if (showReport) refreshReport();
  }, [counts, showReport, refreshReport, previousCounts]);
  const cancel = useAtomCommand(bots.cancelBatch, { reportFailure: false });
  const retry = useAtomCommand(bots.retryBatch, { reportFailure: false });
  const cancelAllowed = useAtomValue(bots.cancelBatch.permissionAtom(environmentId));
  const retryAllowed = useAtomValue(bots.retryBatch.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [useLatest, setUseLatest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!page)
    return (
      <BotNotice
        error={query.error}
        detail={query.isPending ? "Loading batch…" : "This batch is no longer available."}
      />
    );
  const { batch, items } = page;
  const newer = latestVersion(batch.botId);
  const hasNewer = newer !== null && newer !== batch.botVersion;
  const failed = batch.counts.failed + batch.counts.timedOut + batch.counts.fail;
  const attention = batch.counts.needsAttention;
  const active = batch.status === "running";
  const disabled = busy || !capabilities.connected;
  const act = async (work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
      query.refresh();
      report.refresh();
    } catch (cause) {
      setError(failureMessage(cause, "Could not update this batch."));
    }
    setBusy(false);
  };
  const rerun = (include: BotBatchRetryInclude) =>
    act(async () => {
      const result = await retry({
        environmentId,
        input: { batchId, include, ...(hasNewer && useLatest ? { useLatest: true } : {}) },
      });
      const retried = commandValue(result);
      return `Retrying ${retried.retried} items.${retried.exhausted.length ? ` Attempt limit reached: ${retried.exhausted.join(", ")}.` : ""}`;
    });
  return (
    <View className="gap-4">
      <Text className="text-lg font-t3-semibold">
        {batch.botName} · {batch.status}
      </Text>
      <Text>{batch.sourceSummary}</Text>
      <Text className="text-foreground-muted">
        v{batch.botVersion} · {runTime(batch.createdAt)}
      </Text>
      <Text>{counts}</Text>
      {batch.note ? <Text>{batch.note}</Text> : null}
      {batch.pausedUntil ? (
        <Text>Paused until {runTime(batch.pausedUntil)} while the bot's budget recovers.</Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Refresh batch"
          disabled={disabled}
          onPress={() => {
            query.refresh();
            report.refresh();
          }}
        />
        {active ? (
          <Button
            label="Cancel batch"
            tone="danger"
            disabled={disabled || !cancelAllowed}
            onPress={() =>
              void act(async () => {
                const result = await cancel({ environmentId, input: { batchId } });
                commandValue(result);
                return "Batch cancelled.";
              })
            }
          />
        ) : (
          <>
            {failed ? (
              <Button
                label="Retry failed"
                disabled={disabled || !retryAllowed}
                onPress={() => void rerun("failed")}
              />
            ) : null}
            {attention ? (
              <Button
                label="Retry failed and needs attention"
                disabled={disabled || !retryAllowed}
                onPress={() => void rerun("failed_and_attention")}
              />
            ) : null}
          </>
        )}
      </View>
      {!active && hasNewer && failed + attention > 0 ? (
        <BotToggle
          label={`Retry with version ${newer} instead of ${batch.botVersion}`}
          value={useLatest}
          onChange={setUseLatest}
          disabled={disabled}
        />
      ) : null}
      <BotNotice error={error ?? query.error} detail={message} />
      <BotsSection title="Items">
        {items.length ? (
          <BotsOutline>
            {items.slice(0, visibleItems).map((item, index) => (
              <View
                key={item.index}
                className={cn("gap-2 p-4", index > 0 && "border-t border-border-subtle")}
              >
                <Text className="font-t3-semibold">{item.label}</Text>
                <Text>{batchItemOutcome(item)}</Text>
                {item.previousRunIds.length ? (
                  <Text className="text-xs text-foreground-muted">
                    {item.previousRunIds.length + (item.runId ? 1 : 0)} attempts
                  </Text>
                ) : null}
                {item.runId ? (
                  <Button
                    label="View item run"
                    onPress={() =>
                      navigation.navigate("BotsRunDetail", {
                        environmentId,
                        runId: item.runId ?? "",
                      })
                    }
                  />
                ) : null}
              </View>
            ))}
          </BotsOutline>
        ) : null}
        {items.length > visibleItems ? (
          <Button
            label={`Show more items (${visibleItems} of ${items.length})`}
            onPress={() => setVisibleItems((count) => count + 50)}
          />
        ) : null}
      </BotsSection>
      <Button
        label={showReport ? "Hide report" : "Show report"}
        onPress={() => setShowReport((open) => !open)}
      />
      {showReport ? (
        <View className="gap-3">
          <BotNotice
            error={report.error}
            detail={report.isPending && !report.data ? "Loading report…" : null}
          />
          {report.data ? (
            <>
              <Text selectable>{report.data.markdown}</Text>
              {report.data.truncated ? <Text>The report was shortened.</Text> : null}
              <Button
                label="Copy report"
                onPress={() =>
                  void Clipboard.setStringAsync(report.data?.markdown ?? "").then(
                    () => setMessage("Report copied."),
                    () => setError("Could not copy this report. Select its text to copy manually."),
                  )
                }
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Batches({
  environmentId,
  botId,
  batchId,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId?: string;
  readonly batchId?: string;
}) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const changes = useBotBatchChanges(
    environmentId,
    capabilities.connected && capabilities.batchesSupported,
  );
  const [before, setBefore] = useState<string | undefined>();
  const [earlier, setEarlier] = useState<ReadonlyArray<BotBatch>>([]);
  const query = useEnvironmentQuery(
    capabilities.batchesSupported
      ? bots.listBatches({
          environmentId,
          input: {
            limit: BOTS_LIST_BATCHES_MAX_LIMIT,
            ...(botId ? { botId } : {}),
            ...(before ? { before } : {}),
          },
        })
      : null,
  );
  const refresh = () => {
    setBefore(undefined);
    setEarlier([]);
    query.refresh();
  };
  useBotsReconnect(capabilities.connected, refresh);
  const batches = applyBatchChanges([...earlier, ...(query.data?.batches ?? [])], changes, {
    botId,
    includeNew: true,
  });
  const [creating, setCreating] = useState(false);
  const [chosenBotId, setChosenBotId] = useState(botId ?? "");
  const bot = collection.bots.find((candidate) => candidate.id === chosenBotId);
  return (
    <BotPage title={batchId ? "Bot batch" : "Bot batches"}>
      <BotNotice
        error={query.error ?? collection.query.error}
        detail={
          !capabilities.batchesSupported
            ? "Update this computer's server to manage bot batches."
            : !capabilities.connected
              ? "This computer is offline. Reconnect to start or update batches."
              : null
        }
      />
      {batchId && capabilities.batchesSupported ? (
        <BatchDetail
          key={batchId}
          environmentId={environmentId}
          batchId={batchId}
          latestVersion={(id) =>
            collection.bots.find(
              (candidate) => candidate.id === id && candidate.archivedAt === null,
            )?.version ?? null
          }
        />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Run on many"
              tone="primary"
              disabled={!capabilities.batchesSupported || !capabilities.connected}
              onPress={() => setCreating(true)}
            />
            <Button
              label="Refresh batches"
              disabled={!capabilities.connected || query.isPending}
              onPress={refresh}
            />
          </View>
          {creating ? (
            <>
              <RunChoice
                label="Bot"
                value={chosenBotId}
                choices={collection.bots
                  .filter((candidate) => candidate.archivedAt === null)
                  .map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                onChange={setChosenBotId}
              />
              {bot ? (
                <BatchForm
                  key={`${bot.id}:${bot.version}`}
                  environmentId={environmentId}
                  bot={bot}
                  onClose={() => setCreating(false)}
                  onStarted={(batch) => {
                    setCreating(false);
                    refresh();
                    navigation.navigate("BotsBatches", {
                      environmentId,
                      botId: bot.id,
                      batchId: batch.id,
                    });
                  }}
                />
              ) : (
                <Text>Choose a bot with at least one input.</Text>
              )}
            </>
          ) : null}
          {!batches.length && !query.error ? (
            <Text>
              {query.isPending
                ? "Loading batches…"
                : "No batches yet. Run a bot on many items to start one."}
            </Text>
          ) : null}
          {batches.length ? (
            <BotsOutline>
              {batches.map((batch, index) => (
                <View
                  key={batch.id}
                  className={cn("gap-2 p-4", index > 0 && "border-t border-border-subtle")}
                >
                  <Text className="font-t3-semibold">
                    {batch.botName} · {batch.status}
                  </Text>
                  <Text>{batch.sourceSummary}</Text>
                  <Text className="text-foreground-muted">
                    {runTime(batch.createdAt)} · {batchCountsLine(batch.counts)}
                  </Text>
                  <Button
                    label="View batch"
                    onPress={() =>
                      navigation.navigate("BotsBatches", {
                        environmentId,
                        ...(botId ? { botId } : {}),
                        batchId: batch.id,
                      })
                    }
                  />
                </View>
              ))}
            </BotsOutline>
          ) : null}
          {query.data?.hasMore ? (
            <Button
              label="Older batches"
              disabled={query.isPending || !capabilities.connected}
              onPress={() => {
                const last = query.data?.batches.at(-1);
                if (!last) return;
                setEarlier(batches);
                setBefore(last.createdAt);
              }}
            />
          ) : null}
        </>
      )}
    </BotPage>
  );
}

export function BotBatchesRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: string; botId?: string; batchId?: string }>) {
  return (
    <Batches
      key={`${route.params.environmentId}:${route.params.botId ?? "all"}`}
      environmentId={route.params.environmentId as EnvironmentId}
      botId={route.params.botId}
      batchId={route.params.batchId}
    />
  );
}
