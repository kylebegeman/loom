import { useState, type ReactNode } from "react";
import type { BotDefinition, BotRun, BotStarterStatus } from "@t3tools/contracts/fork";
import { botDraft, botVersionLabel } from "@t3tools/client-runtime/fork";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisIcon,
  LayersIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { useProjects } from "~/state/entities";
import { LibraryStateBadge } from "../project-library/LibraryControls";
import { TickStrip } from "../project-library/LibraryData";
import { LibraryBackLink } from "../project-library/LibraryPageFrame";
import { botRecord, chronological, runTone } from "./BotActivity";
import { RUNTIME_MODE_LABELS, WORKSPACE_LABELS } from "./BotEditor";
import { BotTile, StarterBadge, runTime } from "./BotIdentity";

/**
 * One bot across the page's full width: who it is and what to do with it, its record in one
 * line, then its activity beside the settings every run receives.
 */
export function BotDetail({
  bot,
  starter,
  runs,
  canRun,
  canSave,
  runsOnMany,
  onRun,
  onRunOnMany,
  onEdit,
  onArchive,
  onDelete,
  aside,
  children,
}: {
  readonly bot: BotDefinition;
  readonly starter: BotStarterStatus | undefined;
  /** The bot's recent runs, newest first. */
  readonly runs: readonly BotRun[];
  readonly canRun: boolean;
  readonly canSave: boolean;
  readonly runsOnMany: boolean;
  readonly onRun: () => void;
  readonly onRunOnMany: () => void;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
  /** Panels for the side column, below the bot's settings. */
  readonly aside?: ReactNode;
  /** The bot's views. */
  readonly children: ReactNode;
}) {
  const archived = bot.archivedAt !== null;
  const record = botRecord(runs);
  const last = runs[0];
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <LibraryBackLink to="/loom/bots">Bots</LibraryBackLink>
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <BotTile bot={bot} size="lg" />
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">{bot.name}</h1>
              {archived ? (
                <LibraryStateBadge tone="neutral" icon={ArchiveIcon}>
                  Archived
                </LibraryStateBadge>
              ) : null}
              <StarterBadge status={starter} />
              {bot.library == null ? null : (
                <LibraryStateBadge tone="active">In the Library</LibraryStateBadge>
              )}
            </div>
            {bot.description ? (
              <p className="line-clamp-2 max-w-2xl text-sm text-muted-foreground">
                {bot.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button shape="pill" size="sm" variant="ghost" disabled={!canSave} onClick={onEdit}>
              <PencilIcon />
              Edit
            </Button>
            {runsOnMany ? (
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                disabled={!canRun || archived}
                onClick={onRunOnMany}
              >
                <LayersIcon />
                Run on many
              </Button>
            ) : null}
            <Button shape="pill" size="sm" disabled={!canRun || archived} onClick={onRun}>
              <PlayIcon />
              Run
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    shape="pill"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`More actions for ${bot.name}`}
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                <MenuItem disabled={!canSave} onClick={onArchive}>
                  {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  {archived ? "Restore" : "Archive"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" disabled={!canSave} onClick={onDelete}>
                  <Trash2Icon />
                  Delete
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </header>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-border py-3">
        <Vital label="Recent runs">
          {runs.length ? (
            <TickStrip
              label={`Last ${Math.min(runs.length, 24)} runs`}
              ticks={chronological(runs, 24).map((run) => ({ key: run.id, tone: runTone(run) }))}
            />
          ) : (
            <span className="text-muted-foreground">None yet</span>
          )}
        </Vital>
        <Vital label="Passed">
          {record.finished ? (
            <>
              {Math.round((record.passed / record.finished) * 100)}%
              <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                {record.passed} of {record.finished}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No finished runs</span>
          )}
        </Vital>
        <Vital label="Typical run">{record.typical ?? "Not measured"}</Vital>
        <Vital label="Last run">
          {last ? runTime(last.finishedAt ?? last.startedAt ?? last.createdAt) : "Never"}
        </Vital>
        <Vital label="Version">{botVersionLabel(bot)}</Vital>
      </dl>

      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">{children}</div>
        <aside aria-label="About this bot" className="flex min-w-0 flex-col gap-6">
          <BotSettings bot={bot} />
          <BotInstructions bot={bot} />
          {aside}
        </aside>
      </div>
    </div>
  );
}

function Vital({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex h-5 items-center text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function AsideHeading({ children }: { readonly children: ReactNode }) {
  return <h2 className="text-sm font-semibold tracking-tight">{children}</h2>;
}

/** A bot's settings as a spec sheet: one hairline row per setting, label left, value right. */
function BotSettings({ bot }: { readonly bot: BotDefinition }) {
  const projects = useProjects();
  const projectTitle = (id: string | null) =>
    id === null ? null : (projects.find((project) => project.id === id)?.title ?? id);
  const draft = botDraft(bot);
  const workspaceProject =
    bot.workspace.type === "project" ? projectTitle(bot.workspace.projectId) : null;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Model", bot.modelSelection.model],
    ["Permissions", RUNTIME_MODE_LABELS[bot.runtimeMode]],
    ["Mode", bot.interactionMode === "plan" ? "Plan only" : "Do the work"],
    [
      "Runs in",
      `${WORKSPACE_LABELS[draft.workspace]}${
        bot.workspace.type === "project"
          ? `${draft.workspace === "checkout" ? ", in" : " of"} ${
              workspaceProject ?? "the project chosen at run time"
            }`
          : ""
      }`,
    ],
    ["Time limit", `${bot.timeoutMinutes} minutes`],
    ["Runs at once", String(bot.maxConcurrentRuns)],
    ["Available in", projectTitle(bot.scopeProjectId) ?? "Every project"],
    ["Inputs", bot.parameters.map((parameter) => parameter.label).join(", ") || "None"],
  ];
  return (
    <section aria-label="Settings" className="flex flex-col gap-1.5">
      <AsideHeading>Settings</AsideHeading>
      <dl className="flex flex-col divide-y divide-border text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-baseline justify-between gap-4 py-1.5">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-end font-medium wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The brief every run receives; its opening lines, since it can run to pages. */
function BotInstructions({ bot }: { readonly bot: BotDefinition }) {
  const [open, setOpen] = useState(false);
  const long = bot.instructions.split("\n").length > 8 || bot.instructions.length > 480;
  return (
    <section aria-label="Instructions" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <AsideHeading>Instructions</AsideHeading>
        {long ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={() => setOpen((on) => !on)}>
            {open ? "Show less" : "Show all"}
          </Button>
        ) : null}
      </div>
      <pre
        className={
          open
            ? "max-h-[60vh] overflow-auto rounded-lg bg-muted/40 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere dark:bg-accent/30"
            : "line-clamp-8 rounded-lg bg-muted/40 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere dark:bg-accent/30"
        }
      >
        {bot.instructions}
      </pre>
    </section>
  );
}
