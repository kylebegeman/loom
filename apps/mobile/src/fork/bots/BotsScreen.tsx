import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_FEATURE,
  BOTS_LIST_RUNS_MAX_LIMIT,
  type BotDefinition,
} from "@t3tools/contracts/fork";
import {
  applyInboxChanges,
  botVersionLabel,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { RowPressable } from "../../components/ui/RowPressable";
import * as Dialog from "../../components/ui/Dialog";
import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection, BotToggle } from "./BotControls";
import { useBotActionLifetime } from "./useBotActionLifetime";
import { BotSuggestions } from "./BotSuggestions";
import { BotRunHistory } from "./BotRunDetailScreen";
import {
  bots,
  useBotsCapabilities,
  useBotsCollection,
  useBotsReconnect,
  useWaitingBotRuns,
} from "./state";

export function BotsRouteScreen({
  route,
}: StaticScreenProps<
  | {
      readonly environmentId?: string;
      readonly callerThreadId?: string;
    }
  | undefined
>) {
  const navigation = useNavigation();
  const { environments } = useEnvironments();
  const enabled = environments.filter((environment) => environment.entry.enabled);
  const selectedId = route.params?.environmentId;
  const preferred =
    enabled.find(
      (environment) =>
        environment.connection.phase === "connected" &&
        supportsLoomFeature(environment.serverConfig?.environment.capabilities, BOTS_FEATURE),
    ) ??
    enabled.find((environment) =>
      supportsLoomFeature(environment.serverConfig?.environment.capabilities, BOTS_FEATURE),
    ) ??
    enabled[0];
  const environmentId = selectedId
    ? EnvironmentId.make(selectedId)
    : (preferred?.environmentId ?? null);
  return (
    <BotsCatalog
      key={environmentId ?? "no-computer"}
      environmentId={environmentId}
      callerThreadId={route.params?.callerThreadId}
      computers={enabled.map((environment) => ({
        value: environment.environmentId,
        label: `${environment.label}${environment.connection.phase !== "connected" ? " (offline)" : ""}`,
      }))}
      onComputer={(next) =>
        navigation.setParams({ environmentId: next, callerThreadId: undefined })
      }
    />
  );
}

function useBotsMenu(environmentId: EnvironmentId | null) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const items: AppBarMenuItem[] = [];
  if (environmentId && capabilities.supported) {
    items.push({
      id: "runs",
      title: "Run history",
      onPress: () => navigation.navigate("BotsRuns", { environmentId }),
    });
    if (capabilities.inboxSupported)
      items.push({
        id: "inbox",
        title: "Inbox",
        onPress: () => navigation.navigate("BotsInbox", { environmentId }),
      });
    if (capabilities.batchesSupported)
      items.push({
        id: "batches",
        title: "Batches",
        onPress: () => navigation.navigate("BotsBatches", { environmentId }),
      });
    if (capabilities.pipelinesSupported)
      items.push({
        id: "pipelines",
        title: "Pipelines",
        onPress: () => navigation.navigate("BotsPipelines", { environmentId }),
      });
    if (capabilities.triggersSupported)
      items.push({
        id: "triggers",
        title: "Triggers",
        onPress: () => navigation.navigate("BotsTriggers", { environmentId }),
      });
    if (capabilities.budgetsSupported)
      items.push({
        id: "usage",
        title: "Usage and budgets",
        onPress: () => navigation.navigate("BotsUsage", { environmentId }),
      });
    if (capabilities.anywhereSupported)
      items.push({
        id: "computers",
        title: "Computers and sharing",
        onPress: () => navigation.navigate("BotsComputers", { environmentId }),
      });
  }
  return items;
}

function BotsCatalog({
  environmentId,
  callerThreadId,
  computers,
  onComputer,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly callerThreadId?: string;
  readonly computers: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly onComputer: (environmentId: string) => void;
}) {
  const navigation = useNavigation();
  const active = useBotActionLifetime();
  const capabilities = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const canCreate = useAtomValue(bots.save.permissionAtom(environmentId));
  const canRestore = useAtomValue(bots.restoreStarter.permissionAtom(environmentId));
  const restore = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const [filter, setFilter] = useState("");
  const [archived, setArchived] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menu = useBotsMenu(environmentId);
  const waiting = useWaitingBotRuns(environmentId);
  const inbox = useEnvironmentQuery(
    environmentId && capabilities.inboxSupported
      ? bots.inbox({ environmentId, input: { limit: BOTS_LIST_RUNS_MAX_LIMIT } })
      : null,
  );
  const starters = useEnvironmentQuery(
    environmentId && capabilities.startersSupported
      ? bots.listStarters({ environmentId, input: {} })
      : null,
  );
  useBotsReconnect(capabilities.connected, inbox.refresh);
  useBotsReconnect(capabilities.connected, starters.refresh);
  const attention =
    (inbox.data
      ? applyInboxChanges(inbox.data, collection.changes, { dismissed: false }).total
      : 0) + waiting.length;
  const filtered = collection.bots.filter(
    (bot) =>
      (archived || bot.archivedAt === null) &&
      `${bot.name}\n${bot.description}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const missingStarters =
    starters.data?.starters.filter((starter) => starter.state === "removed") ?? [];
  const header = (
    <View className="gap-4 pb-4">
      <Text className="text-sm text-foreground-muted">
        Reusable jobs with their own instructions, inputs and model.
      </Text>
      {computers.length > 1 || (computers.length === 1 && computers[0]?.value !== environmentId) ? (
        <BotChoice
          label="Computer"
          value={environmentId ?? ""}
          options={computers}
          onChange={onComputer}
        />
      ) : environmentId ? (
        <Text className="font-t3-medium">{capabilities.label}</Text>
      ) : null}
      {!environmentId ? (
        <>
          <BotNotice detail="Connect a computer to create and run bots." />
          <Button label="Connect computer" onPress={() => navigation.navigate("Connections")} />
        </>
      ) : !capabilities.connected ? (
        <View className="gap-2">
          <BotNotice
            detail={`Reconnect ${capabilities.label} to update or run bots. Saved information may be out of date.`}
          />
          <Button label="Manage connections" onPress={() => navigation.navigate("Connections")} />
        </View>
      ) : !capabilities.supported ? (
        <BotNotice detail="Update this computer's Loom server to use Bots." />
      ) : null}
      {environmentId && capabilities.supported ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="New bot"
              tone="primary"
              disabled={!canCreate || !capabilities.connected}
              onPress={() => navigation.navigate("BotsCreate", { environmentId })}
            />
            {callerThreadId && capabilities.fromThreadSupported ? (
              <Button
                label="Create from this thread"
                disabled={!canCreate || !capabilities.connected}
                onPress={() =>
                  navigation.navigate("BotsCreate", {
                    environmentId,
                    sourceThreadId: callerThreadId,
                  })
                }
              />
            ) : null}
            {capabilities.inboxSupported ? (
              <Button
                label={attention > 0 ? `Inbox (${attention})` : "Inbox"}
                onPress={() => navigation.navigate("BotsInbox", { environmentId })}
              />
            ) : null}
            <Button
              label="Run history"
              onPress={() => navigation.navigate("BotsRuns", { environmentId })}
            />
          </View>
          <BotInput
            label="Find a bot"
            value={filter}
            onChangeText={setFilter}
            placeholder="Name or description"
          />
          <BotToggle label="Show archived bots" value={archived} onChange={setArchived} />
          <BotNotice
            error={error ?? collection.query.error}
            onRetry={collection.refresh}
            detail={collection.query.isPending && !collection.bots.length ? "Loading bots…" : null}
          />
          {!collection.query.isPending && !collection.query.error && !filtered.length ? (
            <Text className="text-sm text-foreground-muted">
              {filter
                ? "No bots match this search."
                : archived
                  ? "No saved bots. Create one or restore a starter."
                  : "No active bots. Create one, restore a starter or show archived bots."}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
  return (
    <BotPage
      title="Bots"
      scroll={false}
      menus={
        menu.length ? [{ title: "Bots tools", icon: "ellipsis.circle", items: menu }] : undefined
      }
    >
      <FlatList
        data={filtered}
        keyExtractor={(bot) => bot.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        ListHeaderComponent={header}
        renderItem={({ item: bot }) => (
          <View className="mb-3 overflow-hidden rounded-2xl bg-grouped-card">
            <RowPressable
              accessibilityRole="button"
              accessibilityLabel={`${bot.name}, ${botVersionLabel(bot)}${bot.archivedAt ? ", archived" : ""}`}
              onPress={() => {
                if (environmentId)
                  navigation.navigate("BotsDetail", {
                    environmentId,
                    botId: bot.id,
                    ...(callerThreadId ? { callerThreadId } : {}),
                  });
              }}
              className="gap-2 p-4 active:opacity-70"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-t3-semibold">{bot.name}</Text>
                <Text className="text-xs text-foreground-muted">{botVersionLabel(bot)}</Text>
              </View>
              {bot.description ? (
                <Text numberOfLines={2} className="text-sm text-foreground-muted">
                  {bot.description}
                </Text>
              ) : null}
              <Text className="text-xs text-foreground-muted">
                {bot.modelSelection.model}
                {bot.archivedAt ? " · Archived" : ""}
                {bot.library ? " · Shared" : ""}
              </Text>
            </RowPressable>
          </View>
        )}
        ListFooterComponent={
          <View className="gap-6">
            {missingStarters.length && environmentId ? (
              <BotSection
                title="Starter bots"
                description="Restore a built-in job, then edit its instructions and model."
              >
                {missingStarters.map((starter) => (
                  <Button
                    key={starter.starterId}
                    label={`Restore ${starter.name}`}
                    loading={restoring === starter.starterId}
                    disabled={!canRestore || !capabilities.connected || restoring !== null}
                    onPress={() => {
                      if (restoring !== null) return;
                      setRestoring(starter.starterId);
                      setError(null);
                      void restore({ environmentId, input: { starterId: starter.starterId } }).then(
                        (result) => {
                          if (!active.current) return;
                          setRestoring(null);
                          if (result._tag === "Failure") {
                            const cause = squashAtomCommandFailure(result);
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "Could not restore this starter.",
                            );
                          } else {
                            collection.refresh();
                            starters.refresh();
                            navigation.navigate("BotsEdit", {
                              environmentId,
                              botId: result.value.id,
                            });
                          }
                        },
                      );
                    }}
                  />
                ))}
              </BotSection>
            ) : null}
            {environmentId && capabilities.fromThreadSupported ? (
              <BotSuggestions environmentId={environmentId} changes={collection.changes.bots} />
            ) : null}
          </View>
        }
      />
    </BotPage>
  );
}

export function BotDetailRouteScreen({
  route,
}: StaticScreenProps<{
  readonly environmentId: string;
  readonly botId: string;
  readonly callerThreadId?: string;
}>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  return (
    <BotDetail
      key={`${environmentId}:${route.params.botId}`}
      environmentId={environmentId}
      botId={route.params.botId}
      callerThreadId={route.params.callerThreadId}
    />
  );
}

function BotDetail({
  environmentId,
  botId,
  callerThreadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId: string;
  readonly callerThreadId?: string;
}) {
  const navigation = useNavigation();
  const active = useBotActionLifetime();
  const capabilities = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const bot = collection.bots.find((candidate) => candidate.id === botId);
  const canEdit = useAtomValue(bots.save.permissionAtom(environmentId));
  const canRun = useAtomValue(bots.run.permissionAtom(environmentId));
  const canArchive = useAtomValue(bots.archive.permissionAtom(environmentId));
  const canDelete = useAtomValue(bots.delete.permissionAtom(environmentId));
  const archive = useAtomCommand(bots.archive, { reportFailure: false });
  const remove = useAtomCommand(bots.delete, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || !capabilities.connected;
  const updateArchive = async (selected: BotDefinition) => {
    if (disabled || !canArchive) return;
    setBusy(true);
    setError(null);
    const result = await archive({
      environmentId,
      input: { botId, archived: selected.archivedAt === null },
    });
    if (!active.current) return;
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update this bot.");
    } else collection.refresh();
  };
  const deleteBot = () => {
    if (disabled || !canDelete) return;
    Dialog.confirm({
      title: "Delete bot?",
      message:
        "This removes the bot and its local Vault bindings. Its recorded runs remain available. Archive it to keep its definition.",
      confirmText: "Delete bot",
      destructive: true,
      onConfirm: () => {
        if (!active.current) return;
        setBusy(true);
        setError(null);
        void remove({ environmentId, input: { botId } }).then((result) => {
          if (!active.current) return;
          setBusy(false);
          if (result._tag === "Failure") {
            const cause = squashAtomCommandFailure(result);
            setError(cause instanceof Error ? cause.message : "Could not delete this bot.");
          } else {
            collection.refresh();
            navigation.navigate("Bots", { environmentId });
          }
        });
      },
    });
  };
  return (
    <BotPage title={bot?.name ?? "Bot"}>
      <BotNotice
        error={error ?? collection.query.error}
        detail={
          !capabilities.connected ? `Reconnect ${capabilities.label} to manage this bot.` : null
        }
      />
      {!bot ? (
        <BotNotice
          detail={
            collection.query.isPending
              ? "Loading bot…"
              : collection.query.error
                ? "Could not load this bot. Try reloading it."
                : "This bot was removed or is not available on this computer."
          }
          onRetry={collection.refresh}
        />
      ) : (
        <>
          <Text className="text-sm text-foreground-muted">
            {bot.description || "A reusable job."}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {capabilities.label} · {botVersionLabel(bot)}
            {bot.archivedAt ? " · Archived" : ""}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Run bot"
              tone="primary"
              disabled={disabled || !canRun || bot.archivedAt !== null}
              onPress={() =>
                navigation.navigate("BotsRun", {
                  environmentId,
                  botId,
                  ...(callerThreadId ? { callerThreadId } : {}),
                })
              }
            />
            <Button
              label="Edit bot"
              disabled={disabled || !canEdit}
              onPress={() => navigation.navigate("BotsEdit", { environmentId, botId })}
            />
          </View>
          <BotSection title="Instructions">
            <Text selectable className="text-sm text-foreground">
              {bot.instructions}
            </Text>
          </BotSection>
          <BotSection title="Run settings">
            <Text>Model: {bot.modelSelection.model}</Text>
            <Text>Permissions: {bot.runtimeMode.replaceAll("-", " ")}</Text>
            <Text>Mode: {bot.interactionMode === "plan" ? "Plan only" : "Do the work"}</Text>
            <Text>
              Workspace:{" "}
              {bot.workspace.type === "scratch"
                ? "Fresh scratch folder"
                : bot.workspace.checkout === "caller"
                  ? "Selected thread's checkout"
                  : bot.workspace.worktree
                    ? "New worktree"
                    : "Project checkout"}
            </Text>
            <Text>Time limit: {bot.timeoutMinutes} minutes</Text>
            <Text>Concurrent runs: {bot.maxConcurrentRuns}</Text>
            <Text>Output: {bot.output === "verdict" ? "Structured verdict" : "Text"}</Text>
            {bot.parameters.map((parameter) => (
              <Text key={parameter.name}>
                {parameter.label}: {parameter.type}
                {parameter.required ? ", required" : ", optional"}
              </Text>
            ))}
          </BotSection>
          <BotSection title="Manage">
            {capabilities.versionsSupported ? (
              <Button
                label="Versions and replay"
                onPress={() => navigation.navigate("BotsHistory", { environmentId, botId })}
              />
            ) : null}
            {capabilities.pipelinesSupported ? (
              <Button
                label="Pipelines"
                onPress={() => navigation.navigate("BotsPipelines", { environmentId, botId })}
              />
            ) : null}
            {capabilities.batchesSupported ? (
              <Button
                label="Batches"
                onPress={() => navigation.navigate("BotsBatches", { environmentId, botId })}
              />
            ) : null}
            {capabilities.triggersSupported ? (
              <Button
                label="Triggers"
                onPress={() => navigation.navigate("BotsTriggers", { environmentId, botId })}
              />
            ) : null}
            {capabilities.budgetsSupported ? (
              <Button
                label="Usage and budgets"
                onPress={() => navigation.navigate("BotsUsage", { environmentId, botId })}
              />
            ) : null}
            {capabilities.anywhereSupported ? (
              <Button
                label="Computers, sharing and Vault"
                onPress={() => navigation.navigate("BotsComputers", { environmentId, botId })}
              />
            ) : null}
            <Button
              label={bot.archivedAt ? "Unarchive bot" : "Archive bot"}
              disabled={disabled || !canArchive}
              onPress={() => void updateArchive(bot)}
            />
            <Button
              label="Delete bot"
              tone="danger"
              disabled={disabled || !canDelete}
              onPress={deleteBot}
            />
          </BotSection>
          <BotRunHistory environmentId={environmentId} botId={botId} />
        </>
      )}
    </BotPage>
  );
}

export function BotsRunsRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: string; readonly botId?: string }>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  return (
    <BotPage title="Bot runs">
      <BotRunHistory
        key={`${environmentId}:${route.params.botId ?? "all"}`}
        environmentId={environmentId}
        botId={route.params.botId}
      />
    </BotPage>
  );
}
