import { useRef, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { EnvironmentId, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import type {
  BotDefinition,
  BotDraftResult,
  BotOutput,
  BotParameterType,
  BotStarterId,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { scheduledTaskDefaultModel } from "~/components/settings/scheduledTasksSettings.logic";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { BotModelPicker, useBotModelChoices } from "./BotModelPicker";
import {
  botDraft,
  emptyBotDraft,
  newParameterDraft,
  saveInputFromDraft,
  slugFromName,
  type BotDraft,
  type BotParameterDraft,
  type BotWorkspaceChoice,
} from "./draft";
import { budgetMeterText } from "./BotsUsage";
import { refineInputFromDraft } from "./fromThread/logic";
import { bots } from "./state";
import { rollingWindow } from "./usageWindow";

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

const ANY_PROJECT = "";

function Choice<T extends string>({
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

function ParameterRow({
  parameter,
  onChange,
  onRemove,
}: {
  readonly parameter: BotParameterDraft;
  readonly onChange: (parameter: BotParameterDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
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
        <Button size="icon-sm" variant="ghost" aria-label="Remove input" onClick={onRemove}>
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
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={parameter.required}
            onCheckedChange={(required) => onChange({ ...parameter, required })}
          />
          Required
        </label>
        <Input
          aria-label="Default value"
          placeholder="Default"
          className="w-40"
          value={parameter.defaultValue}
          onChange={(event) => onChange({ ...parameter, defaultValue: event.target.value })}
        />
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

export function BotEditor({
  environmentId,
  bot,
  fromThread,
  canSave,
  startersSupported,
  verdictsSupported,
  budgetsSupported,
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
  const [refining, setRefining] = useState(false);
  const refineAttempt = useRef(0);
  const refineDraft = useAtomCommand(bots.refineDraft, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(bots.save, { reportFailure: false });
  const [meterWindow] = useState(() => rollingWindow(1, Date.now()));
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

  const refine = async () => {
    if (!fromThread || refining || busy || !canSave) return;
    const checked = refineInputFromDraft(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    const attempt = ++refineAttempt.current;
    setRefining(true);
    setError(null);
    try {
      const result = await refineDraft({
        environmentId,
        input: { threadId: fromThread.sourceThreadId, draft: checked.draft },
      });
      if (attempt !== refineAttempt.current) return;
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setDraft(botDraft(result.value.draft));
      setNotes(
        result.value.notes.length > 0
          ? result.value.notes
          : ["Refined by the model. Check the draft before saving."],
      );
    } catch (cause) {
      if (attempt === refineAttempt.current)
        setError(cause instanceof Error ? cause.message : "Could not refine the draft.");
    } finally {
      if (attempt === refineAttempt.current) setRefining(false);
    }
  };

  // Stops waiting only; the drafting thread still ends at its own time limit.
  const cancelRefine = () => {
    refineAttempt.current += 1;
    setRefining(false);
  };

  const submit = async () => {
    if (busy || refining || !canSave) return;
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
          {fromThread ? (
            refining ? (
              <Button variant="outline" className="sm:me-auto" onClick={cancelRefine}>
                Cancel refining
              </Button>
            ) : (
              <Button
                variant="outline"
                className="sm:me-auto"
                disabled={busy || !canSave}
                onClick={() => void refine()}
              >
                Refine with model
              </Button>
            )
          ) : null}
          {starterId !== undefined ? (
            <Button
              variant="outline"
              className="sm:me-auto"
              disabled={busy || !canSave}
              onClick={() => void restore(starterId)}
            >
              Restore starter
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || refining || !canSave} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save bot"}
          </Button>
        </>
      }
    >
      {notes.length > 0 || refining ? (
        <div role="status" className="mb-4 grid gap-1 text-sm text-muted-foreground">
          {refining ? (
            <p>Refining with the thread's model. This can take up to three minutes.</p>
          ) : (
            notes.map((note) => <p key={note}>{note}</p>)
          )}
        </div>
      ) : null}
      <fieldset disabled={refining} className="grid gap-4">
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
        <section className="grid gap-2" aria-label="Inputs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Inputs</h3>
            <Button
              size="xs"
              variant="outline"
              onClick={() => update({ parameters: [...draft.parameters, newParameterDraft()] })}
            >
              <PlusIcon />
              Add input
            </Button>
          </div>
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
        </section>
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
          <LibraryField label="Mode">
            <Choice
              id="bot-interaction-mode"
              value={draft.interactionMode}
              labels={INTERACTION_MODE_LABELS}
              onChange={(interactionMode) => update({ interactionMode })}
            />
          </LibraryField>
          <LibraryField label="Runs in">
            <Choice
              id="bot-workspace"
              value={draft.workspace}
              labels={WORKSPACE_LABELS}
              options={
                startersSupported || draft.workspace === "checkout"
                  ? WORKSPACE_CHOICES
                  : WORKSPACE_CHOICES.filter((choice) => choice !== "checkout")
              }
              onChange={(workspace) => update({ workspace })}
            />
          </LibraryField>
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
          <LibraryField label="Available in">
            {projectPicker("bot-scope", draft.scopeProjectId, "Every project", (scopeProjectId) =>
              update({ scopeProjectId }),
            )}
          </LibraryField>
          {verdictsSupported || draft.output === "verdict" ? (
            <LibraryField label="Reply">
              <Choice
                id="bot-output"
                value={draft.output}
                labels={OUTPUT_LABELS}
                onChange={(output) => update({ output })}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {draft.output === "verdict"
                  ? "Each run ends with pass, fail or needs attention, a summary and findings."
                  : "Each run ends with the bot's own words."}
              </span>
            </LibraryField>
          ) : null}
        </div>
        {budgetsSupported || draft.runsPerDay !== "" || draft.tokensPerDay !== "" ? (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Budget</legend>
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
            <span className="text-xs text-muted-foreground">
              {budgetState
                ? budgetMeterText(budgetState)
                : "A run past a limit is refused, and a batch waits until the window allows it. Runs in progress are never stopped."}
            </span>
          </fieldset>
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
