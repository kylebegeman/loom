import { useCallback, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { View } from "react-native";
import { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_TRIGGER_FIRINGS_MAX_LIMIT,
  type BotDefinition,
  type BotTrigger,
  type BotTriggerFiring,
} from "@t3tools/contracts/fork";
import {
  applyFiringChanges,
  applyPipelineChanges,
  applyTriggerChanges,
  triggerSummary,
  type BotTriggerChanges,
} from "@t3tools/client-runtime/fork";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import { commandValue } from "./runLogic";
import { useBotActionLifetime } from "./useBotActionLifetime";
import * as Option from "effect/Option";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotInput, BotNotice, BotPage, BotSection, BotToggle } from "./BotControls";
import { BotTriggerEditor } from "./BotTriggerEditor";
import { confirmBotAutomation } from "./botAutomationActions";
import {
  initialTriggerTestFields,
  newTriggerTestField,
  triggerTestFields,
  type TriggerTestField,
} from "./botAutomationLogic";
import {
  bots,
  useBotPipelineChanges,
  useBotTriggerChanges,
  useBotsCapabilities,
  useBotsCollection,
  useBotsReconnect,
} from "./state";

const time = (value: string) => new Date(value).toLocaleString();

function FiringRows({
  environmentId,
  firings,
}: {
  readonly environmentId: EnvironmentId;
  readonly firings: ReadonlyArray<BotTriggerFiring>;
}) {
  const navigation = useNavigation();
  return firings.length === 0 ? (
    <Text>This trigger has not fired yet.</Text>
  ) : (
    firings.map((firing) => (
      <View key={firing.id} className="gap-1 rounded-xl bg-grouped-card p-3">
        <Text>
          {firing.outcome === "run" ? "Ran" : "Skipped"}: {firing.eventSummary}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {time(firing.firedAt)}
          {firing.reason ? ` · ${firing.reason}` : ""}
        </Text>
        {firing.runId ? (
          <Button
            label="Open bot run"
            onPress={() =>
              navigation.navigate("BotsRunDetail", { environmentId, runId: firing.runId! })
            }
          />
        ) : null}
      </View>
    ))
  );
}

function TriggerFirings({
  environmentId,
  trigger,
  changes,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly changes: BotTriggerChanges;
}) {
  const capabilities = useBotsCapabilities(environmentId);
  const query = useEnvironmentQuery(
    bots.triggerFirings({
      environmentId,
      input: { triggerId: trigger.id, limit: BOTS_TRIGGER_FIRINGS_MAX_LIMIT },
    }),
  );
  useBotsReconnect(capabilities.connected, query.refresh);
  const firings = applyFiringChanges(query.data?.firings ?? [], changes, trigger.id);
  return (
    <View className="gap-2">
      <BotNotice
        error={query.error}
        detail={query.isPending && !query.data ? "Loading firings…" : undefined}
      />
      {firings.length > 0 || (!query.error && (!query.isPending || query.data)) ? (
        <FiringRows environmentId={environmentId} firings={firings} />
      ) : null}
      {query.data?.hasMore ? (
        <Text>Showing the {BOTS_TRIGGER_FIRINGS_MAX_LIMIT} most recent firings.</Text>
      ) : null}
      <Button
        label="Refresh firings"
        disabled={!capabilities.connected || query.isPending}
        onPress={query.refresh}
      />
    </View>
  );
}

function TriggerTest({
  environmentId,
  trigger,
  canTest,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly canTest: boolean;
}) {
  const active = useBotActionLifetime();
  const [fields, setFields] = useState(() => initialTriggerTestFields(trigger));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<BotTriggerFiring | null>(null);
  const test = useAtomCommand(bots.testTrigger, { reportFailure: false });
  const update = (index: number, patch: Partial<TriggerTestField>) =>
    setFields((current) =>
      current.map((field, position) => (position === index ? { ...field, ...patch } : field)),
    );
  const fire = async () => {
    if (busy || !canTest) return;
    const built = triggerTestFields(fields);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    await confirmBotAutomation(
      "Test this trigger?",
      "This bypasses the trigger's filters and limits and starts a real bot or pipeline run.",
      "Fire once",
    )
      .then(async (confirmed) => {
        if (!confirmed || !active.current) return;
        const result = await test({
          environmentId,
          input: { triggerId: trigger.id, fields: built.fields },
        });
        const firing = commandValue(result);
        if (active.current) setFiring(firing);
      })
      .catch((cause: unknown) => {
        if (active.current)
          setError(cause instanceof Error ? cause.message : "Could not fire this trigger.");
      });
    if (active.current) setBusy(false);
  };
  return (
    <BotSection
      title="Test event"
      description="Enter the event fields. This starts a real run, bypassing trigger filters and limits."
    >
      {fields.map((field, index) => (
        <View key={field.key} className="gap-2 rounded-xl bg-grouped-card p-3">
          {trigger.event.kind === "webhook" ? (
            <BotInput
              label={`Event field ${index + 1}`}
              value={field.name}
              disabled={busy}
              onChangeText={(name) => update(index, { name })}
            />
          ) : (
            <Text>{field.name}</Text>
          )}
          <BotChoice
            label={`${field.name || "Field"} type`}
            value={field.type}
            disabled={busy}
            options={[
              { value: "string", label: "Text" },
              { value: "number", label: "Number" },
              { value: "boolean", label: "Boolean" },
            ]}
            onChange={(type) => update(index, { type, value: type === "boolean" ? "false" : "" })}
          />
          {field.type === "boolean" ? (
            <BotToggle
              label={`${field.name || "Field"} value`}
              value={field.value === "true"}
              disabled={busy}
              onChange={(value) => update(index, { value: String(value) })}
            />
          ) : (
            <BotInput
              label={`${field.name || "Field"} value`}
              value={field.value}
              disabled={busy}
              onChangeText={(value) => update(index, { value })}
            />
          )}
          {trigger.event.kind === "webhook" ? (
            <Button
              label={`Remove field ${index + 1}`}
              disabled={busy}
              onPress={() =>
                setFields((current) => current.filter((_, position) => position !== index))
              }
            />
          ) : null}
        </View>
      ))}
      {trigger.event.kind === "webhook" ? (
        <Button
          label="Add event field"
          disabled={busy}
          onPress={() => setFields((current) => [...current, newTriggerTestField()])}
        />
      ) : null}
      <Button
        label={busy ? "Firing…" : "Fire once"}
        tone="primary"
        disabled={busy || !canTest}
        onPress={() => void fire()}
      />
      <BotNotice error={error} />
      {firing ? <FiringRows environmentId={environmentId} firings={[firing]} /> : null}
    </BotSection>
  );
}

function TriggerCard({
  environmentId,
  trigger,
  bot,
  changes,
  onEdit,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly bot: BotDefinition | undefined;
  readonly changes: BotTriggerChanges;
  readonly onEdit: () => void;
  readonly onChanged: () => void;
}) {
  const active = useBotActionLifetime();
  const capabilities = useBotsCapabilities(environmentId);
  const projects = useProjects();
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const enabledAllowed = useAtomValue(bots.setTriggerEnabled.permissionAtom(environmentId));
  const editAllowed = useAtomValue(bots.saveTrigger.permissionAtom(environmentId));
  const deleteAllowed = useAtomValue(bots.deleteTrigger.permissionAtom(environmentId));
  const testAllowed = useAtomValue(bots.testTrigger.permissionAtom(environmentId));
  const repinAllowed = useAtomValue(bots.repinTrigger.permissionAtom(environmentId));
  const rotateAllowed = useAtomValue(bots.rotateTriggerToken.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(bots.setTriggerEnabled, { reportFailure: false });
  const remove = useAtomCommand(bots.deleteTrigger, { reportFailure: false });
  const repin = useAtomCommand(bots.repinTrigger, { reportFailure: false });
  const rotate = useAtomCommand(bots.rotateTriggerToken, { reportFailure: false });
  const [history, setHistory] = useState(false),
    [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAct = capabilities.connected && !busy;
  const address = trigger.webhook
    ? webhookAddress(trigger.webhook, connection?.httpBaseUrl ?? null)
    : null;
  const act = async (work: () => Promise<void>) => {
    if (!canAct) return;
    setBusy(true);
    setError(null);
    await work()
      .then(() => {
        if (active.current) onChanged();
      })
      .catch((cause: unknown) => {
        if (active.current)
          setError(cause instanceof Error ? cause.message : "Could not update this trigger.");
      });
    if (active.current) setBusy(false);
  };
  return (
    <View className="gap-3 rounded-xl border border-border-subtle p-4">
      <Text accessibilityRole="header" className="text-lg font-t3-semibold">
        {trigger.name}
      </Text>
      <Text>
        {bot?.name ?? "Deleted bot"}
        {trigger.pipelineId
          ? ` · Pipeline ${trigger.pipelineId}`
          : ` · ${trigger.followLatest ? "Latest" : trigger.followStable ? "Stable" : `Version ${trigger.pinnedVersion}`}`}
      </Text>
      <Text>
        {triggerSummary(
          trigger.event,
          (id) =>
            projects.find((project) => project.id === id && project.environmentId === environmentId)
              ?.title ?? id,
        )}
      </Text>
      <Text className="text-xs text-foreground-muted">
        At most {trigger.dailyLimit} a day, {trigger.cooldownMinutes} minutes apart.
        {trigger.nextFireAt ? ` Next: ${time(trigger.nextFireAt)}.` : ""}
        {trigger.lastFiredAt ? ` Last ran: ${time(trigger.lastFiredAt)}.` : ""}
      </Text>
      <BotToggle
        label={trigger.enabled ? "Armed" : "Disarmed"}
        value={trigger.enabled}
        disabled={!canAct || !enabledAllowed}
        onChange={(enabled) =>
          void act(async () => {
            const result = await setEnabled({
              environmentId,
              input: { triggerId: trigger.id, enabled },
            });
            commandValue(result);
          })
        }
      />
      <View className="flex-row flex-wrap gap-2">
        <Button label="Edit" disabled={!canAct || !editAllowed || !bot} onPress={onEdit} />
        <Button
          label={testing ? "Close test" : "Test"}
          disabled={!capabilities.connected || !testAllowed || !bot}
          onPress={() => setTesting(!testing)}
        />
        <Button
          label={history ? "Hide history" : "Firing history"}
          onPress={() => setHistory(!history)}
        />
        <Button
          label="Delete"
          tone="danger"
          disabled={!canAct || !deleteAllowed}
          onPress={() =>
            void act(async () => {
              if (
                !(await confirmBotAutomation(
                  `Delete ${trigger.name}?`,
                  "Its firing history, webhook address and secret will be deleted.",
                  "Delete",
                )) ||
                !active.current
              )
                return;
              const result = await remove({ environmentId, input: { triggerId: trigger.id } });
              commandValue(result);
            })
          }
        />
      </View>
      {bot &&
      !trigger.followLatest &&
      !trigger.followStable &&
      bot.version !== trigger.pinnedVersion &&
      !trigger.pipelineId ? (
        <>
          <Text>
            This trigger runs version {trigger.pinnedVersion}; {bot.name} is now version{" "}
            {bot.version}.
          </Text>
          <Button
            label={`Use version ${bot.version}`}
            disabled={!canAct || !repinAllowed}
            onPress={() =>
              void act(async () => {
                const result = await repin({ environmentId, input: { triggerId: trigger.id } });
                commandValue(result);
              })
            }
          />
        </>
      ) : null}
      {address ? (
        <View className="gap-2">
          <Text selectable>{address.address}</Text>
          {address.note ? (
            <Text className="text-xs text-foreground-muted">{address.note}</Text>
          ) : null}
          {trigger.event.kind === "merge-conflict" ? (
            <Text>
              Set LOOM_BOTS_CONFLICT_HOOK to this address before running fork integration.
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={copied ? "Copied address" : "Copy address"}
              disabled={!address.copyable}
              onPress={() => {
                void tryCopyTextWithHaptic(address.address, { target: "trigger address" }).then(
                  (ok) => {
                    if (!active.current) return;
                    setCopied(ok);
                    if (!ok) setError("Could not copy the address.");
                  },
                );
              }}
            />
            <Button
              label="Rotate address"
              disabled={!canAct || !rotateAllowed}
              onPress={() =>
                void act(async () => {
                  if (
                    !(await confirmBotAutomation(
                      "Rotate webhook address?",
                      "The current address stops working immediately.",
                      "Rotate",
                    )) ||
                    !active.current
                  )
                    return;
                  const result = await rotate({ environmentId, input: { triggerId: trigger.id } });
                  commandValue(result);
                  if (active.current) setCopied(false);
                })
              }
            />
          </View>
        </View>
      ) : null}
      {testing ? (
        <TriggerTest
          environmentId={environmentId}
          trigger={trigger}
          canTest={capabilities.connected && testAllowed}
        />
      ) : null}
      {history ? (
        <TriggerFirings environmentId={environmentId} trigger={trigger} changes={changes} />
      ) : null}
      <BotNotice error={error} />
    </View>
  );
}

export function BotTriggersRouteScreen({
  route,
}: StaticScreenProps<{ environmentId: string; botId?: string }>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  return (
    <TriggersScreen
      key={`${environmentId}:${route.params.botId ?? "all"}`}
      environmentId={environmentId}
      botId={route.params.botId}
    />
  );
}

function TriggersScreen({
  environmentId,
  botId,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId?: string;
}) {
  const caps = useBotsCapabilities(environmentId);
  const supported = caps.supported && caps.triggersSupported;
  const collection = useBotsCollection(environmentId);
  const changes = useBotTriggerChanges(environmentId, supported && caps.connected);
  const pipelineChanges = useBotPipelineChanges(
    environmentId,
    caps.pipelinesSupported && caps.connected,
  );
  const query = useEnvironmentQuery(
    supported ? bots.listTriggers({ environmentId, input: botId ? { botId } : {} }) : null,
  );
  const pipelinesQuery = useEnvironmentQuery(
    caps.pipelinesSupported ? bots.listPipelines({ environmentId, input: {} }) : null,
  );
  const pipelines = applyPipelineChanges(pipelinesQuery.data?.pipelines ?? [], pipelineChanges);
  const triggers = applyTriggerChanges(query.data?.triggers ?? [], changes, botId);
  const saveAllowed = useAtomValue(bots.saveTrigger.permissionAtom(environmentId));
  const [newFor, setNewFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    readonly bot: BotDefinition;
    readonly trigger: BotTrigger | null;
  } | null>(null);
  const connected = caps.connected;
  const refreshTriggers = query.refresh,
    refreshPipelines = pipelinesQuery.refresh,
    refreshBots = collection.refresh;
  const refresh = useCallback(() => {
    if (!supported || !connected) return;
    refreshTriggers();
    refreshPipelines();
    refreshBots();
  }, [supported, connected, refreshTriggers, refreshPipelines, refreshBots]);
  useBotsReconnect(caps.connected, refresh);
  useFocusEffect(
    useCallback(() => {
      if (caps.connected && supported) refresh();
    }, [caps.connected, supported, refresh]),
  );
  const selectedBot = botId ? collection.bots.find((bot) => bot.id === botId) : undefined;
  const available = collection.bots.filter(
    (bot) => bot.archivedAt === null && (!botId || bot.id === botId),
  );
  return (
    <BotPage title={selectedBot ? `${selectedBot.name} triggers` : "Bot triggers"}>
      <Text>
        Arm event and schedule automation, inspect what fired, and manage webhook addresses.
      </Text>
      <BotNotice
        detail={
          !caps.connected
            ? `${caps.label} is offline. Reconnect to manage triggers.`
            : !supported
              ? "Update this computer to use bot triggers."
              : undefined
        }
        error={query.error ?? collection.query.error}
      />
      {supported ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="New trigger"
              tone="primary"
              disabled={!caps.connected || !saveAllowed || available.length === 0}
              onPress={() => {
                if (available.length === 1) setEditing({ bot: available[0]!, trigger: null });
                else setNewFor(available[0]?.id ?? "");
              }}
            />
            <Button
              label="Refresh"
              disabled={!caps.connected || query.isPending}
              onPress={refresh}
            />
          </View>
          {newFor !== null ? (
            <BotSection title="Choose a bot">
              <BotChoice
                label="Bot"
                value={newFor}
                options={available.map((bot) => ({ value: bot.id as string, label: bot.name }))}
                onChange={setNewFor}
              />
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Continue"
                  disabled={!available.some((bot) => bot.id === newFor)}
                  onPress={() => {
                    const bot = available.find((candidate) => candidate.id === newFor);
                    if (bot) {
                      setEditing({ bot, trigger: null });
                      setNewFor(null);
                    }
                  }}
                />
                <Button label="Cancel" onPress={() => setNewFor(null)} />
              </View>
            </BotSection>
          ) : null}
          {query.isPending && !query.data ? (
            <Text>Loading triggers…</Text>
          ) : !query.error && !collection.query.error && triggers.length === 0 ? (
            <Text>
              {available.length === 0
                ? "Create a bot before adding triggers."
                : "No triggers yet. Add an event or schedule to start a bot automatically."}
            </Text>
          ) : null}
          {triggers.map((trigger) => (
            <TriggerCard
              key={trigger.id}
              environmentId={environmentId}
              trigger={trigger}
              bot={collection.bots.find((bot) => bot.id === trigger.botId)}
              changes={changes}
              onChanged={query.refresh}
              onEdit={() => {
                const bot = collection.bots.find((candidate) => candidate.id === trigger.botId);
                if (bot) setEditing({ bot, trigger });
              }}
            />
          ))}
          {editing ? (
            <BotTriggerEditor
              environmentId={environmentId}
              bot={editing.bot}
              trigger={editing.trigger}
              pipelines={pipelines.filter(
                (pipeline) => pipeline.steps[0]?.botId === editing.bot.id,
              )}
              canSave={caps.connected && saveAllowed}
              stableSupported={caps.versionsSupported}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                query.refresh();
              }}
            />
          ) : null}
        </>
      ) : null}
    </BotPage>
  );
}
