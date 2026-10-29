import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { useAtomValue } from "@effect/atom-react";
import {
  attentionRow,
  ATTENTION_REASON_LABELS,
  nextAttentionThread,
  runAttentionRetries,
  supportsLoomFeature,
  type AttentionRow,
  type AttentionRetryOutcome,
} from "@t3tools/client-runtime/fork";
import { ATTENTION_RETRY_FEATURE } from "@t3tools/contracts/fork";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { Button } from "../../components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../../components/ui/popover";
import { resolveShortcutCommand } from "../../keybindings";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../../state/server";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useBotsAttentionCount } from "../bots/state";
import { attention, readRetryTarget, retryAttentionTarget, retryThread } from "./state";

const key = (row: AttentionRow) => `${row.thread.environmentId}:${row.thread.id}`;

export function useThreadAttention() {
  const threads = useAtomValue(environmentThreadShells.attentionThreadShellsAtom);
  const current = useThreadRouteRef();
  const navigate = useNavigate();
  const next = nextAttentionThread(threads, current);
  const goNext = useCallback(async () => {
    if (next)
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: next.environmentId, threadId: next.id },
      });
  }, [next, navigate]);
  return { threads, goNext, current };
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
  const canRetry = useAtomValue(attention.retry.permissionAtom(row.thread.environmentId));
  const canResume = useEnvironmentScope(row.thread.environmentId, AuthOrchestrationOperateScope);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const supportsRetry = supportsLoomFeature(
    configs.get(row.thread.environmentId)?.environment.capabilities,
    ATTENTION_RETRY_FEATURE,
  );
  const action =
    row.kind === "paused" ? "Resume queue" : row.target && supportsRetry ? "Retry" : "Open";
  const allowed = action === "Retry" ? canRetry : action === "Resume queue" ? canResume : true;
  return (
    <li className="flex gap-3 py-2">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full truncate text-left text-sm font-medium"
          onClick={() => open(row)}
        >
          {row.thread.title}
        </button>
        <p className="text-xs text-muted-foreground">{ATTENTION_REASON_LABELS[row.kind]}</p>
        {outcome && (
          <p role="status" className="text-xs text-muted-foreground">
            {outcome.status === "failed"
              ? outcome.message
              : outcome.status === "retried"
                ? row.kind === "paused"
                  ? "Queue resumed"
                  : "Retried"
                : row.kind === "paused"
                  ? "Resuming…"
                  : "Retrying…"}
          </p>
        )}
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={!allowed || (action !== "Open" && (busy || outcome?.status === "retried"))}
        onClick={() => (action === "Open" ? open(row) : act(row))}
      >
        {action}
      </Button>
    </li>
  );
}

export function ThreadAttentionButton() {
  const { threads, goNext, current } = useThreadAttention();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const configs = useAtomValue(environmentServerConfigsAtom);
  const navigate = useNavigate();
  const bots = useBotsAttentionCount();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AttentionRow[] | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, AttentionRetryOutcome>>({});
  const [busy, setBusy] = useState(false);
  const rows =
    snapshot ??
    threads.flatMap((thread) => {
      const row = attentionRow(thread);
      return row ? [row] : [];
    });
  const supported = [...configs.values()].some((config) =>
    supportsLoomFeature(config.environment.capabilities, ATTENTION_RETRY_FEATURE),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window shortcut keeps next-attention navigation separate from opening the list
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || isCommandPaletteOpen())
        return;
      if (
        resolveShortcutCommand(event, keybindings, {
          platform: navigator.platform,
          context: { terminalFocus: isTerminalFocused() },
        }) !== "thread.nextAttention"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void goNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, keybindings]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the active thread's optional global retry shortcut
  useEffect(
    () =>
      onForkCommand("loom.attention-status.retry", () => {
        if (current) void retryThread(current);
      }),
    [current],
  );
  const openThread = (row: AttentionRow) => {
    setOpen(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: row.thread.environmentId, threadId: row.thread.id },
    });
  };
  const retryable = rows.filter(
    (row) =>
      row.target &&
      outcomes[key(row)]?.status !== "retried" &&
      readRetryTarget({ environmentId: row.thread.environmentId, threadId: row.thread.id }),
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
  if (!supported)
    return (
      <Button
        variant="ghost-muted"
        size="xs"
        disabled={threads.length === 0}
        onClick={goNext}
        aria-label="Go to next thread that needs you"
      >
        {threads.length} need you
      </Button>
    );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !busy) {
          setSnapshot(null);
          setOutcomes({});
        }
      }}
    >
      <PopoverTrigger render={<Button variant="ghost-muted" size="xs" />}>
        {threads.length} need you
      </PopoverTrigger>
      <PopoverPopup width="lg" align="start">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Needs you</h2>
          {retryable.length > 0 && (
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void act(retryable)}>
              Retry all retryable ({retryable.length})
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No threads need you.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
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
          </ul>
        )}
        {bots > 0 && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/loom/bots", search: { tab: "runs", scope: "attention" } });
            }}
          >
            Bots: {bots} waiting
          </Button>
        )}
      </PopoverPopup>
    </Popover>
  );
}
