import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { applyRunChanges, botVersionDiff, formatReplaySummary } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  BOTS_REPLAY_MAX_RUNS,
  BOTS_VERSIONS_MAX_LIMIT,
  type BotDefinition,
  type BotDefinitionInput,
  type BotReplay,
  type BotRun,
  type BotVersionSummary,
} from "@t3tools/contracts/fork";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotPage } from "./BotControls";
import { defaultReplaySelection, replayCandidates, replayRunsById } from "./historyLogic";
import { bots, useBotsCapabilities, useBotsCollection, useBotsReconnect } from "./state";

type Params = { environmentId: string; botId?: string; replayId?: string };

export function BotHistoryRouteScreen({ route }: StaticScreenProps<Params>) {
  return (
    <HistoryScreen
      key={`${route.params.environmentId}:${route.params.botId ?? ""}`}
      params={route.params}
    />
  );
}

export function BotsReplayRouteScreen({
  route,
}: StaticScreenProps<{
  environmentId: string;
  botId: string;
  replayId?: string;
  version?: number;
  draft?: BotDefinitionInput;
}>) {
  return <ReplayScreen key={JSON.stringify(route.params)} params={route.params} />;
}

function ReplayScreen({
  params,
}: {
  params: {
    environmentId: string;
    botId: string;
    replayId?: string;
    version?: number;
    draft?: BotDefinitionInput;
  };
}) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(params.environmentId);
  const capabilities = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const bot = collection.bots.find((entry) => entry.id === params.botId);
  return (
    <BotPage title="Replay bot">
      {!capabilities.connected ? (
        <Text>Computer offline. Reconnect to start or cancel a replay.</Text>
      ) : null}
      {!capabilities.versionsSupported ? <Text>Update this computer to replay bots.</Text> : null}
      {collection.query.error ? (
        <Text accessibilityRole="alert">{collection.query.error}</Text>
      ) : null}
      {collection.query.isPending && !collection.query.data ? <Text>Loading bot…</Text> : null}
      {collection.query.data && !bot ? <Text>This bot is no longer available.</Text> : null}
      {bot && capabilities.versionsSupported ? (
        <BotReplayView
          environmentId={environmentId}
          bot={bot}
          version={params.version ?? bot.version}
          draft={params.draft}
          replayId={params.replayId}
          connected={capabilities.connected}
          changes={collection.changes}
          onClose={() => navigation.goBack()}
        />
      ) : null}
    </BotPage>
  );
}

function HistoryScreen({ params }: { params: Params }) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(params.environmentId);
  const capabilities = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const bot = collection.bots.find((candidate) => candidate.id === params.botId);
  return (
    <BotPage title={bot ? `${bot.name} history` : "Bot history"}>
      {!capabilities.connected ? (
        <Text>Computer offline. Reconnect to refresh or change this bot.</Text>
      ) : null}
      {!capabilities.versionsSupported ? (
        <Text>Update this computer to use bot history and replay.</Text>
      ) : null}
      {collection.query.error ? (
        <Text accessibilityRole="alert">{collection.query.error}</Text>
      ) : null}
      {collection.query.isPending && !collection.query.data ? <Text>Loading bots…</Text> : null}
      {!bot && collection.query.data ? (
        params.botId ? (
          <Text>This bot is no longer available.</Text>
        ) : collection.bots.length ? (
          <View className="gap-2">
            <Text>Choose a bot to view its history.</Text>
            {collection.bots.map((entry) => (
              <Button
                key={entry.id}
                label={entry.name}
                onPress={() =>
                  navigation.navigate("BotsHistory", { environmentId, botId: entry.id })
                }
              />
            ))}
          </View>
        ) : (
          <Text>No bots yet.</Text>
        )
      ) : null}
      {bot && capabilities.versionsSupported ? (
        <BotHistory
          environmentId={environmentId}
          bot={bot}
          replayId={params.replayId}
          connected={capabilities.connected}
          changes={collection.changes}
          refreshBot={collection.refresh}
        />
      ) : null}
    </BotPage>
  );
}

function VersionCompare({
  environmentId,
  botId,
  before,
  after,
}: {
  environmentId: EnvironmentId;
  botId: string;
  before: number;
  after: number;
}) {
  const older = useEnvironmentQuery(
    bots.version({ environmentId, input: { botId, version: before } }),
  );
  const newer = useEnvironmentQuery(
    bots.version({ environmentId, input: { botId, version: after } }),
  );
  const diff =
    older.data && newer.data ? botVersionDiff(older.data.definition, newer.data.definition) : null;
  return (
    <View className="gap-3 rounded-xl bg-subtle p-3">
      <Text className="font-t3-semibold">
        Changes from v{before} to v{after}
      </Text>
      {older.error || newer.error ? (
        <Text accessibilityRole="alert">{older.error ?? newer.error}</Text>
      ) : !diff ? (
        <Text>Loading versions…</Text>
      ) : null}
      {older.error || newer.error ? (
        <Button
          label="Retry comparison"
          onPress={() => {
            older.refresh();
            newer.refresh();
          }}
        />
      ) : null}
      {diff?.instructions ? (
        <View className="gap-2">
          <Text className="font-t3-semibold">Instructions before</Text>
          <Text selectable>{diff.instructions.before}</Text>
          <Text className="font-t3-semibold">Instructions after</Text>
          <Text selectable>{diff.instructions.after}</Text>
        </View>
      ) : null}
      {diff?.fields.map((field) => (
        <View key={field.field} className="gap-1">
          <Text className="font-t3-semibold">{field.label}</Text>
          <Text selectable>Before: {field.before}</Text>
          <Text selectable>After: {field.after}</Text>
        </View>
      ))}
      {diff && !diff.instructions && !diff.fields.length ? (
        <Text>These versions are the same.</Text>
      ) : null}
    </View>
  );
}

function BotHistory({
  environmentId,
  bot,
  connected,
  changes,
  replayId,
  refreshBot,
}: {
  environmentId: EnvironmentId;
  bot: BotDefinition;
  connected: boolean;
  changes: ReturnType<typeof useBotsCollection>["changes"];
  replayId?: string;
  refreshBot: () => void;
}) {
  const navigation = useNavigation();
  const [before, setBefore] = useState<number | undefined>();
  const versions = useEnvironmentQuery(
    bots.versions({
      environmentId,
      input: {
        botId: bot.id,
        limit: BOTS_VERSIONS_MAX_LIMIT,
        ...(before === undefined ? {} : { before }),
      },
    }),
  );
  const canSetStable = useAtomValue(bots.setStable.permissionAtom(environmentId));
  const canRestore = useAtomValue(bots.restoreVersion.permissionAtom(environmentId));
  const canReplay = useAtomValue(bots.replay.permissionAtom(environmentId));
  const stable = useAtomCommand(bots.setStable, { reportFailure: false });
  const restore = useAtomCommand(bots.restoreVersion, { reportFailure: false });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ version: number; expectedVersion: number } | null>(null);
  const [replayVersion, setReplayVersion] = useState<number | null>(null);
  const refreshVersions = versions.refresh;
  useBotsReconnect(connected, refreshVersions);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the server's saved versions when the bot's current version changes
  useEffect(() => {
    refreshVersions();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Saved versions are not watched; a changed current version invalidates this page.
  }, [bot.version, refreshVersions]);
  const act = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    await work().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not update this bot."),
    );
    pending.current = false;
    setBusy(false);
  };
  const rows = versions.data?.versions ?? [];
  return (
    <View className="gap-4">
      <Text>
        Triggers that follow the stable version run it. Without a stable version they run the
        latest.
      </Text>
      {bot.archivedAt !== null ? (
        <Text>This bot is archived. Restore it before changing versions or replaying runs.</Text>
      ) : null}
      {!canSetStable && !canRestore ? (
        <Text>
          This connection can browse history. Editing requires permission on this computer.
        </Text>
      ) : null}
      <Button
        label="Refresh history"
        disabled={!connected || busy || versions.isPending}
        onPress={() => {
          refreshVersions();
          refreshBot();
        }}
      />
      {error || versions.error ? (
        <Text accessibilityRole="alert">{error ?? versions.error}</Text>
      ) : null}
      {versions.isPending && !versions.data ? <Text>Loading versions…</Text> : null}
      {versions.data && rows.length === 0 ? <Text>No saved versions yet.</Text> : null}
      {rows.length ? (
        <SettingsSection>
          {rows.map((version, index) => {
            const previous = rows[index + 1]?.version ?? null;
            const isStable = bot.stableVersion === version.version;
            const editable = connected && !busy && bot.archivedAt === null;
            return (
              <View
                key={version.version}
                className={cn("gap-3 p-4", index > 0 && "border-t border-border-subtle")}
              >
                <Text className="font-t3-semibold">
                  v{version.version}
                  {version.version === bot.version ? " · Current" : ""}
                  {isStable ? " · Stable" : ""}
                </Text>
                <VersionSummary version={version} />
                <View className="flex-row flex-wrap gap-2">
                  {previous !== null ? (
                    <Button
                      label={
                        compare === version.version ? "Hide changes" : `Compare with v${previous}`
                      }
                      onPress={() =>
                        setCompare(compare === version.version ? null : version.version)
                      }
                    />
                  ) : null}
                  <Button
                    label="Replay"
                    disabled={!editable || !canReplay}
                    accessibilityLabel={`Replay v${version.version}`}
                    onPress={() => setReplayVersion(version.version)}
                  />
                  <Button
                    label={isStable ? "Clear stable" : "Mark stable"}
                    disabled={!editable || !canSetStable}
                    accessibilityLabel={`${isStable ? "Clear stable" : "Mark stable"} v${version.version}`}
                    onPress={() =>
                      void act(async () => {
                        const result = await stable({
                          environmentId,
                          input: { botId: bot.id, version: isStable ? null : version.version },
                        });
                        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                        refreshBot();
                      })
                    }
                  />
                  {version.version !== bot.version ? (
                    <Button
                      label="Restore"
                      accessibilityLabel={`Restore v${version.version}`}
                      disabled={!editable || !canRestore}
                      onPress={() =>
                        setConfirm({ version: version.version, expectedVersion: bot.version })
                      }
                    />
                  ) : null}
                </View>
                {confirm?.version === version.version ? (
                  <View className="gap-2">
                    <Text>
                      Restore v{version.version} as v{confirm.expectedVersion + 1}? Existing history
                      is kept.
                    </Text>
                    {confirm.expectedVersion !== bot.version ? (
                      <Text accessibilityRole="alert">
                        This bot changed after you opened the confirmation. Cancel and review the
                        latest version before restoring.
                      </Text>
                    ) : null}
                    <Button
                      label="Confirm restore"
                      disabled={!editable || !canRestore || confirm.expectedVersion !== bot.version}
                      onPress={() =>
                        void act(async () => {
                          const result = await restore({
                            environmentId,
                            input: {
                              botId: bot.id,
                              version: version.version,
                              expectedVersion: confirm.expectedVersion,
                            },
                          });
                          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                          setConfirm(null);
                          setBefore(undefined);
                          refreshVersions();
                          refreshBot();
                        })
                      }
                    />
                    <Button
                      label="Cancel restore"
                      disabled={busy}
                      onPress={() => setConfirm(null)}
                    />
                  </View>
                ) : null}
                {compare === version.version && previous !== null ? (
                  <VersionCompare
                    environmentId={environmentId}
                    botId={bot.id}
                    before={previous}
                    after={version.version}
                  />
                ) : null}
              </View>
            );
          })}
        </SettingsSection>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {before !== undefined ? (
          <Button
            label="Newest versions"
            disabled={versions.isPending}
            onPress={() => {
              setBefore(undefined);
              setCompare(null);
              setConfirm(null);
            }}
          />
        ) : null}
        {versions.data?.hasMore ? (
          <Button
            label="Older versions"
            disabled={versions.isPending || !rows.length}
            onPress={() => {
              setBefore(rows.at(-1)?.version);
              setCompare(null);
              setConfirm(null);
            }}
          />
        ) : null}
      </View>
      {replayVersion !== null || replayId ? (
        <BotReplayView
          key={`${replayVersion}:${replayId ?? ""}`}
          environmentId={environmentId}
          bot={bot}
          version={replayVersion ?? bot.version}
          replayId={replayId}
          connected={connected}
          changes={changes}
          onClose={() => {
            setReplayVersion(null);
            if (replayId) navigation.navigate("BotsHistory", { environmentId, botId: bot.id });
          }}
        />
      ) : null}
    </View>
  );
}

function VersionSummary({ version }: { version: BotVersionSummary }) {
  return (
    <View className="gap-1">
      <Text className="text-sm text-foreground-muted">
        {version.savedBy === "user"
          ? "Saved by you"
          : version.savedBy === "agent"
            ? "Saved by an agent"
            : version.savedBy === "starter"
              ? "From the starter"
              : "Restored"}
        {version.restoredFrom === null ? "" : ` from v${version.restoredFrom}`} ·{" "}
        {new Date(version.savedAt).toLocaleString()}
      </Text>
      <Text className="text-sm text-foreground-muted">
        {version.runs} {version.runs === 1 ? "run" : "runs"}
        {version.passRate === null ? "" : ` · ${Math.round(version.passRate * 100)}% passed`}
        {version.medianTotalTokens === null
          ? ""
          : ` · ${version.medianTotalTokens.toLocaleString()} median tokens`}
      </Text>
      {version.changed.length ? (
        <Text className="text-sm">Changed {version.changed.join(", ")}</Text>
      ) : null}
    </View>
  );
}

function BotReplayView({
  environmentId,
  bot,
  version,
  draft,
  replayId,
  connected,
  changes,
  onClose,
}: {
  environmentId: EnvironmentId;
  bot: BotDefinition;
  version: number;
  draft?: BotDefinitionInput;
  replayId?: string;
  connected: boolean;
  changes: ReturnType<typeof useBotsCollection>["changes"];
  onClose: () => void;
}) {
  const canReplay = useAtomValue(bots.replay.permissionAtom(environmentId));
  const canCancel = useAtomValue(bots.cancelReplay.permissionAtom(environmentId));
  const capabilities = useBotsCapabilities(environmentId);
  const [before, setBefore] = useState<string | undefined>();
  const [retained, setRetained] = useState<ReadonlyArray<BotRun>>([]);
  const runsQuery = useEnvironmentQuery(
    bots.listRuns({
      environmentId,
      input: { botId: bot.id, limit: BOTS_LIST_RUNS_MAX_LIMIT, ...(before ? { before } : {}) },
    }),
  );
  const runs = applyRunChanges(
    [...replayRunsById(retained, runsQuery.data?.runs ?? [], []).values()],
    changes,
    {
      botId: bot.id,
      includeNew: true,
    },
  );
  const candidates = replayCandidates(runs, bot.id);
  const [selection, setSelection] = useState<ReadonlyArray<string> | null>(null);
  const chosen = (selection ?? defaultReplaySelection(candidates)).filter((id) =>
    candidates.some((run) => run.id === id),
  );
  const [started, setStarted] = useState<BotReplay | null>(null);
  const id = replayId ?? started?.id;
  const replayQuery = useEnvironmentQuery(
    id ? bots.getReplay({ environmentId, input: { replayId: id } }) : null,
  );
  const current = replayQuery.data ?? started;
  const runById = replayRunsById(retained, runs, changes.runs.values());
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const replay = useAtomCommand(bots.replay, { reportFailure: false });
  const cancel = useAtomCommand(bots.cancelReplay, { reportFailure: false });
  const progress = [...changes.runs.values()]
    .filter((run) => run.replayId === id && id !== undefined)
    .map((run) => `${run.id}:${run.status}:${run.verdict?.verdict ?? ""}`)
    .join(",");
  const refreshReplay = replayQuery.refresh;
  const refreshRuns = runsQuery.refresh;
  useBotsReconnect(connected, refreshReplay);
  useBotsReconnect(connected, refreshRuns);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the replay from the server when the streamed replay progress changes while connected
  useEffect(() => {
    if (progress && connected) refreshReplay();
  }, [progress, connected, refreshReplay]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches runs from the server when the bots change stream reports pruned history
  useEffect(() => {
    if (changes.pruned && connected) refreshRuns();
  }, [changes.pruned, connected, refreshRuns]);
  const perform = async (action: () => Promise<void>) => {
    if (pending.current || !connected) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    await action().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not update replay."),
    );
    pending.current = false;
    setBusy(false);
  };
  return (
    <SettingsSection>
      <View className="gap-3 p-4">
        <Text className="text-lg font-t3-semibold">
          Replay {bot.name}
          {current?.source.kind === "draft" || (!current && draft)
            ? " draft"
            : ` v${current?.source.kind === "version" ? current.source.version : version}`}
        </Text>
        <Text>
          Runs earlier inputs again and compares the results. Replays count toward the bot's budget.
        </Text>
        {error || replayQuery.error || runsQuery.error ? (
          <Text accessibilityRole="alert">{error ?? replayQuery.error ?? runsQuery.error}</Text>
        ) : null}
        <Button
          label="Refresh replay"
          disabled={!connected || busy}
          onPress={() => {
            refreshReplay();
            refreshRuns();
          }}
        />
        {id && !current && replayQuery.isPending ? <Text>Loading replay…</Text> : null}
        {current ? (
          <>
            <Text accessibilityLiveRegion="polite">
              {current.status === "running"
                ? "Replaying"
                : current.status === "cancelled"
                  ? "Cancelled"
                  : "Done"}
              . {formatReplaySummary(current.summary)}
            </Text>
            {current.items.map((item) => (
              <View key={item.originalRunId} className="gap-2 rounded-xl bg-subtle p-3">
                <Text className="font-t3-semibold">
                  {item.comparison === "pending"
                    ? "Waiting"
                    : item.comparison.charAt(0).toUpperCase() + item.comparison.slice(1)}
                </Text>
                {item.reason ? <Text accessibilityRole="alert">{item.reason}</Text> : null}
                <RunOutcome
                  title="Before"
                  run={runById.get(item.originalRunId)}
                  runId={item.originalRunId}
                  environmentId={environmentId}
                  exact={capabilities.runDetailsSupported}
                  connected={connected}
                  missing="Original result is not loaded. Load older runs to look for it."
                />
                <RunOutcome
                  title="After"
                  run={item.replayRunId ? runById.get(item.replayRunId) : undefined}
                  runId={item.replayRunId}
                  environmentId={environmentId}
                  exact={capabilities.runDetailsSupported}
                  connected={connected}
                  missing={
                    item.replayRunId
                      ? "Result is not loaded. Load older runs to look for it."
                      : "Not started"
                  }
                />
              </View>
            ))}
            {current.status === "running" ? (
              <Button
                label="Cancel replay"
                tone="danger"
                disabled={!connected || !canCancel || busy}
                onPress={() =>
                  void perform(async () => {
                    const result = await cancel({ environmentId, input: { replayId: current.id } });
                    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                    setStarted(result.value);
                    refreshReplay();
                  })
                }
              />
            ) : null}
          </>
        ) : !id ? (
          <>
            {runsQuery.isPending && !runsQuery.data ? (
              <Text>Loading runs…</Text>
            ) : candidates.length === 0 ? (
              <Text>No finished runs to replay yet.</Text>
            ) : (
              <>
                <Text>Choose up to {BOTS_REPLAY_MAX_RUNS} runs. Rated runs are chosen first.</Text>
                {candidates.map((run) => (
                  <Pressable
                    key={run.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${run.status}, v${run.botVersion}, ${new Date(run.createdAt).toLocaleString()}`}
                    accessibilityState={{
                      checked: chosen.includes(run.id),
                      disabled:
                        busy || (!chosen.includes(run.id) && chosen.length >= BOTS_REPLAY_MAX_RUNS),
                    }}
                    disabled={
                      busy || (!chosen.includes(run.id) && chosen.length >= BOTS_REPLAY_MAX_RUNS)
                    }
                    onPress={() =>
                      setSelection(
                        chosen.includes(run.id)
                          ? chosen.filter((entry) => entry !== run.id)
                          : [...chosen, run.id],
                      )
                    }
                    className="min-h-12 gap-1 rounded-xl bg-subtle p-3"
                  >
                    <Text>
                      {chosen.includes(run.id) ? "Selected · " : ""}
                      {run.status} · v{run.botVersion}
                      {run.rating ? ` · ${run.rating === "up" ? "Good" : "Bad"}` : ""}
                    </Text>
                    <Text className="text-sm text-foreground-muted">
                      {Object.entries(run.inputs)
                        .map(([name, value]) => `${name}: ${value}`)
                        .join(", ") || "No inputs"}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      {new Date(run.finishedAt ?? run.createdAt).toLocaleString()}
                    </Text>
                  </Pressable>
                ))}
                <Button
                  label={`Replay ${chosen.length} ${chosen.length === 1 ? "run" : "runs"}`}
                  tone="primary"
                  disabled={
                    !connected || !canReplay || busy || !chosen.length || bot.archivedAt !== null
                  }
                  onPress={() =>
                    void perform(async () => {
                      const result = await replay({
                        environmentId,
                        input: {
                          botId: bot.id,
                          ...(draft ? { draft } : { version }),
                          runIds: chosen,
                        },
                      });
                      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                      setRetained(runs);
                      setStarted(result.value);
                    })
                  }
                />
              </>
            )}
          </>
        ) : null}
        {runsQuery.data?.hasMore ? (
          <Button
            label="Load older runs"
            disabled={!connected || busy || runsQuery.isPending || !runsQuery.data.runs.length}
            onPress={() => {
              setRetained(runs);
              setBefore(runsQuery.data?.runs.at(-1)?.createdAt);
            }}
          />
        ) : null}
        <Button label="Close replay" disabled={busy} onPress={onClose} />
      </View>
    </SettingsSection>
  );
}

function RunOutcome({
  title,
  run,
  runId,
  environmentId,
  exact,
  connected,
  missing,
}: {
  title: string;
  run: BotRun | undefined;
  runId: string | null;
  environmentId: EnvironmentId;
  exact: boolean;
  connected: boolean;
  missing: string;
}) {
  const query = useEnvironmentQuery(
    !run && runId && exact ? bots.getRun({ environmentId, input: { runId } }) : null,
  );
  useBotsReconnect(connected, query.refresh);
  const result = run ?? query.data?.run;
  return (
    <View className="gap-1">
      <Text className="font-t3-semibold">
        {title}
        {result
          ? ` · ${result.status}${result.verdict ? ` · ${result.verdict.verdict.replaceAll("_", " ")}` : ""}`
          : ""}
      </Text>
      <Text selectable>
        {result
          ? (result.verdict?.summary ?? result.result ?? result.error ?? "No result yet")
          : query.isPending
            ? "Loading result…"
            : query.data?.run === null
              ? "This result is no longer in the retained run history."
              : missing}
      </Text>
      {query.error ? (
        <>
          <Text accessibilityRole="alert">{query.error}</Text>
          <Button
            label={`Retry ${title.toLowerCase()} result`}
            disabled={!connected || query.isPending}
            onPress={query.refresh}
          />
        </>
      ) : null}
      {result?.resultTruncated ? <Text>Result was truncated.</Text> : null}
    </View>
  );
}
