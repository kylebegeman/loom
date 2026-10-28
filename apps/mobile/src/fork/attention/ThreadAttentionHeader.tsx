import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  attentionRow,
  ATTENTION_REASON_LABELS,
  inboxNeedsPersonCount,
  nextAttentionThread,
  runAttentionRetries,
  supportsLoomFeature,
  type AttentionRow,
  type AttentionRetryOutcome,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  ATTENTION_RETRY_FEATURE,
  BOT_RUN_THREAD_PREFIX,
  BOTS_INBOX_FEATURE,
  BOTS_LIST_RUNS_MAX_LIMIT,
} from "@t3tools/contracts/fork";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { ListFilterMenu } from "../../features/workspace/ListFilterMenu";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironmentQuery } from "../../state/query";
import { bots, useBotsCapabilities, useWaitingBotRuns } from "../bots/state";
import { attention, canRetryThread, retryAttentionTarget } from "./state";

const key = (row: AttentionRow) => `${row.thread.environmentId}:${row.thread.id}`;
export type AttentionFilter = "all" | "needs-you" | "waiting";

function BotsAttention({
  environmentId,
  onOpen,
}: {
  environmentId: EnvironmentId;
  onOpen: () => void;
}) {
  const navigation = useNavigation();
  const caps = useBotsCapabilities(environmentId);
  const waiting = useWaitingBotRuns(environmentId);
  const inbox = useEnvironmentQuery(
    caps.inboxSupported
      ? bots.inbox({ environmentId, input: { limit: BOTS_LIST_RUNS_MAX_LIMIT } })
      : null,
  );
  const listed = new Set(inbox.data?.runs.map((run) => `${BOT_RUN_THREAD_PREFIX}${run.id}`) ?? []);
  const count =
    (inbox.data ? inboxNeedsPersonCount(inbox.data) : 0) +
    waiting.filter((thread) => !listed.has(thread.id)).length;
  return count > 0 ? (
    <Button
      tone="text"
      label={`Bots: ${count} waiting on ${caps.label}`}
      onPress={() => {
        onOpen();
        navigation.navigate("BotsInbox", { environmentId });
      }}
    />
  ) : null;
}

function AttentionItem({
  row,
  busy,
  outcome,
  act,
  open,
}: {
  row: AttentionRow;
  busy: boolean;
  outcome: AttentionRetryOutcome | undefined;
  act: (row: AttentionRow) => void;
  open: (row: AttentionRow) => void;
}) {
  const allowed = useAtomValue(attention.retry.permissionAtom(row.thread.environmentId));
  const resumeAllowed = useEnvironmentScope(
    row.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const retryable = row.target !== null && canRetryThread(row.thread);
  const action = row.kind === "paused" ? "Resume queue" : retryable ? "Retry" : "Open";
  return (
    <View className="gap-2 py-3">
      <Pressable accessibilityRole="button" onPress={() => open(row)}>
        <AppText className="font-t3-medium">{row.thread.title}</AppText>
      </Pressable>
      <AppText className="text-foreground-muted text-sm">
        {ATTENTION_REASON_LABELS[row.kind]}
      </AppText>
      {outcome && (
        <AppText accessibilityLiveRegion="polite" className="text-foreground-muted text-sm">
          {outcome.status === "failed"
            ? outcome.message
            : outcome.status === "retried"
              ? row.kind === "paused"
                ? "Queue resumed"
                : "Retried"
              : row.kind === "paused"
                ? "Resuming…"
                : "Retrying…"}
        </AppText>
      )}
      <Button
        tone="secondary"
        label={action}
        disabled={
          action !== "Open" &&
          (busy ||
            outcome?.status === "retried" ||
            (action === "Retry" ? !allowed : !resumeAllowed))
        }
        onPress={() => (action === "Open" ? open(row) : act(row))}
      />
    </View>
  );
}

export function ThreadAttentionHeader(props: {
  threads: readonly EnvironmentThreadShell[];
  filter: AttentionFilter;
  onFilter: (filter: AttentionFilter) => void;
  onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const last = useRef<ScopedThreadRef | null>(null);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const supported = [...configs.values()].some((config) =>
    supportsLoomFeature(config.environment.capabilities, ATTENTION_RETRY_FEATURE),
  );
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AttentionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, AttentionRetryOutcome>>({});
  const rows =
    snapshot ??
    props.threads.flatMap((thread) => {
      const row = attentionRow(thread);
      return row ? [row] : [];
    });
  const retryable = rows.filter(
    (row) => row.target && outcomes[key(row)]?.status !== "retried" && canRetryThread(row.thread),
  );
  const act = async (selected: readonly AttentionRow[]) => {
    if (busy) return;
    setSnapshot(rows);
    setBusy(true);
    try {
      await runAttentionRetries(
        selected,
        async (row) => {
          if (row.kind === "paused") {
            const result = await threadEnvironment.resumeThreadQueue.run(appAtomRegistry, {
              environmentId: row.thread.environmentId,
              input: { threadId: row.thread.id },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          } else if (row.target) await retryAttentionTarget(row.target);
        },
        (row, result) => setOutcomes((prior) => ({ ...prior, [key(row)]: result })),
      );
    } finally {
      setBusy(false);
    }
  };
  const openThread = (row: AttentionRow) => {
    setOpen(false);
    props.onSelect(row.thread);
  };
  return (
    <>
      <View className="flex-row items-center justify-between px-4 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.threads.length} need you`}
          disabled={!supported && props.threads.length === 0}
          hitSlop={8}
          onPress={() => {
            if (supported) {
              if (!busy) {
                setSnapshot(null);
                setOutcomes({});
              }
              setOpen(true);
              return;
            }
            const next = nextAttentionThread(props.threads, last.current);
            if (next) {
              last.current = { environmentId: next.environmentId, threadId: next.id };
              props.onSelect(next);
            }
          }}
        >
          <AppText className="text-foreground-muted text-sm">
            {props.threads.length} need you
          </AppText>
        </Pressable>
        <ListFilterMenu
          label={
            props.filter === "all"
              ? "All statuses"
              : props.filter === "needs-you"
                ? "Needs you"
                : "Waiting on you"
          }
          accessibilityLabel="Filter threads by attention"
          active={props.filter !== "all"}
          actions={[
            { id: "all", title: "All statuses", state: props.filter === "all" ? "on" : "off" },
            {
              id: "needs-you",
              title: "Needs you",
              state: props.filter === "needs-you" ? "on" : "off",
            },
            {
              id: "waiting",
              title: "Waiting on you",
              state: props.filter === "waiting" ? "on" : "off",
            },
          ]}
          onSelect={(id) => {
            if (id === "all" || id === "needs-you" || id === "waiting") props.onFilter(id);
          }}
        />
      </View>
      {open && (
        <Sheet title="Needs you" onClose={() => setOpen(false)} dismissible={!busy}>
          <ScrollView className="px-4" contentContainerClassName="pb-8">
            {retryable.length > 0 && (
              <Button
                label={`Retry all retryable (${retryable.length})`}
                disabled={busy}
                onPress={() => void act(retryable)}
              />
            )}
            {rows.length === 0 && (
              <AppText className="py-4 text-foreground-muted">No threads need you.</AppText>
            )}
            {rows.map((row) => (
              <AttentionItem
                key={key(row)}
                row={row}
                busy={busy}
                outcome={outcomes[key(row)]}
                act={(row) => void act([row])}
                open={openThread}
              />
            ))}
            {[...configs]
              .filter(([, config]) =>
                supportsLoomFeature(config.environment.capabilities, BOTS_INBOX_FEATURE),
              )
              .map(([environmentId]) => (
                <BotsAttention
                  key={environmentId}
                  environmentId={environmentId}
                  onOpen={() => setOpen(false)}
                />
              ))}
          </ScrollView>
        </Sheet>
      )}
    </>
  );
}
