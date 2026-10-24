import { useEffect, useRef, useState } from "react";
import {
  BadgeXIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  EllipsisIcon,
  FlaskConicalIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
  WebhookIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_TRIGGER_EVENT_FIELDS,
  BOTS_TRIGGER_FIRINGS_MAX_LIMIT,
  type BotDefinition,
  type BotTrigger,
  type BotTriggerEventKind,
  type BotTriggerFiring,
} from "@t3tools/contracts/fork";
import {
  applyFiringChanges,
  applyTriggerChanges,
  type BotTriggerChanges,
  triggerSummary,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { webhookAddress } from "@t3tools/client-runtime/webhook-address";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { runTime } from "./BotIdentity";
import { BotRowsSkeleton, BotsEmptyList } from "./BotRuns";
import { bots } from "./state";
import type { BotDefinition as StubBot } from "@t3tools/contracts/fork";

const FIRINGS_PAGE = Math.min(20, BOTS_TRIGGER_FIRINGS_MAX_LIMIT);

const KIND_ICONS: Record<BotTriggerEventKind, LucideIcon> = {
  "pull-request-checks-failing": BadgeXIcon,
  "pull-request-opened": PullRequestGlyph.pullRequest,
  "thread-settled": MessageSquareIcon,
  "merge-conflict": PullRequestGlyph.conflicting,
  webhook: WebhookIcon,
  schedule: ClockIcon,
};

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

function WebhookAddress({
  environmentId,
  trigger,
  canOperate,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly canOperate: boolean;
}) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "webhook URL" });
  const rotate = useAtomCommand(bots.rotateTriggerToken, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = trigger.webhook;
  if (endpoint === undefined) return null;
  const { address, copyable, note } = webhookAddress(endpoint, httpBaseUrl);
  const rotateAddress = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Rotate this address? The current one stops working.",
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    const result = await rotate({ environmentId, input: { triggerId: trigger.id } });
    setBusy(false);
    if (result._tag === "Failure")
      setError(errorText(squashAtomCommandFailure(result), "Could not rotate the address."));
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {/* Selects in one click, so an address that cannot be copied can still be taken by hand. */}
        <code
          aria-label={`${trigger.name} address`}
          className="min-w-0 flex-1 basis-64 select-all rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-xs break-all text-foreground/90 dark:bg-accent/60"
        >
          {address}
        </code>
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          disabled={!copyable}
          onClick={() => copyToClipboard(address, undefined)}
        >
          <CopyIcon />
          {isCopied ? "Copied" : "Copy"}
        </Button>
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          disabled={busy || !canOperate}
          onClick={() => void rotateAddress()}
        >
          <RotateCwIcon />
          Rotate
        </Button>
      </div>
      {note !== null ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {trigger.event.kind === "merge-conflict" ? (
        <p className="text-xs text-muted-foreground">
          Set <span className="font-mono">LOOM_BOTS_CONFLICT_HOOK</span> to this address before
          running the fork integrate script.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FiringList({ firings }: { readonly firings: ReadonlyArray<BotTriggerFiring> }) {
  if (firings.length === 0)
    return <p className="py-1 text-xs text-muted-foreground">This trigger has not fired yet.</p>;
  return (
    <ol className="flex flex-col">
      {firings.map((firing) => (
        <li
          key={firing.id}
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm"
        >
          <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
            {runTime(firing.firedAt)}
          </span>
          <span className="min-w-0 flex-1 basis-40 truncate">{firing.eventSummary}</span>
          <LibraryStateBadge tone={firing.outcome === "run" ? "success" : "neutral"}>
            {firing.outcome === "run" ? "Ran" : "Skipped"}
          </LibraryStateBadge>
          {firing.reason ? (
            <span className="basis-full ps-23 text-xs text-muted-foreground">{firing.reason}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const FIRING_SKELETON = ["first", "second", "third"];

function TriggerFirings({
  environmentId,
  trigger,
  changes,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly changes: BotTriggerChanges;
}) {
  const query = useEnvironmentQuery(
    bots.triggerFirings({ environmentId, input: { triggerId: trigger.id, limit: FIRINGS_PAGE } }),
  );
  if (query.error) return <LibraryErrorNotice error={query.error} onRetry={query.refresh} />;
  if (query.isPending && !query.data)
    return (
      <div role="status" aria-label="Loading firings" className="flex flex-col gap-2.5 py-1.5">
        {FIRING_SKELETON.map((row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton shape="pill" className="h-5 w-14" />
          </div>
        ))}
      </div>
    );
  const firings = applyFiringChanges(query.data?.firings ?? [], changes, trigger.id);
  return (
    <>
      <FiringList firings={firings} />
      {query.data?.hasMore ? (
        <p className="text-xs text-muted-foreground">Showing the {FIRINGS_PAGE} most recent.</p>
      ) : null}
    </>
  );
}

/** A sample event as JSON, with every field the event offers. */
const sampleFields = (trigger: BotTrigger) =>
  JSON.stringify(
    trigger.event.kind === "webhook"
      ? Object.fromEntries(
          Object.values(trigger.mapping).flatMap((entry) =>
            "field" in entry ? [[entry.field, ""]] : [],
          ),
        )
      : Object.fromEntries(
          BOT_TRIGGER_EVENT_FIELDS[trigger.event.kind].map((field) => [field, ""]),
        ),
    null,
    2,
  );

const parseSample = (text: string): Record<string, string | number | boolean> | string => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return "Enter a JSON object of field values.";
    const entries = Object.entries(parsed);
    if (!entries.every(([, value]) => ["string", "number", "boolean"].includes(typeof value)))
      return "Field values are text, numbers or true and false.";
    return Object.fromEntries(entries) as Record<string, string | number | boolean>;
  } catch {
    return "Enter a JSON object of field values.";
  }
};

function TestFiring({
  environmentId,
  trigger,
  canOperate,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly canOperate: boolean;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState(() => sampleFields(trigger));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<BotTriggerFiring | null>(null);
  const test = useAtomCommand(bots.testTrigger, { reportFailure: false });
  const fire = async () => {
    const fields = parseSample(text);
    if (typeof fields === "string") {
      setError(fields);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await test({ environmentId, input: { triggerId: trigger.id, fields } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setFiring(result.value);
    } catch (cause) {
      setError(errorText(cause, "Could not fire the trigger."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Test firing" className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-xs font-medium text-muted-foreground">Test firing</h4>
      <p className="text-sm">
        Fire once with these event fields, past the trigger&apos;s filters and limits. This starts a
        real run.
      </p>
      <Textarea
        rows={6}
        aria-label="Sample event fields"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-1.5">
        <Button shape="pill" size="sm" disabled={busy || !canOperate} onClick={() => void fire()}>
          <ZapIcon />
          {busy ? "Firing…" : "Fire"}
        </Button>
        <Button shape="pill" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {firing ? <FiringList firings={[firing]} /> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function TriggerRow({
  environmentId,
  trigger,
  bot,
  showBot,
  changes,
  canOperate,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: BotTrigger;
  readonly bot: BotDefinition | undefined;
  readonly showBot: boolean;
  readonly changes: BotTriggerChanges;
  readonly canOperate: boolean;
  readonly onEdit: () => void;
}) {
  const projects = useProjects();
  const projectTitle = (id: string) =>
    projects.find((project) => project.id === id)?.title ?? "a removed project";
  const [showFirings, setShowFirings] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setEnabled = useAtomCommand(bots.setTriggerEnabled, { reportFailure: false });
  const repin = useAtomCommand(bots.repinTrigger, { reportFailure: false });
  const remove = useAtomCommand(bots.deleteTrigger, { reportFailure: false });

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (enabled: boolean) =>
    act(async () => {
      const result = await setEnabled({ environmentId, input: { triggerId: trigger.id, enabled } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
  const repinToCurrent = () =>
    act(async () => {
      const result = await repin({ environmentId, input: { triggerId: trigger.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
  const deleteTrigger = () =>
    act(async () => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete ${trigger.name}? Its firing history is deleted with it.`,
      );
      if (!confirmed) return;
      const result = await remove({ environmentId, input: { triggerId: trigger.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });

  const outdated =
    bot !== undefined &&
    !trigger.followLatest &&
    trigger.followStable !== true &&
    bot.version !== trigger.pinnedVersion;
  const KindIcon = KIND_ICONS[trigger.event.kind];
  const timing = [
    trigger.lastFiredAt ? `Last ran ${runTime(trigger.lastFiredAt)}` : "Has not run yet",
    trigger.nextFireAt ? `next ${runTime(trigger.nextFireAt)}` : null,
    `at most ${trigger.dailyLimit} a day`,
    trigger.cooldownMinutes > 0 ? `${trigger.cooldownMinutes} minutes apart` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
            trigger.enabled
              ? "bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
              : "bg-muted text-muted-foreground dark:bg-accent",
          )}
        >
          <KindIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "truncate text-sm font-medium",
                !trigger.enabled && "text-muted-foreground",
              )}
            >
              {trigger.name}
            </span>
            {trigger.enabled ? null : <LibraryStateBadge tone="neutral">Off</LibraryStateBadge>}
            {trigger.pipelineId != null ? (
              <LibraryStateBadge tone="neutral">
                Starts pipeline {trigger.pipelineId}
              </LibraryStateBadge>
            ) : trigger.followLatest ? (
              <LibraryStateBadge tone="neutral">Latest version</LibraryStateBadge>
            ) : trigger.followStable === true ? (
              <LibraryStateBadge tone="neutral">Stable version</LibraryStateBadge>
            ) : null}
            {showBot ? (
              <span className="truncate text-xs text-muted-foreground">
                {bot?.name ?? "Deleted bot"}
              </span>
            ) : null}
          </p>
          <p
            className={cn(
              "truncate text-xs text-foreground/80",
              trigger.event.kind === "schedule" && "font-mono",
            )}
          >
            {triggerSummary(trigger.event, projectTitle)}
          </p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">{timing}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <Switch
            aria-label={trigger.enabled ? `Turn off ${trigger.name}` : `Turn on ${trigger.name}`}
            checked={trigger.enabled}
            disabled={busy || !canOperate}
            onCheckedChange={(enabled) => void toggle(enabled)}
          />
          <span aria-hidden className="mx-1.5 h-4 border-s border-border" />
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!canOperate || bot === undefined}
            onClick={onEdit}
          >
            <PencilIcon />
            Edit
          </Button>
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            onClick={() => setShowFirings((current) => !current)}
            aria-expanded={showFirings}
          >
            Firings
            <ChevronDownIcon
              className={cn("transition-transform duration-200", showFirings && "rotate-180")}
            />
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  shape="pill"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`More actions for ${trigger.name}`}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem disabled={!canOperate} onClick={() => setTesting((current) => !current)}>
                <FlaskConicalIcon />
                {testing ? "Close test" : "Test"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={busy || !canOperate}
                onClick={() => void deleteTrigger()}
              >
                <Trash2Icon />
                Delete
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {outdated || trigger.webhook !== undefined || testing || showFirings || error ? (
        <div className="flex min-w-0 flex-col gap-3 ps-11">
          {outdated ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-warning-foreground"
            >
              <span>
                Runs version {trigger.pinnedVersion}; {bot.name} is now version {bot.version}.
              </span>
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={busy || !canOperate}
                onClick={() => void repinToCurrent()}
              >
                Use version {bot.version}
              </Button>
            </div>
          ) : null}
          <WebhookAddress environmentId={environmentId} trigger={trigger} canOperate={canOperate} />
          {testing ? (
            <TestFiring
              environmentId={environmentId}
              trigger={trigger}
              canOperate={canOperate}
              onClose={() => setTesting(false)}
            />
          ) : null}
          {showFirings ? (
            <section
              aria-label="Firings"
              className="flex flex-col gap-1 border-t border-border pt-3"
            >
              <h4 className="text-xs font-medium text-muted-foreground">Recent firings</h4>
              <TriggerFirings environmentId={environmentId} trigger={trigger} changes={changes} />
            </section>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The triggers of one bot, or of every bot when none is selected. */
export function BotTriggers({
  environmentId,
  allBots,
  selected,
  changes,
  connected,
  canOperate,
  onNew,
  onEdit,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly selected: BotDefinition | null;
  readonly changes: BotTriggerChanges;
  readonly connected: boolean;
  readonly canOperate: boolean;
  readonly onNew: (bot: BotDefinition) => void;
  readonly onEdit: (trigger: BotTrigger) => void;
}) {
  const query = useEnvironmentQuery(
    environmentId
      ? bots.listTriggers({
          environmentId,
          input: selected === null ? {} : { botId: selected.id },
        })
      : null,
  );
  // Changes missed while disconnected never arrive, so a reconnect refetches the list.
  const refresh = query.refresh;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
  const triggers = applyTriggerChanges(query.data?.triggers ?? [], changes, selected?.id);
  const botOf = (botId: string) => allBots.find((bot) => bot.id === botId);
  const newTrigger = selected ? (
    <Button
      shape="pill"
      size="sm"
      variant="outline"
      disabled={!canOperate || selected.archivedAt !== null}
      onClick={() => onNew(selected)}
    >
      <PlusIcon />
      New trigger
    </Button>
  ) : null;
  return (
    <section className="flex flex-col gap-4" aria-label="Triggers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          {selected
            ? `What starts ${selected.name} on its own, and when it runs next.`
            : "What starts each bot on its own, and when it runs next."}
        </p>
        <div className="flex items-center gap-1.5">
          {triggers.length > 0 ? newTrigger : null}
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh triggers"
            disabled={!connected || query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </div>
      {query.error ? (
        <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
      ) : query.isPending && !query.data ? (
        <BotRowsSkeleton label="Loading triggers" />
      ) : triggers.length === 0 ? (
        <BotsEmptyList
          icon={ZapIcon}
          message={
            selected
              ? `Nothing starts ${selected.name} on its own yet. Add a trigger to run it when checks fail, a pull request opens, a webhook arrives or on a schedule.`
              : "No bot has a trigger yet. Choose a bot to add one."
          }
          action={newTrigger}
        />
      ) : environmentId ? (
        <ul className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}>
          {triggers.map((trigger) => (
            <TriggerRow
              key={trigger.id}
              environmentId={environmentId}
              trigger={trigger}
              bot={botOf(trigger.botId)}
              showBot={selected === null}
              changes={changes}
              canOperate={canOperate && connected}
              onEdit={() => onEdit(trigger)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// STUB(bots-redesign): replaced by the owning area's implementation.
/** The index's Triggers view. */
export function TriggersView() {
  return null;
}

/** A bot's triggers, for the aside of its Overview, with its one way to add one. */
export function BotTriggersAside(_props: { readonly bot: StubBot }) {
  return null;
}

/** The trigger sheet (`trigger`) and the trigger editor (`newTrigger`, `editTrigger`), over any page. */
export function TriggersOverlays() {
  return null;
}
