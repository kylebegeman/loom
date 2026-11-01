import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Link } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { NO_THREAD_BOT_RUNS } from "@t3tools/client-runtime/fork";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { isTerminalBotRunStatus, type BotRun } from "@t3tools/contracts/fork";
import { ComposerControl, ComposerControlIcon } from "~/components/chat/ComposerControl";
import type { ComposerControlSize } from "~/components/chat/ComposerControl";
import { useComposerMenuProps } from "~/components/chat/composerEventScope";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { useEnvironmentQueryRefresh } from "~/state/query";
import type { ForkComposerBlock, ForkComposerContext } from "../../composer/registry";
import { useLibraryPermission } from "../../project-library/state";
import {
  bots,
  useRefreshOnReconnect,
  useRefreshWhenBotsChangesPruned,
  useWaitingBotRuns,
} from "../state";
import { BotActivityRun, BotActivitySummary, OpenBotActivityButton } from "../ThreadBotActivity";
import { useMinuteNow } from "../BotIdentity";
import { useComposerBotsAccess } from "./slashSource";

function AttachedRunsChip({
  threadRef,
  runs,
  canCancel,
  size,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly runs: ReadonlyArray<BotRun>;
  readonly canCancel: boolean;
  readonly size: ComposerControlSize;
}) {
  const floatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useState(false);
  const now = useMinuteNow();
  const waiting = useWaitingBotRuns(threadRef.environmentId);
  const waitingIds = new Set(waiting.map((entry) => entry.id));
  const active = runs
    .filter((run) => !isTerminalBotRunStatus(run.status))
    .sort(
      (a, b) =>
        Number(Boolean(b.attention || waitingIds.has(b.threadId))) -
        Number(Boolean(a.attention || waitingIds.has(a.threadId))),
    );
  const recent = runs
    .filter((run) => isTerminalBotRunStatus(run.status))
    .slice(0, active.length ? 1 : 3);
  const shown = [...active, ...recent];
  const label = active.length
    ? `${active.length} ${active.length === 1 ? "bot active" : "bots active"}`
    : "Bot activity";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<ComposerControl size={size} />}
        aria-label={`${label} from this conversation`}
      >
        <ComposerControlIcon icon={BotIcon} size={size} />
        {active.length ? <span className="tabular-nums sm:hidden">{active.length}</span> : null}
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {label}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" width="xl" padding="none" {...floatingLayerProps}>
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <BotIcon aria-hidden className="size-4 text-muted-foreground" />
            <PopoverTitle>Bots</PopoverTitle>
          </div>
          <BotActivitySummary environmentId={threadRef.environmentId} runs={runs} />
        </header>
        <div
          role="region"
          aria-label="Attached bot activity"
          tabIndex={0}
          className="@container max-h-[min(18rem,45vh)] overflow-y-auto px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ul
            role="list"
            className="divide-y divide-border"
            aria-label="Bot activity from this conversation"
          >
            {shown.map((run) => (
              <BotActivityRun
                key={run.id}
                environmentId={threadRef.environmentId}
                run={run}
                canCancel={canCancel}
                now={now}
              />
            ))}
          </ul>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <OpenBotActivityButton threadRef={threadRef} onOpen={() => setOpen(false)} />
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            render={<Link to="/loom/bots" search={{ tab: "runs" }} />}
            onClick={() => setOpen(false)}
          >
            All bots
          </Button>
        </footer>
      </PopoverPopup>
    </Popover>
  );
}

const NO_RUNS = Atom.make(NO_THREAD_BOT_RUNS);

/** Activity stays reachable after a run finishes, with updates scoped to this conversation. */
export function useAttachedBotRunsBlock(context: ForkComposerContext): ForkComposerBlock | null {
  const { host, available } = useComposerBotsAccess(context);
  const environmentId = available ? host.environmentId : null;
  const canCancel = useLibraryPermission(bots.cancel, environmentId) && host.connected;
  const threadId = context.threadRef?.threadId ?? null;
  const { refresh } = useEnvironmentQueryRefresh(
    environmentId ? bots.recentRuns(environmentId) : null,
  );
  const threadRuns = useAtomValue(
    environmentId && threadId
      ? bots.threadActivity({ environmentId, threadId, watching: host.connected })
      : NO_RUNS,
  );
  const { runs } = threadRuns;

  useRefreshOnReconnect(host.connected, refresh);
  useRefreshWhenBotsChangesPruned(threadRuns, refresh);

  if (environmentId === null || context.threadRef === null || runs.length === 0) return null;
  return {
    id: "bot-runs",
    render: (size) => (
      <AttachedRunsChip
        threadRef={context.threadRef!}
        runs={runs}
        canCancel={canCancel}
        size={size}
      />
    ),
  };
}
