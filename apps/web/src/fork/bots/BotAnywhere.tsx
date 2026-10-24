import { useState, type ReactNode } from "react";
import {
  CheckIcon,
  KeyRoundIcon,
  LibraryBigIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { EnvironmentId, ProjectId, RuntimeMode } from "@t3tools/contracts";
import type {
  BotDefinition,
  BotId,
  BotLibraryAvailability,
  BotTarget,
  BotTargetReadiness,
  BotVaultSlot,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibrarySection,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { VaultReferencePicker } from "../vault/ReferencePicker";
import { Choice, RUNTIME_MODE_LABELS } from "./BotEditor";
import { bots } from "./state";
import type { BotDefinition as StubBot } from "@t3tools/contracts/fork";

const LIBRARY_NOTICE: Record<Exclude<BotLibraryAvailability, "available">, string> = {
  none: "Connect this computer to a Library to share bots with your other computers.",
  unsupported: "Your Library does not support shared bots yet.",
};

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

const readinessText = (target: BotTargetReadiness) =>
  target.ready
    ? `Ready, ${target.freeSlots} free ${target.freeSlots === 1 ? "slot" : "slots"}`
    : target.reasons.join(" ");

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

type SlotState = "loading" | "bound" | "unreadable" | "unbound";

const SLOT_STATES = {
  bound: { tone: "success", text: null },
  unreadable: { tone: "danger", text: "Bound to an item this computer can no longer read" },
  unbound: { tone: "warning", text: "Not bound on this computer" },
} as const;

function VaultSlotBinding({
  environmentId,
  bot,
  slot,
  itemLabel,
  state,
  canChange,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly slot: BotVaultSlot;
  readonly itemLabel: string | null;
  readonly state: SlotState;
  readonly canChange: boolean;
  readonly onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bind = useAtomCommand(bots.bindVaultSlot, { reportFailure: false });
  const bound = state === "bound" || state === "unreadable";

  const setItem = async (itemId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await bind({
        environmentId,
        input: { botId: bot.id, slot: slot.name, itemId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setPicking(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not bind the Vault slot.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-1 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <KeyRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate">{slot.label}</p>
          {state === "loading" ? (
            <Skeleton className="mt-1 h-2.5 w-32" />
          ) : (
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <LibraryStateDot tone={SLOT_STATES[state].tone} className="size-1.5" />
              <span className="truncate">{SLOT_STATES[state].text ?? itemLabel}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={!canChange || busy || state === "loading"}
            onClick={() => setPicking(true)}
          >
            {bound ? "Change" : "Bind"}
          </Button>
          {bound ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!canChange || busy}
              onClick={() => void setItem(null)}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="ps-7 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {picking ? (
        <LibraryDialog
          open
          onOpenChange={(open) => {
            if (!open) setPicking(false);
          }}
          title={`Bind ${slot.label}`}
          description={`Choose the Vault item ${bot.name} uses on this computer. It never leaves this computer.`}
          actions={
            <Button shape="pill" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          }
        >
          <VaultReferencePicker
            environmentId={environmentId}
            disabled={busy}
            onSelect={(reference) => void setItem(reference.item.id)}
          />
        </LibraryDialog>
      ) : null}
    </li>
  );
}

/** A titled stretch inside an outlined panel, set off by a hairline rather than its own box. */
function PanelPart({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="border-t border-border px-4 py-2.5">
      <h4 className="pt-0.5 text-xs font-medium text-muted-foreground">{label}</h4>
      {children}
    </div>
  );
}

/** Sharing, where the bot can run, and this computer's Vault bindings for it. */
export function BotSharingPanel({
  environmentId,
  bot,
  canChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly canChange: boolean;
}) {
  const targetsQuery = useEnvironmentQuery(
    bots.targets({ environmentId, input: { botId: bot.id } }),
  );
  const slots = bot.vaultSlots ?? [];
  const bindingsQuery = useEnvironmentQuery(
    slots.length === 0 ? null : bots.vaultBindings({ environmentId, input: { botId: bot.id } }),
  );
  const share = useAtomCommand(bots.share, { reportFailure: false });
  const unshare = useAtomCommand(bots.unshare, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const library = targetsQuery.data?.library ?? null;
  const others = (targetsQuery.data?.targets ?? []).filter((target) => !target.isThisComputer);
  const refreshTargets = targetsQuery.refresh;

  const toggleShared = async () => {
    setBusy(true);
    setError(null);
    try {
      const command = bot.library == null ? share : unshare;
      const result = await command({ environmentId, input: { botId: bot.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refreshTargets();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change sharing.");
    } finally {
      setBusy(false);
    }
  };

  // Most people have one computer and no Library; the panel would only be noise for them.
  if ((library === null || library === "none") && slots.length === 0) return null;
  return (
    <section className={cn(LIBRARY_OUTLINE, "overflow-hidden text-sm")} aria-label="Library">
      <div className="flex min-w-0 items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
        >
          <LibraryBigIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-semibold">
            Library
            {library === "available" && bot.library != null ? (
              <LibraryStateBadge tone="active">Shared</LibraryStateBadge>
            ) : null}
          </h3>
          {library === null ? (
            <Skeleton role="status" aria-label="Checking the Library" className="mt-1 h-3 w-56" />
          ) : (
            <p className="text-xs text-muted-foreground">
              {library !== "available"
                ? LIBRARY_NOTICE[library]
                : bot.library != null
                  ? `Shared with your other computers, revision ${bot.library.revision}.`
                  : "Only on this computer. Share it to run it on your other computers."}
            </p>
          )}
        </div>
        {library === "available" ? (
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={!canChange || busy}
            onClick={() => void toggleShared()}
          >
            {bot.library == null ? "Share to Library" : "Stop sharing"}
          </Button>
        ) : null}
      </div>
      {bot.library?.modelOverride ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          This computer runs it on {bot.library.modelOverride.model}; the Library keeps the shared
          model for the others.
        </p>
      ) : null}
      {library === "available" && others.length > 0 ? (
        <PanelPart label="Your other computers">
          <ul aria-label="Computers" className="flex flex-col">
            {others.map((target) => (
              <li key={target.environmentId} className="flex min-w-0 items-center gap-3 py-2">
                <MonitorIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{target.label}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <LibraryStateDot
                    tone={target.ready ? "success" : "warning"}
                    className="size-1.5"
                  />
                  <span className="truncate">{readinessText(target)}</span>
                </span>
              </li>
            ))}
          </ul>
        </PanelPart>
      ) : null}
      {slots.length > 0 ? (
        <PanelPart label="Vault slots on this computer">
          <ul className="flex flex-col">
            {slots.map((slot) => {
              const binding = bindingsQuery.data?.bindings.find(
                (entry) => entry.slot === slot.name,
              );
              const state: SlotState = !bindingsQuery.data
                ? bindingsQuery.error
                  ? "unbound"
                  : "loading"
                : binding?.itemId == null
                  ? "unbound"
                  : binding.itemLabel == null
                    ? "unreadable"
                    : "bound";
              return (
                <VaultSlotBinding
                  key={slot.name}
                  environmentId={environmentId}
                  bot={bot}
                  slot={slot}
                  itemLabel={binding?.itemLabel ?? null}
                  state={state}
                  canChange={canChange}
                  onChanged={() => {
                    bindingsQuery.refresh();
                    refreshTargets();
                  }}
                />
              );
            })}
          </ul>
        </PanelPart>
      ) : null}
      {error ? (
        <div className="border-t border-border px-4">
          <LibraryErrorNotice error={error} />
        </div>
      ) : null}
    </section>
  );
}

const CEILING_MODES: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

/** Whether this computer runs bots for the others, and how far their runs may reach. */
export function BotRemoteRunsSettings({
  environmentId,
  canChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly canChange: boolean;
}) {
  const settingsQuery = useEnvironmentQuery(bots.remoteSettings({ environmentId, input: {} }));
  const save = useAtomCommand(bots.setRemoteSettings, { reportFailure: false });
  const sync = useAtomCommand(bots.syncLibrary, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = settingsQuery.data;

  const act = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const change = (patch: Partial<NonNullable<typeof settings>>) =>
    act(async () => {
      if (settings === null) return null;
      const result = await save({ environmentId, input: { ...settings, ...patch } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      settingsQuery.refresh();
      return null;
    });

  const syncNow = () =>
    act(async () => {
      const result = await sync({ environmentId, input: {} });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const { pulled, refused } = result.value;
      const summary =
        pulled === 0
          ? "Every shared bot is up to date."
          : `Brought in ${pulled} shared ${pulled === 1 ? "bot" : "bots"}.`;
      return [summary, ...refused.map((entry) => entry.message)].join(" ");
    });

  return (
    <LibrarySection
      title="Remote runs"
      icon={MonitorSmartphoneIcon}
      action={
        <Button
          shape="pill"
          size="xs"
          variant="outline"
          disabled={!canChange || busy}
          onClick={() => void syncNow()}
        >
          <RefreshCwIcon />
          Sync shared bots
        </Button>
      }
    >
      <p className="-mt-1 max-w-prose text-sm text-muted-foreground">
        Let your other computers run shared bots here. Their runs show on this computer as requested
        by the computer that sent them.
      </p>
      {notice ? <LibraryNotice icon={CheckIcon}>{notice}</LibraryNotice> : null}
      <LibraryErrorNotice error={settingsQuery.error} onRetry={settingsQuery.refresh} />
      {settings ? (
        <div className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border text-sm")}>
          <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
            <span className="min-w-0 font-medium">Run bots for other computers</span>
            <Switch
              checked={settings.acceptRemote}
              disabled={!canChange || busy}
              onCheckedChange={(acceptRemote) => void change({ acceptRemote })}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <label htmlFor="bots-remote-ceiling" className="min-w-0">
              <span className="block font-medium">Highest permissions for their runs</span>
              <span className="block text-xs text-muted-foreground">
                A shared bot that needs more is refused here.
              </span>
            </label>
            <Choice
              id="bots-remote-ceiling"
              value={settings.runtimeModeCeiling}
              labels={RUNTIME_MODE_LABELS}
              options={CEILING_MODES}
              disabled={!canChange || busy}
              onChange={(runtimeModeCeiling) => void change({ runtimeModeCeiling })}
            />
          </div>
        </div>
      ) : settingsQuery.error ? null : (
        <div
          role="status"
          aria-label="Loading remote run settings"
          className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
        >
          {SETTING_SKELETONS.map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-2.5 w-64" />
              </div>
              <Skeleton shape="pill" className="h-6 w-24" />
            </div>
          ))}
        </div>
      )}
      <LibraryErrorNotice error={error} />
    </LibrarySection>
  );
}

const SETTING_SKELETONS = ["accept", "ceiling"];

// STUB(bots-redesign): replaced by the owning area's implementation.
/** The header control that opens the Computers sheet, with whether this computer takes remote runs. */
export function ComputersButton() {
  return null;
}

/** The Computers sheet (`computers`), over whichever page is open. */
export function ComputersOverlay() {
  return null;
}

/** Sharing and credentials for one bot, for the aside of its Overview. */
export function BotSharingAside(_props: { readonly bot: StubBot }) {
  return null;
}
