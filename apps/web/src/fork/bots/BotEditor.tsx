import { useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  HistoryIcon,
  LockIcon,
  PlusIcon,
  RotateCcwIcon,
  Share2Icon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_MAX_PARAMETERS,
  BOTS_MAX_VAULT_SLOTS,
  type BotDefinition,
  type BotDefinitionInput,
  type BotDraftResult,
  type BotStarterStatus,
  type BotTargetReadiness,
} from "@t3tools/contracts/fork";
import {
  botDraft,
  emptyBotDraft,
  newParameterDraft,
  newVaultSlotDraft,
  saveInputFromDraft,
  slugFromName,
  type BotDraft,
  type BotParameterDraft,
  type BotVaultSlotDraft,
  type BotWorkspaceChoice,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { scheduledTaskDefaultModel } from "~/components/settings/scheduledTasksSettings.logic";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShell } from "~/state/entities";
import { useEnvironmentQuery, useEnvironmentQueryRefresh } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryNotice,
  LibrarySpecSheet,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { LibraryEditorBar, useUnsavedChangesGuard } from "../project-library/LibraryEditor";
import { LibraryBackLink } from "../project-library/LibraryPageFrame";
import { BotTile, StarterBadge } from "./BotIdentity";
import { BotModelPicker, useBotModelChoices } from "./BotModelPicker";
import { ConfirmDialog, ReplayLaunchDialog, useLatestReplayId } from "./BotReplay";
import { BotBudgetMeter } from "./BotsUsage";
import {
  INTERACTION_MODE_LABELS,
  OUTPUT_LABELS,
  PARAMETER_TYPE_LABELS,
  RUNTIME_MODE_HINTS,
  RUNTIME_MODE_LABELS,
  VAULT_ACTION_LABELS,
  WORKSPACE_HINTS,
  WORKSPACE_LABELS,
  draftChanges,
  draftChoices,
  draftProblems,
  fieldIds,
  instructionPlaceholders,
  isParameterName,
  listText,
  modelText,
  shownProblems,
  withParameterType,
  type DraftProblem,
  type EditorSectionId,
} from "./editorLogic";
import { refineInputFromDraft } from "./fromThread/logic";
import { useBotsNavigation, type BotsPageSearch } from "./navigation";
import { bots, useBots, useBotsAccess } from "./state";

export { RUNTIME_MODE_LABELS, WORKSPACE_LABELS };

const WORKSPACE_CHOICES = Object.keys(WORKSPACE_LABELS) as BotWorkspaceChoice[];
const INSTRUCTIONS_MAX = 20_000;
const ANY_PROJECT = "";
const NO_DEFAULT = "";

const INTERACTION_MODE_HINTS = {
  default: "Makes the changes the instructions ask for and reports what it did.",
  plan: "Writes a plan and changes nothing.",
} as const;

const sectionAnchor = (id: EditorSectionId) => `bot-section-${id}`;
const problemId = (field: string) => `${field}-problem`;

/** Brings a field into view and focuses it, the way a person would go looking for it. */
const focusField = (field: string) => {
  const element = document.getElementById(field);
  if (!element) return;
  element.scrollIntoView({ block: "center" });
  element.focus({ preventScroll: true });
};

const jumpTo = (id: EditorSectionId) =>
  document.getElementById(sectionAnchor(id))?.scrollIntoView({
    block: "start",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });

const failureText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

export function Choice<T extends string>({
  id,
  value,
  labels,
  options = Object.keys(labels) as T[],
  onChange,
  disabled,
}: {
  readonly id: string;
  readonly value: T;
  readonly labels: Record<T, string>;
  readonly options?: ReadonlyArray<T>;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next as T);
      }}
    >
      <SelectTrigger size="sm" id={id}>
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((key) => (
          <SelectItem key={key} value={key} label={labels[key]}>
            {labels[key]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A problem under the field it belongs to, read out with the field. */
function FieldProblem({ problem }: { readonly problem: DraftProblem | undefined }) {
  if (!problem) return null;
  return (
    <p id={problemId(problem.field)} className="text-xs text-destructive-foreground">
      {problem.message}
    </p>
  );
}

const invalidProps = (problem: DraftProblem | undefined) =>
  problem ? { "aria-invalid": true as const, "aria-describedby": problemId(problem.field) } : {};

function EditorField({
  label,
  htmlFor,
  hint,
  problem,
  className,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly hint?: ReactNode;
  readonly problem?: DraftProblem | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {problem ? (
        <FieldProblem problem={problem} />
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** A default that fits the input's type: yes or no, one of the choices, a number, or text. */
function DefaultValueField({
  parameter,
  problem,
  onChange,
}: {
  readonly parameter: BotParameterDraft;
  readonly problem: DraftProblem | undefined;
  readonly onChange: (defaultValue: string) => void;
}) {
  const id = fieldIds.parameter(parameter.key, "default");
  if (parameter.type === "boolean" || parameter.type === "choice") {
    const options: ReadonlyArray<readonly [string, string]> =
      parameter.type === "boolean"
        ? [
            [NO_DEFAULT, "No default"],
            ["true", "Yes"],
            ["false", "No"],
          ]
        : [
            [NO_DEFAULT, "No default"],
            ...draftChoices(parameter).map((choice) => [choice, choice] as const),
          ];
    const label = (value: string) => options.find(([option]) => option === value)?.[1] ?? value;
    return (
      <Select
        value={parameter.defaultValue}
        onValueChange={(next) => onChange(typeof next === "string" ? next : NO_DEFAULT)}
      >
        <SelectTrigger size="sm" id={id} aria-label="Default" {...invalidProps(problem)}>
          <SelectValue>{label(parameter.defaultValue)}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map(([value, text]) => (
            <SelectItem key={value} value={value} label={text}>
              {text}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  }
  return (
    <Input
      id={id}
      size="sm"
      aria-label="Default"
      inputMode={parameter.type === "number" ? "decimal" : undefined}
      placeholder={parameter.type === "number" ? "Default number" : "Default (optional)"}
      value={parameter.defaultValue}
      onChange={(event) => onChange(event.target.value)}
      {...invalidProps(problem)}
    />
  );
}

const NO_PROBLEMS: ReadonlyArray<DraftProblem> = [];

/**
 * One input of a bot or pipeline: its name, label and type on the first line, its hint and a
 * default that fits the type on the second. `framed` outlines a row that sits in no list.
 */
export function ParameterRow({
  parameter,
  onChange,
  onRemove,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
  problems = NO_PROBLEMS,
  framed = true,
}: {
  readonly parameter: BotParameterDraft;
  readonly onChange: (parameter: BotParameterDraft) => void;
  readonly onRemove: () => void;
  readonly onMove?: (offset: -1 | 1) => void;
  readonly canMoveUp?: boolean;
  readonly canMoveDown?: boolean;
  readonly problems?: ReadonlyArray<DraftProblem>;
  readonly framed?: boolean;
}) {
  const problemOf = (part: Parameters<typeof fieldIds.parameter>[1]) =>
    problems.find((problem) => problem.field === fieldIds.parameter(parameter.key, part));
  const name = parameter.name.trim() || "this input";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2",
        framed ? "rounded-xl border border-border p-3" : "px-3 py-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={fieldIds.parameter(parameter.key, "name")}
          size="sm"
          font="mono"
          aria-label="Input name"
          placeholder="name"
          className="w-36"
          value={parameter.name}
          onChange={(event) => onChange({ ...parameter, name: event.target.value })}
          {...invalidProps(problemOf("name"))}
        />
        <Input
          id={fieldIds.parameter(parameter.key, "label")}
          size="sm"
          aria-label="Input label"
          placeholder="Label in the run form"
          className="min-w-40 flex-1"
          value={parameter.label}
          onChange={(event) => onChange({ ...parameter, label: event.target.value })}
          {...invalidProps(problemOf("label"))}
        />
        <div className="w-36">
          <Choice
            id={`${parameter.key}-type`}
            value={parameter.type}
            labels={PARAMETER_TYPE_LABELS}
            onChange={(type) => onChange(withParameterType(parameter, type))}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Required
          <Switch
            size="sm"
            checked={parameter.required}
            onCheckedChange={(required) => onChange({ ...parameter, required })}
          />
        </label>
        <div className="ms-auto flex items-center">
          {onMove ? (
            <>
              <Button
                shape="pill"
                size="icon-xs"
                variant="ghost"
                aria-label={`Move ${name} up`}
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                shape="pill"
                size="icon-xs"
                variant="ghost"
                aria-label={`Move ${name} down`}
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              >
                <ArrowDownIcon />
              </Button>
            </>
          ) : null}
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={fieldIds.parameter(parameter.key, "description")}
          size="sm"
          aria-label="Input hint"
          placeholder="Hint under the field (optional)"
          className="min-w-48 flex-1"
          value={parameter.description}
          onChange={(event) => onChange({ ...parameter, description: event.target.value })}
          {...invalidProps(problemOf("description"))}
        />
        <div className="w-48">
          <DefaultValueField
            parameter={parameter}
            problem={problemOf("default")}
            onChange={(defaultValue) => onChange({ ...parameter, defaultValue })}
          />
        </div>
      </div>
      {parameter.type === "choice" ? (
        <Textarea
          id={fieldIds.parameter(parameter.key, "choices")}
          size="sm"
          rows={3}
          aria-label="Choices, one per line"
          placeholder="One choice per line"
          value={parameter.choices}
          onChange={(event) => onChange({ ...parameter, choices: event.target.value })}
          {...invalidProps(problemOf("choices"))}
        />
      ) : null}
      {problems.map((problem) => (
        <FieldProblem key={problem.field} problem={problem} />
      ))}
    </div>
  );
}

function VaultSlotRow({
  slot,
  problems,
  onChange,
  onRemove,
}: {
  readonly slot: BotVaultSlotDraft;
  readonly problems: ReadonlyArray<DraftProblem>;
  readonly onChange: (slot: BotVaultSlotDraft) => void;
  readonly onRemove: () => void;
}) {
  const problemOf = (part: Parameters<typeof fieldIds.slot>[1]) =>
    problems.find((problem) => problem.field === fieldIds.slot(slot.key, part));
  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={fieldIds.slot(slot.key, "name")}
          size="sm"
          font="mono"
          aria-label="Slot name"
          placeholder="github-token"
          className="w-40"
          value={slot.name}
          onChange={(event) => onChange({ ...slot, name: event.target.value })}
          {...invalidProps(problemOf("name"))}
        />
        <Input
          id={fieldIds.slot(slot.key, "label")}
          size="sm"
          aria-label="Slot label"
          placeholder="GitHub token"
          className="min-w-40 flex-1"
          value={slot.label}
          onChange={(event) => onChange({ ...slot, label: event.target.value })}
          {...invalidProps(problemOf("label"))}
        />
        <div className="w-44">
          <Choice
            id={`${slot.key}-action`}
            value={slot.action}
            labels={VAULT_ACTION_LABELS}
            onChange={(action) => onChange({ ...slot, action })}
          />
        </div>
        <Button
          shape="pill"
          size="icon-xs"
          variant="ghost"
          aria-label={`Remove ${slot.name.trim() || "this slot"}`}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      <Input
        id={fieldIds.slot(slot.key, "destination")}
        size="sm"
        aria-label="Destination"
        placeholder="Where it may be sent, such as https://api.github.com (optional)"
        value={slot.destination}
        onChange={(event) => onChange({ ...slot, destination: event.target.value })}
        {...invalidProps(problemOf("destination"))}
      />
      {problems.map((problem) => (
        <FieldProblem key={problem.field} problem={problem} />
      ))}
    </div>
  );
}

/** One group of the editor, set off by a hairline and its heading rather than a box. */
function EditorSection({
  id,
  title,
  count,
  hint,
  action,
  children,
}: {
  readonly id: EditorSectionId;
  readonly title: string;
  readonly count?: number;
  readonly hint?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const headingId = `${sectionAnchor(id)}-title`;
  return (
    <section
      id={sectionAnchor(id)}
      aria-labelledby={headingId}
      className="flex min-w-0 scroll-mt-6 flex-col gap-4 border-t border-border pt-6"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={headingId} className="flex items-baseline gap-1.5 text-sm font-semibold">
            {title}
            {count ? (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </h2>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A short set of choices shown at once, so the current one reads without opening a menu. */
function Segmented<T extends string>({
  id,
  label,
  value,
  labels,
  hint,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly labels: Record<T, string>;
  readonly hint?: string;
  readonly onChange: (value: T) => void;
}) {
  const options = Object.keys(labels) as T[];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={id} className="text-sm font-medium">
        {label}
      </p>
      <ToggleGroup
        shape="pill"
        variant="segmented"
        aria-labelledby={id}
        value={[value]}
        onValueChange={(next) => {
          const chosen = options.find((option) => option === next[0]);
          if (chosen) onChange(chosen);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option} value={option}>
            {labels[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Jumps within the page; the editor stays one column, so this never becomes a sidebar. */
function SectionIndex({
  sections,
  flagged,
}: {
  readonly sections: ReadonlyArray<{ readonly id: EditorSectionId; readonly title: string }>;
  readonly flagged: ReadonlySet<EditorSectionId>;
}) {
  return (
    <nav aria-label="Editor sections" className="flex flex-wrap items-center gap-1">
      {sections.map((section) => (
        <Button
          key={section.id}
          shape="pill"
          size="xs"
          variant="ghost-muted"
          onClick={() => jumpTo(section.id)}
        >
          {flagged.has(section.id) ? (
            <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
          ) : null}
          {section.title}
          {flagged.has(section.id) ? <span className="sr-only">, needs a fix</span> : null}
        </Button>
      ))}
    </nav>
  );
}

/** The instructions, with the inputs they name beside them and one click to add a missing one. */
function InstructionsEditor({
  value,
  parameters,
  problem,
  canAddInput,
  onChange,
  onAddInput,
}: {
  readonly value: string;
  readonly parameters: ReadonlyArray<BotParameterDraft>;
  readonly problem: DraftProblem | undefined;
  readonly canAddInput: boolean;
  readonly onChange: (value: string) => void;
  readonly onAddInput: (name: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const declared = parameters.map((parameter) => parameter.name.trim()).filter(Boolean);
  const placeholders = instructionPlaceholders(value, declared);
  const insert = (name: string) => {
    const element = field.current;
    const placeholder = `{{${name}}}`;
    if (!element) return onChange(`${value}${placeholder}`);
    const start = element.selectionStart;
    const end = element.selectionEnd;
    onChange(`${value.slice(0, start)}${placeholder}${value.slice(end)}`);
    const caret = start + placeholder.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={field}
        id={fieldIds.instructions}
        aria-label="Instructions"
        value={value}
        placeholder={
          "Review {{pr}} for correctness. Report each problem with its file and line, and say how sure you are."
        }
        onChange={(event) => onChange(event.target.value)}
        {...invalidProps(problem)}
        className="field-sizing-content max-h-160 min-h-72 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 focus-visible:ring-inset aria-invalid:border-destructive/36 disabled:opacity-64 dark:bg-input/32"
      />
      <FieldProblem problem={problem} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {declared.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span>Insert</span>
            {declared.map((name) => (
              <Button
                key={name}
                shape="pill"
                size="xs"
                variant="secondary"
                aria-label={`Insert {{${name}}}`}
                onClick={() => insert(name)}
              >
                <span className="font-mono">{`{{${name}}}`}</span>
              </Button>
            ))}
          </div>
        ) : (
          <span>
            Name an input in double braces, such as {"{{pr}}"}, and each run fills in its value.
          </span>
        )}
        <span className="ms-auto tabular-nums">
          {value.length.toLocaleString("en-US")} / {INSTRUCTIONS_MAX.toLocaleString("en-US")}
        </span>
      </div>
      {placeholders.undeclared.length > 0 ? (
        <ul aria-label="Placeholders that are not inputs" className="flex flex-col gap-1 text-xs">
          {placeholders.undeclared.map((name) => (
            <li key={name} className="flex flex-wrap items-center gap-2 text-warning-foreground">
              <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
              <span>
                <span className="font-mono">{`{{${name}}}`}</span> is not an input, so runs see it
                as written.
              </span>
              {canAddInput && isParameterName(name) ? (
                <Button shape="pill" size="xs" variant="outline" onClick={() => onAddInput(name)}>
                  <PlusIcon />
                  Add input
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {placeholders.unused.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          The instructions never name {listText(placeholders.unused.map((name) => `{{${name}}}`))}.
          A run only uses {placeholders.unused.length === 1 ? "that input" : "those inputs"} if the
          instructions say where.
        </p>
      ) : null}
    </div>
  );
}

const AVAILABILITY_TEXT: Record<NonNullable<BotTargetReadiness["availability"]>, string> = {
  ready: "Ready",
  busy: "Busy",
  offline: "Offline",
  blocked: "Cannot run it",
  unknown: "Not reported",
};

const readinessText = (target: BotTargetReadiness) => {
  const state =
    target.availability ?? (target.online ? (target.ready ? "ready" : "blocked") : "offline");
  if (state === "ready")
    return target.freeSlots === 1 ? "Ready, 1 free slot" : `Ready, ${target.freeSlots} free slots`;
  const reason = target.reasons[0];
  return reason ? `${AVAILABILITY_TEXT[state]}: ${reason}` : AVAILABILITY_TEXT[state];
};

/** Which computers run the bot, and what saving does to its shared copy. */
function SharingSection({
  environmentId,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition | null;
}) {
  const targets = useEnvironmentQuery(
    bot ? bots.targets({ environmentId, input: { botId: bot.id } }) : null,
  );
  const link = bot?.library ?? null;
  return (
    <EditorSection
      id="sharing"
      title="Where it runs"
      hint="A shared bot runs on any computer connected to your Library. Each computer keeps its own credentials."
    >
      {link ? (
        <LibraryNotice icon={Share2Icon}>
          <p>
            Shared through your Library at revision {link.revision}. Saving publishes this version
            to your other computers.
          </p>
          {link.modelOverride ? (
            <p className="mt-1">
              This computer runs it with {modelText(link.modelOverride)}, since the shared model is
              not set up here. That choice stays on this computer.
            </p>
          ) : null}
        </LibraryNotice>
      ) : (
        <p className="text-sm text-muted-foreground">
          {bot
            ? "Runs on this computer only. Share it from its page to run it on your other computers."
            : "Runs on this computer. Once it is saved, share it from its page to run it on your other computers."}
        </p>
      )}
      {bot ? (
        targets.error ? (
          <LibraryErrorNotice error={targets.error} onRetry={targets.refresh} />
        ) : !targets.data ? (
          <div role="status" aria-label="Loading computers" className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        ) : targets.data.targets.length > 0 ? (
          <LibrarySpecSheet
            label="Computers that can run it"
            rows={targets.data.targets.map((target) => ({
              label: target.isThisComputer ? `${target.label} (this computer)` : target.label,
              value: readinessText(target),
            }))}
          />
        ) : null
      ) : null}
    </EditorSection>
  );
}

type ModelWork = "refine" | "suggest";

const MODEL_WORK = {
  refine: {
    status: "Refining with the thread's model. This can take up to three minutes.",
    note: "Refined by the model. Check the draft before saving.",
    failure: "Could not refine the draft.",
    title: "Refine this draft?",
    confirm:
      "The model rewrites the whole form from this draft and the thread. Edits it does not keep are lost.",
    action: "Refine",
  },
  suggest: {
    status: "Reading the runs rated Bad. This can take up to three minutes.",
    note: "Suggested by the model. Check the edit, or try it on past runs, before saving.",
    failure: "Could not suggest an edit.",
    title: "Replace your changes?",
    confirm:
      "The suggestion starts from the saved version and replaces the whole form, so your changes here are lost.",
    action: "Suggest an edit",
  },
} as const;

const EDITOR_KEYS = ["bot", "edit", "newBot", "fromThread", "suggestion"] as const;

/** The search keys that pick the editor page, so a move that keeps them keeps the editor. */
const editorPageOf = (search: object) => {
  const values = search as Readonly<Record<string, unknown>>;
  return JSON.stringify(EDITOR_KEYS.map((key) => values[key] ?? null));
};

/**
 * The bot editor: a new bot for `bot === null`, a thread's draft with `fromThread`. Saving opens
 * the bot's page, after dismissing the suggestion the draft answers.
 */
export function BotEditorForm({
  environmentId,
  bot,
  fromThread,
  suggestionId = null,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition | null;
  readonly fromThread?: BotDraftResult;
  readonly suggestionId?: string | null;
}) {
  const nav = useBotsNavigation();
  const { host } = useBots();
  const access = useBotsAccess();
  const lastReplay = useLatestReplayId(bot?.id ?? null);
  const { settings, instanceEntries } = useBotModelChoices(environmentId);
  const defaultModel = scheduledTaskDefaultModel(settings, null, instanceEntries);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const sourceThread = useThreadShell(
    fromThread ? { environmentId, threadId: fromThread.sourceThreadId } : null,
  );

  const [start] = useState(() =>
    bot ? botDraft(bot) : fromThread ? botDraft(fromThread.draft) : emptyBotDraft(null),
  );
  /** The saved bot the draft started from; saving expects the server to still have it. */
  const [base, setBase] = useState(bot);
  const [initial, setInitial] = useState(start);
  const [draft, setDraft] = useState(start);
  /** The model's last draft, so asking again only warns about edits made since. */
  const [lastDrafted, setLastDrafted] = useState(start);
  // A drafted id is already free on the server; renaming must not trade it for a taken one.
  const [idTouched, setIdTouched] = useState(bot !== null || fromThread !== undefined);
  const [notes, setNotes] = useState<ReadonlyArray<string>>(fromThread?.notes ?? []);
  const [refining, setRefining] = useState<string | null>(null);
  const refineAttempt = useRef(0);
  const [confirming, setConfirming] = useState<ModelWork | "starter" | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayDraft, setReplayDraft] = useState<BotDefinitionInput | null>(null);

  const save = useAtomCommand(bots.save, { reportFailure: false });
  const dismissSuggestion = useAtomCommand(bots.dismissSuggestion, { reportFailure: false });
  const openSuggestions = useEnvironmentQueryRefresh(
    suggestionId === null ? null : bots.suggestions({ environmentId, input: {} }),
  );
  const refineDraft = useAtomCommand(bots.refineDraft, { reportFailure: false });
  const suggestEdit = useAtomCommand(bots.suggestEdit, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const starterId = host.startersSupported ? base?.origin?.starterId : undefined;
  const starters = useEnvironmentQuery(
    starterId ? bots.listStarters({ environmentId, input: {} }) : null,
  );
  const starter: BotStarterStatus | undefined = starters.data?.starters.find(
    (entry) => entry.starterId === starterId,
  );

  // The default model can arrive after the form opens; filling it in is not an edit.
  const filled = (value: BotDraft): BotDraft =>
    value.modelSelection === null && defaultModel !== null
      ? { ...value, modelSelection: defaultModel }
      : value;
  const current = filled(draft);
  const changes = draftChanges(filled(initial), current);
  const dirty = changes.length > 0;
  const problems = draftProblems(current);
  const shown = shownProblems(problems, attempted);
  const problemFor = (field: string) => shown.find((problem) => problem.field === field);
  const flagged = new Set(shown.map((problem) => problem.section));

  const { leave } = useUnsavedChangesGuard({
    dirty,
    message: "Discard your changes to this bot?",
    staysOpen: (next) =>
      next.pathname === "/loom/bots" &&
      typeof next.search === "object" &&
      next.search !== null &&
      editorPageOf(next.search) === editorPageOf(nav.search),
  });

  const update = (patch: Partial<BotDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const projectTitle = (id: string) =>
    projects.find((project) => project.id === id)?.title ?? (id === ANY_PROJECT ? "" : id);
  const back: BotsPageSearch = bot ? { bot: bot.id } : {};
  const isNew = bot === null;
  const archived = base?.archivedAt != null;
  const conflict = bot !== null && base !== null && bot.version !== base.version ? bot : null;
  const locked = refining !== null || busy;
  const readOnly = host.connected && !access.canSave;

  const showProblems = (list: ReadonlyArray<DraftProblem>) => {
    setAttempted(true);
    const first = list[0];
    if (first) focusField(first.field);
  };

  // Only the newest attempt may replace the draft, so a cancelled one that finishes is ignored.
  const draftWithModel = async (work: ModelWork) => {
    if (locked || !access.canSave) return;
    const copy = MODEL_WORK[work];
    let request: () => Promise<
      Awaited<ReturnType<typeof refineDraft>> | Awaited<ReturnType<typeof suggestEdit>>
    >;
    if (work === "refine") {
      if (!fromThread) return;
      const checked = refineInputFromDraft(current);
      if (!checked.ok) {
        if (problems.length > 0) showProblems(problems);
        else setError(checked.message);
        return;
      }
      request = () =>
        refineDraft({
          environmentId,
          input: { threadId: fromThread.sourceThreadId, draft: checked.draft },
        });
    } else {
      if (!bot) return;
      request = () => suggestEdit({ environmentId, input: { botId: bot.id } });
    }
    const attempt = ++refineAttempt.current;
    setRefining(copy.status);
    setError(null);
    try {
      const result = await request();
      if (attempt !== refineAttempt.current) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const next = botDraft(result.value.draft);
      setDraft(next);
      setLastDrafted(next);
      setNotes(result.value.notes.length > 0 ? result.value.notes : [copy.note]);
    } catch (cause) {
      if (attempt === refineAttempt.current) setError(failureText(cause, copy.failure));
    } finally {
      if (attempt === refineAttempt.current) setRefining(null);
    }
  };

  const askModel = (work: ModelWork) => {
    if (draftChanges(filled(lastDrafted), current).length > 0) setConfirming(work);
    else void draftWithModel(work);
  };

  // Stops waiting only; the drafting thread still ends at its own time limit.
  const stopWaiting = () => {
    refineAttempt.current += 1;
    setRefining(null);
  };

  const submit = async () => {
    if (locked || !access.canSave || (!isNew && !dirty)) return;
    if (problems.length > 0) return showProblems(problems);
    const checked = saveInputFromDraft(current, base?.version);
    if (!checked.ok) {
      setAttempted(true);
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await save({ environmentId, input: checked.input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const saved = result.value;
      setBase(saved);
      // The bot is saved either way; a suggestion left open is only a stale prompt.
      if (suggestionId !== null) {
        await dismissSuggestion({ environmentId, input: { suggestionId, dismissed: true } });
        openSuggestions.refresh();
      }
      leave(() => nav.open({ bot: saved.id }));
    } catch (cause) {
      setError(failureText(cause, "Could not save the bot."));
      setBusy(false);
    }
  };

  const tryOnPastRuns = () => {
    if (locked) return;
    const checked = refineInputFromDraft(current);
    if (!checked.ok) {
      if (problems.length > 0) showProblems(problems);
      else setError(checked.message);
      return;
    }
    setError(null);
    setReplayDraft(checked.draft);
  };

  const restore = async () => {
    if (!starterId || !access.canSave || locked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreStarter({ environmentId, input: { starterId } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const restored = result.value;
      setBase(restored);
      setConfirming(null);
      leave(() => nav.open({ bot: restored.id }));
    } catch (cause) {
      setConfirming(null);
      setError(failureText(cause, "Could not restore the starter."));
      setBusy(false);
    }
  };

  const loadLatest = (latest: BotDefinition) => {
    const next = botDraft(latest);
    setBase(latest);
    setInitial(next);
    setDraft(next);
    setLastDrafted(next);
    setNotes([]);
    setError(null);
    setAttempted(false);
  };

  const keepMine = (latest: BotDefinition) => {
    setBase(latest);
    setInitial(botDraft(latest));
  };

  const addInput = (name = "") => {
    if (current.parameters.length >= BOTS_MAX_PARAMETERS) return;
    update({ parameters: [...current.parameters, { ...newParameterDraft(), name, label: name }] });
  };
  const changeInput = (next: BotParameterDraft) =>
    update({
      parameters: current.parameters.map((entry) => (entry.key === next.key ? next : entry)),
    });
  const moveInput = (key: string, offset: -1 | 1) => {
    const index = current.parameters.findIndex((entry) => entry.key === key);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= current.parameters.length) return;
    const parameters = [...current.parameters];
    const [moved] = parameters.splice(index, 1);
    if (moved) parameters.splice(target, 0, moved);
    update({ parameters });
  };

  const workspaceOptions =
    host.startersSupported || current.workspace === "checkout"
      ? WORKSPACE_CHOICES
      : WORKSPACE_CHOICES.filter((choice) => choice !== "checkout");
  const showBudget =
    host.budgetsSupported || current.runsPerDay !== "" || current.tokensPerDay !== "";
  const showCredentials = host.anywhereSupported || current.vaultSlots.length > 0;
  const sections: ReadonlyArray<{ readonly id: EditorSectionId; readonly title: string }> = [
    { id: "basics", title: "Basics" },
    { id: "instructions", title: "Instructions" },
    { id: "inputs", title: "Inputs" },
    { id: "runtime", title: "Model and runtime" },
    ...(showCredentials ? [{ id: "credentials" as const, title: "Credentials" }] : []),
    ...(showBudget ? [{ id: "budget" as const, title: "Budget" }] : []),
    ...(host.anywhereSupported ? [{ id: "sharing" as const, title: "Where it runs" }] : []),
  ];

  const projectPicker = (
    id: string,
    value: string,
    anyLabel: string,
    onChange: (projectId: string) => void,
  ) => (
    <Select value={value} onValueChange={(next) => onChange(next ?? ANY_PROJECT)}>
      <SelectTrigger size="sm" id={id}>
        <SelectValue>{value === ANY_PROJECT ? anyLabel : projectTitle(value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={ANY_PROJECT} label={anyLabel}>
          {anyLabel}
        </SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id} label={project.title}>
            <span className="block truncate">{project.title}</span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );

  const firstShown = shown[0];
  const status: ReactNode =
    refining !== null ? (
      refining
    ) : busy ? (
      "Saving…"
    ) : error ? (
      <span role="alert" className="text-destructive-foreground">
        {error}
      </span>
    ) : !host.connected ? (
      "Reconnect to save. Your edits stay on this page."
    ) : !access.canSave ? (
      "This connection cannot change bots."
    ) : firstShown ? (
      <span className="flex flex-wrap items-center gap-x-2">
        <span className="text-destructive-foreground">
          {shown.length === 1 ? "1 thing to fix" : `${shown.length} things to fix`}:{" "}
          {firstShown.message}
        </span>
        <Button shape="pill" size="xs" variant="link" onClick={() => focusField(firstShown.field)}>
          Go to field
        </Button>
      </span>
    ) : base && !dirty ? (
      "No changes yet."
    ) : base ? (
      `Changed ${listText(changes)}. Saves v${base.version + 1}.${base.library ? " Your other computers get it too." : ""}`
    ) : (
      `Creates ${current.name.trim() || "the bot"} as v1.`
    );

  const rowProblems = (key: string) =>
    shown.filter((problem) => problem.field.startsWith(`${key}-`));
  const modelWork: ModelWork = confirming === "refine" ? "refine" : "suggest";

  return (
    <div className="flex min-w-0 flex-col">
      <LibraryBackLink to="/loom/bots" search={back}>
        {bot ? bot.name : "Bots"}
      </LibraryBackLink>
      <header className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3">
        <BotTile bot={base ?? { id: current.id.trim() || "new-bot" }} size="lg" />
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {bot ? `Edit ${bot.name}` : fromThread ? "New bot from a thread" : "New bot"}
          </h1>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {base ? (
              <>
                <span className="tabular-nums">Editing v{base.version}</span>
                {base.stableVersion != null ? (
                  <span className="tabular-nums">Stable is v{base.stableVersion}</span>
                ) : null}
                <StarterBadge status={starter} />
                {base.library ? (
                  <LibraryStateBadge tone="active" icon={Share2Icon}>
                    Shared
                  </LibraryStateBadge>
                ) : null}
                {archived ? (
                  <LibraryStateBadge tone="neutral" icon={ArchiveIcon}>
                    Archived
                  </LibraryStateBadge>
                ) : null}
              </>
            ) : fromThread ? (
              <span className="min-w-0">
                Drafted from{" "}
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: fromThread.sourceThreadId }}
                  className="rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  {sourceThread?.title ?? "its thread"}
                </Link>
                . Nothing is saved until you create it.
              </span>
            ) : (
              <span>Every run follows these instructions and settings, whoever starts it.</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {refining !== null ? (
            <Button shape="pill" size="sm" variant="outline" onClick={stopWaiting}>
              Stop waiting
            </Button>
          ) : fromThread ? (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={locked || !access.canSave}
              onClick={() => askModel("refine")}
            >
              <SparklesIcon />
              Refine with model
            </Button>
          ) : bot && host.versionsSupported ? (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={locked || !access.canSave || archived}
              onClick={() => askModel("suggest")}
            >
              <SparklesIcon />
              Suggest an edit
            </Button>
          ) : null}
          {starterId ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    shape="pill"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`More actions for ${base?.name ?? "this bot"}`}
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                <MenuItem
                  disabled={!access.canSave || locked || starter?.state === "present"}
                  onClick={() => setConfirming("starter")}
                >
                  <RotateCcwIcon />
                  {starter?.state === "outdated"
                    ? "Update to the newest starter…"
                    : starter?.state === "present"
                      ? "Matches its starter"
                      : "Restore starter…"}
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
        </div>
      </header>

      <div className="mt-5 flex flex-col gap-3">
        <SectionIndex sections={sections} flagged={flagged} />
        {conflict ? (
          <LibraryNotice
            icon={TriangleAlertIcon}
            tone="warning"
            action={
              <div className="flex flex-wrap gap-1.5">
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  onClick={() => loadLatest(conflict)}
                >
                  Load v{conflict.version}
                </Button>
                {dirty ? (
                  <Button shape="pill" size="xs" variant="ghost" onClick={() => keepMine(conflict)}>
                    Keep my edits
                  </Button>
                ) : null}
              </div>
            }
          >
            v{conflict.version} was saved while you edited v{base?.version}.{" "}
            {dirty
              ? "Load it to start again from it, or keep your edits and save them as the next version."
              : "Load it to edit the newest version."}
          </LibraryNotice>
        ) : null}
        {!host.connected ? (
          <LibraryNotice icon={WifiOffIcon}>
            Offline. Your edits stay on this page; save once the connection is back.
          </LibraryNotice>
        ) : readOnly ? (
          <LibraryNotice icon={LockIcon}>
            This connection can read bots but not change them.
          </LibraryNotice>
        ) : null}
        {archived ? (
          <LibraryNotice icon={ArchiveIcon}>
            This bot is archived. Saving keeps it archived; restore it from its page to run it.
          </LibraryNotice>
        ) : null}
        {refining !== null || notes.length > 0 ? (
          <LibraryNotice icon={SparklesIcon}>
            {refining !== null ? (
              <p>{refining}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </LibraryNotice>
        ) : null}
      </div>

      <fieldset
        disabled={refining !== null || readOnly}
        className="mt-6 flex min-w-0 flex-col gap-8 pb-6"
      >
        <legend className="sr-only">Bot settings</legend>
        <EditorSection id="basics" title="Basics">
          <div className="flex flex-col gap-4 sm:flex-row">
            <EditorField
              label="Name"
              htmlFor={fieldIds.name}
              problem={problemFor(fieldIds.name)}
              className="flex-1"
            >
              <Input
                id={fieldIds.name}
                value={current.name}
                placeholder="Reviewer"
                onChange={(event) => {
                  const name = event.target.value;
                  update(idTouched ? { name } : { name, id: slugFromName(name) });
                }}
                {...invalidProps(problemFor(fieldIds.name))}
              />
            </EditorField>
            {isNew ? (
              <EditorField
                label="Id"
                htmlFor={fieldIds.id}
                hint="Used in links and by agents. It cannot change once saved."
                problem={problemFor(fieldIds.id)}
                className="sm:w-60"
              >
                <Input
                  id={fieldIds.id}
                  font="mono"
                  value={current.id}
                  placeholder="reviewer"
                  onChange={(event) => {
                    setIdTouched(true);
                    update({ id: event.target.value });
                  }}
                  {...invalidProps(problemFor(fieldIds.id))}
                />
              </EditorField>
            ) : null}
          </div>
          <EditorField
            label="Description"
            htmlFor={fieldIds.description}
            hint="Shown in lists, and to agents choosing a bot."
            problem={problemFor(fieldIds.description)}
          >
            <Input
              id={fieldIds.description}
              value={current.description}
              placeholder="What this bot is for"
              onChange={(event) => update({ description: event.target.value })}
              {...invalidProps(problemFor(fieldIds.description))}
            />
          </EditorField>
          {isNew ? null : (
            <p className="text-xs text-muted-foreground">
              Id <span className="font-mono text-foreground">{current.id}</span>, which cannot
              change.
            </p>
          )}
        </EditorSection>

        <EditorSection id="instructions" title="Instructions" hint="What every run is told to do.">
          <InstructionsEditor
            value={current.instructions}
            parameters={current.parameters}
            problem={problemFor(fieldIds.instructions)}
            canAddInput={current.parameters.length < BOTS_MAX_PARAMETERS}
            onChange={(instructions) => update({ instructions })}
            onAddInput={addInput}
          />
        </EditorSection>

        <EditorSection
          id="inputs"
          title="Inputs"
          count={current.parameters.length}
          hint="What whoever runs the bot fills in. Each value goes where the instructions name it."
          action={
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={current.parameters.length >= BOTS_MAX_PARAMETERS}
              onClick={() => addInput()}
            >
              <PlusIcon />
              Add input
            </Button>
          }
        >
          {current.parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No inputs. Every run gets the same instructions.
            </p>
          ) : (
            <ul
              id="bot-inputs"
              aria-label="Inputs"
              className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
            >
              {current.parameters.map((parameter, index) => (
                <li key={parameter.key}>
                  <ParameterRow
                    framed={false}
                    parameter={parameter}
                    problems={rowProblems(parameter.key)}
                    canMoveUp={index > 0}
                    canMoveDown={index < current.parameters.length - 1}
                    onMove={(offset) => moveInput(parameter.key, offset)}
                    onChange={changeInput}
                    onRemove={() =>
                      update({
                        parameters: current.parameters.filter(
                          (entry) => entry.key !== parameter.key,
                        ),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {current.parameters.length >= BOTS_MAX_PARAMETERS ? (
            <p className="text-xs text-muted-foreground">
              A bot takes {BOTS_MAX_PARAMETERS} inputs at most.
            </p>
          ) : null}
        </EditorSection>

        <EditorSection id="runtime" title="Model and runtime">
          <EditorField label="Model" problem={problemFor(fieldIds.model)}>
            <div id={fieldIds.model} tabIndex={-1} className="rounded-lg outline-none">
              <BotModelPicker
                environmentId={environmentId}
                value={current.modelSelection}
                onChange={(modelSelection) => update({ modelSelection })}
              />
            </div>
          </EditorField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditorField
              label="Permissions"
              htmlFor="bot-runtime-mode"
              hint={RUNTIME_MODE_HINTS[current.runtimeMode]}
            >
              <Choice
                id="bot-runtime-mode"
                value={current.runtimeMode}
                labels={RUNTIME_MODE_LABELS}
                onChange={(runtimeMode) => update({ runtimeMode })}
              />
            </EditorField>
            <Segmented
              id="bot-interaction-mode"
              label="Mode"
              value={current.interactionMode}
              labels={INTERACTION_MODE_LABELS}
              hint={INTERACTION_MODE_HINTS[current.interactionMode]}
              onChange={(interactionMode) => update({ interactionMode })}
            />
          </div>
          {host.verdictsSupported || current.output === "verdict" ? (
            <Segmented
              id="bot-output"
              label="Reply"
              value={current.output}
              labels={OUTPUT_LABELS}
              onChange={(output) => update({ output })}
              hint={
                current.output === "verdict"
                  ? "Each run ends with pass, fail or needs attention, a summary and findings."
                  : "Each run ends with the bot's own words."
              }
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <p id="bot-workspace-label" className="text-sm font-medium">
              Runs in
            </p>
            <RadioGroup
              aria-labelledby="bot-workspace-label"
              value={current.workspace}
              onValueChange={(value) => {
                const workspace = workspaceOptions.find((choice) => choice === value);
                if (workspace) update({ workspace });
              }}
            >
              {workspaceOptions.map((choice) => (
                <label
                  key={choice}
                  className={cn(
                    LIBRARY_OUTLINE,
                    "flex min-w-0 cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-accent/40 has-data-checked:border-ring",
                  )}
                >
                  <span className="pt-0.5">
                    <Radio value={choice} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm">{WORKSPACE_LABELS[choice]}</span>
                    <span className="text-xs text-muted-foreground">{WORKSPACE_HINTS[choice]}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {current.workspace === "scratch" ? null : (
              <EditorField
                label="Project"
                htmlFor="bot-project"
                hint={
                  current.projectId === ANY_PROJECT
                    ? "Whoever runs it picks the project."
                    : undefined
                }
              >
                {projectPicker(
                  "bot-project",
                  current.projectId,
                  "Chosen at run time",
                  (projectId) => update({ projectId }),
                )}
              </EditorField>
            )}
            {current.workspace === "worktree" ? (
              <EditorField
                label="Worktree base"
                htmlFor={fieldIds.baseRef}
                hint="The branch or commit each worktree starts from."
                problem={problemFor(fieldIds.baseRef)}
              >
                <Input
                  id={fieldIds.baseRef}
                  size="sm"
                  font="mono"
                  value={current.baseRef}
                  placeholder="HEAD"
                  onChange={(event) => update({ baseRef: event.target.value })}
                  {...invalidProps(problemFor(fieldIds.baseRef))}
                />
              </EditorField>
            ) : null}
            <EditorField
              label="Available in"
              htmlFor="bot-scope"
              hint="Where the bot is offered, in menus and to agents."
            >
              {projectPicker(
                "bot-scope",
                current.scopeProjectId,
                "Every project",
                (scopeProjectId) => update({ scopeProjectId }),
              )}
            </EditorField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditorField
              label="Time limit in minutes"
              htmlFor={fieldIds.timeoutMinutes}
              hint="1 to 120. A run still going then is stopped."
              problem={problemFor(fieldIds.timeoutMinutes)}
            >
              <Input
                id={fieldIds.timeoutMinutes}
                size="sm"
                inputMode="numeric"
                value={current.timeoutMinutes}
                onChange={(event) => update({ timeoutMinutes: event.target.value })}
                {...invalidProps(problemFor(fieldIds.timeoutMinutes))}
              />
            </EditorField>
            <EditorField
              label="Runs at once"
              htmlFor={fieldIds.maxConcurrentRuns}
              hint="1 to 20. Later runs wait their turn."
              problem={problemFor(fieldIds.maxConcurrentRuns)}
            >
              <Input
                id={fieldIds.maxConcurrentRuns}
                size="sm"
                inputMode="numeric"
                value={current.maxConcurrentRuns}
                onChange={(event) => update({ maxConcurrentRuns: event.target.value })}
                {...invalidProps(problemFor(fieldIds.maxConcurrentRuns))}
              />
            </EditorField>
          </div>
        </EditorSection>

        {showCredentials ? (
          <EditorSection
            id="credentials"
            title="Credentials"
            count={current.vaultSlots.length}
            hint="Each computer binds a slot to one of its own Vault items, so a secret never leaves the computer that holds it."
            action={
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={current.vaultSlots.length >= BOTS_MAX_VAULT_SLOTS}
                onClick={() => update({ vaultSlots: [...current.vaultSlots, newVaultSlotDraft()] })}
              >
                <PlusIcon />
                Add slot
              </Button>
            }
          >
            {current.vaultSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No credentials. Add a slot for each token or key the bot needs.
              </p>
            ) : (
              <ul
                id="bot-credentials"
                aria-label="Credential slots"
                className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
              >
                {current.vaultSlots.map((slot) => (
                  <li key={slot.key}>
                    <VaultSlotRow
                      slot={slot}
                      problems={rowProblems(slot.key)}
                      onChange={(next) =>
                        update({
                          vaultSlots: current.vaultSlots.map((entry) =>
                            entry.key === slot.key ? next : entry,
                          ),
                        })
                      }
                      onRemove={() =>
                        update({
                          vaultSlots: current.vaultSlots.filter((entry) => entry.key !== slot.key),
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </EditorSection>
        ) : null}

        {showBudget ? (
          <EditorSection
            id="budget"
            title="Budget"
            hint="Limits over the last 24 hours. A run past one is refused and a batch waits; runs already going are never stopped."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <EditorField
                label="Runs per 24 hours"
                htmlFor={fieldIds.runsPerDay}
                hint="Empty for no limit."
                problem={problemFor(fieldIds.runsPerDay)}
              >
                <Input
                  id={fieldIds.runsPerDay}
                  size="sm"
                  inputMode="numeric"
                  placeholder="No limit"
                  value={current.runsPerDay}
                  onChange={(event) => update({ runsPerDay: event.target.value })}
                  {...invalidProps(problemFor(fieldIds.runsPerDay))}
                />
              </EditorField>
              <EditorField
                label="Tokens per 24 hours"
                htmlFor={fieldIds.tokensPerDay}
                hint="At least 1,000, or empty for no limit."
                problem={problemFor(fieldIds.tokensPerDay)}
              >
                <Input
                  id={fieldIds.tokensPerDay}
                  size="sm"
                  inputMode="numeric"
                  placeholder="No limit"
                  value={current.tokensPerDay}
                  onChange={(event) => update({ tokensPerDay: event.target.value })}
                  {...invalidProps(problemFor(fieldIds.tokensPerDay))}
                />
              </EditorField>
            </div>
            {bot ? <BotBudgetMeter botId={bot.id} /> : null}
          </EditorSection>
        ) : null}

        {host.anywhereSupported ? <SharingSection environmentId={environmentId} bot={bot} /> : null}
      </fieldset>

      <LibraryEditorBar status={status}>
        <Button
          shape="pill"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => leave(() => nav.show(back))}
        >
          Cancel
        </Button>
        {bot && host.versionsSupported ? (
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            disabled={locked || !access.canReplay || archived}
            onClick={tryOnPastRuns}
          >
            <HistoryIcon />
            Try on past runs
          </Button>
        ) : null}
        {lastReplay ? (
          <Button
            shape="pill"
            size="sm"
            variant="ghost"
            onClick={() => nav.overlay({ replay: lastReplay })}
          >
            Last results
          </Button>
        ) : null}
        <Button
          shape="pill"
          size="sm"
          disabled={locked || !access.canSave || (!isNew && !dirty)}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : isNew ? "Create bot" : "Save"}
        </Button>
      </LibraryEditorBar>

      {bot && replayDraft ? (
        <ReplayLaunchDialog
          environmentId={environmentId}
          bot={bot}
          source={{ kind: "draft", draft: replayDraft }}
          onClose={() => setReplayDraft(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirming === "refine" || confirming === "suggest"}
        title={MODEL_WORK[modelWork].title}
        description={MODEL_WORK[modelWork].confirm}
        confirmLabel={MODEL_WORK[modelWork].action}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void draftWithModel(modelWork);
        }}
      />
      <ConfirmDialog
        open={confirming === "starter"}
        title={`Restore ${base?.name ?? "this bot"} to its starter?`}
        busy={busy}
        description={
          <div className="flex flex-col gap-2">
            <p>
              Its instructions, inputs and settings are replaced with the{" "}
              {starter ? `${starter.name} starter` : "starter"}. The model and where it is available
              stay.
            </p>
            <p>
              It saves as v{(base?.version ?? 0) + 1}, and every earlier version stays in Versions.
              {dirty ? " Your unsaved changes here are discarded." : ""}
            </p>
          </div>
        }
        confirmLabel="Restore starter"
        onCancel={() => setConfirming(null)}
        onConfirm={() => void restore()}
      />
    </div>
  );
}

const SKELETON_SECTIONS = ["basics", "instructions", "inputs"] as const;

/** The editor's first sections, held in place while a draft arrives so nothing jumps. */
export function BotEditorSkeleton() {
  return (
    <div role="status" aria-label="Loading the editor" className="mt-6 flex flex-col gap-8">
      {SKELETON_SECTIONS.map((section) => (
        <div key={section} className="flex flex-col gap-3 border-t border-border pt-6">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton shape="card" className={section === "instructions" ? "h-56" : "h-9"} />
        </div>
      ))}
    </div>
  );
}

/** The bot editor as a full page: a new bot for `null`, else that bot. */
export function BotEditorPage({ bot }: { readonly bot: BotDefinition | null }) {
  const { host } = useBots();
  if (host.environmentId === null) return null;
  return <BotEditorForm key={bot?.id ?? "new"} environmentId={host.environmentId} bot={bot} />;
}
