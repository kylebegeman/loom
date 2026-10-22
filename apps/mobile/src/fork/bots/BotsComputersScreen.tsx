import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { applyRunChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type RuntimeMode } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotRemoteSettings,
} from "@t3tools/contracts/fork";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { VaultReferenceSearch } from "../vault/ReferenceSearch";
import { BotChoice, BotPage, BotSection, BotToggle } from "./BotControls";
import { targetReadinessText } from "./historyLogic";
import {
  bots,
  useBotsCapabilities,
  useBotsCollection,
  useBotsReconnect,
  useRefreshWhenBotsChangesPruned,
} from "./state";

type Params = { environmentId: string; botId?: string };
const CEILINGS: ReadonlyArray<{ value: RuntimeMode; label: string; description: string }> = [
  {
    value: "approval-required",
    label: "Ask for approval",
    description: "Require approval for changes and commands.",
  },
  {
    value: "auto-accept-edits",
    label: "Allow edits",
    description: "Allow file edits; ask before commands.",
  },
  {
    value: "auto",
    label: "Automatic",
    description: "Use the provider's normal automatic permissions.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow the provider's full access mode.",
  },
];

export function BotsComputersRouteScreen({ route }: StaticScreenProps<Params>) {
  return (
    <ComputersScreen
      key={`${route.params.environmentId}:${route.params.botId ?? ""}`}
      params={route.params}
    />
  );
}

function ComputersScreen({ params }: { params: Params }) {
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(params.environmentId);
  const capabilities = useBotsCapabilities(environmentId);
  const collection = useBotsCollection(environmentId);
  const bot = collection.bots.find((entry) => entry.id === params.botId);
  return (
    <BotPage title={bot ? `${bot.name} computers` : "Bot computers"} back={navigation.canGoBack()}>
      <Text className="text-foreground-muted">
        Share bots through your Library and choose which computers can run them. Credential bindings
        stay on each computer.
      </Text>
      {!capabilities.connected ? (
        <Text>
          {capabilities.label} is offline. Reconnect to change settings or refresh readiness.
        </Text>
      ) : null}
      {!capabilities.anywhereSupported ? (
        <Text>Update this computer to share bots and manage remote runs.</Text>
      ) : (
        <>
          <RemoteSettings
            environmentId={environmentId}
            connected={capabilities.connected}
            onSync={collection.refresh}
          />
          {collection.query.error ? (
            <Text accessibilityRole="alert">{collection.query.error}</Text>
          ) : null}
          {collection.query.isPending && !collection.query.data ? <Text>Loading bots…</Text> : null}
          {bot ? (
            <SharingPanel
              environmentId={environmentId}
              bot={bot}
              connected={capabilities.connected}
              refreshBot={collection.refresh}
            />
          ) : collection.query.data ? (
            <View className="gap-2">
              <Text>
                {params.botId
                  ? "This bot is no longer available."
                  : collection.bots.length
                    ? "Choose a bot to manage sharing, readiness and Vault slots."
                    : "No bots yet. Create a bot before sharing it."}
              </Text>
              {!params.botId
                ? collection.bots.map((entry) => (
                    <Button
                      key={entry.id}
                      label={entry.name}
                      onPress={() =>
                        navigation.navigate("BotsComputers", { environmentId, botId: entry.id })
                      }
                    />
                  ))
                : null}
            </View>
          ) : null}
          <RemoteDeliveries
            environmentId={environmentId}
            botId={params.botId}
            connected={capabilities.connected}
            changes={collection.changes}
          />
        </>
      )}
    </BotPage>
  );
}

function RemoteSettings({
  environmentId,
  connected,
  onSync,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  onSync: () => void;
}) {
  const query = useEnvironmentQuery(bots.remoteSettings({ environmentId, input: {} }));
  const save = useAtomCommand(bots.setRemoteSettings, { reportFailure: false });
  const sync = useAtomCommand(bots.syncLibrary, { reportFailure: false });
  const canSave = useAtomValue(bots.setRemoteSettings.permissionAtom(environmentId));
  const canSync = useAtomValue(bots.syncLibrary.permissionAtom(environmentId));
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBotsReconnect(connected, query.refresh);
  const act = async (work: () => Promise<string | null>) => {
    if (pending.current || !connected) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    setError(null);
    await work()
      .then(setNotice)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not update remote settings."),
      );
    pending.current = false;
    setBusy(false);
  };
  const change = (patch: Partial<BotRemoteSettings>) => {
    if (!query.data || !canSave) return;
    const settings = query.data;
    void act(async () => {
      const result = await save({ environmentId, input: { ...settings, ...patch } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      query.refresh();
      return "Remote run settings saved.";
    });
  };
  return (
    <BotSection
      title="Incoming runs"
      description="Let your other computers run shared bots here. Their runs identify the computer that requested them."
    >
      {query.error || error ? <Text accessibilityRole="alert">{error ?? query.error}</Text> : null}
      {query.isPending && !query.data ? <Text>Loading remote settings…</Text> : null}
      {!canSave ? (
        <Text>This connection can read settings. Changes require permission on this computer.</Text>
      ) : null}
      {query.data ? (
        <>
          <BotToggle
            label="Run bots for other computers"
            value={query.data.acceptRemote}
            disabled={!connected || !canSave || busy || query.isPending}
            onChange={(acceptRemote) => change({ acceptRemote })}
          />
          <BotChoice
            label="Highest permissions for incoming runs"
            value={query.data.runtimeModeCeiling}
            options={CEILINGS}
            disabled={!connected || !canSave || busy || query.isPending}
            onChange={(runtimeModeCeiling) => change({ runtimeModeCeiling })}
          />
        </>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Refresh settings"
          disabled={!connected || busy || query.isPending}
          onPress={query.refresh}
        />
        <Button
          label="Sync shared bots"
          disabled={!connected || !canSync || busy}
          onPress={() =>
            void act(async () => {
              const result = await sync({ environmentId, input: {} });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              onSync();
              return [
                result.value.pulled === 0
                  ? "Every shared bot is up to date."
                  : `Brought in ${result.value.pulled} shared ${result.value.pulled === 1 ? "bot" : "bots"}.`,
                ...result.value.refused.map((entry) => entry.message),
              ].join(" ");
            })
          }
        />
      </View>
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
    </BotSection>
  );
}

function SharingPanel({
  environmentId,
  bot,
  connected,
  refreshBot,
}: {
  environmentId: EnvironmentId;
  bot: BotDefinition;
  connected: boolean;
  refreshBot: () => void;
}) {
  const targets = useEnvironmentQuery(bots.targets({ environmentId, input: { botId: bot.id } }));
  const slots = bot.vaultSlots ?? [];
  const bindings = useEnvironmentQuery(
    slots.length ? bots.vaultBindings({ environmentId, input: { botId: bot.id } }) : null,
  );
  const share = useAtomCommand(bots.share, { reportFailure: false });
  const unshare = useAtomCommand(bots.unshare, { reportFailure: false });
  const bind = useAtomCommand(bots.bindVaultSlot, { reportFailure: false });
  const canShare = useAtomValue(bots.share.permissionAtom(environmentId));
  const canUnshare = useAtomValue(bots.unshare.permissionAtom(environmentId));
  const canBind = useAtomValue(bots.bindVaultSlot.permissionAtom(environmentId));
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTargets = targets.refresh;
  const refreshBindings = bindings.refresh;
  useBotsReconnect(connected, refreshTargets);
  useBotsReconnect(connected, refreshBindings);
  const act = async (work: () => Promise<void>) => {
    if (pending.current || !connected) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    await work().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not update this bot."),
    );
    pending.current = false;
    setBusy(false);
  };
  const bindItem = (slot: string, itemId: string | null) => {
    if (!canBind || bot.archivedAt !== null) return;
    void act(async () => {
      const result = await bind({ environmentId, input: { botId: bot.id, slot, itemId } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPicking(null);
      refreshBindings();
      refreshTargets();
    });
  };
  return (
    <BotSection title="Library sharing">
      {targets.error || bindings.error || error ? (
        <Text accessibilityRole="alert">{error ?? targets.error ?? bindings.error}</Text>
      ) : null}
      <Button
        label="Refresh sharing and readiness"
        disabled={!connected || busy}
        onPress={() => {
          refreshTargets();
          refreshBindings();
          refreshBot();
        }}
      />
      {targets.isPending && !targets.data ? <Text>Checking Library and computers…</Text> : null}
      {targets.data?.library === "none" ? (
        <Text>Connect this computer to a Library to share bots with your other computers.</Text>
      ) : targets.data?.library === "unsupported" ? (
        <Text>Your Library needs an update to support shared bots.</Text>
      ) : targets.data?.library === "available" ? (
        <>
          <Text>
            {bot.library
              ? `Shared with your computers, revision ${bot.library.revision}.`
              : "Only on this computer. Share it to run it on your other computers."}
          </Text>
          {bot.library?.modelOverride ? (
            <Text>
              This computer uses {bot.library.modelOverride.model}; the Library keeps the shared
              model for other computers.
            </Text>
          ) : null}
          <Button
            label={bot.library ? "Stop sharing" : "Share to Library"}
            disabled={
              !connected ||
              busy ||
              bot.archivedAt !== null ||
              !(bot.library ? canUnshare : canShare)
            }
            onPress={() =>
              void act(async () => {
                const command = bot.library ? unshare : share;
                const result = await command({ environmentId, input: { botId: bot.id } });
                if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                refreshBot();
                refreshTargets();
              })
            }
          />
        </>
      ) : null}
      {targets.data?.targets.length ? (
        <View className="gap-2">
          <Text className="font-t3-semibold">Readiness</Text>
          {targets.data.targets.map((target) => (
            <View key={target.environmentId} className="gap-1 rounded-xl bg-grouped-card p-3">
              <Text className="font-t3-medium">
                {target.label}
                {target.isThisComputer ? " · This computer" : ""}
              </Text>
              <Text>{targetReadinessText(target)}</Text>
            </View>
          ))}
        </View>
      ) : targets.data?.library === "available" ? (
        <Text>No computers have reported readiness yet.</Text>
      ) : null}
      {slots.length ? (
        <View className="gap-3">
          <Text className="font-t3-semibold">Vault slots on this computer</Text>
          <Text>
            Choose a Vault item for each slot. Only the slot definition is shared; the item stays on
            this computer.
          </Text>
          {bindings.isPending && !bindings.data ? <Text>Loading Vault bindings…</Text> : null}
          {slots.map((slot) => {
            const binding = bindings.data?.bindings.find((entry) => entry.slot === slot.name);
            const disabled =
              !connected ||
              busy ||
              !canBind ||
              !bindings.data ||
              !!bindings.error ||
              bot.archivedAt !== null;
            return (
              <View key={slot.name} className="gap-2 rounded-xl bg-grouped-card p-4">
                <Text className="font-t3-medium">{slot.label}</Text>
                <Text className="text-sm text-foreground-muted">
                  {slot.action}
                  {slot.destination ? ` · ${slot.destination}` : ""}
                </Text>
                {bindings.data ? (
                  <Text>
                    {binding?.itemId
                      ? (binding.itemLabel ?? "The bound Vault item is no longer readable")
                      : "Not bound on this computer"}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label={binding?.itemId ? "Change Vault item" : "Bind Vault item"}
                    accessibilityLabel={`${binding?.itemId ? "Change" : "Bind"} ${slot.label} Vault item`}
                    disabled={disabled}
                    onPress={() => setPicking(picking === slot.name ? null : slot.name)}
                  />
                  {binding?.itemId ? (
                    <Button
                      label="Clear binding"
                      accessibilityLabel={`Clear ${slot.label} binding`}
                      disabled={disabled}
                      onPress={() => bindItem(slot.name, null)}
                    />
                  ) : null}
                </View>
                {picking === slot.name ? (
                  <View className="gap-2">
                    <VaultReferenceSearch
                      environmentId={environmentId}
                      connected={connected && !busy && canBind && bot.archivedAt === null}
                      onSelect={(reference) => bindItem(slot.name, reference.item.id)}
                    />
                    <Button
                      label="Cancel Vault selection"
                      disabled={busy}
                      onPress={() => setPicking(null)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </BotSection>
  );
}

function RemoteDeliveries({
  environmentId,
  botId,
  connected,
  changes,
}: {
  environmentId: EnvironmentId;
  botId?: string;
  connected: boolean;
  changes: ReturnType<typeof useBotsCollection>["changes"];
}) {
  const navigation = useNavigation();
  const query = useEnvironmentQuery(
    bots.listRuns({
      environmentId,
      input: { ...(botId ? { botId } : {}), limit: BOTS_LIST_RUNS_MAX_LIMIT },
    }),
  );
  useBotsReconnect(connected, query.refresh);
  useRefreshWhenBotsChangesPruned(changes, query.refresh);
  const runs = applyRunChanges(query.data?.runs ?? [], changes, {
    botId,
    includeNew: true,
    limit: BOTS_LIST_RUNS_MAX_LIMIT,
  }).filter((run) => run.ranOn || run.requestedBy);
  return (
    <BotSection
      title="Recent remote runs"
      description="Runs sent to another computer and runs requested by another computer."
    >
      <Button
        label="Refresh remote runs"
        disabled={!connected || query.isPending}
        onPress={query.refresh}
      />
      {query.error ? <Text accessibilityRole="alert">{query.error}</Text> : null}
      {query.isPending && !query.data ? (
        <Text>Loading remote runs…</Text>
      ) : query.data && !runs.length ? (
        <Text>No remote runs in the recent history.</Text>
      ) : null}
      {runs.map((run) => (
        <View key={run.id} className="gap-2 rounded-xl bg-grouped-card p-4">
          <Text className="font-t3-semibold">
            {run.botName} · {run.status.replaceAll("_", " ")}
          </Text>
          {run.ranOn ? <Text>Sent to {run.ranOn.label}</Text> : null}
          {run.requestedBy ? <Text>Requested by {run.requestedBy.label}</Text> : null}
          <Text className="text-sm text-foreground-muted">
            {new Date(run.createdAt).toLocaleString()}
          </Text>
          {run.error ? <Text accessibilityRole="alert">{run.error}</Text> : null}
          <Button
            label="View run"
            onPress={() => navigation.navigate("BotsRunDetail", { environmentId, runId: run.id })}
          />
        </View>
      ))}
      {query.data?.hasMore ? (
        <Text>
          Showing remote runs among the {BOTS_LIST_RUNS_MAX_LIMIT} newest runs. Open a bot's run
          history to see older runs.
        </Text>
      ) : null}
    </BotSection>
  );
}
