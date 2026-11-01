import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Link } from "@tanstack/react-router";
import { BotIcon, PlusIcon } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  applyBotChanges,
  NO_THREAD_BOT_RUNS,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  BOTS_FEATURE,
  BOTS_INVOCATION_FEATURE,
  BOTS_OPERATIONS_FEATURE,
  isTerminalBotRunStatus,
} from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import type { ForkPanelProps } from "../panels/types";
import { LibraryErrorNotice, LibraryGroupHeading } from "../project-library/LibraryControls";
import { useLibraryPermission } from "../project-library/state";
import { BotActivityRun, BotActivitySummary } from "./ThreadBotActivity";
import { useMinuteNow } from "./BotIdentity";
import { useBotRunDrawerStore } from "./composer/drawerStore";
import { botSlashItems } from "./composer/slashSource";
import {
  bots,
  useBotsChanges,
  useRefreshOnReconnect,
  useRefreshWhenBotsChangesPruned,
  useWaitingBotRuns,
} from "./state";

const NO_RUNS = Atom.make(NO_THREAD_BOT_RUNS);

export default function BotActivityPanel({ threadRef, visible }: ForkPanelProps) {
  const environment = useEnvironment(threadRef.environmentId);
  const primaryId = usePrimaryEnvironmentId();
  const thread = useThreadShell(threadRef);
  const capabilities = environment?.serverConfig?.environment.capabilities;
  const supported = supportsLoomFeature(capabilities, BOTS_FEATURE);
  const connected = environment?.connection.phase === "connected";
  const live = visible && supported;
  const operationsSupported = supportsLoomFeature(capabilities, BOTS_OPERATIONS_FEATURE);
  const operations = useEnvironmentQuery(
    live && connected && operationsSupported
      ? bots.operationChanges({ environmentId: threadRef.environmentId, input: {} })
      : null,
  );
  const list = useEnvironmentQuery(live ? bots.recentRuns(threadRef.environmentId) : null);
  const changes = useBotsChanges(threadRef.environmentId, live && connected);
  const activity = useAtomValue(
    live ? bots.threadActivity({ ...threadRef, watching: connected }) : NO_RUNS,
  );
  const canCancel =
    useLibraryPermission(bots.cancel, live ? threadRef.environmentId : null) && connected;
  const canRun =
    useLibraryPermission(bots.run, live ? threadRef.environmentId : null) &&
    connected &&
    supportsLoomFeature(capabilities, BOTS_INVOCATION_FEATURE) &&
    (!operationsSupported || (operations.data !== null && operations.data.mode !== "paused"));
  const definitions = useEnvironmentQuery(
    live ? bots.list({ environmentId: threadRef.environmentId, input: {} }) : null,
  );
  const availableBots = applyBotChanges(definitions.data?.bots ?? [], changes);
  const runnable = botSlashItems(availableBots, thread?.projectId ?? null);
  const now = useMinuteNow();
  useRefreshOnReconnect(connected, list.refresh);
  useRefreshOnReconnect(connected, definitions.refresh);
  useRefreshWhenBotsChangesPruned(activity, list.refresh);
  const waiting = useWaitingBotRuns(threadRef.environmentId);
  const waitingIds = new Set(waiting.map((entry) => entry.id));
  const active = activity.runs
    .filter((run) => !isTerminalBotRunStatus(run.status))
    .sort(
      (a, b) =>
        Number(Boolean(b.attention || waitingIds.has(b.threadId))) -
        Number(Boolean(a.attention || waitingIds.has(a.threadId))),
    );
  const recent = activity.runs.filter((run) => isTerminalBotRunStatus(run.status));
  if (!visible) return null;
  if (!supported)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Bot activity is unavailable on this computer.
      </p>
    );

  return (
    <section aria-label="Bot activity" className="flex h-full min-h-0 flex-col">
      <header className="space-y-1.5 border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Bots</h2>
            <p className="max-w-72 truncate text-xs text-muted-foreground">
              {thread?.title ?? "This conversation"}
            </p>
          </div>
          <Menu>
            <MenuTrigger
              render={<Button shape="pill" size="xs" variant="outline" />}
              disabled={!canRun || runnable.length === 0}
            >
              <PlusIcon />
              Run bot
            </MenuTrigger>
            <MenuPopup align="end">
              {runnable.map((bot) => (
                <MenuItem
                  key={bot.id}
                  onClick={() =>
                    useBotRunDrawerStore.getState().show(scopedThreadKey(threadRef), bot.value)
                  }
                >
                  {bot.description ? (
                    <span className="flex flex-col gap-1">
                      <span>
                        {availableBots.find((entry) => entry.id === bot.value)?.name ?? bot.value}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {bot.description}
                      </span>
                    </span>
                  ) : (
                    (availableBots.find((entry) => entry.id === bot.value)?.name ?? bot.value)
                  )}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </div>
        <BotActivitySummary environmentId={threadRef.environmentId} runs={activity.runs} />
        {operations.data?.mode === "paused" ? (
          <p role="status" className="text-xs text-muted-foreground">
            Bot runs are paused on this computer.
          </p>
        ) : null}
        {!connected ? (
          <p role="status" className="text-xs text-muted-foreground">
            Updates paused while {environment?.label ?? "this computer"} is offline.
          </p>
        ) : null}
      </header>
      <div className="@container min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <LibraryErrorNotice error={operations.error} onRetry={operations.refresh} />
        <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
        <LibraryErrorNotice error={definitions.error} onRetry={definitions.refresh} />
        {list.isPending && !list.data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading activity…
          </p>
        ) : null}
        {activity.runs.length === 0 && list.data ? (
          <div className="flex flex-col items-start gap-3 py-5">
            <BotIcon aria-hidden className="size-7 text-muted-foreground" />
            <h3 className="text-sm font-medium">No recent bot runs</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Run a bot from this conversation to keep its task, progress and results here.
            </p>
          </div>
        ) : null}
        {active.length ? (
          <section aria-label="Active bot runs" className="space-y-3">
            {activity.runs.length > 2 ? (
              <LibraryGroupHeading title="In progress" count={active.length} />
            ) : null}
            <ul className="divide-y divide-border">
              {active.map((run) => (
                <BotActivityRun
                  key={run.id}
                  environmentId={threadRef.environmentId}
                  run={run}
                  canCancel={canCancel}
                  now={now}
                  showDetails
                />
              ))}
            </ul>
          </section>
        ) : null}
        {recent.length ? (
          <section
            aria-label="Recent bot results"
            className={active.length ? "mt-4 space-y-2" : "space-y-2"}
          >
            <LibraryGroupHeading title="Recent results" count={recent.length} />
            <ul className="divide-y divide-border">
              {recent.map((run) => (
                <BotActivityRun
                  key={run.id}
                  environmentId={threadRef.environmentId}
                  run={run}
                  canCancel={false}
                  now={now}
                  showDetails
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-2xs text-muted-foreground">{environment?.label ?? "This computer"}</p>
        {primaryId === threadRef.environmentId ? (
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            render={<Link to="/loom/bots" search={{ tab: "runs" }} />}
          >
            All bots and runs
          </Button>
        ) : (
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            render={<Link to="/settings/connections" />}
          >
            Open computers
          </Button>
        )}
      </footer>
    </section>
  );
}
