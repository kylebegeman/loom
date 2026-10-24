import type { BotDefinition, BotRun, BotStarterStatus } from "@t3tools/contracts/fork";
import { botColor } from "@t3tools/client-runtime/fork";
import { PlayIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { LibraryStateBadge, LibraryStateDot } from "../project-library/LibraryControls";
import {
  LIBRARY_CELL,
  LIBRARY_ROW_TARGET,
  LIBRARY_TABLE_ROW,
  LibraryTable,
  TickStrip,
} from "../project-library/LibraryData";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { chronological, runTone } from "./BotActivity";
import { BotTile, StarterBadge, runTime } from "./BotIdentity";

const COLUMNS = [
  { key: "bot", label: "Bot" },
  { key: "recent", label: "Recent runs", className: "hidden w-40 sm:table-cell" },
  { key: "last", label: "Last run", className: "hidden w-32 md:table-cell" },
  { key: "model", label: "Model", className: "hidden w-44 lg:table-cell" },
  { key: "actions", label: "Actions", hideLabel: true, className: "w-16" },
] as const;

/** How many of a bot's runs its row shows; enough to see a streak, few enough to stay narrow. */
const ROW_TICKS = 16;

/** Every bot as one row: who it is, how its recent runs went, and the way to run it again. */
export function BotsTable({
  bots,
  runs,
  starterOf,
  canRun,
  onOpen,
  onRun,
}: {
  readonly bots: readonly BotDefinition[];
  /** Recent runs across every bot, newest first. */
  readonly runs: readonly BotRun[];
  readonly starterOf: (bot: BotDefinition) => BotStarterStatus | undefined;
  readonly canRun: boolean;
  readonly onOpen: (bot: BotDefinition) => void;
  readonly onRun: (bot: BotDefinition) => void;
}) {
  const runsByBot = new Map<string, BotRun[]>();
  for (const run of runs) runsByBot.set(run.botId, [...(runsByBot.get(run.botId) ?? []), run]);
  return (
    <LibraryTable label="Bots" columns={COLUMNS}>
      {bots.map((bot) => {
        const own = runsByBot.get(bot.id) ?? [];
        const last = own[0];
        const archived = bot.archivedAt !== null;
        return (
          <tr
            key={bot.id}
            style={projectColorStyle(botColor(bot))}
            className={cn(LIBRARY_TABLE_ROW, archived && "text-muted-foreground")}
          >
            <td className={LIBRARY_CELL}>
              <div className="flex min-w-0 items-center gap-3">
                <BotTile bot={bot} size="sm" />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(bot)}
                      className={cn(LIBRARY_ROW_TARGET, "truncate font-medium")}
                    >
                      {bot.name}
                    </button>
                    {archived ? (
                      <LibraryStateBadge tone="neutral">Archived</LibraryStateBadge>
                    ) : null}
                    {starterOf(bot)?.state === "outdated" ? (
                      <StarterBadge status={starterOf(bot)} />
                    ) : null}
                  </div>
                  {bot.description ? (
                    <p className="truncate text-xs text-muted-foreground">{bot.description}</p>
                  ) : null}
                </div>
              </div>
            </td>
            <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
              {own.length ? (
                <TickStrip
                  label={`Last ${Math.min(own.length, ROW_TICKS)} runs`}
                  ticks={chronological(own, ROW_TICKS).map((run) => ({
                    key: run.id,
                    tone: runTone(run),
                  }))}
                />
              ) : (
                <span className="text-xs text-muted-foreground">No runs yet</span>
              )}
            </td>
            <td className={cn(LIBRARY_CELL, "hidden text-xs tabular-nums md:table-cell")}>
              {last ? (
                <span className="inline-flex items-center gap-1.5">
                  <LibraryStateDot tone={runTone(last)} className="size-1.5" />
                  {runTime(last.finishedAt ?? last.startedAt ?? last.createdAt)}
                </span>
              ) : (
                <span className="text-muted-foreground">Never</span>
              )}
            </td>
            <td className={cn(LIBRARY_CELL, "hidden lg:table-cell")}>
              <span className="block truncate text-xs text-muted-foreground">
                {bot.modelSelection.model}
              </span>
            </td>
            <td className={cn(LIBRARY_CELL, "py-1.5 text-end")}>
              {/* Raised over the row's stretched target so it stays its own button. */}
              <span className="relative">
                <Button
                  shape="pill"
                  size="xs"
                  variant="ghost"
                  disabled={!canRun || archived}
                  onClick={() => onRun(bot)}
                >
                  <PlayIcon />
                  Run
                </Button>
              </span>
            </td>
          </tr>
        );
      })}
    </LibraryTable>
  );
}

export function RemovedStarters({
  starters,
  canRestore,
  onRestore,
}: {
  readonly starters: readonly BotStarterStatus[];
  readonly canRestore: boolean;
  readonly onRestore: (starter: BotStarterStatus) => void;
}) {
  return (
    <section aria-label="Starters you removed" className="flex flex-col gap-1.5">
      <h2 className="text-xs font-medium text-muted-foreground">Starters you removed</h2>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-dashed border-border">
        {starters.map((starter) => (
          <li key={starter.starterId} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{starter.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {starter.description}
              </span>
            </span>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={!canRestore}
              onClick={() => onRestore(starter)}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
