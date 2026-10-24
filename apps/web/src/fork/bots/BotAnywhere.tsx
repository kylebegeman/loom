import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  KeyRoundIcon,
  LibraryBigIcon,
  LockIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  ServerOffIcon,
  XIcon,
} from "lucide-react";
import type { EnvironmentId, ProjectId, RuntimeMode } from "@t3tools/contracts";
import {
  BOTS_ANYWHERE_FEATURE,
  BOTS_LIST_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotId,
  type BotRemoteSettings,
  type BotSyncResult,
  type BotTarget,
  type BotTargetReadiness,
  type BotVaultBinding,
  type BotVaultSlot,
  type LibraryProjectColor,
} from "@t3tools/contracts/fork";
import { applyBotChanges, applyRunChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_ROW,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibraryGroupHeading,
  LibraryNotice,
  LibrarySpecSheet,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { ComputerIcon, projectColorStyle } from "../project-library/ProjectIdentity";
import { useLibraryAuthority } from "../project-library/state";
import { VaultReferencePicker } from "../vault/ReferencePicker";
import { BotRunStatusBadge, BotTile, runTime } from "./BotIdentity";
import { RUNTIME_MODE_LABELS } from "./BotEditor";
import { botsPageOf, useBotsNavigation } from "./navigation";
import { bots, useBotDefinitionChanges, useBotsAccess, useBotsChanges, useBotsHost } from "./state";
import {
  platformName,
  reasonsText,
  remoteRuns,
  syncSummary,
  targetAvailability,
  targetDetail,
} from "./usageWindow";

/** The Bots page's own ink; the sheet is portaled out of the page's colour scope. */
const BOTS_COLOR: LibraryProjectColor = "plum";

const HERE = "here";
const BEST = "best";
const ENVIRONMENT_PREFIX = "environment:";

const targetValue = (target: BotTarget) =>
  target.type === "environment" ? `${ENVIRONMENT_PREFIX}${target.environmentId}` : target.type;

const targetFromValue = (value: string): BotTarget =>
  value.startsWith(ENVIRONMENT_PREFIX)
    ? {
        type: "environment",
        environmentId: value.slice(ENVIRONMENT_PREFIX.length) as EnvironmentId,
      }
    : value === BEST
      ? { type: "best" }
      : { type: "here" };

/** "Busy", or "Not ready. Remote runs are off." when there is a why. */
const readinessText = (target: BotTargetReadiness) => {
  const { label } = targetAvailability(target);
  const reasons = target.ready ? "" : reasonsText(target.reasons);
  return reasons ? `${label}. ${reasons}` : label;
};

/**
 * Where a run goes. Shows nothing until the Library records shared bots and another computer has
 * reported in, so a single computer keeps the plain Run form.
 */
export function BotTargetField({
  environmentId,
  botId,
  projectId,
  value,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId: BotId;
  readonly projectId: ProjectId | null;
  readonly value: BotTarget;
  readonly onChange: (target: BotTarget) => void;
}) {
  const query = useEnvironmentQuery(
    bots.targets({
      environmentId,
      input: { botId, ...(projectId === null ? {} : { projectId }) },
    }),
  );
  const data = query.data;
  if (data === null || data.library !== "available" || data.targets.length < 2) return null;
  const others = data.targets.filter((target) => !target.isThisComputer);
  const here = data.targets.find((target) => target.isThisComputer);
  const chosen =
    value.type === "environment"
      ? data.targets.find((target) => target.environmentId === value.environmentId)
      : value.type === "here"
        ? here
        : undefined;
  return (
    <LibraryField label="Run on">
      <Select
        value={targetValue(value)}
        onValueChange={(next) => onChange(targetFromValue(next ?? HERE))}
      >
        <SelectTrigger size="sm">
          <SelectValue>
            {value.type === "best"
              ? "Best available"
              : value.type === "here"
                ? "This computer"
                : (chosen?.label ?? "Another computer")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={HERE} label="This computer">
            This computer
          </SelectItem>
          <SelectItem value={BEST} label="Best available">
            Best available
          </SelectItem>
          {others.map((target) => (
            <SelectItem
              key={target.environmentId}
              value={`${ENVIRONMENT_PREFIX}${target.environmentId}`}
              label={target.label}
              disabled={!target.ready}
            >
              <span className="grid">
                <span className="truncate">{target.label}</span>
                <span className="text-xs text-muted-foreground">{readinessText(target)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {chosen ? (
        <span className="text-xs font-normal text-muted-foreground">{readinessText(chosen)}</span>
      ) : value.type === "best" ? (
        <span className="text-xs font-normal text-muted-foreground">
          The ready computer with the most free slots. This computer wins a tie.
        </span>
      ) : null}
    </LibraryField>
  );
}

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/** Why a control is disabled when that is not obvious: the host is away, or this device may only look. */
function ReadOnlyLine({ subject }: { readonly subject: string }) {
  const host = useBotsHost();
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <LockIcon aria-hidden className="size-3 shrink-0" />
      {host.connected
        ? `This connection can view ${subject} but cannot change them.`
        : `${host.environment?.label ?? "This computer"} is offline. Reconnect it to change ${subject}.`}
    </p>
  );
}

/** The header control that opens the Computers sheet, with whether this computer takes remote runs. */
export function ComputersButton() {
  const host = useBotsHost();
  const nav = useBotsNavigation();
  const available = host.environmentId !== null && host.supported && host.anywhereSupported;
  const settings = useEnvironmentQuery(
    available && host.environmentId !== null
      ? bots.remoteSettings({ environmentId: host.environmentId, input: {} })
      : null,
  );
  if (!available) return null;
  const accepting = settings.data?.acceptRemote;
  return (
    <Button
      shape="pill"
      size="sm"
      variant="ghost"
      aria-haspopup="dialog"
      onClick={() => nav.overlay({ computers: true })}
    >
      {accepting === undefined ? null : (
        <LibraryStateDot tone={accepting ? "success" : "neutral"} />
      )}
      Computers
      {accepting === undefined ? null : (
        <span className="sr-only">{accepting ? ", remote runs on" : ", remote runs off"}</span>
      )}
    </Button>
  );
}

/** The ceiling a remote run may reach, from the most careful up. */
const CEILING_MODES: readonly RuntimeMode[] = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

const SETTING_ROW = "flex min-w-0 items-center justify-between gap-4 py-2.5";

function SettingsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading remote run settings"
      className="flex flex-col divide-y divide-border"
    >
      {["accept", "ceiling"].map((row) => (
        <div key={row} className={SETTING_ROW}>
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-2.5 w-56" />
          </div>
          <Skeleton shape="pill" className="h-5 w-9" />
        </div>
      ))}
    </div>
  );
}

/** Whether this computer runs shared bots for the others, and how far their runs may reach. */
function RemoteRunSettings({
  environmentId,
  label,
  canChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly canChange: boolean;
}) {
  const ceilingId = useId();
  const query = useEnvironmentQuery(bots.remoteSettings({ environmentId, input: {} }));
  const save = useAtomCommand(bots.setRemoteSettings, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = query.data;

  const change = async (patch: Partial<BotRemoteSettings>) => {
    if (settings === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await save({ environmentId, input: { ...settings, ...patch } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      query.refresh();
    } catch (cause) {
      setError(errorText(cause, "Could not save the remote run settings."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Runs for other computers" className="flex flex-col gap-1">
      <LibraryGroupHeading
        marker={<ComputerIcon environmentId={environmentId} />}
        title={label}
        hint="This computer"
      />
      {settings === null ? (
        query.error ? (
          <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
        ) : (
          <SettingsSkeleton />
        )
      ) : (
        <div className="flex flex-col divide-y divide-border text-sm">
          <label className={cn(SETTING_ROW, canChange && !busy && "cursor-pointer")}>
            <span className="min-w-0">
              <span className="block font-medium">Run bots for other computers</span>
              <span className="block text-xs text-muted-foreground">
                Their runs show here, marked with the computer that sent them.
              </span>
            </span>
            <Switch
              checked={settings.acceptRemote}
              disabled={!canChange || busy}
              onCheckedChange={(acceptRemote) => void change({ acceptRemote })}
            />
          </label>
          <div className={SETTING_ROW}>
            <label htmlFor={ceilingId} className="min-w-0">
              <span className="block font-medium">Highest permissions</span>
              <span className="block text-xs text-muted-foreground">
                {settings.acceptRemote
                  ? "A shared bot that needs more is refused here."
                  : "Applies once runs for other computers are on."}
              </span>
            </label>
            <div className="w-40 shrink-0">
              <Select
                value={settings.runtimeModeCeiling}
                disabled={!canChange || busy || !settings.acceptRemote}
                onValueChange={(next) => {
                  const mode = CEILING_MODES.find((entry) => entry === next);
                  if (mode && mode !== settings.runtimeModeCeiling)
                    void change({ runtimeModeCeiling: mode });
                }}
              >
                <SelectTrigger id={ceilingId} size="sm">
                  <SelectValue>{RUNTIME_MODE_LABELS[settings.runtimeModeCeiling]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {CEILING_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode} label={RUNTIME_MODE_LABELS[mode]}>
                      {RUNTIME_MODE_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
        </div>
      )}
      <LibraryErrorNotice error={error} />
    </section>
  );
}

const COMPUTER_SKELETONS = ["first", "second"];

/** The computers enrolled in the Library, which shared bots can run on. */
function LibraryComputers({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const library = useLibraryAuthority();
  const info = library.info;
  const sharesBots = info.data?.features?.includes(BOTS_ANYWHERE_FEATURE) ?? false;
  const heading = (
    <LibraryGroupHeading
      title="Your computers"
      count={info.data ? library.computers.length : undefined}
    />
  );
  if (library.authorityId === null)
    return (
      <section aria-label="Your computers" className="flex flex-col gap-1.5">
        {heading}
        <LibraryNotice
          icon={LibraryBigIcon}
          action={
            <Button shape="pill" size="xs" variant="outline" render={<Link to="/projects" />}>
              Set up a Library
            </Button>
          }
        >
          Connect your computers to a Library to send shared bots between them.
        </LibraryNotice>
      </section>
    );
  return (
    <section aria-label="Your computers" className="flex flex-col gap-1.5">
      {heading}
      {library.connected ? null : (
        <LibraryNotice icon={ServerOffIcon}>
          {library.environment?.label ?? "Your Library"} is offline. This list may be out of date.
        </LibraryNotice>
      )}
      {info.data === null ? (
        info.error ? (
          <LibraryErrorNotice error={info.error} onRetry={info.refresh} />
        ) : (
          <ul role="status" aria-label="Loading computers" className="flex flex-col">
            {COMPUTER_SKELETONS.map((row) => (
              <li key={row} className="flex items-center gap-3 py-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="ms-auto h-3 w-24" />
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {sharesBots ? null : (
            <LibraryNotice icon={LibraryBigIcon} tone="warning">
              Your Library does not record shared bots yet. Update the computer that hosts it.
            </LibraryNotice>
          )}
          {library.computers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No computer has enrolled yet.</p>
          ) : (
            <ul className="flex flex-col">
              {library.computers.map((computer) => (
                <li
                  key={computer.environmentId}
                  className="flex min-w-0 items-center gap-3 py-2 text-sm"
                >
                  <ComputerIcon environmentId={computer.environmentId} />
                  <span className="min-w-0 flex-1 truncate">{computer.label}</span>
                  {computer.environmentId === environmentId ? (
                    <LibraryStateBadge tone="neutral">This computer</LibraryStateBadge>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {[
                      platformName(computer.platform.os),
                      computer.supportsExecution ? null : "Does not run work",
                      `seen ${runTime(computer.lastSeenAt) ?? "never"}`,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** The bots this computer shares, and pulling the others' shared bots in now. */
function SharedBotsSync({
  environmentId,
  connected,
  canChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly canChange: boolean;
}) {
  const list = useEnvironmentQuery(bots.list({ environmentId, input: {} }));
  const changes = useBotDefinitionChanges(environmentId, connected);
  const sync = useAtomCommand(bots.syncLibrary, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BotSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shared = list.data
    ? applyBotChanges(list.data.bots, changes).filter(
        (bot) => bot.library != null && bot.archivedAt === null,
      ).length
    : undefined;

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await sync({ environmentId, input: {} });
      if (outcome._tag === "Failure") throw squashAtomCommandFailure(outcome);
      setResult(outcome.value);
      list.refresh();
    } catch (cause) {
      setError(errorText(cause, "Could not sync shared bots."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Shared bots" className="flex flex-col gap-1.5">
      <LibraryGroupHeading
        title="Shared bots"
        count={shared}
        action={
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!canChange || busy}
            onClick={() => void syncNow()}
          >
            <RefreshCwIcon />
            Sync now
          </Button>
        }
      />
      <p className="text-xs text-muted-foreground">
        Brings in bots your other computers shared, and their latest edits.
      </p>
      {result ? (
        <div role="status" className="flex flex-col gap-1 text-xs">
          <p className="flex items-center gap-1.5">
            <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
            {syncSummary(result)}
          </p>
          {result.refused.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {result.refused.map((entry) => (
                <li key={entry.libraryBotId} className="flex items-start gap-1.5">
                  <LibraryStateDot tone="warning" className="mt-1 size-1.5" />
                  <span className="min-w-0">{entry.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <LibraryErrorNotice error={error} onRetry={() => void syncNow()} />
    </section>
  );
}

const REMOTE_RUNS_SHOWN = 8;

/** Runs this computer sent to another one, or ran for one, among the newest runs. */
function RecentRemoteRuns({
  environmentId,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
}) {
  const nav = useBotsNavigation();
  const changes = useBotsChanges(environmentId, connected);
  const query = useEnvironmentQuery(
    bots.listRuns({ environmentId, input: { limit: BOTS_LIST_RUNS_MAX_LIMIT } }),
  );
  const runs = query.data
    ? remoteRuns(
        applyRunChanges(query.data.runs, changes, {
          includeNew: true,
          limit: BOTS_LIST_RUNS_MAX_LIMIT,
        }),
        REMOTE_RUNS_SHOWN,
      )
    : null;
  return (
    <section aria-label="Recent remote runs" className="flex flex-col gap-1.5">
      <LibraryGroupHeading title="Recent remote runs" />
      {runs === null ? (
        query.error ? (
          <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
        ) : (
          <ul role="status" aria-label="Loading runs" className="flex flex-col">
            {COMPUTER_SKELETONS.map((row) => (
              <li key={row} className="flex items-center gap-3 py-2">
                <Skeleton className="size-6" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="ms-auto h-3 w-14" />
              </li>
            ))}
          </ul>
        )
      ) : runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No remote runs yet.</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  to="/loom/bots"
                  search={{ ...botsPageOf(nav.search), runId: run.id }}
                  replace
                  className={cn(
                    LIBRARY_ROW,
                    "flex min-w-0 items-center gap-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                >
                  <BotTile bot={{ id: run.botId }} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{run.botName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {run.ranOn
                        ? `Ran on ${run.ranOn.label}`
                        : run.requestedBy
                          ? `Sent by ${run.requestedBy.label}`
                          : null}
                      {` · ${runTime(run.createdAt) ?? ""}`}
                    </span>
                  </span>
                  <BotRunStatusBadge status={run.status} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Among the {BOTS_LIST_RUNS_MAX_LIMIT} most recent runs.
          </p>
        </>
      )}
    </section>
  );
}

function ComputersSheetBody() {
  const host = useBotsHost();
  const { canShare } = useBotsAccess();
  const environmentId = host.environmentId;
  return (
    <>
      <SheetHeader>
        <SheetTitle>Computers</SheetTitle>
        <SheetDescription>
          Run shared bots on any of your computers. Vault items never leave the computer that holds
          them.
        </SheetDescription>
      </SheetHeader>
      <SheetPanel>
        <div className="flex flex-col gap-6">
          {environmentId === null || !host.supported || !host.anywhereSupported ? (
            <LibraryNotice icon={ServerOffIcon}>
              {host.environment?.label ?? "This server"} cannot run bots on other computers yet.
              Update it to share bots between your computers.
            </LibraryNotice>
          ) : (
            <>
              {canShare ? null : <ReadOnlyLine subject="these settings" />}
              <RemoteRunSettings
                environmentId={environmentId}
                label={host.environment?.label ?? "This computer"}
                canChange={canShare}
              />
              <LibraryComputers environmentId={environmentId} />
              <SharedBotsSync
                environmentId={environmentId}
                connected={host.connected}
                canChange={canShare}
              />
              <RecentRemoteRuns environmentId={environmentId} connected={host.connected} />
            </>
          )}
        </div>
      </SheetPanel>
    </>
  );
}

/** The Computers sheet (`computers`), over whichever page is open. */
export function ComputersOverlay() {
  const nav = useBotsNavigation();
  return (
    <Sheet
      open={nav.search.computers === true}
      onOpenChange={(open) => {
        if (!open) nav.close();
      }}
    >
      <SheetPopup side="right" style={projectColorStyle(BOTS_COLOR)}>
        <ComputersSheetBody />
      </SheetPopup>
    </Sheet>
  );
}

type SlotState = "bound" | "unreadable" | "unbound";

const SLOT_STATES = {
  bound: { tone: "success", text: null },
  unreadable: { tone: "danger", text: "Can no longer read its item" },
  unbound: { tone: "warning", text: "Not bound" },
} as const;

const slotState = (binding: BotVaultBinding | undefined): SlotState =>
  binding?.itemId == null ? "unbound" : binding.itemLabel == null ? "unreadable" : "bound";

/** This computer's Vault item for each of the bot's credential slots. */
function BotCredentials({
  environmentId,
  bot,
  slots,
  canChange,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly slots: readonly BotVaultSlot[];
  readonly canChange: boolean;
  readonly onChanged: () => void;
}) {
  const query = useEnvironmentQuery(
    bots.vaultBindings({ environmentId, input: { botId: bot.id } }),
  );
  const bind = useAtomCommand(bots.bindVaultSlot, { reportFailure: false });
  const [picking, setPicking] = useState<BotVaultSlot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setItem = async (slot: BotVaultSlot, itemId: string | null) => {
    setBusy(slot.name);
    setError(null);
    try {
      const result = await bind({
        environmentId,
        input: { botId: bot.id, slot: slot.name, itemId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPicking(null);
      query.refresh();
      onChanged();
    } catch (cause) {
      setError(
        errorText(cause, itemId === null ? "Could not clear the binding." : "Could not bind it."),
      );
    } finally {
      setBusy(null);
    }
  };

  const bindings = query.data?.bindings;
  return (
    <section aria-label="Credentials on this computer" className="flex flex-col gap-1.5">
      <LibraryGroupHeading title="Credentials on this computer" count={slots.length} />
      {bindings === undefined ? (
        query.error ? (
          <LibraryErrorNotice
            error={`Could not read the bindings. ${query.error}`}
            onRetry={query.refresh}
          />
        ) : (
          <ul role="status" aria-label="Loading credentials" className="flex flex-col">
            {slots.map((slot) => (
              <li key={slot.name} className="flex items-center gap-3 py-2">
                <Skeleton className="size-4" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="flex flex-col">
          {slots.map((slot) => {
            const binding = bindings.find((entry) => entry.slot === slot.name);
            const state = slotState(binding);
            return (
              <li key={slot.name} className="flex min-w-0 items-center gap-3 py-2 text-sm">
                <KeyRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{slot.label}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <LibraryStateDot tone={SLOT_STATES[state].tone} className="size-1.5" />
                    <span className="truncate">
                      {SLOT_STATES[state].text ?? binding?.itemLabel}
                    </span>
                  </span>
                </span>
                <Button
                  shape="pill"
                  size="xs"
                  variant="ghost"
                  disabled={!canChange || busy !== null}
                  onClick={() => {
                    setError(null);
                    setPicking(slot);
                  }}
                >
                  {state === "unbound" ? "Bind" : "Change"}
                </Button>
                {state === "unbound" ? null : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          shape="pill"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Clear ${slot.label}`}
                          disabled={!canChange || busy !== null}
                          onClick={() => void setItem(slot, null)}
                        />
                      }
                    >
                      <XIcon />
                    </TooltipTrigger>
                    <TooltipPopup>Clear the binding</TooltipPopup>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {picking === null ? <LibraryErrorNotice error={error} /> : null}
      <LibraryDialog
        open={picking !== null}
        onOpenChange={(open) => {
          if (!open && busy === null) setPicking(null);
        }}
        title={picking ? `Bind ${picking.label}` : "Bind"}
        description={`Choose the Vault item ${bot.name} uses on this computer. It never leaves this computer.`}
        actions={
          <Button
            shape="pill"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setPicking(null)}
          >
            Cancel
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <LibraryErrorNotice error={picking === null ? null : error} />
          {picking ? (
            <VaultReferencePicker
              environmentId={environmentId}
              disabled={busy !== null}
              onSelect={(reference) => void setItem(picking, reference.item.id)}
            />
          ) : null}
        </div>
      </LibraryDialog>
    </section>
  );
}

const LIBRARY_HINTS = {
  none: "Connect this computer to a Library to share bots with your other computers.",
  unsupported: "Your Library does not record shared bots yet.",
} as const;

function SharingSkeleton() {
  return (
    <div role="status" aria-label="Checking the Library" className="flex flex-col gap-2 py-1">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

function SharingAside({
  environmentId,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
}) {
  const { canShare } = useBotsAccess();
  const targets = useEnvironmentQuery(bots.targets({ environmentId, input: { botId: bot.id } }));
  const share = useAtomCommand(bots.share, { reportFailure: false });
  const unshare = useAtomCommand(bots.unshare, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slots = bot.vaultSlots ?? [];
  const link = bot.library ?? null;
  const library = targets.data?.library ?? null;
  const others = (targets.data?.targets ?? []).filter((target) => !target.isThisComputer);

  const setShared = async (next: boolean) => {
    if (
      !next &&
      !(await ensureLocalApi().dialogs.confirm(
        `Stop sharing ${bot.name}? Your other computers keep their copies, but edits stop syncing to them.`,
        { variant: "destructive" },
      ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const command = next ? share : unshare;
      const result = await command({ environmentId, input: { botId: bot.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      targets.refresh();
    } catch (cause) {
      setError(errorText(cause, next ? "Could not share the bot." : "Could not stop sharing."));
    } finally {
      setBusy(false);
    }
  };

  const action =
    library !== "available" ? null : link === null ? (
      <Button
        shape="pill"
        size="xs"
        variant="ghost"
        disabled={!canShare || busy}
        onClick={() => void setShared(true)}
      >
        Share
      </Button>
    ) : (
      <Menu>
        <MenuTrigger
          render={
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-label="Sharing actions"
              disabled={!canShare || busy}
            />
          }
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup side="bottom" align="end">
          <MenuItem variant="destructive" onClick={() => void setShared(false)}>
            Stop sharing…
          </MenuItem>
        </MenuPopup>
      </Menu>
    );

  const facts = [
    {
      label: "Status",
      value: link ? `Shared · revision ${link.revision}` : "Only on this computer",
    },
    ...(link ? [{ label: "Synced", value: runTime(link.syncedAt) ?? "Not yet" }] : []),
    ...(link?.modelOverride ? [{ label: "Model here", value: link.modelOverride.model }] : []),
  ];

  return (
    <>
      <section aria-label="Sharing" className="flex flex-col gap-1.5">
        <LibraryGroupHeading title="Sharing" action={action} />
        {library === null ? (
          targets.error ? (
            <LibraryErrorNotice error={targets.error} onRetry={targets.refresh} />
          ) : (
            <SharingSkeleton />
          )
        ) : (
          <>
            <LibrarySpecSheet label="Sharing" rows={facts} />
            {link?.modelOverride ? (
              <p className="text-xs text-muted-foreground">
                The shared model is not installed here, so this computer uses its own. The Library
                keeps the shared one for the others.
              </p>
            ) : null}
            {library !== "available" ? (
              <p className="text-xs text-muted-foreground">
                {LIBRARY_HINTS[library]}{" "}
                {library === "none" ? (
                  <Link to="/projects" className="font-medium text-foreground underline">
                    Set up a Library
                  </Link>
                ) : null}
              </p>
            ) : link === null ? (
              <p className="text-xs text-muted-foreground">
                Share it to run it on your other computers.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <h3 className="pt-1 text-xs font-medium text-muted-foreground">Can run it</h3>
                {others.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No other computer has reported in.
                  </p>
                ) : (
                  <ul className="flex flex-col">
                    {others.map((target) => (
                      <TargetRow key={target.environmentId} target={target} />
                    ))}
                  </ul>
                )}
              </div>
            )}
            {targets.error ? (
              <LibraryErrorNotice error={targets.error} onRetry={targets.refresh} />
            ) : null}
          </>
        )}
        <LibraryErrorNotice error={error} />
      </section>
      {slots.length > 0 ? (
        <BotCredentials
          environmentId={environmentId}
          bot={bot}
          slots={slots}
          canChange={canShare}
          onChanged={targets.refresh}
        />
      ) : null}
      {canShare ? null : <ReadOnlyLine subject="sharing and credentials" />}
    </>
  );
}

function TargetRow({ target }: { readonly target: BotTargetReadiness }) {
  const availability = targetAvailability(target);
  const detail = targetDetail(target, (iso) => runTime(iso) ?? iso);
  const state = (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <LibraryStateDot tone={availability.tone} className="size-1.5" />
      {availability.label}
    </span>
  );
  return (
    <li className="flex min-w-0 items-center gap-3 py-1.5 text-sm">
      <ComputerIcon environmentId={target.environmentId} />
      <span className="min-w-0 flex-1 truncate">{target.label}</span>
      {detail ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            {state}
            <span className="sr-only">. {detail}</span>
          </TooltipTrigger>
          <TooltipPopup>{detail}</TooltipPopup>
        </Tooltip>
      ) : (
        state
      )}
    </li>
  );
}

/** Sharing and credentials for one bot, for the aside of its Overview. */
export function BotSharingAside({ bot }: { readonly bot: BotDefinition }) {
  const host = useBotsHost();
  if (host.environmentId === null || !host.supported || !host.anywhereSupported) return null;
  return <SharingAside environmentId={host.environmentId} bot={bot} />;
}
