import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  CloudOffIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FlaskConicalIcon,
  ListFilterIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WorkflowIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_TRIGGER_FIRINGS_MAX_LIMIT,
  type BotDefinition,
  type BotTrigger,
  type BotTriggerEventKind,
  type BotTriggerFiring,
} from "@t3tools/contracts/fork";
import {
  applyFiringChanges,
  applyTriggerChanges,
  botColor,
  TRIGGER_KIND_LABELS,
  type BotTriggerChanges,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { toastManager } from "~/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LIBRARY_ROW,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryFilterChip,
  LibraryGroupHeading,
  LibraryNotice,
  LibrarySearch,
  LibrarySpecSheet,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import {
  LIBRARY_ROW_TARGET,
  LIBRARY_TABLE_ROW,
  TickStrip,
  type LibraryTick,
} from "../project-library/LibraryData";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BotTile, runTime } from "./BotIdentity";
import {
  ReasonTooltip,
  TRIGGER_KIND_ICONS,
  TriggerKindTile,
  TriggerWizard,
  triggerOperateReason,
} from "./BotTriggerEditor";
import { botsPageOf, useBotsNavigation, type BotsPageSearch } from "./navigation";
import { bots, useBots, useBotsAccess, useBotTriggerChanges, usePipelines } from "./state";
import {
  filterTriggers,
  firingActivity,
  initialTestFields,
  limitsPhrase,
  mappingLines,
  maskWebhookAddress,
  newestFiredAt,
  newTestField,
  spanAhead,
  testFieldsInput,
  TRIGGER_KINDS,
  triggerAgenda,
  triggerVersion,
  triggerWhen,
  type TestField,
  type TriggerStateFilter,
} from "./triggerDraft";

/** The first page of a trigger's firings. Rows and the sheet ask with the same input, so they share it. */
const FIRINGS_PAGE = Math.min(20, BOTS_TRIGGER_FIRINGS_MAX_LIMIT);
const ROW_TICKS = 12;
const SHEET_TICKS = 30;
const EMPTY_TICK_KEYS = Array.from({ length: SHEET_TICKS }, (_, slot) => `empty-${slot}`);
const SKELETON_ROWS = ["first", "second", "third"];

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const byName = (left: { readonly name: string }, right: { readonly name: string }) =>
  left.name.localeCompare(right.name);

function useNowMs() {
  return Date.parse(`${useNowMinute()}:00Z`);
}

/** Changes missed while the host was away never arrive, so a reconnect refetches. */
function useRefreshOnReconnect(connected: boolean, refresh: () => void) {
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
}

/**
 * Every trigger on the host, with watched changes applied. The index, the aside, the sheet and the
 * editor all read this one list, so a change made in one shows in the others at once.
 */
function useTriggerData() {
  const { host, live, bots: allBots, list: botList } = useBots();
  const { canOperateTriggers, canSave, canRun } = useBotsAccess();
  const environmentId = host.environmentId;
  const enabled = Boolean(environmentId && live && host.triggersSupported);
  const changes = useBotTriggerChanges(environmentId, enabled && host.connected);
  const list = useEnvironmentQuery(
    environmentId && enabled ? bots.listTriggers({ environmentId, input: {} }) : null,
  );
  const { pipelines, list: pipelineList } = usePipelines(
    environmentId,
    live && host.pipelinesSupported,
    host.connected,
  );
  useRefreshOnReconnect(host.connected, list.refresh);
  const projects = useProjects();
  const hostLabel = host.environment?.label ?? "The bots computer";
  return {
    host,
    environmentId,
    enabled,
    hostLabel,
    changes,
    list,
    loading: list.isPending && !list.data,
    triggers: applyTriggerChanges(list.data?.triggers ?? [], changes),
    allBots,
    botsLoading: botList.isPending && !botList.data,
    pipelines,
    pipelinesLoading: host.pipelinesSupported && pipelineList.isPending && !pipelineList.data,
    canOperate: canOperateTriggers,
    /** The page already says when a connection can neither run nor change bots. */
    pageReadOnly: !canSave && !canRun,
    operateReason: triggerOperateReason({
      connected: host.connected,
      canOperate: canOperateTriggers,
      hostLabel,
    }),
    botOf: (botId: string) => allBots.find((bot) => bot.id === botId),
    pipelineOf: (pipelineId: string | null | undefined) =>
      pipelineId == null ? undefined : pipelines.find((pipeline) => pipeline.id === pipelineId),
    projectTitle: (id: string) =>
      projects.find((project) => project.id === id)?.title ?? "a removed project",
  };
}

type TriggerData = ReturnType<typeof useTriggerData>;

/**
 * The newest page of firings, with watched ones in front. A trigger's `lastFiredAt` moving past the
 * page means firings arrived while the watch was down, so the page is fetched again, once.
 */
function useFirstFirings(
  environmentId: EnvironmentId | null,
  trigger: BotTrigger,
  changes: BotTriggerChanges,
  enabled: boolean,
) {
  const query = useEnvironmentQuery(
    environmentId && enabled
      ? bots.triggerFirings({
          environmentId,
          input: { triggerId: trigger.id, limit: FIRINGS_PAGE },
        })
      : null,
  );
  const firings = applyFiringChanges(query.data?.firings ?? [], changes, trigger.id);
  const newest = newestFiredAt(firings);
  const lastFiredAt = trigger.lastFiredAt;
  const behind =
    enabled &&
    query.data !== null &&
    lastFiredAt !== null &&
    (newest === null || lastFiredAt > newest);
  const asked = useRef<string | null>(null);
  const { refresh } = query;
  useEffect(() => {
    if (!behind || asked.current === lastFiredAt) return;
    asked.current = lastFiredAt;
    refresh();
  }, [behind, lastFiredAt, refresh]);
  return { query, firings };
}

/** What a trigger runs, by name: its bot and version, or its pipeline. Never a raw id. */
function runsLabel(data: TriggerData, trigger: BotTrigger) {
  if (trigger.pipelineId != null)
    return `Starts ${data.pipelineOf(trigger.pipelineId)?.name ?? "a deleted pipeline"}`;
  const bot = data.botOf(trigger.botId);
  const version = triggerVersion(trigger, bot);
  return `Runs ${bot?.name ?? "a deleted bot"}${version ? ` · ${version.short}` : ""}`;
}

/** When a schedule fires next, or what a trigger that waits for something accepts. */
function nextLabel(data: TriggerData, trigger: BotTrigger, now: number) {
  if (!trigger.enabled) return "Paused";
  if (trigger.event.kind === "webhook")
    return trigger.event.signature ? "Signed requests only" : "Any request to its address";
  if (trigger.event.kind !== "schedule") return limitsPhrase(trigger);
  const at = trigger.nextFireAt ? Date.parse(trigger.nextFireAt) : Number.NaN;
  if (!Number.isFinite(at)) return "Not scheduled";
  if (at - now <= 60_000)
    return data.host.connected ? "Due now" : `Due when ${data.hostLabel} reconnects`;
  return `Next ${runTime(trigger.nextFireAt ?? null, now)}, in ${spanAhead(at - now)}`;
}

function TriggerEnabledSwitch({
  environmentId,
  trigger,
  reason,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly reason: string | null;
}) {
  const setEnabled = useAtomCommand(bots.setTriggerEnabled, { reportFailure: false });
  // The list hears of the change through the watch, which can lag the reply, so the switch holds
  // the asked-for state until the list's copy is at least as new as the saved one.
  const [asked, setAsked] = useState<{
    readonly enabled: boolean;
    readonly savedAt: string | null;
  } | null>(null);
  const pending = asked !== null && asked.savedAt === null;
  const checked =
    asked !== null && (asked.savedAt === null || trigger.updatedAt < asked.savedAt)
      ? asked.enabled
      : trigger.enabled;
  const toggle = async (enabled: boolean) => {
    setAsked({ enabled, savedAt: null });
    const result = await setEnabled({ environmentId, input: { triggerId: trigger.id, enabled } });
    if (result._tag === "Success") {
      setAsked({ enabled, savedAt: result.value.updatedAt });
      return;
    }
    setAsked(null);
    toastManager.add({
      type: "error",
      title: enabled ? `Could not turn on ${trigger.name}` : `Could not pause ${trigger.name}`,
      description: errorText(squashAtomCommandFailure(result), "Try again."),
    });
  };
  return (
    <ReasonTooltip reason={reason}>
      <Switch
        aria-label={`${trigger.name} is on`}
        checked={checked}
        disabled={reason !== null || pending}
        onCheckedChange={(enabled) => void toggle(enabled)}
      />
    </ReasonTooltip>
  );
}

/** Ticks for the newest firings, oldest first, padded so a short history still reads as a track. */
function firingTicks(firings: readonly BotTriggerFiring[], count: number, now: number) {
  const shown = firings.slice(0, count).toReversed();
  const ticks: LibraryTick[] = [
    ...EMPTY_TICK_KEYS.slice(0, count - shown.length).map((key) => ({ key, tone: null })),
    ...shown.map((firing) => ({
      key: firing.id,
      tone: firing.outcome === "run" ? ("success" as const) : ("neutral" as const),
      label: `${firing.outcome === "run" ? "Ran" : "Skipped"} ${runTime(firing.firedAt, now) ?? ""}: ${firing.eventSummary}`,
    })),
  ];
  return { ticks, shown, padding: count - shown.length };
}

function NewTriggerMenu({ data }: { readonly data: TriggerData }) {
  const nav = useBotsNavigation();
  const runnable = data.allBots.filter((bot) => bot.archivedAt === null).toSorted(byName);
  const pipelines = data.host.pipelinesSupported
    ? data.pipelines
        .filter((pipeline) => {
          const first = pipeline.steps[0] ? data.botOf(pipeline.steps[0].botId) : undefined;
          return first !== undefined && first.archivedAt === null;
        })
        .toSorted(byName)
    : [];
  const reason =
    data.operateReason ??
    (runnable.length === 0 ? "Add a bot first. A trigger starts a bot or a pipeline." : null);
  return (
    <ReasonTooltip reason={reason}>
      <Menu>
        <MenuTrigger disabled={reason !== null} render={<Button shape="pill" size="sm" />}>
          <PlusIcon />
          New trigger
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup side="bottom" align="end">
          <MenuGroup>
            <MenuGroupLabel>Run a bot</MenuGroupLabel>
            {runnable.map((bot) => (
              <MenuItem key={bot.id} onClick={() => nav.overlay({ newTrigger: bot.id })}>
                <BotTile bot={bot} size="sm" />
                {bot.name}
              </MenuItem>
            ))}
          </MenuGroup>
          {pipelines.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>Start a pipeline</MenuGroupLabel>
                {pipelines.map((pipeline) => (
                  <MenuItem
                    key={pipeline.id}
                    onClick={() =>
                      nav.overlay({
                        newTrigger: pipeline.steps[0]?.botId,
                        triggerPipeline: pipeline.id,
                      })
                    }
                  >
                    <WorkflowIcon />
                    {pipeline.name}
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </ReasonTooltip>
  );
}

function KindFilterMenu({
  counts,
  kinds,
  onToggle,
}: {
  readonly counts: readonly { readonly kind: BotTriggerEventKind; readonly count: number }[];
  readonly kinds: ReadonlySet<BotTriggerEventKind>;
  readonly onToggle: (kind: BotTriggerEventKind) => void;
}) {
  if (counts.length < 2 && kinds.size === 0) return null;
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
        <ListFilterIcon />
        Kind
        {kinds.size > 0 ? (
          <span className="tabular-nums text-muted-foreground">{kinds.size}</span>
        ) : null}
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        <MenuGroup>
          <MenuGroupLabel>Show only</MenuGroupLabel>
          {counts.map(({ kind, count }) => {
            const Icon = TRIGGER_KIND_ICONS[kind];
            return (
              <MenuCheckboxItem
                key={kind}
                checked={kinds.has(kind)}
                onCheckedChange={() => onToggle(kind)}
              >
                <span className="flex w-full items-center gap-2">
                  <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                  <span className="flex-1">{TRIGGER_KIND_LABELS[kind]}</span>
                  <span className="ps-4 text-xs tabular-nums text-muted-foreground">{count}</span>
                </span>
              </MenuCheckboxItem>
            );
          })}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * When a trigger last started work, apart from the firings its limits skipped. The trigger's own
 * `lastFiredAt` counts skips, so it alone would show a held-back trigger as having just run.
 */
function TriggerActivity({
  data,
  trigger,
  now,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
  readonly now: number;
}) {
  const fired = trigger.lastFiredAt !== null;
  const { query, firings } = useFirstFirings(data.environmentId, trigger, data.changes, fired);
  if (!fired) return <p className="text-xs text-muted-foreground">Never fired</p>;
  if (firings.length === 0 && query.error)
    return <p className="text-xs text-muted-foreground">Firings did not load</p>;
  if (firings.length === 0)
    return (
      <div className="grid gap-1.5" role="status" aria-label="Loading firings">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
    );
  const activity = firingActivity(firings);
  const { ticks } = firingTicks(firings, ROW_TICKS, now);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="hidden shrink-0 lg:inline-flex">
        <TickStrip
          ticks={ticks}
          label={`Of the last ${Math.min(firings.length, ROW_TICKS)} firings, ${activity.ran} ran and ${activity.skipped} were skipped`}
        />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs">
          {activity.lastRun ? `Ran ${runTime(activity.lastRun.firedAt, now)}` : "No runs yet"}
        </p>
        {activity.lastSkip && activity.skippedSinceRun > 0 ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <LibraryStateDot tone="warning" className="size-1.5" />
            <span className="truncate">
              Skipped {runTime(activity.lastSkip.firedAt, now)}
              {activity.skippedSinceRun > 1 ? `, ${activity.skippedSinceRun} times since` : ""}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_auto]";

function AgendaRow({
  data,
  trigger,
  page,
  now,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
  readonly page: BotsPageSearch;
  readonly now: number;
}) {
  const bot = data.botOf(trigger.botId);
  const version = triggerVersion(trigger, bot);
  const KindIcon = TRIGGER_KIND_ICONS[trigger.event.kind];
  return (
    <li
      className={cn(LIBRARY_TABLE_ROW, ROW_GRID)}
      style={projectColorStyle(botColor({ id: trigger.botId }))}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("inline-flex", !trigger.enabled && "opacity-50")}>
          <BotTile bot={bot ?? { id: trigger.botId }} size="md" />
        </span>
        <div className="min-w-0">
          <Link
            to="/loom/bots"
            search={{ ...page, trigger: trigger.id }}
            replace
            className={cn(
              LIBRARY_ROW_TARGET,
              "block truncate text-sm font-medium",
              !trigger.enabled && "text-muted-foreground",
            )}
          >
            {trigger.name}
          </Link>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{runsLabel(data, trigger)}</span>
            {version?.outdated ? (
              <>
                <LibraryStateDot tone="warning" className="size-1.5" />
                <span className="sr-only">A newer version of the bot was saved since.</span>
              </>
            ) : null}
            {bot?.archivedAt ? <span className="shrink-0">· archived</span> : null}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 items-start gap-2 max-md:col-start-1 max-md:ps-11">
        <KindIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm">{triggerWhen(trigger.event, data.projectTitle)}</p>
          <p className="truncate text-xs text-muted-foreground">{nextLabel(data, trigger, now)}</p>
        </div>
      </div>
      <div className="min-w-0 max-md:col-start-1 max-md:ps-11">
        <TriggerActivity data={data} trigger={trigger} now={now} />
      </div>
      <div className="relative z-10 flex items-center justify-end max-md:col-start-2 max-md:row-start-1">
        {data.environmentId ? (
          <TriggerEnabledSwitch
            environmentId={data.environmentId}
            trigger={trigger}
            reason={data.operateReason}
          />
        ) : null}
      </div>
    </li>
  );
}

function AgendaGroup({
  title,
  hint,
  triggers,
  data,
  page,
  now,
}: {
  readonly title: string;
  readonly hint: string;
  readonly triggers: readonly BotTrigger[];
  readonly data: TriggerData;
  readonly page: BotsPageSearch;
  readonly now: number;
}) {
  if (triggers.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <LibraryGroupHeading title={title} count={triggers.length} hint={hint} />
      <ul className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}>
        {triggers.map((trigger) => (
          <AgendaRow key={trigger.id} data={data} trigger={trigger} page={page} now={now} />
        ))}
      </ul>
    </section>
  );
}

function AgendaSkeleton() {
  return (
    <div role="status" aria-label="Loading triggers" className="flex flex-col gap-2.5">
      <Skeleton className="h-4 w-24" />
      <div className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}>
        {SKELETON_ROWS.map((row) => (
          <div key={row} className={ROW_GRID}>
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton shape="card" className="size-8" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="hidden gap-1.5 md:grid">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="hidden h-3 w-24 md:block" />
            <Skeleton shape="pill" className="h-4 w-7" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A connection that may run or change bots can still be barred from triggers. The page's own
 * notices cover a host that is offline or a connection that can do neither.
 */
function ReadOnlyNotice({ data }: { readonly data: TriggerData }) {
  if (!data.host.connected || data.canOperate || data.pageReadOnly) return null;
  return (
    <LibraryNotice icon={LockIcon}>
      This connection can see triggers but not add, change or pause them.
    </LibraryNotice>
  );
}

/** The index's Triggers view: an agenda of what runs on its own, across every bot. */
export function TriggersView() {
  const data = useTriggerData();
  const nav = useBotsNavigation();
  const now = useNowMs();
  const [search, setSearch] = useState("");
  const [kinds, setKinds] = useState<ReadonlySet<BotTriggerEventKind>>(() => new Set());
  const [state, setState] = useState<TriggerStateFilter>("all");
  if (!data.enabled)
    return (
      <LibraryNotice icon={ZapIcon}>
        {data.hostLabel} runs a version of Loom without triggers. Update it to use them.
      </LibraryNotice>
    );

  const page = botsPageOf(nav.search);
  const triggers = data.triggers;
  const words = (trigger: BotTrigger) =>
    [
      runsLabel(data, trigger),
      triggerWhen(trigger.event, data.projectTitle),
      TRIGGER_KIND_LABELS[trigger.event.kind],
    ].join(" ");
  const visible = filterTriggers(triggers, { search, kinds, state }, words);
  const agenda = triggerAgenda(visible);
  const kindCounts = TRIGGER_KINDS.flatMap((kind) => {
    const count = triggers.filter((trigger) => trigger.event.kind === kind).length;
    return count > 0 ? [{ kind, count }] : [];
  });
  const onCount = triggers.filter((trigger) => trigger.enabled).length;
  const toggleKind = (kind: BotTriggerEventKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  const clearFilters = () => {
    setSearch("");
    setKinds(new Set());
    setState("all");
  };

  return (
    <section aria-label="Triggers" className="flex flex-col gap-5">
      {triggers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <LibrarySearch
            value={search}
            onChange={setSearch}
            placeholder="Search triggers, bots and pipelines"
            label="Search triggers"
          />
          <KindFilterMenu counts={kindCounts} kinds={kinds} onToggle={toggleKind} />
          {[...kinds].map((kind) => {
            const Icon = TRIGGER_KIND_ICONS[kind];
            return (
              <LibraryFilterChip
                key={kind}
                label={TRIGGER_KIND_LABELS[kind]}
                removeLabel={`Stop showing only ${TRIGGER_KIND_LABELS[kind].toLowerCase()} triggers`}
                marker={<Icon aria-hidden />}
                onRemove={() => toggleKind(kind)}
              />
            );
          })}
          <div className="ms-auto flex items-center gap-2">
            <ToggleGroup
              shape="pill"
              variant="segmented"
              aria-label="Which triggers"
              value={[state]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "all" || next === "on" || next === "paused") setState(next);
              }}
            >
              <ToggleGroupItem value="all">
                All <span className="tabular-nums opacity-60">{triggers.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="on">
                On <span className="tabular-nums opacity-60">{onCount}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="paused">
                Paused <span className="tabular-nums opacity-60">{triggers.length - onCount}</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <NewTriggerMenu data={data} />
          </div>
        </div>
      ) : null}
      <ReadOnlyNotice data={data} />
      <LibraryErrorNotice error={data.list.error} onRetry={data.list.refresh} />
      {data.loading ? (
        data.host.connected ? (
          <AgendaSkeleton />
        ) : (
          <LibraryNotice icon={CloudOffIcon}>
            Triggers show once {data.hostLabel} is back.
          </LibraryNotice>
        )
      ) : triggers.length === 0 ? (
        data.list.error ? null : (
          <LibraryEmpty
            icon={ZapIcon}
            title="Nothing runs on its own yet"
            action={<NewTriggerMenu data={data} />}
          >
            A trigger starts a bot or a pipeline on a schedule, from a webhook, or when a pull
            request or thread changes.
          </LibraryEmpty>
        )
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <Empty size="compact">
            <EmptyHeader>
              <EmptyTitle>No triggers match</EmptyTitle>
              <EmptyDescription>
                Search looks at trigger names, what they run and when they fire.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button shape="pill" size="sm" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          <AgendaGroup
            title="Next up"
            hint="Schedules, soonest first"
            triggers={agenda.nextUp}
            data={data}
            page={page}
            now={now}
          />
          <AgendaGroup
            title="On demand"
            hint="Webhooks and events, most recently fired first"
            triggers={agenda.onDemand}
            data={data}
            page={page}
            now={now}
          />
        </div>
      )}
    </section>
  );
}

function AsideRow({
  data,
  trigger,
  page,
  now,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
  readonly page: BotsPageSearch;
  readonly now: number;
}) {
  const next =
    trigger.enabled && trigger.event.kind === "schedule" && trigger.nextFireAt
      ? Date.parse(trigger.nextFireAt) - now
      : Number.NaN;
  const when = !trigger.enabled
    ? "Paused"
    : !Number.isFinite(next)
      ? null
      : next <= 60_000
        ? "Due"
        : `in ${spanAhead(next)}`;
  return (
    <li className={cn(LIBRARY_ROW, "relative flex min-w-0 items-center gap-2.5 py-1.5")}>
      <TriggerKindTile kind={trigger.event.kind} size="sm" muted={!trigger.enabled} />
      <div className="min-w-0 flex-1">
        <Link
          to="/loom/bots"
          search={{ ...page, trigger: trigger.id }}
          replace
          className={cn(
            LIBRARY_ROW_TARGET,
            "block truncate text-xs font-medium",
            !trigger.enabled && "text-muted-foreground",
          )}
        >
          {trigger.name}
        </Link>
        <p className="truncate text-2xs text-muted-foreground">
          {trigger.pipelineId != null
            ? runsLabel(data, trigger)
            : triggerWhen(trigger.event, data.projectTitle)}
        </p>
      </div>
      {when ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{when}</span>
      ) : null}
    </li>
  );
}

/** A bot's triggers, for the aside of its Overview, with the way to add one. */
export function BotTriggersAside({ bot }: { readonly bot: BotDefinition }) {
  const data = useTriggerData();
  const nav = useBotsNavigation();
  const now = useNowMs();
  if (!data.enabled) return null;
  const { nextUp, onDemand } = triggerAgenda(
    data.triggers.filter((trigger) => trigger.botId === bot.id),
  );
  const mine = [...nextUp, ...onDemand];
  const reason =
    bot.archivedAt !== null ? `Restore ${bot.name} to add triggers.` : data.operateReason;
  const page = botsPageOf(nav.search);
  return (
    <section aria-label="Triggers" className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-1.5 text-sm font-semibold tracking-tight">
          Triggers
          {mine.length > 0 ? (
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {mine.length}
            </span>
          ) : null}
        </h2>
        <ReasonTooltip reason={reason}>
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={reason !== null}
            onClick={() => nav.overlay({ newTrigger: bot.id })}
          >
            <PlusIcon />
            Add trigger
          </Button>
        </ReasonTooltip>
      </div>
      <LibraryErrorNotice error={data.list.error} onRetry={data.list.refresh} />
      {data.loading && !data.host.connected ? (
        <p className="py-1 text-xs text-muted-foreground">
          Triggers show once {data.hostLabel} is back.
        </p>
      ) : data.loading ? (
        <div role="status" aria-label="Loading triggers" className="grid gap-2.5 py-1.5">
          {SKELETON_ROWS.slice(0, 2).map((row) => (
            <div key={row} className="flex items-center gap-2.5">
              <Skeleton shape="card" className="size-6" />
              <div className="grid flex-1 gap-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : mine.length === 0 ? (
        data.list.error ? null : (
          <p className="py-1 text-xs text-muted-foreground">Runs only when someone starts it.</p>
        )
      ) : (
        <ul className="flex flex-col">
          {mine.map((trigger) => (
            <AsideRow key={trigger.id} data={data} trigger={trigger} page={page} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SheetHeading({ title, aside }: { readonly title: string; readonly aside?: ReactNode }) {
  return (
    <div className="flex min-h-7 min-w-0 items-center justify-between gap-3">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {aside}
    </div>
  );
}

function WebhookAddressSection({
  data,
  trigger,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
}) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(data.environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "trigger address" });
  const rotate = useAtomCommand(bots.rotateTriggerToken, { reportFailure: false });
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The new address comes back in the reply, before the list hears of it, and the old one must
  // not be shown or copied once it stops working.
  const [rotated, setRotated] = useState<BotTrigger | null>(null);
  const endpoint =
    rotated !== null && rotated.updatedAt > trigger.updatedAt ? rotated.webhook : trigger.webhook;
  const address = endpoint ? webhookAddress(endpoint, httpBaseUrl) : null;
  const signature = trigger.event.kind === "webhook" ? trigger.event.signature : undefined;
  const rotateAddress = async () => {
    if (!data.environmentId) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Give ${trigger.name} a new address? The current one stops working, so whatever sends to it needs the new one.`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const result = await rotate({
      environmentId: data.environmentId,
      input: { triggerId: trigger.id },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setError(errorText(squashAtomCommandFailure(result), "Could not change the address."));
      return;
    }
    setRotated(result.value);
    setShown(true);
  };
  return (
    <section aria-label="Address" className="flex flex-col gap-2">
      <SheetHeading title="Address" />
      {address === null ? (
        <p className="text-xs text-muted-foreground">
          Only a connection that can change triggers sees the address.
        </p>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {/* Selects in one click, so an address that cannot be copied can be taken by hand. */}
            <code
              aria-label={`${trigger.name} address`}
              className="min-w-0 flex-1 basis-64 select-all rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-xs break-all text-foreground/90 dark:bg-accent/60"
            >
              {shown ? address.address : maskWebhookAddress(address.address)}
            </code>
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              aria-pressed={shown}
              onClick={() => setShown((open) => !open)}
            >
              {shown ? <EyeOffIcon /> : <EyeIcon />}
              {shown ? "Hide" : "Show"}
            </Button>
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!address.copyable}
              onClick={() => copyToClipboard(address.address, undefined)}
            >
              <CopyIcon />
              {isCopied ? "Copied" : "Copy"}
            </Button>
            <ReasonTooltip reason={data.operateReason}>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                disabled={busy || data.operateReason !== null}
                onClick={() => void rotateAddress()}
              >
                <RotateCwIcon />
                {busy ? "Changing…" : "New address"}
              </Button>
            </ReasonTooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            {address.note ??
              "The end of the address is its key: anyone who has it can fire the trigger."}
          </p>
        </>
      )}
      {trigger.event.kind === "merge-conflict" ? (
        <p className="text-xs text-muted-foreground">
          Set <span className="font-mono text-foreground">LOOM_BOTS_CONFLICT_HOOK</span> to this
          address before running the fork integrate script.
        </p>
      ) : (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <LibraryStateDot
            tone={signature ? (endpoint?.hasSecret === false ? "danger" : "success") : "neutral"}
            className="mt-1 size-1.5"
          />
          <span>
            {signature
              ? endpoint?.hasSecret === false
                ? "The signature check is on but no secret is stored, so every request is refused. Add the secret in Edit."
                : `Requests must be signed, in ${signature.header}.`
              : "Any request to the address fires it. Turn on a signature check in Edit."}
          </span>
        </p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function FiringRow({
  firing,
  pipelineId,
  now,
}: {
  readonly firing: BotTriggerFiring;
  readonly pipelineId: string | null;
  readonly now: number;
}) {
  const nav = useBotsNavigation();
  const ran = firing.outcome === "run";
  const runId = firing.runId;
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-1.5">
      <span className="truncate text-xs tabular-nums text-muted-foreground">
        {runTime(firing.firedAt, now)}
      </span>
      <span className="truncate text-sm">{firing.eventSummary}</span>
      <span className="flex items-center justify-end gap-1">
        {runId ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={() => nav.overlay({ runId })}>
            Open run
          </Button>
        ) : ran && pipelineId !== null ? (
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            render={<Link to="/loom/bots" search={{ pipeline: pipelineId }} />}
          >
            Open pipeline
          </Button>
        ) : null}
        <LibraryStateBadge tone={ran ? "success" : "neutral"}>
          {ran ? "Ran" : "Skipped"}
        </LibraryStateBadge>
      </span>
      {firing.reason ? (
        <span className="col-span-2 col-start-2 text-xs text-muted-foreground">
          {firing.reason}
        </span>
      ) : null}
    </li>
  );
}

function OlderFirings({
  environmentId,
  trigger,
  before,
  last,
  now,
  onMore,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly before: string;
  readonly last: boolean;
  readonly now: number;
  readonly onMore: (before: string) => void;
}) {
  const query = useEnvironmentQuery(
    bots.triggerFirings({
      environmentId,
      input: { triggerId: trigger.id, before, limit: BOTS_TRIGGER_FIRINGS_MAX_LIMIT },
    }),
  );
  if (query.error)
    return (
      <li className="py-1.5">
        <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      </li>
    );
  if (!query.data)
    return (
      <li className="py-2" role="status" aria-label="Loading older firings">
        <Skeleton className="h-3 w-48" />
      </li>
    );
  const oldest = query.data.firings.at(-1);
  return (
    <>
      {query.data.firings.map((firing) => (
        <FiringRow
          key={firing.id}
          firing={firing}
          pipelineId={trigger.pipelineId ?? null}
          now={now}
        />
      ))}
      {last && query.data.hasMore && oldest ? (
        <li className="py-1.5">
          <Button shape="pill" size="xs" variant="ghost" onClick={() => onMore(oldest.firedAt)}>
            Load older
          </Button>
        </li>
      ) : null}
    </>
  );
}

function FiringsSection({
  data,
  trigger,
  now,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
  readonly now: number;
}) {
  const nav = useBotsNavigation();
  const { query, firings } = useFirstFirings(data.environmentId, trigger, data.changes, true);
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const activity = firingActivity(firings);
  const { ticks, shown, padding } = firingTicks(firings, SHEET_TICKS, now);
  const pipelineId = trigger.pipelineId ?? null;
  const oldest = firings.at(-1);
  const environmentId = data.environmentId;
  return (
    <section aria-label="Firings" className="flex flex-col gap-2">
      <SheetHeading
        title="Firings"
        aside={
          firings.length > 0 ? (
            <p className="text-xs tabular-nums text-muted-foreground">
              {activity.ran} ran, {activity.skipped} skipped of the last {firings.length}
            </p>
          ) : null
        }
      />
      {firings.length === 0 && query.error ? (
        <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      ) : firings.length === 0 && !query.data ? (
        <div role="status" aria-label="Loading firings" className="grid gap-2.5 py-1.5">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton shape="pill" className="h-5 w-14" />
            </div>
          ))}
        </div>
      ) : firings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          It has not fired yet.
          {trigger.enabled && trigger.event.kind === "schedule" && trigger.nextFireAt
            ? ` Its first firing is ${runTime(trigger.nextFireAt ?? null, now)}.`
            : null}
        </p>
      ) : (
        <>
          <TickStrip
            ticks={ticks}
            size="fill"
            label={`The last ${shown.length} firings, oldest first. ${activity.ran} ran and ${activity.skipped} were skipped.`}
            onSelectTick={(index) => {
              const runId = shown[index - padding]?.runId;
              if (runId) nav.overlay({ runId });
            }}
          />
          <ol className="flex flex-col divide-y divide-border">
            {firings.map((firing) => (
              <FiringRow key={firing.id} firing={firing} pipelineId={pipelineId} now={now} />
            ))}
            {environmentId
              ? cursors.map((before, index) => (
                  <OlderFirings
                    key={before}
                    environmentId={environmentId}
                    trigger={trigger}
                    before={before}
                    last={index === cursors.length - 1}
                    now={now}
                    onMore={(next) => setCursors((current) => [...current, next])}
                  />
                ))
              : null}
          </ol>
          {cursors.length === 0 && query.data?.hasMore && oldest ? (
            <div>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                onClick={() => setCursors([oldest.firedAt])}
              >
                Load older
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function TestFieldRow({
  field,
  onChange,
  onRemove,
}: {
  readonly field: TestField;
  readonly onChange: (patch: Partial<TestField>) => void;
  readonly onRemove: () => void;
}) {
  const label = field.name.trim() || "New field";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center">
      <Input
        aria-label="Field name"
        font="mono"
        size="sm"
        placeholder="body.number"
        value={field.name}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <div className="max-sm:col-start-1 max-sm:row-start-2">
        {field.type === "boolean" ? (
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label={`${label} value`}
            value={[field.value === "true" ? "true" : "false"]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "true" || next === "false") onChange({ value: next });
            }}
          >
            <ToggleGroupItem value="true">Yes</ToggleGroupItem>
            <ToggleGroupItem value="false">No</ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <Input
            aria-label={`${label} value`}
            size="sm"
            inputMode={field.type === "number" ? "decimal" : undefined}
            placeholder={field.type === "number" ? "A number" : "Value"}
            value={field.value}
            onChange={(event) => onChange({ value: event.target.value })}
          />
        )}
      </div>
      <Button
        shape="pill"
        size="icon-xs"
        variant="ghost"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </li>
  );
}

function TestFiringSection({
  data,
  trigger,
  target,
  now,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
  readonly target: Pick<BotDefinition, "name" | "parameters"> | undefined;
  readonly now: number;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(() =>
    initialTestFields(trigger, target ?? { parameters: [] }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BotTriggerFiring | null>(null);
  const test = useAtomCommand(bots.testTrigger, { reportFailure: false });
  const reason = target === undefined ? "What this trigger runs was deleted." : data.operateReason;
  const fire = async () => {
    if (!data.environmentId || reason !== null) return;
    const input = testFieldsInput(fields);
    if ("error" in input) {
      setError(input.error);
      return;
    }
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Fire ${trigger.name} once? It skips the trigger's filters and limits, and starts a real run of ${target?.name ?? "its target"}.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const fired = await test({
      environmentId: data.environmentId,
      input: { triggerId: trigger.id, fields: input.fields },
    });
    setBusy(false);
    if (fired._tag === "Failure") {
      setError(errorText(squashAtomCommandFailure(fired), "Could not fire the trigger."));
      return;
    }
    setResult(fired.value);
  };
  const change = (key: string, patch: Partial<TestField>) => {
    setError(null);
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    );
  };
  return (
    <section aria-label="Test firing" className="flex flex-col gap-2">
      <SheetHeading
        title="Test firing"
        aside={
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen((shown) => !shown)}
          >
            <FlaskConicalIcon />
            {open ? "Hide" : "Set up a test"}
          </Button>
        }
      />
      {open ? (
        <>
          <p className="text-xs text-muted-foreground">
            Fires once with these fields, past the trigger&apos;s filters and limits. It starts a
            real run.
          </p>
          {fields.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {fields.map((field) => (
                <TestFieldRow
                  key={field.key}
                  field={field}
                  onChange={(patch) => change(field.key, patch)}
                  onRemove={() =>
                    setFields((current) => current.filter((item) => item.key !== field.key))
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No fields, so it fires with an empty event.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              onClick={() => setFields((current) => [...current, newTestField()])}
            >
              <PlusIcon />
              Add field
            </Button>
            <ReasonTooltip reason={reason}>
              <Button
                shape="pill"
                size="sm"
                disabled={busy || reason !== null}
                onClick={() => void fire()}
              >
                <ZapIcon />
                {busy ? "Firing…" : "Fire once"}
              </Button>
            </ReasonTooltip>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive-foreground">
              {error}
            </p>
          ) : null}
          {result ? (
            <ol aria-label="Test result" className="flex flex-col">
              <FiringRow firing={result} pipelineId={trigger.pipelineId ?? null} now={now} />
            </ol>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function TriggerSheet({
  data,
  trigger,
}: {
  readonly data: TriggerData;
  readonly trigger: BotTrigger;
}) {
  const nav = useBotsNavigation();
  const now = useNowMs();
  const remove = useAtomCommand(bots.deleteTrigger, { reportFailure: false });
  const repin = useAtomCommand(bots.repinTrigger, { reportFailure: false });
  const [repinning, setRepinning] = useState(false);
  const [repinError, setRepinError] = useState<string | null>(null);
  /** When the repin was saved, so the notice stays gone until the list catches up. */
  const [repinnedAt, setRepinnedAt] = useState<string | null>(null);
  const bot = data.botOf(trigger.botId);
  const isPipeline = trigger.pipelineId != null;
  const target = isPipeline ? data.pipelineOf(trigger.pipelineId) : bot;
  const targetLoading = isPipeline ? data.pipelinesLoading : data.botsLoading;
  const version = triggerVersion(trigger, bot);
  const when = triggerWhen(trigger.event, data.projectTitle);
  const signature = trigger.event.kind === "webhook" ? trigger.event.signature : undefined;
  const editReason =
    target === undefined
      ? isPipeline
        ? "The pipeline it starts was deleted."
        : "The bot it runs was deleted."
      : data.operateReason;

  // The sheet closes as the delete goes out, so it never shows the trigger as missing while the
  // reply is on its way; a failure comes back as a toast.
  const deleteTrigger = async () => {
    const environmentId = data.environmentId;
    if (!environmentId) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete ${trigger.name}? Its address and firing history go with it.`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    nav.close();
    const result = await remove({ environmentId, input: { triggerId: trigger.id } });
    if (result._tag === "Failure")
      toastManager.add({
        type: "error",
        title: `Could not delete ${trigger.name}`,
        description: errorText(squashAtomCommandFailure(result), "Try again."),
      });
  };
  const repinToCurrent = async () => {
    if (!data.environmentId) return;
    setRepinning(true);
    setRepinError(null);
    const result = await repin({
      environmentId: data.environmentId,
      input: { triggerId: trigger.id },
    });
    setRepinning(false);
    if (result._tag === "Failure")
      setRepinError(errorText(squashAtomCommandFailure(result), "Could not change the version."));
    else setRepinnedAt(result.value.updatedAt);
  };
  const outdated =
    version?.outdated === true && (repinnedAt === null || trigger.updatedAt >= repinnedAt);

  const inputs = target ? mappingLines(target, trigger.mapping) : [];
  const rows = [
    {
      label: isPipeline ? "Starts" : "Runs",
      value:
        target === undefined ? (
          <span className="text-muted-foreground">
            {targetLoading ? "…" : isPipeline ? "A deleted pipeline" : "A deleted bot"}
          </span>
        ) : (
          <Link
            to="/loom/bots"
            search={isPipeline ? { pipeline: target.id } : { bot: target.id }}
            className="underline-offset-4 hover:underline"
          >
            {target.name}
          </Link>
        ),
    },
    {
      label: "When",
      value:
        trigger.event.kind === "schedule" && trigger.event.schedule.type === "fixed_time"
          ? `${when}, on ${data.hostLabel}'s clock`
          : when,
    },
    ...(trigger.event.kind === "schedule"
      ? [
          {
            label: "Next firing",
            value: trigger.enabled
              ? (runTime(trigger.nextFireAt ?? null, now) ?? "Not scheduled")
              : "Paused",
          },
        ]
      : []),
    ...(version
      ? [
          {
            label: "Version",
            value:
              outdated && bot
                ? `${version.label}, ${bot.name} is on ${bot.version}`
                : version.label,
          },
        ]
      : []),
    {
      label: "Inputs",
      value:
        inputs.length > 0 ? (
          <span className="flex flex-col items-end">
            {inputs.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        ) : (
          "None"
        ),
    },
    { label: "Limits", value: limitsPhrase(trigger) },
    {
      label: "Added",
      value: `${runTime(trigger.createdAt, now) ?? "Unknown"}${trigger.createdBy === "agent" ? ", by an agent" : ""}`,
    },
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) nav.close();
      }}
    >
      <SheetPopup
        side="right"
        size="wide"
        style={projectColorStyle(botColor({ id: trigger.botId }))}
      >
        <SheetHeader>
          <div className="flex min-w-0 items-start gap-3 pe-8">
            <TriggerKindTile kind={trigger.event.kind} muted={!trigger.enabled} />
            <div className="grid min-w-0 flex-1 gap-1">
              <SheetTitle>{trigger.name}</SheetTitle>
              <SheetDescription>
                {when}. {runsLabel(data, trigger)}.
              </SheetDescription>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {trigger.enabled ? (
              <LibraryStateBadge tone="success">On</LibraryStateBadge>
            ) : (
              <LibraryStateBadge tone="neutral">Paused</LibraryStateBadge>
            )}
            {signature ? (
              <LibraryStateBadge tone="neutral" icon={ShieldCheckIcon}>
                Signed
              </LibraryStateBadge>
            ) : null}
            {trigger.createdBy === "agent" ? (
              <LibraryStateBadge tone="neutral" icon={SparklesIcon}>
                Added by an agent
              </LibraryStateBadge>
            ) : null}
            <div className="ms-auto flex items-center gap-1.5">
              {data.environmentId ? (
                <TriggerEnabledSwitch
                  environmentId={data.environmentId}
                  trigger={trigger}
                  reason={data.operateReason}
                />
              ) : null}
              <ReasonTooltip reason={editReason}>
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  disabled={editReason !== null}
                  onClick={() => nav.overlay({ editTrigger: trigger.id })}
                >
                  <PencilIcon />
                  Edit
                </Button>
              </ReasonTooltip>
              <ReasonTooltip reason={data.operateReason}>
                <Button
                  shape="pill"
                  size="sm"
                  variant="ghost-destructive"
                  disabled={data.operateReason !== null}
                  onClick={() => void deleteTrigger()}
                >
                  <Trash2Icon />
                  Delete
                </Button>
              </ReasonTooltip>
            </div>
          </div>
        </SheetHeader>
        <SheetPanel>
          <div className="flex flex-col gap-6">
            {!data.host.connected ? (
              <LibraryNotice icon={CloudOffIcon}>
                {data.hostLabel} is offline, so this may be out of date.
              </LibraryNotice>
            ) : null}
            {bot?.archivedAt ? (
              <LibraryNotice icon={TriangleAlertIcon} tone="warning">
                {bot.name} is archived, so this trigger&apos;s firings are skipped until it is
                restored.
              </LibraryNotice>
            ) : null}
            {target === undefined && !targetLoading ? (
              <LibraryNotice icon={TriangleAlertIcon} tone="danger">
                {isPipeline
                  ? "The pipeline this trigger starts was deleted, so its firings are skipped. Delete the trigger, or add a new one for another pipeline."
                  : "The bot this trigger runs was deleted, so its firings are skipped."}
              </LibraryNotice>
            ) : null}
            {outdated && bot ? (
              <LibraryNotice
                icon={TriangleAlertIcon}
                action={
                  <ReasonTooltip reason={data.operateReason}>
                    <Button
                      shape="pill"
                      size="xs"
                      variant="outline"
                      disabled={repinning || data.operateReason !== null}
                      onClick={() => void repinToCurrent()}
                    >
                      {repinning ? "Changing…" : `Use version ${bot.version}`}
                    </Button>
                  </ReasonTooltip>
                }
              >
                It runs version {trigger.pinnedVersion}. {bot.name} has been saved since, as version{" "}
                {bot.version}.
              </LibraryNotice>
            ) : null}
            {repinError ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {repinError}
              </p>
            ) : null}
            <LibrarySpecSheet label="About this trigger" rows={rows} />
            {trigger.event.kind === "webhook" || trigger.event.kind === "merge-conflict" ? (
              <WebhookAddressSection data={data} trigger={trigger} />
            ) : null}
            <FiringsSection data={data} trigger={trigger} now={now} />
            <TestFiringSection data={data} trigger={trigger} target={target} now={now} />
          </div>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

function SheetSkeleton() {
  const nav = useBotsNavigation();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) nav.close();
      }}
    >
      <SheetPopup side="right" size="wide">
        <SheetHeader>
          <div role="status" aria-label="Loading trigger" className="flex items-start gap-3 pe-8">
            <Skeleton shape="card" className="size-8" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3.5 w-64" />
            </div>
          </div>
        </SheetHeader>
        <SheetPanel>
          <div className="grid gap-2.5">
            {SKELETON_ROWS.map((row) => (
              <div key={row} className="flex justify-between gap-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

/** What an overlay shows when its target is gone or out of reach: why, and the way on. */
function TriggerNotice({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  const nav = useBotsNavigation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) nav.close();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter variant="bare">
          <Button shape="pill" variant="ghost" onClick={nav.close}>
            Close
          </Button>
          {action}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function OpenTriggerOverlay({
  triggerId,
  editTriggerId,
  newTriggerBotId,
  pipelineId,
}: {
  readonly triggerId: string | undefined;
  readonly editTriggerId: string | undefined;
  readonly newTriggerBotId: string | undefined;
  readonly pipelineId: string | undefined;
}) {
  const data = useTriggerData();
  const nav = useBotsNavigation();
  // The editor hands over to the sheet as soon as the save replies, which can be before the list
  // hears of the trigger. The saved copy stands in until then, unless the watch saw it deleted.
  const [saved, setSaved] = useState<BotTrigger | null>(null);
  const findTrigger = (id: string) => {
    const listed = data.triggers.find((candidate) => candidate.id === id);
    const fresh = saved?.id === id && data.changes.triggers.get(id) !== null ? saved : undefined;
    if (listed && fresh) return fresh.updatedAt > listed.updatedAt ? fresh : listed;
    return listed ?? fresh;
  };
  const environmentId = data.environmentId;
  if (!data.enabled || !environmentId)
    return (
      <TriggerNotice
        title="Triggers are not available"
        description={`${data.hostLabel} runs a version of Loom without triggers. Update it to use them.`}
      />
    );
  const triggerMissing = () =>
    data.list.error !== null && !data.list.data ? (
      <TriggerNotice
        title="Triggers did not load"
        description={data.list.error}
        action={
          <Button shape="pill" variant="outline" onClick={data.list.refresh}>
            Try again
          </Button>
        }
      />
    ) : (
      <TriggerNotice
        title="Trigger not found"
        description={`This trigger is not on ${data.hostLabel}. It may have been deleted, along with its bot.`}
      />
    );

  if (triggerId) {
    const trigger = findTrigger(triggerId);
    if (trigger) return <TriggerSheet key={trigger.id} data={data} trigger={trigger} />;
    return data.loading ? <SheetSkeleton /> : triggerMissing();
  }

  const wizard = (bot: BotDefinition, existing: BotTrigger | null, startPipeline: string) => (
    <TriggerWizard
      key={existing?.id ?? `${bot.id}:${startPipeline}`}
      environmentId={environmentId}
      hostLabel={data.hostLabel}
      bot={bot}
      existing={existing}
      pipelines={data.host.pipelinesSupported ? data.pipelines : []}
      initialPipelineId={startPipeline}
      canSave={data.canOperate}
      saveReason={data.operateReason}
      stableSupported={data.host.versionsSupported}
      pipelinesSupported={data.host.pipelinesSupported}
      onClose={nav.close}
      onSaved={(trigger) => {
        setSaved(trigger);
        nav.overlay({ trigger: trigger.id });
      }}
    />
  );

  if (editTriggerId) {
    const trigger = findTrigger(editTriggerId);
    if (!trigger) return data.loading ? null : triggerMissing();
    const bot = data.botOf(trigger.botId);
    if (!bot)
      return data.botsLoading ? null : (
        <TriggerNotice
          title="Its bot was deleted"
          description={`${trigger.name} cannot be edited because the bot it runs is gone.`}
        />
      );
    if (trigger.pipelineId != null && !data.pipelineOf(trigger.pipelineId))
      return data.pipelinesLoading ? null : (
        <TriggerNotice
          title="Its pipeline was deleted"
          description={`${trigger.name} cannot be edited because the pipeline it starts is gone. You can still pause or delete it.`}
          action={
            <Button
              shape="pill"
              variant="outline"
              onClick={() => nav.overlay({ trigger: trigger.id })}
            >
              Open trigger
            </Button>
          }
        />
      );
    return wizard(bot, trigger, trigger.pipelineId ?? "");
  }

  if (!newTriggerBotId) return null;
  const bot = data.botOf(newTriggerBotId);
  if (!bot)
    return data.botsLoading ? null : (
      <TriggerNotice
        title="Bot not found"
        description={`This bot is not on ${data.hostLabel}. It may have been deleted.`}
      />
    );
  if (bot.archivedAt !== null)
    return (
      <TriggerNotice
        title={`${bot.name} is archived`}
        description={`Restore ${bot.name} to add triggers to it.`}
        action={
          <Button
            shape="pill"
            variant="outline"
            render={<Link to="/loom/bots" search={{ bot: bot.id }} />}
          >
            Open {bot.name}
          </Button>
        }
      />
    );
  if (pipelineId && data.host.pipelinesSupported) {
    const pipeline = data.pipelineOf(pipelineId);
    if (!pipeline && data.pipelinesLoading) return null;
    if (!pipeline || pipeline.steps[0]?.botId !== bot.id)
      return (
        <TriggerNotice
          title={pipeline ? `${pipeline.name} starts with another bot` : "Pipeline not found"}
          description={
            pipeline
              ? `A trigger starts a pipeline through the bot in its first step, and ${pipeline.name} no longer starts with ${bot.name}.`
              : `This pipeline is not on ${data.hostLabel}. It may have been deleted.`
          }
          action={
            <Button
              shape="pill"
              variant="outline"
              onClick={() => nav.overlay({ newTrigger: bot.id })}
            >
              Add a trigger for {bot.name}
            </Button>
          }
        />
      );
    return wizard(bot, null, pipeline.id);
  }
  return wizard(bot, null, "");
}

/** The trigger sheet (`trigger`) and the trigger editor (`newTrigger`, `editTrigger`), over any page. */
export function TriggersOverlays() {
  const { search } = useBotsNavigation();
  if (!search.trigger && !search.editTrigger && !search.newTrigger) return null;
  return (
    <OpenTriggerOverlay
      triggerId={search.trigger}
      editTriggerId={search.editTrigger}
      newTriggerBotId={search.newTrigger}
      pipelineId={search.triggerPipeline}
    />
  );
}
