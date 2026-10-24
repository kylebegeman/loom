import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
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
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { RowPressable } from "../../components/ui/RowPressable";
import * as Dialog from "../../components/ui/Dialog";
import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { cn } from "../../lib/cn";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection, BotToggle } from "./BotControls";
import { useBotActionLifetime } from "./useBotActionLifetime";
import { BotSuggestions } from "./BotSuggestions";
import { BotRunHistory } from "./BotRunDetailScreen";
import { BotRowsSkeleton, BotSpecGrid, BotTile, BotsOutline, BotsSection } from "./BotIdentity";
import { RUNTIME_MODE_LABELS, botDetail, workspaceLabel } from "./runLogic";
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

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

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
  const activeCount = collection.bots.filter((bot) => bot.archivedAt === null).length;
  const archivedCount = collection.bots.length - activeCount;
  const offline = environmentId !== null && !capabilities.connected;
  const showList =
    environmentId !== null && capabilities.supported && !(offline && !collection.bots.length);
  const createDisabled = !canCreate || !capabilities.connected;
  const newBot = (
    <Button
      label="New bot"
      tone="primary"
      icon="plus"
      disabled={createDisabled}
      onPress={() => {
        if (environmentId) navigation.navigate("BotsCreate", { environmentId });
      }}
    />
  );
  const fromThread =
    environmentId && callerThreadId && capabilities.fromThreadSupported ? (
      <Button
        label="Create from this thread"
        disabled={createDisabled}
        onPress={() =>
          navigation.navigate("BotsCreate", { environmentId, sourceThreadId: callerThreadId })
        }
      />
    ) : null;
  const header = (
    <View className="gap-5 pb-4">
      {computers.length > 1 || (computers.length === 1 && computers[0]?.value !== environmentId) ? (
        <BotChoice
          label="Computer"
          value={environmentId ?? ""}
          options={computers}
          onChange={onComputer}
        />
      ) : null}
      {!environmentId ? (
        <EmptyState
          variant="plain"
          title="Connect a computer"
          detail="Bots run on a computer running Loom. Connect one to create bots and run them."
          actionLabel="Connect computer"
          onAction={() => navigation.navigate("Connections")}
        />
      ) : offline && !collection.bots.length ? (
        <EmptyState
          variant="plain"
          title={`${capabilities.label} is offline`}
          detail={`Reconnect ${capabilities.label} to see, update and run its bots.`}
          actionLabel="Manage connections"
          onAction={() => navigation.navigate("Connections")}
        />
      ) : offline ? (
        <View className="gap-1">
          <BotNotice
            detail={`Reconnect ${capabilities.label} to update or run bots. Saved information may be out of date.`}
          />
          <Button
            label="Manage connections"
            tone="text"
            onPress={() => navigation.navigate("Connections")}
          />
        </View>
      ) : !capabilities.supported ? (
        <EmptyState
          variant="plain"
          title="Bots need a newer server"
          detail={`Update ${capabilities.label}'s Loom server to create and run bots here.`}
        />
      ) : null}
      {showList ? (
        !collection.bots.length ? (
          collection.query.isPending ? (
            <CatalogSkeleton />
          ) : collection.query.error ? (
            <BotNotice error={collection.query.error} onRetry={collection.refresh} />
          ) : (
            <EmptyState
              variant="plain"
              title="Create your first bot"
              detail="A bot is a job you brief agents on again and again, such as a review or a release check. Its instructions, inputs and settings stay fixed, so every run starts from the same brief."
              action={
                <View className="items-center gap-2">
                  {newBot}
                  {fromThread}
                </View>
              }
            />
          )
        ) : (
          <>
            <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
              <Text className="text-xs tabular-nums text-foreground-muted">
                {[
                  plural(activeCount, "bot"),
                  archivedCount ? `${archivedCount} archived` : null,
                  `on ${capabilities.label}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {capabilities.inboxSupported && attention > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open inbox, ${attention} ${attention === 1 ? "needs" : "need"} you`}
                  onPress={() => {
                    if (environmentId) navigation.navigate("BotsInbox", { environmentId });
                  }}
                  className="active:opacity-70"
                >
                  <LibraryStateBadge
                    tone="warning"
                    label={`${attention} ${attention === 1 ? "needs" : "need"} you`}
                  />
                </Pressable>
              ) : null}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {newBot}
              {fromThread}
            </View>
            <BotInput
              label="Find a bot"
              value={filter}
              onChangeText={setFilter}
              placeholder="Name or description"
            />
            {archivedCount ? (
              <BotToggle label="Show archived bots" value={archived} onChange={setArchived} />
            ) : null}
            <BotNotice
              error={error ?? collection.query.error}
              onRetry={collection.query.error ? collection.refresh : undefined}
            />
            {!filtered.length ? (
              <Text className="px-1 text-sm text-foreground-muted">
                {filter
                  ? "No bots match this search."
                  : "Every bot is archived. Show archived bots or create a new one."}
              </Text>
            ) : null}
          </>
        )
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
        data={showList ? filtered : []}
        keyExtractor={(bot) => bot.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        ListHeaderComponent={header}
        renderItem={({ item: bot, index }) => (
          <View
            className={cn(
              "overflow-hidden border-x border-border",
              index === 0 && "rounded-t-2xl border-t",
              index === filtered.length - 1 && "rounded-b-2xl border-b",
            )}
          >
            {index > 0 ? <View className="ms-16 h-px bg-border-subtle" /> : null}
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
              className={cn(
                "min-h-16 flex-row items-center gap-3 px-4 py-3 active:opacity-70",
                bot.archivedAt && "opacity-70",
              )}
            >
              <BotTile botId={bot.id} />
              <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={1} className="text-base font-t3-medium text-foreground">
                  {bot.name}
                </Text>
                <Text numberOfLines={1} className="text-xs text-foreground-muted">
                  {botDetail(bot)}
                </Text>
              </View>
              <SymbolView name="chevron.right" size={14} tintColorClassName="accent-icon-muted" />
            </RowPressable>
          </View>
        )}
        ListFooterComponent={
          <View className="gap-6 pt-6">
            {missingStarters.length && environmentId && capabilities.supported ? (
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
  const runDisabled = !bot || disabled || !canRun || bot.archivedAt !== null;
  const manage = [
    capabilities.versionsSupported
      ? { label: "Versions and replay", route: "BotsHistory" as const }
      : null,
    capabilities.pipelinesSupported
      ? { label: "Pipelines", route: "BotsPipelines" as const }
      : null,
    capabilities.triggersSupported ? { label: "Triggers", route: "BotsTriggers" as const } : null,
    capabilities.budgetsSupported
      ? { label: "Usage and budgets", route: "BotsUsage" as const }
      : null,
    capabilities.anywhereSupported
      ? { label: "Computers, sharing and Vault", route: "BotsComputers" as const }
      : null,
  ].filter((entry) => entry !== null);
  return (
    <BotPage
      title={bot?.name ?? "Bot"}
      menus={
        bot
          ? [
              {
                title: `More actions for ${bot.name}`,
                icon: "ellipsis.circle",
                items: [
                  {
                    id: "archive",
                    title: bot.archivedAt ? "Unarchive bot" : "Archive bot",
                    icon: "archivebox",
                    disabled: disabled || !canArchive,
                    onPress: () => void updateArchive(bot),
                  },
                  {
                    id: "delete",
                    title: "Delete bot",
                    icon: "trash",
                    disabled: disabled || !canDelete,
                    onPress: deleteBot,
                  },
                ],
              },
            ]
          : undefined
      }
    >
      <BotNotice
        error={error ?? collection.query.error}
        detail={
          !capabilities.connected ? `Reconnect ${capabilities.label} to manage this bot.` : null
        }
      />
      {!bot ? (
        collection.query.isPending ? (
          <BotDetailSkeleton />
        ) : (
          <EmptyState
            variant="plain"
            title={collection.query.error ? "Could not load this bot" : "Bot not found"}
            detail={
              collection.query.error
                ? "Try reloading it."
                : "This bot was removed or is not available on this computer."
            }
            actionLabel="Reload bots"
            onAction={collection.refresh}
          />
        )
      ) : (
        <>
          <View className="gap-4 rounded-3xl border border-border bg-card p-5">
            <View className="flex-row items-start gap-4">
              <BotTile botId={bot.id} size="xl" />
              <View className="min-w-0 flex-1 gap-1.5">
                <Text
                  accessibilityRole="header"
                  className="text-2xl font-t3-semibold text-foreground"
                >
                  {bot.name}
                </Text>
                <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
                  {bot.archivedAt ? <LibraryStateBadge tone="neutral" label="Archived" /> : null}
                  {bot.origin?.kind === "starter" ? (
                    <LibraryStateBadge tone="neutral" label="Starter" />
                  ) : null}
                  {bot.library == null ? null : (
                    <LibraryStateBadge tone="neutral" label="From the Library" />
                  )}
                  <Text className="text-xs tabular-nums text-foreground-muted">
                    {botVersionLabel(bot)} · {capabilities.label}
                  </Text>
                </View>
              </View>
            </View>
            {bot.description ? (
              <Text className="text-sm text-foreground-muted">{bot.description}</Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Run bot"
                tone="primary"
                icon="play"
                disabled={runDisabled}
                onPress={() =>
                  navigation.navigate("BotsRun", {
                    environmentId,
                    botId,
                    ...(callerThreadId ? { callerThreadId } : {}),
                  })
                }
              />
              {capabilities.batchesSupported ? (
                <Button
                  label="Run on many"
                  icon="square.on.square"
                  disabled={runDisabled}
                  onPress={() => navigation.navigate("BotsBatches", { environmentId, botId })}
                />
              ) : null}
              <Button
                label="Edit bot"
                icon="pencil"
                disabled={disabled || !canEdit}
                onPress={() => navigation.navigate("BotsEdit", { environmentId, botId })}
              />
            </View>
            <View className="border-t border-border-subtle pt-4">
              <BotSpecGrid
                rows={[
                  ["Model", bot.modelSelection.model],
                  ["Permissions", RUNTIME_MODE_LABELS[bot.runtimeMode]],
                  ["Mode", bot.interactionMode === "plan" ? "Plan only" : "Do the work"],
                  ["Runs in", workspaceLabel(bot.workspace)],
                  ["Time limit", `${bot.timeoutMinutes} minutes`],
                  ["Runs at once", String(bot.maxConcurrentRuns)],
                  ["Output", bot.output === "verdict" ? "Structured verdict" : "Text"],
                  [
                    "Inputs",
                    bot.parameters
                      .map(
                        (parameter) =>
                          `${parameter.label}${parameter.required ? "" : " (optional)"}`,
                      )
                      .join(", ") || "None",
                  ],
                ]}
              />
            </View>
          </View>
          <BotInstructions instructions={bot.instructions} />
          {manage.length ? (
            <BotsSection title="Manage">
              <BotsOutline>
                {manage.map((entry, index) => (
                  <RowPressable
                    key={entry.route}
                    accessibilityRole="button"
                    accessibilityLabel={entry.label}
                    onPress={() => navigation.navigate(entry.route, { environmentId, botId })}
                    className={cn(
                      "min-h-12 flex-row items-center gap-3 px-4 py-3 active:opacity-70",
                      index > 0 && "border-t border-border-subtle",
                    )}
                  >
                    <Text className="min-w-0 flex-1 text-sm text-foreground">{entry.label}</Text>
                    <SymbolView
                      name="chevron.right"
                      size={14}
                      tintColorClassName="accent-icon-muted"
                    />
                  </RowPressable>
                ))}
              </BotsOutline>
            </BotsSection>
          ) : null}
          <BotRunHistory environmentId={environmentId} botId={botId} />
        </>
      )}
    </BotPage>
  );
}

/** Lines shown before the brief folds; enough to recognize it, short enough to reach the runs. */
const INSTRUCTION_PREVIEW_LINES = 4;

/** The brief every run receives, folded to a preview since it can run to pages. */
function BotInstructions({ instructions }: { readonly instructions: string }) {
  const [open, setOpen] = useState(false);
  const lines = instructions.split("\n").length;
  return (
    <BotsOutline>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? "Fold instructions" : "Show all instructions"}
        onPress={() => setOpen((value) => !value)}
        className="min-h-12 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
      >
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-t3-semibold text-foreground">Instructions</Text>
          <Text className="text-xs text-foreground-muted">
            The brief every run receives · {plural(lines, "line")}
          </Text>
        </View>
        <SymbolView
          name={open ? "chevron.up" : "chevron.down"}
          size={14}
          tintColorClassName="accent-icon-muted"
        />
      </Pressable>
      <Text
        selectable
        numberOfLines={open ? undefined : INSTRUCTION_PREVIEW_LINES}
        className="border-t border-border-subtle px-4 py-3 text-sm leading-relaxed text-foreground"
      >
        {instructions}
      </Text>
    </BotsOutline>
  );
}

function CatalogSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading bots" className="gap-5">
      <View className="h-3.5 w-48 rounded-md bg-row-hover" />
      <View className="h-12 w-32 rounded-full bg-row-hover" />
      <View className="h-11 w-full rounded-xl bg-row-hover" />
      <BotRowsSkeleton label="Loading bots" rows={4} />
    </View>
  );
}

function BotDetailSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading bot" className="gap-6">
      <View className="gap-4 rounded-3xl border border-border p-5">
        <View className="flex-row items-center gap-4">
          <View className="size-14 rounded-2xl bg-row-hover" />
          <View className="flex-1 gap-2">
            <View className="h-6 w-40 rounded-md bg-row-hover" />
            <View className="h-3 w-32 rounded-md bg-row-hover" />
          </View>
        </View>
        <View className="flex-row gap-2">
          <View className="h-12 w-28 rounded-full bg-row-hover" />
          <View className="h-12 w-24 rounded-full bg-row-hover" />
        </View>
        <View className="flex-row flex-wrap gap-y-4 border-t border-border-subtle pt-4">
          {["model", "mode", "workspace", "limit"].map((cell) => (
            <View key={cell} className="w-1/2 gap-1.5 pe-3">
              <View className="h-3 w-16 rounded-md bg-row-hover" />
              <View className="h-3.5 w-24 rounded-md bg-row-hover" />
            </View>
          ))}
        </View>
      </View>
      <View className="h-16 w-full rounded-2xl border border-border" />
      <BotRowsSkeleton label="Loading runs" />
    </View>
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
