import { useState, type ReactNode } from "react";
import {
  BadgeXIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WebhookIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_TRIGGER_EVENT_FIELDS,
  type BotDefinition,
  type BotParameter,
  type BotPipeline,
  type BotTrigger,
  type BotTriggerEventKind,
} from "@t3tools/contracts/fork";
import {
  botColor,
  TRIGGER_KIND_LABELS,
  triggerDraftFrom,
  triggerInputFromDraft,
  WEEKDAY_LABELS,
  type MappingDraft,
  type MappingMode,
  type TriggerDraft,
  type TriggerFollow,
  type TriggerTarget,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  WizardFooter,
  WizardHeader,
  WizardPanel,
  WizardPopup,
  WizardSteps,
} from "~/components/ui/wizard";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryField, LibraryNotice, LibrarySpecSheet } from "../project-library/LibraryControls";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BotTile } from "./BotIdentity";
import { bots } from "./state";
import {
  DAY_PRESETS,
  dayPresetOf,
  defaultTriggerName,
  everyMinutesFrom,
  firstProblemStep,
  generateWebhookSecret,
  INTERVAL_PRESETS,
  intervalParts,
  limitsPhrase,
  mappingLines,
  newTriggerDraft,
  PIPELINE_PER_FILE,
  remapForKind,
  reviseTriggerDraft,
  schedulePhrase,
  TRIGGER_KINDS,
  TRIGGER_STEPS,
  triggerStepProblem,
  triggerWhen,
  upcomingDays,
  type IntervalUnit,
  type TriggerStepContext,
} from "./triggerDraft";

export const TRIGGER_KIND_ICONS: Record<BotTriggerEventKind, LucideIcon> = {
  "pull-request-checks-failing": BadgeXIcon,
  "pull-request-opened": PullRequestGlyph.pullRequest,
  "thread-settled": MessageSquareIcon,
  "merge-conflict": PullRequestGlyph.conflicting,
  webhook: WebhookIcon,
  schedule: ClockIcon,
};

export const TRIGGER_KIND_HINTS: Record<BotTriggerEventKind, string> = {
  "pull-request-checks-failing":
    "Fires when a linked pull request's checks turn failing, and again for a new failing commit.",
  "pull-request-opened": "Fires the first time Loom sees a linked pull request open.",
  "thread-settled": "Fires when a thread in the project settles. Bot runs never start it.",
  "merge-conflict":
    "Fires when the fork integrate script reports conflicts. Each file runs as one batch item.",
  webhook:
    "Fires on each request to the trigger's address. Map inputs from body, headers or query.",
  schedule: "Fires on an interval or at a time of day.",
};

const STEP_LABELS = ["Kind", "When", "What it runs", "Review"] as const;

export const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** Why trigger actions are off, or null when they are on. */
export function triggerOperateReason(host: {
  readonly connected: boolean;
  readonly canOperate: boolean;
  readonly hostLabel: string;
}): string | null {
  if (!host.connected) return `${host.hostLabel} is offline. Triggers can change once it is back.`;
  return host.canOperate ? null : "This connection can see triggers but not change them.";
}

/** A trigger's kind as a tile, in its bot's color while on and grey while paused. */
export function TriggerKindTile({
  kind,
  muted = false,
  size = "md",
}: {
  readonly kind: BotTriggerEventKind;
  readonly muted?: boolean;
  readonly size?: "sm" | "md";
}) {
  const Icon = TRIGGER_KIND_ICONS[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "sm" ? "size-6 rounded-md" : "size-8 rounded-lg",
        muted
          ? "bg-muted text-muted-foreground dark:bg-accent"
          : "bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}

function OptionSelect<T extends string>({
  label,
  value,
  options,
  placeholder = "Choose…",
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: T | null;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const chosen = options.find(([key]) => key === value)?.[1];
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find(([key]) => key === next);
        if (option) onChange(option[0]);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue>{chosen ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map(([key, text]) => (
          <SelectItem key={key} value={key} label={text}>
            {text}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A choice drawn as a card: neutral outline, the bot's color only in its fill once chosen. */
function ChoiceCard({
  selected,
  disabled,
  leading,
  title,
  detail,
  onSelect,
}: {
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly leading: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-foreground/20 bg-(--project-color)/8 dark:bg-(--project-color)/12"
          : "border-border enabled:hover:bg-accent/40",
      )}
    >
      {leading}
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function StepHeading({
  title,
  hint,
}: {
  readonly title: string;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function KindStep({
  draft,
  onKind,
}: {
  readonly draft: TriggerDraft;
  readonly onKind: (kind: BotTriggerEventKind) => void;
}) {
  return (
    <div className="grid gap-3">
      <StepHeading title="What starts it" />
      <div role="group" aria-label="What starts it" className="grid gap-2 sm:grid-cols-2">
        {TRIGGER_KINDS.map((kind) => {
          const blocked = kind === "merge-conflict" && draft.pipelineId !== "";
          return (
            <ChoiceCard
              key={kind}
              selected={draft.kind === kind}
              disabled={blocked}
              leading={<TriggerKindTile kind={kind} muted={draft.kind !== kind} />}
              title={TRIGGER_KIND_LABELS[kind]}
              detail={blocked ? PIPELINE_PER_FILE : TRIGGER_KIND_HINTS[kind]}
              onSelect={() => onKind(kind)}
            />
          );
        })}
      </div>
    </div>
  );
}

const UNIT_OPTIONS: ReadonlyArray<readonly [IntervalUnit, string]> = [
  ["minutes", "minutes"],
  ["hours", "hours"],
  ["days", "days"],
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DATE_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function ScheduleFields({
  draft,
  hostLabel,
  update,
}: {
  readonly draft: TriggerDraft;
  readonly hostLabel: string;
  readonly update: (patch: Partial<TriggerDraft>) => void;
}) {
  // The typed amount and unit live here, so "1.5 hours" does not turn into "90 minutes" mid-edit.
  const [interval, setIntervalParts] = useState(() => intervalParts(draft.everyMinutes));
  const minute = useNowMinute();
  const phrase = schedulePhrase(draft);
  const setAmount = (amount: string, unit: IntervalUnit) => {
    setIntervalParts({ amount, unit });
    update({ everyMinutes: everyMinutesFrom(amount, unit) });
  };
  const shownDays = draft.weekdays.length === 0 ? ALL_DAYS : draft.weekdays;
  const preset = dayPresetOf(draft.weekdays);
  const upcoming =
    draft.scheduleType === "fixed_time"
      ? upcomingDays(draft, new Date(Date.parse(`${minute}:00Z`)), 3)
      : [];
  return (
    <div className="grid gap-4">
      <ToggleGroup
        shape="pill"
        variant="segmented"
        aria-label="How it repeats"
        value={[draft.scheduleType]}
        onValueChange={(values) => {
          const next = values[0];
          if (next === "interval" || next === "fixed_time") update({ scheduleType: next });
        }}
      >
        <ToggleGroupItem value="interval">On an interval</ToggleGroupItem>
        <ToggleGroupItem value="fixed_time">At a time of day</ToggleGroupItem>
      </ToggleGroup>
      {draft.scheduleType === "interval" ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Every</span>
            <div className="w-20">
              <Input
                aria-label="How many"
                inputMode="decimal"
                value={interval.amount}
                onChange={(event) => setAmount(event.target.value, interval.unit)}
              />
            </div>
            <div className="w-28">
              <OptionSelect
                label="Unit"
                value={interval.unit}
                options={UNIT_OPTIONS}
                onChange={(unit) => setAmount(interval.amount, unit)}
              />
            </div>
            <div role="group" aria-label="Common intervals" className="flex flex-wrap gap-1">
              {INTERVAL_PRESETS.map((choice) => {
                const pressed = draft.everyMinutes === String(choice.minutes);
                return (
                  <Button
                    key={choice.label}
                    shape="pill"
                    size="xs"
                    variant={pressed ? "secondary" : "ghost"}
                    aria-pressed={pressed}
                    onClick={() => {
                      const parts = intervalParts(String(choice.minutes));
                      setAmount(parts.amount, parts.unit);
                    }}
                  >
                    {choice.label}
                  </Button>
                );
              })}
            </div>
          </div>
          {phrase ? (
            <p className="text-xs text-muted-foreground">
              Runs {phrase}. The first run comes one interval after you save it.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <LibraryField label="Time">
              <div className="w-32">
                <Input
                  type="time"
                  nativeInput
                  value={draft.timeOfDay}
                  onChange={(event) => update({ timeOfDay: event.target.value })}
                />
              </div>
            </LibraryField>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Days</span>
              <ToggleGroup
                multiple
                shape="pill"
                variant="segmented"
                aria-label="Days"
                value={shownDays.map(String)}
                onValueChange={(values) => {
                  // A schedule runs on at least one day; "every day" is stored as no days.
                  if (values.length === 0) return;
                  const days = values.map(Number).toSorted((left, right) => left - right);
                  update({ weekdays: days.length === 7 ? [] : days });
                }}
              >
                {WEEKDAY_LABELS.map((label, day) => (
                  <ToggleGroupItem key={label} value={String(day)}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
          <div role="group" aria-label="Common days" className="flex flex-wrap gap-1">
            {DAY_PRESETS.map((choice) => (
              <Button
                key={choice.label}
                shape="pill"
                size="xs"
                variant={preset === choice.label ? "secondary" : "ghost"}
                aria-pressed={preset === choice.label}
                onClick={() => update({ weekdays: choice.days })}
              >
                {choice.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {phrase ? `Runs ${phrase} on ${hostLabel}'s clock, which may differ from yours.` : null}
            {upcoming.length > 0
              ? ` Next: ${upcoming.map((day) => DATE_LABEL.format(day)).join(", ")}.`
              : null}
          </p>
        </div>
      )}
    </div>
  );
}

function WebhookFields({
  draft,
  hasSecret,
  hasAddress,
  update,
}: {
  readonly draft: TriggerDraft;
  readonly hasSecret: boolean;
  readonly hasAddress: boolean;
  readonly update: (patch: Partial<TriggerDraft>) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "signing secret" });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Each request to the trigger&apos;s address fires it, with the request&apos;s body, headers
        and query as fields.{" "}
        {hasAddress ? "The address is on the trigger." : "The address appears once you save."}
      </p>
      <div className="grid gap-3 rounded-xl border border-border p-3">
        <label className="flex items-start gap-3">
          <Switch checked={draft.signed} onCheckedChange={(signed) => update({ signed })} />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">Check a signature</span>
            <span className="text-xs text-muted-foreground">
              Accept only requests signed with a shared secret (HMAC-SHA256), as GitHub sends them.
              Without it, anyone with the address can fire it.
            </span>
          </span>
        </label>
        {draft.signed ? (
          <>
            <LibraryField label="Secret">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                <div className="min-w-0 flex-1 basis-56">
                  <Input
                    type={reveal ? "text" : "password"}
                    font="mono"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={500}
                    placeholder={
                      hasSecret ? "Stored secret kept" : "The secret the sender signs with"
                    }
                    value={draft.secret}
                    onChange={(event) => update({ secret: event.target.value })}
                  />
                </div>
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    update({ secret: generateWebhookSecret() });
                    setReveal(true);
                  }}
                >
                  <RefreshCwIcon />
                  Generate
                </Button>
                <Button
                  shape="pill"
                  size="sm"
                  variant="ghost"
                  disabled={draft.secret === ""}
                  onClick={() => copyToClipboard(draft.secret, undefined)}
                >
                  <CopyIcon />
                  {isCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            </LibraryField>
            <p className="text-xs text-muted-foreground">
              {draft.secret !== ""
                ? "Give the sender this secret too. Loom keeps it but never shows it again."
                : hasSecret
                  ? "Leave it empty to keep the stored secret."
                  : "Paste the sender's secret, or generate one and give it to the sender."}
            </p>
            <div>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                aria-expanded={advanced}
                onClick={() => setAdvanced((open) => !open)}
              >
                Header and encoding
                <ChevronDownIcon />
              </Button>
            </div>
            {advanced ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <LibraryField label="Header">
                  <Input
                    font="mono"
                    value={draft.signatureHeader}
                    onChange={(event) => update({ signatureHeader: event.target.value })}
                  />
                </LibraryField>
                <LibraryField label="Prefix">
                  <Input
                    font="mono"
                    placeholder="None"
                    value={draft.signaturePrefix}
                    onChange={(event) => update({ signaturePrefix: event.target.value })}
                  />
                </LibraryField>
                <div className="grid gap-2">
                  <span className="text-sm font-medium">Encoding</span>
                  <ToggleGroup
                    shape="pill"
                    variant="segmented"
                    aria-label="Encoding"
                    value={[draft.signatureEncoding]}
                    onValueChange={(values) => {
                      const next = values[0];
                      if (next === "hex" || next === "base64") update({ signatureEncoding: next });
                    }}
                  >
                    <ToggleGroupItem value="hex">Hex</ToggleGroupItem>
                    <ToggleGroupItem value="base64">Base64</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function WhenStep({
  draft,
  projects,
  hostLabel,
  hasSecret,
  hasAddress,
  update,
}: {
  readonly draft: TriggerDraft;
  readonly projects: ReadonlyArray<readonly [string, string]>;
  readonly hostLabel: string;
  readonly hasSecret: boolean;
  readonly hasAddress: boolean;
  readonly update: (patch: Partial<TriggerDraft>) => void;
}) {
  const pullRequest =
    draft.kind === "pull-request-checks-failing" || draft.kind === "pull-request-opened";
  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <StepHeading
          title={TRIGGER_KIND_LABELS[draft.kind]}
          hint={TRIGGER_KIND_HINTS[draft.kind]}
        />
        {pullRequest ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <LibraryField label="Project">
                <OptionSelect
                  label="Project"
                  value={draft.projectId === "" ? "any" : draft.projectId}
                  options={[["any", "Any project"], ...projects]}
                  onChange={(projectId) =>
                    update({ projectId: projectId === "any" ? "" : projectId })
                  }
                />
              </LibraryField>
              <LibraryField label="Repository">
                <Input
                  placeholder="Any, or owner/name"
                  maxLength={200}
                  value={draft.repository}
                  onChange={(event) => update({ repository: event.target.value })}
                />
              </LibraryField>
              <LibraryField label="Branch">
                <Input
                  placeholder="Any, or release/*"
                  maxLength={200}
                  value={draft.branchPattern}
                  onChange={(event) => update({ branchPattern: event.target.value })}
                />
              </LibraryField>
            </div>
            <p className="text-xs text-muted-foreground">
              An empty filter matches anything. In a branch, * matches any run of characters.
            </p>
          </>
        ) : null}
        {draft.kind === "thread-settled" ? (
          projects.length > 0 ? (
            <div className="sm:w-1/2">
              <LibraryField label="Project">
                <OptionSelect
                  label="Project"
                  value={draft.projectId === "" ? null : draft.projectId}
                  options={projects}
                  placeholder="Choose a project"
                  onChange={(projectId) => update({ projectId })}
                />
              </LibraryField>
            </div>
          ) : (
            <LibraryNotice icon={TriangleAlertIcon} tone="warning">
              {hostLabel} has no projects yet. Add one first, or choose another kind.
            </LibraryNotice>
          )
        ) : null}
        {draft.kind === "schedule" ? (
          <ScheduleFields draft={draft} hostLabel={hostLabel} update={update} />
        ) : null}
        {draft.kind === "webhook" ? (
          <WebhookFields
            draft={draft}
            hasSecret={hasSecret}
            hasAddress={hasAddress}
            update={update}
          />
        ) : null}
        {draft.kind === "merge-conflict" ? (
          <p className="text-sm text-muted-foreground">
            The trigger gets its own address. Set{" "}
            <span className="font-mono text-foreground">LOOM_BOTS_CONFLICT_HOOK</span> to it before
            running the fork integrate script, and each conflicting file becomes one item of a
            batch.
          </p>
        ) : null}
      </div>
      <div className="grid gap-3 border-t border-border pt-4">
        <StepHeading
          title="Limits"
          hint="A firing past a limit is skipped, and the skip shows in its history."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <LibraryField label="Runs a day, at most">
            <InputGroup>
              <InputGroupInput
                inputMode="numeric"
                value={draft.dailyLimit}
                onChange={(event) => update({ dailyLimit: event.target.value })}
              />
              <InputGroupAddon align="inline-end">runs</InputGroupAddon>
            </InputGroup>
          </LibraryField>
          <LibraryField label="Time between runs, at least">
            <InputGroup>
              <InputGroupInput
                inputMode="numeric"
                value={draft.cooldownMinutes}
                onChange={(event) => update({ cooldownMinutes: event.target.value })}
              />
              <InputGroupAddon align="inline-end">minutes</InputGroupAddon>
            </InputGroup>
          </LibraryField>
        </div>
      </div>
    </div>
  );
}

const EMPTY_MAPPING: MappingDraft = { mode: "none", field: "", value: "" };

function MappingRow({
  parameter,
  entry,
  kind,
  onChange,
}: {
  readonly parameter: BotParameter;
  readonly entry: MappingDraft;
  readonly kind: BotTriggerEventKind;
  readonly onChange: (patch: Partial<MappingDraft>) => void;
}) {
  const required = parameter.required && parameter.default === undefined;
  const fields = BOT_TRIGGER_EVENT_FIELDS[kind];
  return (
    <li className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,9rem)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{parameter.label}</span>
          {required ? (
            <span className="shrink-0 text-xs text-muted-foreground">Required</span>
          ) : null}
        </p>
        <p className="truncate font-mono text-2xs text-muted-foreground">{parameter.name}</p>
      </div>
      <ToggleGroup
        shape="pill"
        variant="segmented"
        aria-label={`Where ${parameter.label} comes from`}
        value={[entry.mode]}
        onValueChange={(values) => {
          const mode = values[0] as MappingMode | undefined;
          if (mode === "field" || mode === "value" || mode === "none") onChange({ mode });
        }}
      >
        <ToggleGroupItem value="field">{kind === "webhook" ? "Request" : "Event"}</ToggleGroupItem>
        <ToggleGroupItem value="value">Fixed</ToggleGroupItem>
        <ToggleGroupItem value="none">
          {parameter.default === undefined ? "Empty" : "Default"}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="min-w-0">
        {entry.mode === "field" ? (
          kind === "webhook" ? (
            <Input
              aria-label={`${parameter.label} request field`}
              font="mono"
              placeholder="body.pull_request.number"
              maxLength={200}
              value={entry.field}
              onChange={(event) => onChange({ field: event.target.value })}
            />
          ) : (
            <OptionSelect
              label={`${parameter.label} event field`}
              value={fields.includes(entry.field) ? entry.field : null}
              options={fields.map((field) => [field, field] as const)}
              placeholder="Choose a field"
              onChange={(field) => onChange({ field })}
            />
          )
        ) : entry.mode === "value" ? (
          parameter.type === "boolean" ? (
            <ToggleGroup
              shape="pill"
              variant="segmented"
              aria-label={`${parameter.label} value`}
              value={[entry.value === "true" ? "true" : "false"]}
              onValueChange={(values) => {
                const next = values[0];
                if (next === "true" || next === "false") onChange({ value: next });
              }}
            >
              <ToggleGroupItem value="true">Yes</ToggleGroupItem>
              <ToggleGroupItem value="false">No</ToggleGroupItem>
            </ToggleGroup>
          ) : parameter.type === "choice" && parameter.choices ? (
            <OptionSelect
              label={`${parameter.label} value`}
              value={parameter.choices.includes(entry.value) ? entry.value : null}
              options={parameter.choices.map((choice) => [choice, choice] as const)}
              onChange={(value) => onChange({ value })}
            />
          ) : (
            <Input
              aria-label={`${parameter.label} value`}
              inputMode={parameter.type === "number" ? "decimal" : undefined}
              value={entry.value}
              onChange={(event) => onChange({ value: event.target.value })}
            />
          )
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {parameter.default === undefined ? "Left empty" : `Uses ${parameter.default}`}
          </p>
        )}
      </div>
    </li>
  );
}

const FOLLOW_HINTS: Record<TriggerFollow, (bot: string, version: number) => string> = {
  pinned: (bot, version) => `Runs version ${version} even after ${bot} changes.`,
  latest: (bot) => `Runs ${bot} as last saved, so edits apply to the next run.`,
  stable: () => "Runs the version marked stable, or the latest while none is marked.",
};

function RunsStep({
  draft,
  bot,
  target,
  choices,
  locked,
  showTargets,
  pinnedVersion,
  stableSupported,
  update,
  onTarget,
}: {
  readonly draft: TriggerDraft;
  readonly bot: BotDefinition;
  readonly target: TriggerTarget;
  readonly choices: ReadonlyArray<BotPipeline>;
  readonly locked: boolean;
  readonly showTargets: boolean;
  readonly pinnedVersion: number;
  readonly stableSupported: boolean;
  readonly update: (patch: Partial<TriggerDraft>) => void;
  readonly onTarget: (pipelineId: string) => void;
}) {
  const setMapping = (name: string, patch: Partial<MappingDraft>) =>
    update({
      mapping: {
        ...draft.mapping,
        [name]: { ...(draft.mapping[name] ?? EMPTY_MAPPING), ...patch },
      },
    });
  return (
    <div className="grid gap-5">
      {showTargets ? (
        <div className="grid gap-2">
          <StepHeading
            title="Runs"
            hint={
              locked
                ? "A saved trigger keeps what it runs. Add a new trigger to run something else."
                : undefined
            }
          />
          <div role="group" aria-label="What it runs" className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              selected={draft.pipelineId === ""}
              disabled={locked}
              leading={<BotTile bot={bot} size="md" />}
              title={bot.name}
              detail={`The bot, version ${bot.version}`}
              onSelect={() => onTarget("")}
            />
            {choices.map((pipeline) => (
              <ChoiceCard
                key={pipeline.id}
                selected={draft.pipelineId === pipeline.id}
                disabled={locked || draft.kind === "merge-conflict"}
                leading={
                  <span
                    aria-hidden
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent"
                  >
                    <WorkflowIcon className="size-4" />
                  </span>
                }
                title={pipeline.name}
                detail={
                  draft.kind === "merge-conflict"
                    ? PIPELINE_PER_FILE
                    : `A pipeline of ${pipeline.steps.length} step${pipeline.steps.length === 1 ? "" : "s"}, starting with ${bot.name}`
                }
                onSelect={() => onTarget(pipeline.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2">
        <StepHeading
          title="Inputs"
          hint={
            target.parameters.length > 0
              ? `Fill each from the ${draft.kind === "webhook" ? "request" : "event"}, with a fixed value, or leave it.`
              : undefined
          }
        />
        {target.parameters.length === 0 ? (
          <p className="text-xs text-muted-foreground">{target.name} takes no inputs.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {target.parameters.map((parameter) => (
              <MappingRow
                key={parameter.name}
                parameter={parameter}
                entry={draft.mapping[parameter.name] ?? EMPTY_MAPPING}
                kind={draft.kind}
                onChange={(patch) => setMapping(parameter.name, patch)}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-2">
        <StepHeading title="Version" />
        {draft.pipelineId === "" ? (
          <>
            <ToggleGroup
              shape="pill"
              variant="segmented"
              aria-label="Version to run"
              value={[draft.follow]}
              onValueChange={(values) => {
                const follow = values[0];
                if (follow === "pinned" || follow === "latest" || follow === "stable")
                  update({ follow });
              }}
            >
              <ToggleGroupItem value="pinned">Version {pinnedVersion}</ToggleGroupItem>
              <ToggleGroupItem value="latest">Latest</ToggleGroupItem>
              {stableSupported || draft.follow === "stable" ? (
                <ToggleGroupItem value="stable">Stable</ToggleGroupItem>
              ) : null}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {FOLLOW_HINTS[draft.follow](bot.name, pinnedVersion)}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Each step runs the version its pipeline sets for it.
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  draft,
  bot,
  target,
  existing,
  suggestedName,
  preview,
  projectTitle,
  pinnedVersion,
  update,
}: {
  readonly draft: TriggerDraft;
  readonly bot: BotDefinition;
  readonly target: TriggerTarget;
  readonly existing: BotTrigger | null;
  readonly suggestedName: string;
  readonly preview: ReturnType<typeof triggerInputFromDraft>;
  readonly projectTitle: (id: string) => string;
  readonly pinnedVersion: number;
  readonly update: (patch: Partial<TriggerDraft>) => void;
}) {
  const input = "input" in preview ? preview.input : null;
  const when = input ? triggerWhen(input.event, projectTitle) : null;
  const inputs = input ? mappingLines(target, input.mapping) : [];
  const version =
    draft.pipelineId !== ""
      ? "Set by each step"
      : draft.follow === "latest"
        ? "Latest"
        : draft.follow === "stable"
          ? "Stable"
          : `Version ${pinnedVersion}`;
  const runs = draft.pipelineId === "" ? `${bot.name}, ${version.toLowerCase()}` : target.name;
  const rows = [
    { label: "When", value: when ?? "Not set yet" },
    { label: "Runs", value: draft.pipelineId === "" ? bot.name : `Pipeline ${target.name}` },
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
    { label: "Version", value: version },
    {
      label: "Limits",
      value: input ? limitsPhrase(input) : "Not set yet",
    },
    ...(draft.kind === "webhook"
      ? [
          {
            label: "Signature",
            value: draft.signed ? `Checked in ${draft.signatureHeader}` : "Not checked",
          },
        ]
      : []),
  ];
  return (
    <div className="grid gap-5">
      <LibraryField label="Name">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="min-w-0 flex-1 basis-56">
            <Input value={draft.name} onChange={(event) => update({ name: event.target.value })} />
          </div>
          {draft.name !== suggestedName ? (
            <Button
              shape="pill"
              size="sm"
              variant="ghost"
              onClick={() => update({ name: suggestedName })}
            >
              Use suggested name
            </Button>
          ) : null}
        </div>
      </LibraryField>
      {when ? (
        <p className="text-sm">
          {when}, {draft.pipelineId === "" ? "it runs" : "it starts"} {runs}.
        </p>
      ) : null}
      <LibrarySpecSheet label="What this trigger does" rows={rows} />
      <label className="flex items-start gap-3">
        <Switch checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">
            {existing ? "Run automatically" : "Run automatically once saved"}
          </span>
          <span className="text-xs text-muted-foreground">
            {draft.enabled
              ? "It fires as soon as it is saved."
              : "It is saved paused. Turn it on from the trigger when ready."}
          </span>
        </span>
      </label>
      {draft.kind === "webhook" && draft.signed && draft.secret !== "" ? (
        <LibraryNotice icon={TriangleAlertIcon} tone="warning">
          Copy the signing secret from the When step before saving. Loom never shows it again.
        </LibraryNotice>
      ) : null}
      {(draft.kind === "webhook" || draft.kind === "merge-conflict") && !existing?.webhook ? (
        <p className="text-xs text-muted-foreground">
          The address appears on the trigger once saved.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Creates or edits one trigger in four steps. A new trigger walks them in order and each step
 * says what it still needs; an edit opens on Review and any step can be reopened.
 */
export function TriggerWizard({
  environmentId,
  hostLabel,
  bot,
  existing,
  pipelines,
  initialPipelineId,
  canSave,
  saveReason,
  stableSupported,
  pipelinesSupported,
  onClose,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly hostLabel: string;
  readonly bot: BotDefinition;
  /**
   * The trigger as it is now, or null for a new one. The editor keeps the version it opened, so
   * a save elsewhere shows as a change rather than replacing the edits in progress.
   */
  readonly existing: BotTrigger | null;
  /** Every pipeline; the ones starting with this bot are offered. */
  readonly pipelines: ReadonlyArray<BotPipeline>;
  readonly initialPipelineId: string;
  readonly canSave: boolean;
  readonly saveReason: string | null;
  readonly stableSupported: boolean;
  readonly pipelinesSupported: boolean;
  readonly onClose: () => void;
  readonly onSaved: (trigger: BotTrigger) => void;
}) {
  const projects = useProjects()
    .filter((project) => project.environmentId === environmentId && !project.isScratch)
    .map((project) => [project.id as string, project.title] as const);
  const projectTitle = (id: string) =>
    projects.find(([projectId]) => projectId === id)?.[1] ?? "a removed project";
  const pipelineOf = (pipelineId: string) =>
    pipelineId === "" ? undefined : pipelines.find((pipeline) => pipeline.id === pipelineId);
  const targetOf = (pipelineId: string): TriggerTarget => pipelineOf(pipelineId) ?? bot;
  const targetName = (pipelineId: string) => targetOf(pipelineId).name;
  const draftOf = (trigger: BotTrigger | null) =>
    trigger === null
      ? newTriggerDraft(bot, targetOf(initialPipelineId), initialPipelineId)
      : triggerDraftFrom(bot, trigger, targetOf(trigger.pipelineId ?? ""));

  const [snapshot, setSnapshot] = useState(existing);
  const [baseline, setBaseline] = useState(() => draftOf(existing));
  const [draft, setDraft] = useState(baseline);
  const [revision, setRevision] = useState(0);
  const [step, setStep] = useState(existing ? TRIGGER_STEPS.length - 1 : 0);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useAtomCommand(bots.saveTrigger, { reportFailure: false });

  const target = targetOf(draft.pipelineId);
  const context: TriggerStepContext = {
    target,
    hasSecret: snapshot?.webhook?.hasSecret ?? false,
  };
  const problems = TRIGGER_STEPS.map((name) => triggerStepProblem(name, draft, context));
  const firstProblem = problems.findIndex((problem) => problem !== null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  // A save's own change can arrive before its reply, so it is not news while the save is out.
  const changedElsewhere =
    !busy && snapshot !== null && existing !== null && existing.updatedAt !== snapshot.updatedAt;
  const choices = pipelines.filter(
    (pipeline) => pipeline.steps[0]?.botId === bot.id || pipeline.id === draft.pipelineId,
  );
  const pinnedVersion = snapshot?.pinnedVersion ?? bot.version;
  const preview = triggerInputFromDraft(bot, draft, snapshot, target);

  const update = (patch: Partial<TriggerDraft>) => {
    setSaveError(null);
    setDraft((current) => reviseTriggerDraft(current, patch, targetName));
  };
  const loadLatest = () => {
    if (existing === null) return;
    const next = draftOf(existing);
    setSnapshot(existing);
    setBaseline(next);
    setDraft(next);
    setRevision((count) => count + 1);
    setSaveError(null);
  };
  const requestClose = async () => {
    if (busy) return;
    if (dirty) {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        snapshot ? `Discard your changes to ${snapshot.name}?` : "Discard this new trigger?",
        { variant: "destructive" },
      );
      if (!confirmed) return;
    }
    onClose();
  };
  const submit = async () => {
    if (busy || !canSave || changedElsewhere) return;
    const result = triggerInputFromDraft(bot, draft, snapshot, target);
    if ("error" in result) {
      setSaveError(result.error);
      const owner = firstProblemStep(draft, context);
      if (owner !== null) setStep(TRIGGER_STEPS.indexOf(owner));
      return;
    }
    setBusy(true);
    setSaveError(null);
    const saved = await save({ environmentId, input: result.input });
    setBusy(false);
    if (saved._tag === "Failure") {
      setSaveError(errorText(squashAtomCommandFailure(saved), "Could not save the trigger."));
      return;
    }
    onSaved(saved.value);
  };

  const editing = snapshot !== null;
  const last = step === TRIGGER_STEPS.length - 1;
  const stepProblem = problems[step] ?? null;
  const otherProblem =
    firstProblem >= 0 && firstProblem !== step
      ? `${STEP_LABELS[firstProblem]}: ${problems[firstProblem]}`
      : null;
  const leading = saveError ? (
    <p role="alert" className="text-sm text-destructive-foreground">
      {saveError}
    </p>
  ) : !canSave && saveReason ? (
    <p role="status" className="text-sm text-muted-foreground">
      {saveReason}
    </p>
  ) : stepProblem || ((editing || last) && otherProblem) ? (
    <p role="status" className="text-sm text-muted-foreground">
      {stepProblem ?? otherProblem}
    </p>
  ) : undefined;
  const canSubmit = canSave && !busy && !changedElsewhere && firstProblem < 0;

  const body =
    step === 0 ? (
      <KindStep
        draft={draft}
        onKind={(kind) =>
          update({
            kind,
            mapping: remapForKind(target, draft.mapping, kind),
            ...(kind === "thread-settled" && draft.projectId === "" && projects.length === 1
              ? { projectId: projects[0]![0] }
              : {}),
          })
        }
      />
    ) : step === 1 ? (
      <WhenStep
        draft={draft}
        projects={projects}
        hostLabel={hostLabel}
        hasSecret={context.hasSecret}
        hasAddress={snapshot?.webhook !== undefined}
        update={update}
      />
    ) : step === 2 ? (
      <RunsStep
        draft={draft}
        bot={bot}
        target={target}
        choices={choices}
        locked={editing}
        showTargets={pipelinesSupported && (choices.length > 0 || draft.pipelineId !== "")}
        pinnedVersion={pinnedVersion}
        stableSupported={stableSupported}
        update={update}
        onTarget={(pipelineId) => {
          const next = targetOf(pipelineId);
          update({
            pipelineId,
            mapping: remapForKind(next, {}, draft.kind),
            ...(pipelineId === "" ? {} : { follow: "pinned" as const }),
          });
        }}
      />
    ) : (
      <ReviewStep
        draft={draft}
        bot={bot}
        target={target}
        existing={snapshot}
        suggestedName={defaultTriggerName(target.name, draft)}
        preview={preview}
        projectTitle={projectTitle}
        pinnedVersion={pinnedVersion}
        update={update}
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
    >
      <WizardPopup size="wide">
        {/* WizardPopup takes no style, and its portal sits outside the page's color scope. */}
        <div className="contents" style={projectColorStyle(botColor(bot))}>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing || last) void submit();
              else if (stepProblem === null) setStep(step + 1);
            }}
          >
            <WizardHeader
              title={editing ? `Edit ${snapshot.name}` : "New trigger"}
              identity={
                <div className="flex min-w-0 items-center gap-3">
                  <BotTile bot={bot} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-tight">
                      {editing ? snapshot.name : "New trigger"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {draft.pipelineId === ""
                        ? `Runs ${bot.name}`
                        : `Starts the pipeline ${target.name}`}
                    </p>
                  </div>
                </div>
              }
            >
              <WizardSteps
                steps={STEP_LABELS}
                currentStep={step}
                onStepChange={setStep}
                isStepDisabled={(index) => !editing && firstProblem >= 0 && index > firstProblem}
              />
            </WizardHeader>
            <WizardPanel>
              <div key={`${step}:${revision}`} className="grid gap-4">
                {changedElsewhere ? (
                  <LibraryNotice
                    icon={TriangleAlertIcon}
                    tone="warning"
                    action={
                      <Button shape="pill" size="xs" variant="outline" onClick={loadLatest}>
                        Load the latest
                      </Button>
                    }
                  >
                    This trigger changed since you opened it. Load the latest to save; edits made
                    here are dropped.
                  </LibraryNotice>
                ) : null}
                {body}
              </div>
            </WizardPanel>
            <WizardFooter leading={leading}>
              <Button shape="pill" variant="ghost" onClick={() => void requestClose()}>
                Cancel
              </Button>
              {editing ? (
                <Button shape="pill" type="submit" disabled={!canSubmit}>
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              ) : (
                <>
                  {step > 0 ? (
                    <Button shape="pill" variant="outline" onClick={() => setStep(step - 1)}>
                      Back
                    </Button>
                  ) : null}
                  {last ? (
                    <Button shape="pill" type="submit" disabled={!canSubmit}>
                      {busy ? "Saving…" : "Save trigger"}
                    </Button>
                  ) : (
                    <Button shape="pill" type="submit" disabled={stepProblem !== null}>
                      Next
                    </Button>
                  )}
                </>
              )}
            </WizardFooter>
          </form>
        </div>
      </WizardPopup>
    </Dialog>
  );
}
