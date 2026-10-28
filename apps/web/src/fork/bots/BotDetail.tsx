import { useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import type {
  BotDefinition,
  BotParameter,
  BotRun,
  BotStarterStatus,
  BotUsageRow,
} from "@t3tools/contracts/fork";
import { botDraft, botVersionLabel } from "@t3tools/client-runtime/fork";
import { formatModelSlugName } from "@t3tools/shared/model";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import {
  ActivityIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  CpuIcon,
  EllipsisIcon,
  FolderIcon,
  HistoryIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LinkIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  TextCursorInputIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { LibraryHero, LibraryVital, LibraryVitals } from "../project-library/LibraryCollection";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
  LibrarySection,
  LibrarySpecSheet,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { TickStrip } from "../project-library/LibraryData";
import { LibraryTabs, type LibraryTab } from "../project-library/LibraryTabs";
import { BotSharingAside } from "./BotAnywhere";
import { botRecord, runTone } from "./BotActivity";
import { RUNTIME_MODE_LABELS, WORKSPACE_LABELS } from "./editorLogic";
import { BotVersionsView } from "./BotHistory";
import { BotTile, StarterBadge, formatSpan, runTime, useMinuteNow } from "./BotIdentity";
import { BotPipelinesAside } from "./BotPipelines";
import { RunRows, RunsView } from "./BotRuns";
import { BotTriggersAside } from "./BotTriggers";
import { NeedsYouBand } from "./BotsInbox";
import { runTicks, useBotLifecycle, useBotStarters, useNewestRuns } from "./BotsOverview";
import { BotUsageAside, useBotUsage, useBotUsageWindow } from "./BotsUsage";
import { activeRuns, successFigure } from "./botsCollection";
import { botPageTabs, selectedTab, type BotPageTab } from "./botsRoute";
import { useBotsNavigation } from "./navigation";
import { useBots, useBotsAccess, useNeedsYouItems } from "./state";
import { usageWindowShort, type BotUsageDays } from "./usageWindow";

const TABS: Record<BotPageTab, { readonly label: string; readonly icon: typeof ActivityIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboardIcon },
  runs: { label: "Runs", icon: ActivityIcon },
  versions: { label: "Versions", icon: HistoryIcon },
};

/** How many of a bot's runs its Overview lists before pointing at Runs. */
const RECENT_RUNS = 5;
const HERO_TICKS = 24;

type NewestRuns = ReturnType<typeof useNewestRuns>;

/** One bot's page: who it is and what to do with it in the hero, then its views. */
export function BotPage({ bot }: { readonly bot: BotDefinition }) {
  const { host } = useBots();
  const nav = useBotsNavigation();
  const newest = useNewestRuns(bot.id);
  // The same queue the Overview's Needs you band lists, so the badge and the band agree.
  const needsYou = useNeedsYouItems(bot, newest.runs).length;
  const tabs = botPageTabs(host);
  const tab = selectedTab(tabs, nav.search.tab);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BotHero bot={bot} newest={newest} />
      <LibraryTabs
        label={`${bot.name} views`}
        selected={tab}
        onSelect={(value) =>
          nav.show({ bot: bot.id, ...(value === "overview" ? {} : { tab: value }) })
        }
        tabs={tabs.map((value): LibraryTab<BotPageTab> => ({
          value,
          ...TABS[value],
          ...(value === "runs" ? { count: needsYou, urgent: true } : {}),
        }))}
      >
        {tab === "runs" ? (
          <RunsView bot={bot} />
        ) : tab === "versions" ? (
          <BotVersionsView bot={bot} />
        ) : (
          <BotOverview bot={bot} newest={newest} />
        )}
      </LibraryTabs>
    </div>
  );
}

function BotHero({ bot, newest }: { readonly bot: BotDefinition; readonly newest: NewestRuns }) {
  const { host } = useBots();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const router = useRouter();
  const lifecycle = useBotLifecycle();
  const starter = useBotStarters().starterOf(bot);
  const projects = useProjects();
  const archived = bot.archivedAt !== null;
  const running = activeRuns(newest.runs);
  const scope =
    bot.scopeProjectId === null
      ? "Every project"
      : (projects.find((project) => project.id === bot.scopeProjectId)?.title ?? "One project");
  const resetStarter = async (current: BotStarterStatus) => {
    await lifecycle.restore(
      current,
      current.state === "outdated"
        ? `Update ${bot.name} to the newer starter? Its instructions, inputs and settings are replaced; the model and where it is available stay.`
        : `Restore ${bot.name} to its starter? Its instructions, inputs and settings are replaced; the model and where it is available stay.`,
    );
  };
  const copyLink = async () => {
    const href = router.history.createHref(
      router.buildLocation({ to: "/loom/bots", search: { bot: bot.id } }).href,
    );
    try {
      await writeTextToClipboard(new URL(href, window.location.href).href, "link");
      toastManager.add({ type: "success", title: "Link copied" });
    } catch {
      toastManager.add({ type: "error", title: "Could not copy the link" });
    }
  };
  const remove = async () => {
    if (await lifecycle.deleteBot(bot)) nav.show({});
  };
  const restorable = starter && (starter.state === "edited" || starter.state === "outdated");
  return (
    <div className="flex flex-col gap-4">
      <LibraryHero
        tile={
          <span
            className={cn(
              "shrink-0 rounded-2xl bg-card shadow-sm ring-1 ring-border",
              archived && "opacity-70 grayscale",
            )}
          >
            <BotTile bot={bot} size="2xl" />
          </span>
        }
        title={bot.name}
        meta={
          <>
            {archived ? (
              <LibraryStateBadge tone="neutral" icon={ArchiveIcon}>
                Archived
              </LibraryStateBadge>
            ) : running ? (
              <LibraryStateBadge tone="active">
                {running === 1 ? "Running" : `${running} running`}
              </LibraryStateBadge>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <CpuIcon aria-hidden className="size-3.5 opacity-70" />
              {formatModelSlugName(bot.modelSelection.model)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <HistoryIcon aria-hidden className="size-3.5 opacity-70" />
              {botVersionLabel(bot)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FolderIcon aria-hidden className="size-3.5 opacity-70" />
              {scope}
            </span>
            {starter ? (
              <span className="inline-flex items-center gap-1.5">
                <StarterBadge status={starter} />
                {starter.state === "outdated" ? (
                  <Button
                    shape="pill"
                    size="xs"
                    variant="outline"
                    disabled={!access.canSave}
                    onClick={() => void resetStarter(starter)}
                  >
                    Update
                  </Button>
                ) : null}
              </span>
            ) : null}
            {bot.library == null ? null : (
              <LibraryStateBadge tone="neutral">In the Library</LibraryStateBadge>
            )}
          </>
        }
        actions={
          <>
            <Button
              shape="pill"
              disabled={!access.canRun || archived}
              onClick={() => nav.overlay({ run: bot.id })}
            >
              <PlayIcon />
              Run
            </Button>
            {host.batchesSupported && bot.parameters.length ? (
              <Button
                shape="pill"
                variant="outline"
                disabled={!access.canRun || archived}
                onClick={() => nav.overlay({ many: bot.id })}
              >
                <LayersIcon />
                Run on many
              </Button>
            ) : null}
            <Button
              shape="pill"
              variant="outline"
              disabled={!access.canSave}
              onClick={() => nav.open({ bot: bot.id, edit: true })}
            >
              <PencilIcon />
              Edit
            </Button>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    shape="pill"
                    size="icon"
                    variant="outline"
                    aria-label={`More actions for ${bot.name}`}
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                {host.triggersSupported ? (
                  <MenuItem
                    disabled={!access.canOperateTriggers || archived}
                    onClick={() => nav.overlay({ newTrigger: bot.id })}
                  >
                    <ZapIcon />
                    Add trigger
                  </MenuItem>
                ) : null}
                <MenuItem onClick={() => void copyLink()}>
                  <LinkIcon />
                  Copy link
                </MenuItem>
                {restorable ? (
                  <MenuItem disabled={!access.canSave} onClick={() => void resetStarter(starter)}>
                    <RotateCcwIcon />
                    {starter.state === "outdated"
                      ? "Update to the newer starter"
                      : "Restore starter"}
                  </MenuItem>
                ) : null}
                <MenuSeparator />
                <MenuItem
                  disabled={!access.canSave}
                  onClick={() => void lifecycle.setArchived(bot, !archived)}
                >
                  {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  {archived ? "Restore" : "Archive"}
                </MenuItem>
                <MenuItem
                  variant="destructive"
                  disabled={!access.canSave}
                  onClick={() => void remove()}
                >
                  <Trash2Icon />
                  Delete
                </MenuItem>
              </MenuPopup>
            </Menu>
          </>
        }
        footer={<BotVitals bot={bot} newest={newest} />}
      >
        {bot.description.trim() ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{bot.description}</p>
        ) : null}
      </LibraryHero>
      {archived ? (
        <LibraryNotice
          icon={ArchiveIcon}
          action={
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={!access.canSave}
              onClick={() => void lifecycle.setArchived(bot, false)}
            >
              Restore
            </Button>
          }
        >
          Archived. Its runs stay readable; restore it to run it again or add triggers.
        </LibraryNotice>
      ) : null}
    </div>
  );
}

/**
 * The bot's vital signs along the hero's foot. Usage over the chosen window gives the rates; a
 * server without usage falls back to the bot's latest runs and says so in the labels.
 */
function BotVitals({ bot, newest }: { readonly bot: BotDefinition; readonly newest: NewestRuns }) {
  const { host } = useBots();
  const nav = useBotsNavigation();
  const [days] = useBotUsageWindow();
  const usage = useBotUsage(days);
  const now = useMinuteNow();
  const last = newest.runs[0];
  const ticks = runTicks(newest.runs, HERO_TICKS, now);
  const runsShown = Math.min(newest.runs.length, HERO_TICKS);
  return (
    <LibraryVitals>
      {host.budgetsSupported ? (
        <UsageVitals
          days={days}
          row={usage.rowOf(bot.id)}
          loading={usage.isPending && !usage.usage}
          unavailable={usage.error !== null && !usage.usage}
        />
      ) : (
        <RecordVitals runs={newest.runs} loading={newest.loading} />
      )}
      <LibraryVital label="Last run">
        {newest.loading ? (
          <Skeleton className="h-3.5 w-16" />
        ) : newest.unavailable ? (
          <Muted>Unavailable</Muted>
        ) : last ? (
          <span className="inline-flex items-center gap-1.5">
            <LibraryStateDot tone={runTone(last)} className="size-1.5" />
            {runTime(last.finishedAt ?? last.startedAt ?? last.createdAt, now)}
          </span>
        ) : (
          <Muted>Never</Muted>
        )}
      </LibraryVital>
      <LibraryVital label="Recent runs">
        {newest.loading ? (
          <Skeleton className="h-4 w-32" />
        ) : newest.runs.length ? (
          <TickStrip
            label={`${bot.name}'s last ${runsShown} runs, oldest first. Choose one to open it.`}
            ticks={ticks}
            onSelectTick={(index) => {
              const run = newest.runs.find((entry) => entry.id === ticks[index]?.key);
              if (run) nav.overlay({ runId: run.id });
            }}
          />
        ) : newest.unavailable ? (
          <Muted>Unavailable</Muted>
        ) : (
          <Muted>None yet</Muted>
        )}
      </LibraryVital>
    </LibraryVitals>
  );
}

function Muted({ children }: { readonly children: string }) {
  return <span className="font-normal text-muted-foreground">{children}</span>;
}

function UsageVitals({
  days,
  row,
  loading,
  unavailable,
}: {
  readonly days: BotUsageDays;
  readonly row: BotUsageRow | undefined;
  readonly loading: boolean;
  readonly unavailable: boolean;
}) {
  const short = usageWindowShort(days);
  const figure = successFigure(row);
  const reading = (value: ReactNode) =>
    loading ? (
      <Skeleton className="h-3.5 w-12" />
    ) : unavailable ? (
      <Muted>Unavailable</Muted>
    ) : (
      value
    );
  return (
    <>
      <LibraryVital label={`${figure?.label ?? "Passed"} · ${short}`}>
        {reading(
          figure ? (
            <>
              {formatPercent(figure.share, 0)}
              <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                {figure.detail}
              </span>
            </>
          ) : (
            <Muted>No finished runs</Muted>
          ),
        )}
      </LibraryVital>
      <LibraryVital label={`Runs · ${short}`}>{reading(formatCount(row?.runs ?? 0))}</LibraryVital>
      <LibraryVital label={`Typical run · ${short}`}>
        {reading(
          row?.medianDurationMs == null ? (
            <Muted>Not measured</Muted>
          ) : (
            formatSpan(row.medianDurationMs)
          ),
        )}
      </LibraryVital>
      <LibraryVital label={`Tokens · ${short}`}>
        {reading(
          row && !row.usageComplete ? (
            <Tooltip>
              <TooltipTrigger render={<span className="cursor-default" />}>
                <span className="sr-only">At least </span>
                {formatTokens(row.tokens.total)}
                <span aria-hidden className="text-muted-foreground">
                  +
                </span>
              </TooltipTrigger>
              <TooltipPopup side="top">
                Some runs did not report usage, so this is a floor.
              </TooltipPopup>
            </Tooltip>
          ) : (
            formatTokens(row?.tokens.total ?? 0)
          ),
        )}
      </LibraryVital>
    </>
  );
}

function RecordVitals({
  runs,
  loading,
}: {
  readonly runs: readonly BotRun[];
  readonly loading: boolean;
}) {
  const record = botRecord(runs);
  const scope = `last ${record.finished} ${record.finished === 1 ? "run" : "runs"}`;
  return (
    <>
      <LibraryVital label={record.finished ? `Passed · ${scope}` : "Passed"}>
        {loading ? (
          <Skeleton className="h-3.5 w-12" />
        ) : record.finished ? (
          <>
            {formatPercent(record.passed / record.finished, 0)}
            <span className="ms-1.5 text-xs font-normal text-muted-foreground">
              {record.passed} of {record.finished}
            </span>
          </>
        ) : (
          <Muted>No finished runs</Muted>
        )}
      </LibraryVital>
      <LibraryVital label={record.finished ? `Typical run · ${scope}` : "Typical run"}>
        {loading ? (
          <Skeleton className="h-3.5 w-12" />
        ) : (
          (record.typical ?? <Muted>Not measured</Muted>)
        )}
      </LibraryVital>
    </>
  );
}

/** Overview: what the bot is told and how it runs beside where it is wired up. */
function BotOverview({
  bot,
  newest,
}: {
  readonly bot: BotDefinition;
  readonly newest: NewestRuns;
}) {
  const { host } = useBots();
  return (
    <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-8">
        <NeedsYouBand bot={bot} />
        <BotBrief bot={bot} />
        <div className="grid items-start gap-x-8 gap-y-6 md:grid-cols-2">
          <LibrarySection title="Inputs" icon={TextCursorInputIcon} count={bot.parameters.length}>
            {bot.parameters.length ? (
              <LibrarySpecSheet
                label="Inputs"
                rows={bot.parameters.map((parameter) => ({
                  label: parameter.label,
                  value: parameterSummary(parameter),
                }))}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Runs without inputs: every run gets the same brief as written.
              </p>
            )}
          </LibrarySection>
          <LibrarySection title="Settings" icon={SlidersHorizontalIcon}>
            <BotSettings bot={bot} />
          </LibrarySection>
        </div>
        <BotRecentRuns bot={bot} newest={newest} />
      </div>
      <aside aria-label="About this bot" className="flex min-w-0 flex-col gap-4">
        {host.triggersSupported ? <BotTriggersAside bot={bot} /> : null}
        {host.pipelinesSupported ? <BotPipelinesAside bot={bot} /> : null}
        {host.budgetsSupported ? <BotUsageAside bot={bot} /> : null}
        {host.anywhereSupported ? <BotSharingAside bot={bot} /> : null}
      </aside>
    </div>
  );
}

/** Briefs can run to pages, so the Overview opens on their first lines. */
const BRIEF_MAX_LINES = 8;
const BRIEF_MAX_CHARS = 480;

function BotBrief({ bot }: { readonly bot: BotDefinition }) {
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const [open, setOpen] = useState(false);
  const long =
    bot.instructions.split("\n").length > BRIEF_MAX_LINES ||
    bot.instructions.length > BRIEF_MAX_CHARS;
  return (
    <LibrarySection
      title="Brief"
      icon={ScrollTextIcon}
      action={
        <div className="flex items-center gap-1">
          {long ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen((on) => !on)}
            >
              {open ? "Show less" : "Show all"}
            </Button>
          ) : null}
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!access.canSave}
            onClick={() => nav.open({ bot: bot.id, edit: true })}
          >
            <PencilIcon />
            Edit brief
          </Button>
        </div>
      }
    >
      <pre
        className={cn(
          "rounded-xl bg-muted/40 p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere dark:bg-accent/30",
          open ? "max-h-[70vh] overflow-auto" : "line-clamp-8",
        )}
      >
        {bot.instructions}
      </pre>
    </LibrarySection>
  );
}

const PARAMETER_TYPES: Record<BotParameter["type"], string> = {
  string: "Short text",
  text: "Long text",
  number: "Number",
  boolean: "Yes or no",
  choice: "Choice",
};

function parameterSummary(parameter: BotParameter) {
  const type =
    parameter.type === "choice" && parameter.choices
      ? `One of ${parameter.choices.length}`
      : PARAMETER_TYPES[parameter.type];
  return [
    type,
    parameter.required ? "required" : "optional",
    parameter.default ? `default ${parameter.default}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function budgetSummary(bot: BotDefinition) {
  const limits = [
    bot.budget?.runsPerDay === undefined
      ? null
      : `${formatCount(bot.budget.runsPerDay)} ${bot.budget.runsPerDay === 1 ? "run" : "runs"}`,
    bot.budget?.tokensPerDay === undefined
      ? null
      : `${formatTokens(bot.budget.tokensPerDay)} tokens`,
  ].filter(Boolean);
  return limits.length ? `${limits.join(" and ")} a day` : "Unlimited";
}

/** A bot's settings, the ones every run receives, as a spec sheet. */
function BotSettings({ bot }: { readonly bot: BotDefinition }) {
  const projects = useProjects();
  const projectTitle = (id: string | null) =>
    id === null ? null : (projects.find((project) => project.id === id)?.title ?? id);
  const draft = botDraft(bot);
  const workspaceProject =
    bot.workspace.type === "project" ? projectTitle(bot.workspace.projectId) : null;
  const rows = [
    { label: "Model", value: formatModelSlugName(bot.modelSelection.model) },
    { label: "Permissions", value: RUNTIME_MODE_LABELS[bot.runtimeMode] },
    { label: "Mode", value: bot.interactionMode === "plan" ? "Plan only" : "Do the work" },
    {
      label: "Runs in",
      value: `${WORKSPACE_LABELS[draft.workspace]}${
        bot.workspace.type === "project"
          ? `${draft.workspace === "checkout" ? ", in" : " of"} ${
              workspaceProject ?? "the project chosen at run time"
            }`
          : ""
      }`,
    },
    {
      label: "Answers with",
      value: bot.output === "verdict" ? "A verdict: pass, fail or needs attention" : "Text",
    },
    { label: "Time limit", value: `${bot.timeoutMinutes} minutes` },
    { label: "Runs at once", value: String(bot.maxConcurrentRuns) },
    { label: "Budget", value: budgetSummary(bot) },
    { label: "Available in", value: projectTitle(bot.scopeProjectId) ?? "Every project" },
    ...(bot.vaultSlots?.length
      ? [{ label: "Credentials", value: bot.vaultSlots.map((slot) => slot.label).join(", ") }]
      : []),
  ];
  return <LibrarySpecSheet label="Settings" rows={rows} />;
}

function BotRecentRuns({
  bot,
  newest,
}: {
  readonly bot: BotDefinition;
  readonly newest: NewestRuns;
}) {
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const archived = bot.archivedAt !== null;
  return (
    <LibrarySection
      title="Recent runs"
      icon={ActivityIcon}
      action={
        newest.runs.length ? (
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            onClick={() => nav.show({ bot: bot.id, tab: "runs" })}
          >
            All runs
          </Button>
        ) : null
      }
    >
      {newest.loading ? (
        <div role="status" aria-label="Loading runs" className="flex flex-col gap-2">
          {RUN_SKELETONS.map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      ) : newest.unavailable ? (
        <LibraryErrorNotice error={newest.query.error} onRetry={newest.query.refresh} />
      ) : newest.runs.length ? (
        <RunRows runs={newest.runs.slice(0, RECENT_RUNS)} showBot={false} />
      ) : (
        <LibraryEmpty
          icon={ActivityIcon}
          title={`${bot.name} has not run yet`}
          action={
            archived ? null : (
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                disabled={!access.canRun}
                onClick={() => nav.overlay({ run: bot.id })}
              >
                <PlayIcon />
                Run {bot.name}
              </Button>
            )
          }
        >
          Its runs, findings and replies collect here.
        </LibraryEmpty>
      )}
    </LibrarySection>
  );
}

const RUN_SKELETONS = ["first", "second", "third"];
