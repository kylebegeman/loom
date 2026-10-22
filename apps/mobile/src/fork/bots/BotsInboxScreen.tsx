import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import { BOTS_LIST_RUNS_MAX_LIMIT, type BotRun } from "@t3tools/contracts/fork";
import { applyInboxChanges, dismissRunIdBatches } from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotPage, BotNotice } from "./BotControls";
import { BotRunSummary } from "./BotRunDetailScreen";
import {
  bots,
  useBotsCapabilities,
  useBotsChanges,
  useBotsReconnect,
  useRefreshWhenBotsChangesPruned,
  useWaitingBotRuns,
} from "./state";
import { commandValue, failureMessage } from "./runLogic";

function Inbox({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const navigation = useNavigation();
  const capabilities = useBotsCapabilities(environmentId);
  const changes = useBotsChanges(environmentId, capabilities.supported && capabilities.connected);
  const waiting = useWaitingBotRuns(environmentId);
  const [dismissed, setDismissed] = useState(false);
  const [before, setBefore] = useState<string | undefined>();
  const [earlier, setEarlier] = useState<ReadonlyArray<BotRun>>([]);
  const query = useEnvironmentQuery(
    capabilities.inboxSupported
      ? bots.inbox({
          environmentId,
          input: {
            limit: BOTS_LIST_RUNS_MAX_LIMIT,
            ...(dismissed ? { dismissed: true } : {}),
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
  useRefreshWhenBotsChangesPruned(changes, refresh);
  const page = query.data
    ? applyInboxChanges({ ...query.data, runs: [...earlier, ...query.data.runs] }, changes, {
        dismissed,
      })
    : null;
  const dismiss = useAtomCommand(bots.dismiss, { reportFailure: false });
  const allowed = useAtomValue(bots.dismiss.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoIds, setUndoIds] = useState<ReadonlyArray<string>>([]);
  const update = async (ids: ReadonlyArray<string>, next: boolean) => {
    if (busy || !allowed || !capabilities.connected) return;
    setBusy(true);
    setError(null);
    const completed: string[] = [];
    await Promise.resolve()
      .then(async () => {
        for (const batch of dismissRunIdBatches(ids.map((id) => ({ id })))) {
          const result = await dismiss({
            environmentId,
            input: { runIds: batch, dismissed: next },
          });
          commandValue(result);
          completed.push(...batch);
        }
        setUndoIds(next ? completed : []);
      })
      .catch((cause: unknown) => {
        setUndoIds(next ? completed : ids.filter((id) => !completed.includes(id)));
        setError(failureMessage(cause, "Could not update these runs."));
      });
    refresh();
    setBusy(false);
  };
  return (
    <BotPage title="Bots inbox">
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={dismissed ? "Show needs attention" : "Show dismissed"}
          disabled={busy}
          onPress={() => {
            setDismissed((value) => !value);
            setBefore(undefined);
            setEarlier([]);
          }}
        />
        <Button
          label="Refresh inbox"
          disabled={!capabilities.connected || query.isPending || busy}
          onPress={refresh}
        />
        {!dismissed && page && page.runs.length > 1 ? (
          <Button
            label="Dismiss all shown"
            disabled={!allowed || !capabilities.connected || busy}
            onPress={() =>
              void update(
                page.runs.map((run) => run.id),
                true,
              )
            }
          />
        ) : null}
      </View>
      <BotNotice
        error={error ?? query.error}
        detail={
          !capabilities.inboxSupported
            ? "Update this computer's server to use the Bots inbox."
            : !capabilities.connected
              ? "Reconnect this computer to act on runs. Saved results may be out of date."
              : null
        }
      />
      {undoIds.length ? (
        <Button
          label={`Undo dismiss (${undoIds.length})`}
          disabled={busy || !allowed || !capabilities.connected}
          onPress={() => void update(undoIds, false)}
        />
      ) : null}
      {!dismissed && waiting.length ? (
        <View className="gap-3">
          <Text className="text-lg font-t3-semibold">Waiting for you</Text>
          {waiting.map((thread) => (
            <View key={thread.id} className="gap-2 rounded-2xl bg-grouped-card p-4">
              <Text className="font-t3-semibold">{thread.title}</Text>
              <Text>{thread.hasPendingApprovals ? "Needs approval" : "Has a question"}</Text>
              <Button
                label="Answer in thread"
                onPress={() =>
                  navigation.navigate("Thread", {
                    environmentId: thread.environmentId,
                    threadId: thread.id,
                  })
                }
              />
            </View>
          ))}
        </View>
      ) : null}
      <Text className="text-lg font-t3-semibold">
        {dismissed ? "Dismissed" : "Needs attention"}
      </Text>
      {!page ? (
        query.isPending ? (
          <Text>Loading inbox…</Text>
        ) : null
      ) : !page.runs.length ? (
        <Text>
          {dismissed
            ? "No dismissed runs."
            : "Nothing needs you. Failed, timed out and undecided runs land here."}
        </Text>
      ) : (
        <>
          {page.runs.map((run) => (
            <View key={run.id} className="gap-3 rounded-2xl bg-grouped-card p-4">
              <BotRunSummary run={run} />
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="View run and actions"
                  onPress={() =>
                    navigation.navigate("BotsRunDetail", { environmentId, runId: run.id })
                  }
                />
                <Button
                  label={dismissed ? "Restore" : "Dismiss"}
                  disabled={busy || !allowed || !capabilities.connected}
                  onPress={() => void update([run.id], !dismissed)}
                />
              </View>
            </View>
          ))}
          <Text className="text-xs text-foreground-muted">
            Showing {page.runs.length} of {page.total} runs.
          </Text>
          {query.data?.hasMore ? (
            <Button
              label="Older inbox runs"
              disabled={query.isPending || !capabilities.connected}
              onPress={() => {
                const last = query.data?.runs.at(-1);
                if (!last) return;
                setEarlier(page.runs);
                setBefore(last.createdAt);
              }}
            />
          ) : null}
        </>
      )}
    </BotPage>
  );
}

export function BotsInboxRouteScreen({ route }: StaticScreenProps<{ environmentId: string }>) {
  return (
    <Inbox
      key={route.params.environmentId}
      environmentId={route.params.environmentId as EnvironmentId}
    />
  );
}
