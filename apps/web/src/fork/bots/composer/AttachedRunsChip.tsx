import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Link } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { NO_THREAD_BOT_RUNS } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotRun } from "@t3tools/contracts/fork";
import {
  ComposerControl,
  ComposerControlIcon,
  ComposerControlSeparator,
} from "~/components/chat/ComposerControl";
import type { ComposerControlSize } from "~/components/chat/ComposerControl";
import { useComposerMenuProps } from "~/components/chat/composerEventScope";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { useEnvironmentQueryRefresh } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ForkComposerBlock, ForkComposerContext } from "../../composer/registry";
import { useLibraryPermission } from "../../project-library/state";
import { bots, useRefreshWhenBotsChangesPruned } from "../state";
import { useComposerBotsAccess } from "./slashSource";

function AttachedRun({
  environmentId,
  run,
  canCancel,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly canCancel: boolean;
}) {
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = run.startedAt ?? run.createdAt;

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await cancel({ environmentId, input: { runId: run.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel the run.");
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-1">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{run.status === "queued" ? "Queued" : "Running"}</Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{run.botName}</span>
        <span className="text-muted-foreground">{new Date(started).toLocaleTimeString()}</span>
      </div>
      <div className="flex justify-end gap-1">
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          render={<Link to="/loom/bots" search={{ bot: run.botId, runId: run.id }} />}
        >
          Open
        </Button>
        {canCancel ? (
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => void stop()}
          >
            {busy ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AttachedRunsChip({
  environmentId,
  runs,
  canCancel,
  size,
}: {
  readonly environmentId: EnvironmentId;
  readonly runs: ReadonlyArray<BotRun>;
  readonly canCancel: boolean;
  readonly size: ComposerControlSize;
}) {
  const floatingLayerProps = useComposerMenuProps();
  const label = runs.length === 1 ? "bot running" : "bots running";
  return (
    <Popover>
      <PopoverTrigger
        render={<ComposerControl size={size} />}
        aria-label={`${runs.length} ${label} from this thread`}
      >
        <ComposerControlIcon icon={BotIcon} size={size} />
        <span className="tabular-nums">{runs.length}</span>
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {label}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" width="sm" {...floatingLayerProps}>
        <ul role="list" className="grid gap-3 text-xs" aria-label="Bot runs from this thread">
          {runs.map((run) => (
            <AttachedRun
              key={run.id}
              environmentId={environmentId}
              run={run}
              canCancel={canCancel}
            />
          ))}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}

const NO_RUNS = Atom.make(NO_THREAD_BOT_RUNS);

/** A footer control counting the unfinished bot runs started from this thread. */
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
      ? bots.threadRuns({ environmentId, threadId, watching: host.connected })
      : NO_RUNS,
  );
  const { runs } = threadRuns;

  // Changes missed while disconnected never arrive, so a reconnect refetches the list.
  const wasConnected = useRef(host.connected);
  useEffect(() => {
    if (host.connected && !wasConnected.current) refresh();
    wasConnected.current = host.connected;
  }, [host.connected, refresh]);
  useRefreshWhenBotsChangesPruned(threadRuns, refresh);

  if (environmentId === null || runs.length === 0) return null;
  return {
    id: "bot-runs",
    render: (size) => (
      <>
        <ComposerControlSeparator size={size} />
        <AttachedRunsChip
          environmentId={environmentId}
          runs={runs}
          canCancel={canCancel}
          size={size}
        />
      </>
    ),
  };
}
