import { useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import { Pressable, ScrollView, View } from "react-native";
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
import {
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  applyRunChanges,
  canRetryBotRun,
  isBotTriageRun,
} from "@t3tools/client-runtime/fork";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconButton } from "../../components/ui/IconButton";
import { RowPressable } from "../../components/ui/RowPressable";
import { cn } from "../../lib/cn";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
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
import { BotModelField } from "./BotModelField";
import {
  BotRowsSkeleton,
  BotRunStateBadge,
  BotSpecGrid,
  BotStateDot,
  BotTile,
  BotVerdictBadge,
  BotsEmptyList,
  BotsOutline,
  BotsSection,
} from "./BotIdentity";
import { useBotActionLifetime } from "./useBotActionLifetime";
import { commandValue, failureMessage, runMeta, runSummary, showsRunState } from "./runLogic";

const VERDICT_FILTERS = ["", "pass", "fail", "needs_attention"] as const;

/**
 * A run in one glance: whose it is, how it went, when and how long. Shared by every run list so
 * history and the inbox read alike.
 */
function BotRunSummary({
  run,
  showBot = true,
}: {
  readonly run: BotRun;
  /** Off inside one bot's own list, where the inputs tell its runs apart better than its name. */
  readonly showBot?: boolean;
}) {
  const tone = BOT_RUN_STATES[run.status].tone;
  const summary = runSummary(run);
  return (
    <View className="flex-row items-start gap-3">
      {showBot ? (
        <BotTile botId={run.botId} status={<BotStateDot tone={tone} />} />
      ) : (
        <View className="px-1 pt-1.5">
          <BotStateDot tone={tone} />
        </View>
      )}
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-t3-medium text-foreground">
            {showBot ? run.botName : summary || "No inputs"}
          </Text>
          {run.verdict ? <BotVerdictBadge verdict={run.verdict.verdict} /> : null}
          {showsRunState(run) ? <BotRunStateBadge status={run.status} /> : null}
        </View>
        <Text numberOfLines={1} className="text-xs tabular-nums text-foreground-muted">
          {runMeta(run)}
        </Text>
        {showBot && summary ? (
          <Text numberOfLines={1} className="text-xs text-foreground-muted">
            {summary}
          </Text>
        ) : null}
        {run.verdict ? (
          <Text numberOfLines={2} className="text-sm text-foreground">
            {run.verdict.summary}
          </Text>
        ) : null}
        {run.error ? (
          <Text numberOfLines={3} className="text-sm text-danger-foreground">
            {run.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A run row that opens the run; `actions` sit under it so a tap on them never opens the run. */
export function BotRunRow({
  run,
  showBot = true,
  separated,
  onOpen,
  actions,
}: {
  readonly run: BotRun;
  readonly showBot?: boolean;
  readonly separated: boolean;
  readonly onOpen: () => void;
  readonly actions?: ReactNode;
}) {
  const state = BOT_RUN_STATES[run.status].label;
  const verdict = run.verdict ? `, ${BOT_VERDICT_STATES[run.verdict.verdict].label}` : "";
  return (
    <View className={cn(separated && "border-t border-border-subtle")}>
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`${run.botName}, ${state}${verdict}`}
        accessibilityHint="Opens the run"
        onPress={onOpen}
        className="px-4 py-3 active:opacity-70"
      >
        <BotRunSummary run={run} showBot={showBot} />
      </RowPressable>
      {actions ? (
        <View className={cn("flex-row flex-wrap gap-1 pe-2 pb-1", showBot ? "ps-14" : "ps-8")}>
          {actions}
        </View>
      ) : null}
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
    <BotsSection
      title="Runs"
      detail={runs.length ? `${runs.length}${query.data?.hasMore ? "+" : ""}` : undefined}
      trailing={
        <IconButton
          icon="arrow.clockwise"
          accessibilityLabel="Refresh runs"
          tintColorClassName="accent-icon-muted"
          disabled={!capabilities.connected || query.isPending}
          onPress={refresh}
        />
      }
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Filter runs by verdict"
        className="grow-0"
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      >
        {VERDICT_FILTERS.map((value) => {
          const current = value === verdict;
          return (
            <Pressable
              key={value || "all"}
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              onPress={() => {
                setVerdict(value);
                setBefore(undefined);
                setEarlier([]);
              }}
              className={cn(
                "min-h-9 justify-center rounded-full border px-3.5 active:opacity-70",
                current ? "border-foreground bg-foreground" : "border-border",
              )}
            >
              <Text
                className={cn(
                  "text-sm font-t3-medium",
                  current ? "text-screen" : "text-foreground",
                )}
              >
                {value ? BOT_VERDICT_STATES[value].label : "All runs"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {query.error ? (
        <BotNotice error={query.error} onRetry={refresh} retryLabel="Try again" />
      ) : null}
      {runs.length ? (
        <BotsOutline>
          {runs.map((run, index) => (
            <BotRunRow
              key={run.id}
              run={run}
              showBot={!botId}
              separated={index > 0}
              onOpen={() => navigation.navigate("BotsRunDetail", { environmentId, runId: run.id })}
            />
          ))}
        </BotsOutline>
      ) : query.isPending ? (
        <BotRowsSkeleton label="Loading runs" />
      ) : query.error ? null : (
        <BotsEmptyList
          message={
            verdict
              ? `No runs with a ${BOT_VERDICT_STATES[verdict].label.toLowerCase()} verdict yet.`
              : botId
                ? "No runs yet. Run this bot and its results land here."
                : "No runs yet. Every bot run lands here, newest first."
          }
        />
      )}
      {query.data?.hasMore ? (
        <Button
          label="Older runs"
          tone="text"
          disabled={query.isPending || !capabilities.connected}
          onPress={() => {
            const last = query.data?.runs.at(-1);
            if (!last) return;
            setEarlier(runs);
            setBefore(last.createdAt);
          }}
        />
      ) : null}
    </BotsSection>
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
  const selectDetail = useSelectWorkspaceDetail();
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
  // Retry, continuing in a thread and dismissing arrived with the inbox; older servers have none.
  const retryable = capabilities.inboxSupported && canRetryBotRun(run);
  // The server forks the run's thread where it runs, which a remote run's is not.
  const promotable = capabilities.inboxSupported && !active && !run.ranOn;
  const dismissible = capabilities.inboxSupported && isBotTriageRun(run, false);
  const restorable = capabilities.inboxSupported && isBotTriageRun(run, true);
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
    <View className="gap-5">
      <View className="flex-row flex-wrap gap-2">
        {run.status !== "queued" ? (
          <Button
            label="Open thread"
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: {
                  environmentId: run.ranOn?.environmentId ?? environmentId,
                  threadId: run.threadId,
                },
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
        ) : retryable ? (
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
        ) : null}
        {promotable ? (
          <Button
            label={run.promotedThreadId ? "Open continued thread" : "Open as thread"}
            disabled={disabled || !promoteAllowed}
            onPress={() =>
              void act(async () => {
                const result = await promote({ environmentId, input: { runId: run.id } });
                const promoted = commandValue(result);
                if (!live.current) return;
                selectDetail({
                  name: "Thread",
                  params: { environmentId, threadId: promoted.threadId },
                });
              })
            }
          />
        ) : null}
        {dismissible || restorable ? (
          <Button
            label={restorable ? "Restore to inbox" : "Dismiss from inbox"}
            disabled={disabled || !dismissAllowed}
            onPress={() =>
              void act(async () => {
                const result = await dismiss({
                  environmentId,
                  input: { runIds: [run.id], dismissed: !restorable },
                });
                commandValue(result);
                setMessage(
                  restorable ? "Restored to inbox." : "Dismissed. Use Restore to inbox to undo.",
                );
              })
            }
          />
        ) : null}
      </View>
      {chooseModel && retryable ? (
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
        <BotsSection title="Feedback">
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
        </BotsSection>
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
  const location = (finding: { readonly path?: string | null; readonly line?: number | null }) =>
    finding.path ? `${finding.path}${finding.line ? `:${finding.line}` : ""}` : null;
  return (
    <BotPage
      title={run?.botName ?? "Bot run"}
      back
      actions={[
        {
          icon: "arrow.clockwise",
          accessibilityLabel: "Refresh run",
          disabled: !capabilities.connected || query.isPending,
          onPress: query.refresh,
        },
      ]}
    >
      <BotNotice
        error={query.error ?? copyError}
        detail={
          !capabilities.connected
            ? "This computer is offline. Saved run details may be out of date."
            : null
        }
      />
      {!run ? (
        query.isPending ? (
          <RunDetailSkeleton />
        ) : (
          <EmptyState
            variant="plain"
            title={query.error ? "Could not load this run" : "Run not available"}
            detail={
              query.error
                ? "Try refreshing it."
                : capabilities.runDetailsSupported
                  ? "This run is no longer available."
                  : "This run is outside this computer's recent history. Update the server to open older run details."
            }
            {...(query.error ? { actionLabel: "Try again", onAction: query.refresh } : {})}
          />
        )
      ) : (
        <>
          <RunHeader run={run} />
          <BotRunActions environmentId={environmentId} run={run} refresh={query.refresh} />
          {run.verdict ? (
            <BotsSection
              title="Findings"
              detail={
                run.verdict.findings.length
                  ? `${run.verdict.findings.length}${run.verdict.findingsTruncated ? "+" : ""}`
                  : undefined
              }
            >
              {run.verdict.findings.length ? (
                <BotsOutline>
                  {run.verdict.findings.map((finding, index) => {
                    const at = location(finding);
                    return (
                      <View
                        key={JSON.stringify(finding)}
                        className={cn(
                          "gap-1 px-4 py-3",
                          index > 0 && "border-t border-border-subtle",
                        )}
                      >
                        <Text className="text-sm font-t3-medium text-foreground">
                          {finding.title}
                        </Text>
                        {at ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Copy location ${at}`}
                            onPress={() => void copy(at)}
                            className="min-h-8 justify-center self-start active:opacity-70"
                          >
                            <Text numberOfLines={1} className="font-mono text-xs text-primary-text">
                              {at}
                            </Text>
                          </Pressable>
                        ) : null}
                        <Text selectable className="text-sm text-foreground-muted">
                          {finding.detail}
                        </Text>
                      </View>
                    );
                  })}
                </BotsOutline>
              ) : (
                <BotsEmptyList message="No findings. The verdict summary says it all." />
              )}
              {run.verdict.findingsTruncated ? (
                <Text className="px-1 text-xs text-foreground-muted">
                  More findings are available in the thread.
                </Text>
              ) : null}
            </BotsSection>
          ) : null}
          {run.result ? (
            <BotsSection
              title="Reply"
              trailing={
                <Button
                  label={rawShown ? "Hide raw reply" : "Show raw reply"}
                  tone="text"
                  onPress={() => setRaw(!rawShown)}
                />
              }
            >
              {rawShown ? (
                <BotsOutline>
                  <Text selectable className="px-4 py-3 text-sm text-foreground">
                    {run.result}
                  </Text>
                  <View className="flex-row flex-wrap items-center gap-2 border-t border-border-subtle px-1">
                    <Button
                      label="Copy reply"
                      tone="text"
                      icon="doc.on.doc"
                      onPress={() => void copy(run.result ?? "")}
                    />
                    {run.resultTruncated ? (
                      <Text className="flex-1 pe-3 text-xs text-foreground-muted">
                        Reply shortened. Open the thread for the full text.
                      </Text>
                    ) : null}
                  </View>
                </BotsOutline>
              ) : null}
            </BotsSection>
          ) : null}
          {run.usage ? (
            <Text className="px-1 text-xs tabular-nums text-foreground-muted">
              {run.usage.inputTokens.toLocaleString()} input tokens ·{" "}
              {run.usage.outputTokens.toLocaleString()} output tokens · Usage {run.usage.status}
            </Text>
          ) : null}
          {run.batchId || run.replayId ? (
            <View className="flex-row flex-wrap gap-2">
              {run.batchId ? (
                <Button
                  label="Open batch"
                  tone="text"
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
                  tone="text"
                  onPress={() =>
                    navigation.navigate("BotsReplay", {
                      environmentId,
                      botId: run.botId,
                      replayId: run.replayId ?? "",
                    })
                  }
                />
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </BotPage>
  );
}

/** The run's identity and settings, unboxed, so the findings below carry the weight. */
function RunHeader({ run }: { readonly run: BotRun }) {
  const rows: Array<readonly [string, string]> = [
    ...(run.modelSelection ? [["Model", run.modelSelection.model] as const] : []),
    ...(run.ranOn ? [["Ran on", run.ranOn.label] as const] : []),
    ...(run.requestedBy ? [["Requested by", run.requestedBy.label] as const] : []),
    ...Object.entries(run.inputs).map(([name, value]) => [name, String(value)] as const),
  ];
  return (
    <View className="gap-4">
      <View className="flex-row items-start gap-4">
        <BotTile botId={run.botId} size="xl" />
        <View className="min-w-0 flex-1 gap-1.5">
          <Text accessibilityRole="header" className="text-2xl font-t3-semibold text-foreground">
            {run.botName}
          </Text>
          <View className="flex-row flex-wrap items-center gap-1.5">
            {run.verdict ? <BotVerdictBadge verdict={run.verdict.verdict} /> : null}
            {showsRunState(run) ? <BotRunStateBadge status={run.status} /> : null}
            {run.replayId ? <LibraryStateBadge tone="neutral" label="Replay" /> : null}
          </View>
          <Text className="text-xs tabular-nums text-foreground-muted">{runMeta(run)}</Text>
        </View>
      </View>
      {run.verdict ? (
        <Text selectable className="text-base text-foreground">
          {run.verdict.summary}
        </Text>
      ) : null}
      {run.error ? (
        <Text selectable accessibilityRole="alert" className="text-sm text-danger-foreground">
          {run.error}
        </Text>
      ) : null}
      {rows.length ? (
        <View className="border-t border-border-subtle pt-4">
          <BotSpecGrid rows={rows} />
        </View>
      ) : null}
    </View>
  );
}

function RunDetailSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading run" className="gap-6">
      <View className="flex-row items-center gap-4">
        <View className="size-14 rounded-2xl bg-row-hover" />
        <View className="flex-1 gap-2">
          <View className="h-6 w-40 rounded-md bg-row-hover" />
          <View className="h-5 w-24 rounded-full bg-row-hover" />
          <View className="h-3 w-48 rounded-md bg-row-hover" />
        </View>
      </View>
      <View className="flex-row gap-2">
        <View className="h-12 w-32 rounded-full bg-row-hover" />
        <View className="h-12 w-24 rounded-full bg-row-hover" />
      </View>
      <BotRowsSkeleton label="Loading findings" rows={2} />
    </View>
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
