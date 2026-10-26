import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import { Pressable, View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  isBotRunHandledByCaller,
  type BotRun,
} from "@t3tools/contracts/fork";
import {
  applyInboxChanges,
  dismissRunIdBatches,
  inboxNeedsPersonCount,
} from "@t3tools/client-runtime/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotPage, BotNotice } from "./BotControls";
import { BotRunRow } from "./BotRunDetailScreen";
import {
  BotRowsSkeleton,
  BotStateDot,
  BotsEmptyList,
  BotsOutline,
  BotsSection,
} from "./BotIdentity";
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
  const selectDetail = useSelectWorkspaceDetail();
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
  const switchView = (next: boolean) => {
    if (next === dismissed) return;
    setDismissed(next);
    setBefore(undefined);
    setEarlier([]);
  };
  const canAct = allowed && capabilities.connected && !busy;
  // Runs whose calling agent already has the outcome need no one, so they wait folded below.
  const [showHandled, setShowHandled] = useState(false);
  const handled = dismissed || !page ? [] : page.runs.filter(isBotRunHandledByCaller);
  const shown = !page
    ? []
    : handled.length
      ? page.runs.filter((run) => !handled.includes(run))
      : page.runs;
  const shownTotal = !page ? 0 : dismissed ? page.total : inboxNeedsPersonCount(page);
  const runRows = (runs: ReadonlyArray<BotRun>) => (
    <BotsOutline>
      {runs.map((run, index) => (
        <BotRunRow
          key={run.id}
          run={run}
          separated={index > 0}
          onOpen={() => navigation.navigate("BotsRunDetail", { environmentId, runId: run.id })}
          actions={
            <Button
              label={dismissed ? "Restore" : "Dismiss"}
              accessibilityLabel={`${dismissed ? "Restore" : "Dismiss"} ${run.botName} run`}
              tone="text"
              disabled={!canAct}
              onPress={() => void update([run.id], !dismissed)}
            />
          }
        />
      ))}
    </BotsOutline>
  );
  return (
    <BotPage
      title="Bots inbox"
      actions={[
        {
          icon: "arrow.clockwise",
          accessibilityLabel: "Refresh inbox",
          disabled: !capabilities.connected || query.isPending || busy,
          onPress: refresh,
        },
      ]}
    >
      <View accessibilityRole="tablist" className="flex-row gap-2">
        {(
          [
            [false, "Needs you"],
            [true, "Dismissed"],
          ] as const
        ).map(([value, label]) => {
          const current = value === dismissed;
          return (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: current, disabled: busy }}
              disabled={busy}
              onPress={() => switchView(value)}
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
                {label}
              </Text>
            </Pressable>
          );
        })}
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
          tone="text"
          disabled={!canAct}
          onPress={() => void update(undoIds, false)}
        />
      ) : null}
      {!dismissed && waiting.length ? (
        <BotsSection title="Waiting for you" detail={String(waiting.length)}>
          <BotsOutline>
            {waiting.map((thread, index) => (
              <View
                key={thread.id}
                className={cn(
                  "gap-1 bg-adaptive-amber-500-a12-a16 py-3 ps-4 pe-1",
                  index > 0 && "border-t border-border-subtle",
                )}
              >
                <View className="flex-row items-center gap-2.5 pe-3">
                  <BotStateDot tone="warning" />
                  <Text
                    numberOfLines={2}
                    className="min-w-0 flex-1 text-sm font-t3-medium text-foreground"
                  >
                    {thread.title}
                  </Text>
                  <LibraryStateBadge
                    tone="warning"
                    label={thread.hasPendingApprovals ? "Needs approval" : "Has a question"}
                  />
                </View>
                <View className="ps-3">
                  <Button
                    label="Answer in thread"
                    tone="text"
                    onPress={() =>
                      selectDetail({
                        name: "Thread",
                        params: { environmentId: thread.environmentId, threadId: thread.id },
                      })
                    }
                  />
                </View>
              </View>
            ))}
          </BotsOutline>
        </BotsSection>
      ) : null}
      {capabilities.inboxSupported ? (
        <BotsSection
          title={dismissed ? "Dismissed" : "Needs attention"}
          detail={shown.length ? `${shown.length} of ${shownTotal}` : undefined}
        >
          {!page ? (
            query.isPending ? (
              <BotRowsSkeleton label="Loading inbox" />
            ) : null
          ) : (
            <>
              {shown.length ? (
                runRows(shown)
              ) : (
                <BotsEmptyList
                  message={
                    dismissed
                      ? "No dismissed runs."
                      : "Nothing needs you. Failed, timed out and undecided runs land here."
                  }
                />
              )}
              <View className="flex-row flex-wrap gap-2">
                {!dismissed && shown.length > 1 ? (
                  <Button
                    label="Dismiss all shown"
                    tone="text"
                    disabled={!canAct}
                    onPress={() =>
                      void update(
                        shown.map((run) => run.id),
                        true,
                      )
                    }
                  />
                ) : null}
                {query.data?.hasMore ? (
                  <Button
                    label="Older inbox runs"
                    tone="text"
                    disabled={query.isPending || !capabilities.connected}
                    onPress={() => {
                      const last = query.data?.runs.at(-1);
                      if (!last) return;
                      setEarlier(page.runs);
                      setBefore(last.createdAt);
                    }}
                  />
                ) : null}
              </View>
            </>
          )}
        </BotsSection>
      ) : null}
      {handled.length ? (
        <BotsSection
          title="Handled by the calling agent"
          detail={`${handled.length} of ${page?.handled ?? handled.length}`}
          trailing={
            <Button
              label={showHandled ? "Hide" : "Show"}
              accessibilityLabel={`${showHandled ? "Hide" : "Show"} runs handled by the calling agent`}
              accessibilityHint="Their results went back to the agent that started them"
              tone="text"
              onPress={() => setShowHandled((value) => !value)}
            />
          }
        >
          {showHandled ? (
            <>
              {runRows(handled)}
              {handled.length > 1 ? (
                <Button
                  label={`Dismiss all ${handled.length}`}
                  tone="text"
                  disabled={!canAct}
                  onPress={() =>
                    void update(
                      handled.map((run) => run.id),
                      true,
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
        </BotsSection>
      ) : null}
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
