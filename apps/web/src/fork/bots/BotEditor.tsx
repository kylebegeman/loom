import { useRef, useState, type ReactNode } from "react";
import { PlusIcon, RotateCcwIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import type { EnvironmentId, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type {
  BotDefinition,
  BotDefinitionInput,
  BotDraftResult,
  BotOutput,
  BotParameterType,
  BotStarterId,
  VaultAccessAction,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { scheduledTaskDefaultModel } from "~/components/settings/scheduledTasksSettings.logic";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField, LibraryNotice } from "../project-library/LibraryControls";
import { BotModelPicker, useBotModelChoices } from "./BotModelPicker";
import {
  botDraft,
  rollingBotsUsageWindow,
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
import { budgetMeterText } from "./BotsUsage";
import { refineInputFromDraft } from "./fromThread/logic";
import { bots } from "./state";

export const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Ask before actions",
  "auto-accept-edits": "Accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

const INTERACTION_MODE_LABELS: Record<ProviderInteractionMode, string> = {
  default: "Do the work",
  plan: "Plan only",
};

export const WORKSPACE_LABELS: Record<BotWorkspaceChoice, string> = {
  scratch: "Fresh scratch folder",
  project: "Project checkout",
  worktree: "New worktree",
  checkout: "Checkout it is run for",
};

const WORKSPACE_CHOICES = Object.keys(WORKSPACE_LABELS) as BotWorkspaceChoice[];

const OUTPUT_LABELS: Record<BotOutput, string> = {
  text: "Text",
  verdict: "Verdict",
};

const PARAMETER_TYPE_LABELS: Record<BotParameterType, string> = {
  string: "Short text",
  text: "Long text",
  number: "Number",
  boolean: "Yes or no",
  choice: "Choice",
};

const VAULT_ACTION_LABELS: Record<VaultAccessAction, string> = {
  use: "Use it",
  inspect: "See its details",
  reveal: "Reveal its value",
  manage: "Change it",
  export: "Export it",
  delegate: "Hand it on",
};

const ANY_PROJECT = "";

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

export function ParameterRow({
  parameter,
  onChange,
  onRemove,
}: {
  readonly parameter: BotParameterDraft;
  readonly onChange: (parameter: BotParameterDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <Input
            aria-label="Input name"
            placeholder="name"
            value={parameter.name}
            onChange={(event) => onChange({ ...parameter, name: event.target.value })}
          />
          <Input
            aria-label="Input label"
            placeholder="Label"
            value={parameter.label}
            onChange={(event) => onChange({ ...parameter, label: event.target.value })}
          />
        </div>
        <Button
          shape="pill"
          size="icon-sm"
          variant="ghost"
          aria-label="Remove input"
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      <Input
        aria-label="Input description"
        placeholder="Hint shown in the run form"
        value={parameter.description}
        onChange={(event) => onChange({ ...parameter, description: event.target.value })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Choice
          id={`${parameter.key}-type`}
          value={parameter.type}
          labels={PARAMETER_TYPE_LABELS}
          onChange={(type) => onChange({ ...parameter, type })}
        />
        <Input
          aria-label="Default value"
          placeholder="Default"
          className="w-40"
          value={parameter.defaultValue}
          onChange={(event) => onChange({ ...parameter, defaultValue: event.target.value })}
        />
        <label className="ms-auto flex items-center gap-2 text-sm">
          Required
          <Switch
            checked={parameter.required}
            onCheckedChange={(required) => onChange({ ...parameter, required })}
          />
        </label>
      </div>
      {parameter.type === "choice" ? (
        <Textarea
          aria-label="Choices, one per line"
          placeholder="One choice per line"
          rows={3}
          value={parameter.choices}
          onChange={(event) => onChange({ ...parameter, choices: event.target.value })}
        />
      ) : null}
    </div>
  );
}

function VaultSlotRow({
  slot,
  onChange,
  onRemove,
}: {
  readonly slot: BotVaultSlotDraft;
  readonly onChange: (slot: BotVaultSlotDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <Input
            aria-label="Slot name"
            placeholder="github-token"
            value={slot.name}
            onChange={(event) => onChange({ ...slot, name: event.target.value })}
          />
          <Input
            aria-label="Slot label"
            placeholder="GitHub token"
            value={slot.label}
            onChange={(event) => onChange({ ...slot, label: event.target.value })}
          />
        </div>
        <Button
          shape="pill"
          size="icon-sm"
          variant="ghost"
          aria-label="Remove Vault slot"
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Choice
          id={`${slot.key}-action`}
          value={slot.action}
          labels={VAULT_ACTION_LABELS}
          onChange={(action) => onChange({ ...slot, action })}
        />
        <Input
          aria-label="Destination"
          className="min-w-48 flex-1"
          placeholder="Where it may be sent, such as https://api.github.com (optional)"
          value={slot.destination}
          onChange={(event) => onChange({ ...slot, destination: event.target.value })}
        />
      </div>
    </div>
  );
}

/** One group of editor settings, set off by its heading and a hairline rather than a box. */
function EditorSection({
  title,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-4 border-t border-border pt-5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="flex items-baseline gap-1.5 text-sm font-semibold tracking-tight">
          {title}
          {count ? (
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              ({count})
            </span>
          ) : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A short set of choices shown all at once, so the current one reads without opening a menu. */
function Segmented<T extends string>({
  id,
  label,
  value,
  labels,
  hint,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly labels: Record<T, string>;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const options = Object.keys(labels) as T[];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={id} className="text-sm font-medium">
        {label}
      </p>
      <ToggleGroup
        shape="pill"
        variant="segmented"
        aria-labelledby={id}
        disabled={disabled}
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

export function BotEditor({
  environmentId,
  bot,
  fromThread,
  canSave,
  startersSupported,
  verdictsSupported,
  budgetsSupported,
  versionsSupported = false,
  anywhereSupported = false,
  canReplay = false,
  onReplay,
  onSaved,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  /** Absent for a new bot. */
  readonly bot: BotDefinition | null;
  /** A new bot drafted from a thread; offers Refine. */
  readonly fromThread?: BotDraftResult;
  readonly canSave: boolean;
  /** Older servers know neither checkout bots nor starters. */
  readonly startersSupported: boolean;
  /** Older servers keep every reply as text. */
  readonly verdictsSupported: boolean;
  /** Older servers have no budgets. */
  readonly budgetsSupported: boolean;
  /** Older servers keep no history, so they can neither suggest an edit nor replay. */
  readonly versionsSupported?: boolean;
  /** Older servers have no Vault slots. */
  readonly anywhereSupported?: boolean;
  readonly canReplay?: boolean;
  /** Tries the unsaved draft on the bot's past runs. */
  readonly onReplay?: (bot: BotDefinition, draft: BotDefinitionInput) => void;
  readonly onSaved: (bot: BotDefinition) => void;
  readonly onClose: () => void;
}) {
  const { settings, instanceEntries } = useBotModelChoices(environmentId);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [draft, setDraft] = useState<BotDraft>(() =>
    bot
      ? botDraft(bot)
      : fromThread
        ? botDraft(fromThread.draft)
        : emptyBotDraft(scheduledTaskDefaultModel(settings, null, instanceEntries)),
  );
  // A drafted id is already free on the server; renaming must not trade it for a taken one.
  const [idTouched, setIdTouched] = useState(bot !== null || fromThread !== undefined);
  const [notes, setNotes] = useState(fromThread?.notes ?? []);
  /** What the model is drafting, shown while it works; null when idle. */
  const [refining, setRefining] = useState<string | null>(null);
  const refineAttempt = useRef(0);
  const refineDraft = useAtomCommand(bots.refineDraft, { reportFailure: false });
  const suggestEdit = useAtomCommand(bots.suggestEdit, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(bots.save, { reportFailure: false });
  const [meterWindow] = useState(() => rollingBotsUsageWindow(1, Date.now()));
  const usage = useEnvironmentQuery(
    budgetsSupported && bot?.budget !== undefined
      ? bots.usage({ environmentId, input: { ...meterWindow, botId: bot.id } })
      : null,
  );
  const budgetState = bot ? usage.data?.budgets[bot.id] : undefined;
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });

  const update = (patch: Partial<BotDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const projectTitle = (id: string) =>
    projects.find((project) => project.id === id)?.title ?? (id === ANY_PROJECT ? "" : id);

  // Only the newest attempt may replace the draft, so a cancelled one that finishes is ignored.
  const draftWithModel = async (
    status: string,
    work: () => Promise<
      Awaited<ReturnType<typeof refineDraft>> | Awaited<ReturnType<typeof suggestEdit>>
    >,
    fallbackNote: string,
    failure: string,
  ) => {
    const attempt = ++refineAttempt.current;
    setRefining(status);
    setError(null);
    try {
      const result = await work();
      if (attempt !== refineAttempt.current) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setDraft(botDraft(result.value.draft));
      setNotes(result.value.notes.length > 0 ? result.value.notes : [fallbackNote]);
    } catch (cause) {
      if (attempt === refineAttempt.current)
        setError(cause instanceof Error ? cause.message : failure);
    } finally {
      if (attempt === refineAttempt.current) setRefining(null);
    }
  };

  const refine = async () => {
    if (!fromThread || refining !== null || busy || !canSave) return;
    const checked = refineInputFromDraft(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    await draftWithModel(
      "Refining with the thread's model. This can take up to three minutes.",
      () =>
        refineDraft({
          environmentId,
          input: { threadId: fromThread.sourceThreadId, draft: checked.draft },
        }),
      "Refined by the model. Check the draft before saving.",
      "Could not refine the draft.",
    );
  };

  const suggest = async () => {
    if (!bot || refining !== null || busy || !canSave) return;
    await draftWithModel(
      "Reading the runs rated Bad. This can take up to three minutes.",
      () => suggestEdit({ environmentId, input: { botId: bot.id } }),
      "Suggested by the model. Check the edit, or try it on past runs, before saving.",
      "Could not suggest an edit.",
    );
  };

  const tryOnPastRuns = () => {
    if (!bot || !onReplay) return;
    const checked = refineInputFromDraft(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    onReplay(bot, checked.draft);
  };

  // Stops waiting only; the drafting thread still ends at its own time limit.
  const cancelRefine = () => {
    refineAttempt.current += 1;
    setRefining(null);
  };

  const submit = async () => {
    if (busy || refining !== null || !canSave) return;
    const checked = saveInputFromDraft(draft, bot?.version);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await save({ environmentId, input: checked.input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the bot.");
    } finally {
      setBusy(false);
    }
  };

  const starterId = startersSupported ? bot?.origin?.starterId : undefined;
  const restore = async (origin: BotStarterId) => {
    if (busy || !canSave || !bot) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Restore ${bot.name} to its starter? Its instructions, inputs and settings are replaced; the model and where it is available stay.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreStarter({ environmentId, input: { starterId: origin } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore the starter.");
    } finally {
      setBusy(false);
    }
  };

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

  const locked = refining !== null;
  const workspaceOptions =
    startersSupported || draft.workspace === "checkout"
      ? WORKSPACE_CHOICES
      : WORKSPACE_CHOICES.filter((choice) => choice !== "checkout");
  const showBudget = budgetsSupported || draft.runsPerDay !== "" || draft.tokensPerDay !== "";
  const leadingActions =
    refining !== null ? (
      <Button shape="pill" variant="outline" onClick={cancelRefine}>
        Stop waiting
      </Button>
    ) : fromThread ? (
      <Button
        shape="pill"
        variant="outline"
        disabled={busy || !canSave}
        onClick={() => void refine()}
      >
        <SparklesIcon />
        Refine with model
      </Button>
    ) : bot && versionsSupported ? (
      <>
        <Button
          shape="pill"
          variant="outline"
          disabled={busy || !canSave || bot.archivedAt !== null}
          onClick={() => void suggest()}
        >
          <SparklesIcon />
          Suggest an edit
        </Button>
        {onReplay ? (
          <Button
            shape="pill"
            variant="outline"
            disabled={busy || !canReplay || bot.archivedAt !== null}
            onClick={tryOnPastRuns}
          >
            Try on past runs
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={bot ? `Edit ${bot.name}` : fromThread ? "Save as bot" : "New bot"}
      description={
        fromThread
          ? "Drafted from the thread's first message. Nothing is saved until you press Save bot."
          : "Every run uses these instructions and settings, whoever starts it."
      }
      actions={
        <>
          {leadingActions !== null || starterId !== undefined ? (
            <div className="flex flex-col-reverse gap-2 sm:me-auto sm:flex-row">
              {leadingActions}
              {starterId !== undefined ? (
                <Button
                  shape="pill"
                  variant="ghost"
                  disabled={busy || !canSave}
                  onClick={() => void restore(starterId)}
                >
                  <RotateCcwIcon />
                  Restore starter
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button shape="pill" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            shape="pill"
            disabled={busy || refining !== null || !canSave}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save bot"}
          </Button>
        </>
      }
    >
      {notes.length > 0 || refining !== null ? (
        <div className="mb-5">
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
        </div>
      ) : null}
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <LibraryField label="Name">
              <Input
                value={draft.name}
                onChange={(event) => {
                  const name = event.target.value;
                  update(idTouched ? { name } : { name, id: slugFromName(name) });
                }}
              />
            </LibraryField>
            <LibraryField label="Id">
              <Input
                value={draft.id}
                disabled={bot !== null}
                onChange={(event) => {
                  setIdTouched(true);
                  update({ id: event.target.value });
                }}
              />
            </LibraryField>
          </div>
          <LibraryField label="Description">
            <Input
              value={draft.description}
              placeholder="What this bot is for"
              onChange={(event) => update({ description: event.target.value })}
            />
          </LibraryField>
          <LibraryField label="Instructions">
            <Textarea
              rows={8}
              value={draft.instructions}
              placeholder="Review {{file}} for correctness. Report each problem with its line."
              onChange={(event) => update({ instructions: event.target.value })}
            />
          </LibraryField>
        </div>

        <EditorSection
          title="Inputs"
          count={draft.parameters.length}
          action={
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              onClick={() => update({ parameters: [...draft.parameters, newParameterDraft()] })}
            >
              <PlusIcon />
              Add input
            </Button>
          }
        >
          {draft.parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No inputs. Add one and refer to it in the instructions as {"{{name}}"}.
            </p>
          ) : null}
          {draft.parameters.map((parameter) => (
            <ParameterRow
              key={parameter.key}
              parameter={parameter}
              onChange={(next) =>
                update({
                  parameters: draft.parameters.map((entry) =>
                    entry.key === parameter.key ? next : entry,
                  ),
                })
              }
              onRemove={() =>
                update({
                  parameters: draft.parameters.filter((entry) => entry.key !== parameter.key),
                })
              }
            />
          ))}
        </EditorSection>

        <EditorSection title="How it works">
          <LibraryField label="Model">
            <BotModelPicker
              environmentId={environmentId}
              value={draft.modelSelection}
              onChange={(modelSelection) => update({ modelSelection })}
            />
          </LibraryField>
          <div className="grid gap-4 sm:grid-cols-2">
            <LibraryField label="Permissions">
              <Choice
                id="bot-runtime-mode"
                value={draft.runtimeMode}
                labels={RUNTIME_MODE_LABELS}
                onChange={(runtimeMode) => update({ runtimeMode })}
              />
            </LibraryField>
            <Segmented
              id="bot-interaction-mode"
              label="Mode"
              value={draft.interactionMode}
              labels={INTERACTION_MODE_LABELS}
              disabled={locked}
              onChange={(interactionMode) => update({ interactionMode })}
            />
          </div>
          {verdictsSupported || draft.output === "verdict" ? (
            <Segmented
              id="bot-output"
              label="Reply"
              value={draft.output}
              labels={OUTPUT_LABELS}
              disabled={locked}
              onChange={(output) => update({ output })}
              hint={
                draft.output === "verdict"
                  ? "Each run ends with pass, fail or needs attention, a summary and findings."
                  : "Each run ends with the bot's own words."
              }
            />
          ) : null}
        </EditorSection>

        <EditorSection title="Where it runs">
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Runs in</legend>
            <div className="rounded-xl border border-border p-1">
              <RadioGroup
                value={draft.workspace}
                disabled={locked}
                onValueChange={(value) => {
                  const workspace = workspaceOptions.find((choice) => choice === value);
                  if (workspace) update({ workspace });
                }}
                className="grid sm:grid-cols-2"
              >
                {workspaceOptions.map((choice) => (
                  <label
                    key={choice}
                    className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-150 hover:bg-accent/50"
                  >
                    <Radio value={choice} />
                    <span className="truncate">{WORKSPACE_LABELS[choice]}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            {draft.workspace === "scratch" ? null : (
              <LibraryField label="Project">
                {projectPicker("bot-project", draft.projectId, "Chosen at run time", (projectId) =>
                  update({ projectId }),
                )}
              </LibraryField>
            )}
            {draft.workspace === "worktree" ? (
              <LibraryField label="Worktree base">
                <Input
                  value={draft.baseRef}
                  placeholder="HEAD"
                  onChange={(event) => update({ baseRef: event.target.value })}
                />
              </LibraryField>
            ) : null}
            <LibraryField label="Available in">
              {projectPicker("bot-scope", draft.scopeProjectId, "Every project", (scopeProjectId) =>
                update({ scopeProjectId }),
              )}
            </LibraryField>
          </div>
        </EditorSection>

        <EditorSection title="Limits">
          <div className="grid gap-4 sm:grid-cols-2">
            <LibraryField label="Time limit (minutes)">
              <Input
                inputMode="numeric"
                value={draft.timeoutMinutes}
                onChange={(event) => update({ timeoutMinutes: event.target.value })}
              />
            </LibraryField>
            <LibraryField label="Runs at once">
              <Input
                inputMode="numeric"
                value={draft.maxConcurrentRuns}
                onChange={(event) => update({ maxConcurrentRuns: event.target.value })}
              />
            </LibraryField>
            {showBudget ? (
              <>
                <LibraryField label="Runs per 24 hours">
                  <Input
                    inputMode="numeric"
                    placeholder="No limit"
                    value={draft.runsPerDay}
                    onChange={(event) => update({ runsPerDay: event.target.value })}
                  />
                </LibraryField>
                <LibraryField label="Tokens per 24 hours">
                  <Input
                    inputMode="numeric"
                    placeholder="No limit"
                    value={draft.tokensPerDay}
                    onChange={(event) => update({ tokensPerDay: event.target.value })}
                  />
                </LibraryField>
              </>
            ) : null}
          </div>
          {showBudget ? (
            <p className="text-xs text-muted-foreground">
              {budgetState
                ? budgetMeterText(budgetState)
                : "A run past a limit is refused, and a batch waits until the window allows it. Runs in progress are never stopped."}
            </p>
          ) : null}
        </EditorSection>

        {anywhereSupported || draft.vaultSlots.length > 0 ? (
          <EditorSection
            title="Vault slots"
            count={draft.vaultSlots.length}
            action={
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                onClick={() => update({ vaultSlots: [...draft.vaultSlots, newVaultSlotDraft()] })}
              >
                <PlusIcon />
                Add slot
              </Button>
            }
          >
            <p className="text-sm text-muted-foreground">
              {draft.vaultSlots.length === 0
                ? "No Vault slots. Add one for a credential the bot needs."
                : "Each computer binds a slot to one of its own Vault items, so no secret leaves the computer that holds it."}
            </p>
            {draft.vaultSlots.map((slot) => (
              <VaultSlotRow
                key={slot.key}
                slot={slot}
                onChange={(next) =>
                  update({
                    vaultSlots: draft.vaultSlots.map((entry) =>
                      entry.key === slot.key ? next : entry,
                    ),
                  })
                }
                onRemove={() =>
                  update({ vaultSlots: draft.vaultSlots.filter((entry) => entry.key !== slot.key) })
                }
              />
            ))}
          </EditorSection>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {!canSave ? (
          <p role="status" className="text-sm text-muted-foreground">
            This connection cannot change bots.
          </p>
        ) : null}
      </fieldset>
    </LibraryDialog>
  );
}
