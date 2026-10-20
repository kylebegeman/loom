import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import type { BotDefinition, BotParameterType, BotStarterId } from "@t3tools/contracts/fork";
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
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "~/components/settings/settingsLayout";
import { scheduledTaskDefaultModel } from "~/components/settings/scheduledTasksSettings.logic";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
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
  canSave,
  startersSupported,
  onSaved,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  /** Absent for a new bot. */
  readonly bot: BotDefinition | null;
  readonly canSave: boolean;
  /** Older servers know neither checkout bots nor starters. */
  readonly startersSupported: boolean;
  readonly onSaved: (bot: BotDefinition) => void;
  readonly onClose: () => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, null),
  );
  const [draft, setDraft] = useState<BotDraft>(() =>
    bot ? botDraft(bot) : emptyBotDraft(scheduledTaskDefaultModel(settings, null, instanceEntries)),
  );
  const [idTouched, setIdTouched] = useState(bot !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(bots.save, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });

  const update = (patch: Partial<BotDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const activeInstanceId =
    draft.modelSelection?.instanceId ??
    instanceEntries[0]?.instanceId ??
    ("" as ProviderInstanceId);
  const activeModel = draft.modelSelection?.model ?? "";
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    activeInstanceId,
    activeModel,
  );
  const projectTitle = (id: string) =>
    projects.find((project) => project.id === id)?.title ?? (id === ANY_PROJECT ? "" : id);

  const submit = async () => {
    if (busy || !canSave) return;
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
      title={bot ? `Edit ${bot.name}` : "New bot"}
      description="Every run uses these instructions and settings, whoever starts it."
      actions={
        <>
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
          <Button disabled={busy || !canSave} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save bot"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
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
          <ProviderModelPicker
            environmentId={environmentId}
            activeInstanceId={activeInstanceId}
            model={activeModel}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={modelOptionsByInstance}
            isComposerOwned={false}
            triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            onInstanceModelChange={(instanceId, model) =>
              update({ modelSelection: { instanceId, model } })
            }
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
        </div>
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
      </div>
    </LibraryDialog>
  );
}
