import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_PIPELINE_MAX_STEPS,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineGate,
  type BotPipelineInput,
  type BotPipelineProblem,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { BotTargetField } from "./BotAnywhere";
import { Choice, ParameterRow } from "./BotEditor";
import { BotModelPicker } from "./BotModelPicker";
import {
  newParameterDraft,
  slugFromName,
  defaultStepInputs,
  emptyPipelineDraft,
  newStepDraft,
  pipelineDraft,
  pipelineInputFromDraft,
  problemsOf,
  stepReferences,
  type PipelineDraft,
  type PipelineFailChoice,
  type PipelineStepDraft,
  type PipelineVersionChoice,
} from "@t3tools/client-runtime/fork";

import { bots, useBotsHost } from "./state";

const CHECK_DEBOUNCE_MS = 400;

const VERSION_LABELS: Record<PipelineVersionChoice, string> = {
  latest: "Latest version",
  stable: "Stable version",
  number: "A fixed version",
};

const FAIL_LABELS: Record<PipelineFailChoice, string> = {
  stop: "Stop the pipeline",
  continue: "Go on to the next step",
  loop: "Go back to a step",
};

const GATE_LABELS: Record<BotPipelineGate, string> = {
  stop: "Stop the pipeline",
  continue: "Go on to the next step",
};

function Problems({ problems }: { readonly problems: ReadonlyArray<BotPipelineProblem> }) {
  if (problems.length === 0) return null;
  return (
    <ul className="grid gap-1 text-sm">
      {problems.map((problem) => (
        <li
          key={`${problem.field}:${problem.message}`}
          className={
            problem.severity === "error" ? "text-destructive-foreground" : "text-warning-foreground"
          }
        >
          {problem.message}
        </li>
      ))}
    </ul>
  );
}

function StepCard({
  environmentId,
  draft,
  index,
  step,
  allBots,
  problems,
  onChange,
  onMove,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: PipelineDraft;
  readonly index: number;
  readonly step: PipelineStepDraft;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly problems: ReadonlyArray<BotPipelineProblem>;
  readonly onChange: (step: PipelineStepDraft) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const bot = allBots.find((candidate) => candidate.id === step.botId) ?? null;
  const anywhereSupported = useBotsHost().anywhereSupported;
  const botLabels = Object.fromEntries(
    allBots.map((candidate) => [candidate.id, candidate.name]),
  ) as Record<string, string>;
  const gives = bot?.output === "verdict";
  const otherSteps = draft.steps.filter((other) => other.key !== step.key);
  const stepLabels = Object.fromEntries(
    draft.steps.map((other) => [other.id, other.id || "Unnamed step"]),
  ) as Record<string, string>;
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          aria-label="Step id"
          placeholder="step-id"
          value={step.id}
          onChange={(event) => onChange({ ...step, id: event.target.value })}
        />
        <Choice
          id={`${step.key}-bot`}
          value={step.botId}
          labels={{ ...botLabels, "": "Choose a bot…" }}
          options={allBots.map((candidate) => candidate.id)}
          onChange={(botId) => {
            const next = allBots.find((candidate) => candidate.id === botId);
            onChange({
              ...step,
              botId,
              inputs: next === undefined ? {} : defaultStepInputs(draft, next),
            });
          }}
        />
        <div className="flex gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move step up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move step down"
            disabled={index === draft.steps.length - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Remove step" onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {bot === null ? null : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Choice
              id={`${step.key}-version`}
              value={step.version}
              labels={VERSION_LABELS}
              onChange={(version) => onChange({ ...step, version })}
            />
            {step.version === "number" ? (
              <Input
                aria-label="Version"
                inputMode="numeric"
                placeholder={String(bot.version)}
                className="w-24"
                value={step.versionNumber}
                onChange={(event) => onChange({ ...step, versionNumber: event.target.value })}
              />
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={step.forEach}
              onCheckedChange={(forEach) => onChange({ ...step, forEach })}
            />
            Run once per item, as a batch
          </label>
          {step.forEach ? (
            <LibraryField label="Items">
              <Input
                placeholder="{{steps.review.findings}}"
                value={step.forEachFrom}
                onChange={(event) => onChange({ ...step, forEachFrom: event.target.value })}
              />
              <span className="text-xs font-normal text-muted-foreground">
                The findings of an earlier step, or a long-text input with one item per line.
              </span>
            </LibraryField>
          ) : null}
          {step.forEach ? (
            <LibraryField label="Item label (optional)">
              <Input
                placeholder="Finding {{item}}"
                value={step.forEachItemLabel}
                onChange={(event) => onChange({ ...step, forEachItemLabel: event.target.value })}
              />
            </LibraryField>
          ) : null}
          {bot.parameters.map((parameter) => (
            <LibraryField
              key={parameter.name}
              label={parameter.required ? parameter.label : `${parameter.label} (optional)`}
            >
              <Textarea
                rows={parameter.type === "text" ? 3 : 1}
                value={step.inputs[parameter.name] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...step,
                    inputs: { ...step.inputs, [parameter.name]: event.target.value },
                  })
                }
              />
            </LibraryField>
          ))}
          <p className="text-xs text-muted-foreground">
            Can use {stepReferences(draft, index).join(", ")}.
          </p>
          {gives ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <LibraryField label="On a fail verdict">
                <Choice
                  id={`${step.key}-fail`}
                  value={step.onFail}
                  labels={FAIL_LABELS}
                  onChange={(onFail) =>
                    onChange({
                      ...step,
                      onFail,
                      goTo: step.goTo === "" ? (draft.steps[0]?.id ?? "") : step.goTo,
                    })
                  }
                />
              </LibraryField>
              <LibraryField label="On needs attention">
                <Choice
                  id={`${step.key}-attention`}
                  value={step.onNeedsAttention}
                  labels={GATE_LABELS}
                  onChange={(onNeedsAttention) => onChange({ ...step, onNeedsAttention })}
                />
              </LibraryField>
            </div>
          ) : null}
          {gives && step.onFail === "loop" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <LibraryField label="Go back to">
                <Choice
                  id={`${step.key}-goto`}
                  value={step.goTo}
                  labels={stepLabels}
                  options={[step, ...otherSteps].map((other) => other.id)}
                  onChange={(goTo) => onChange({ ...step, goTo })}
                />
              </LibraryField>
              <LibraryField label="At most this many rounds">
                <Input
                  inputMode="numeric"
                  value={step.maxRounds}
                  onChange={(event) => onChange({ ...step, maxRounds: event.target.value })}
                />
              </LibraryField>
            </div>
          ) : null}
          <LibraryField label="When the run fails or times out">
            <Choice
              id={`${step.key}-error`}
              value={step.onError}
              labels={GATE_LABELS}
              onChange={(onError) => onChange({ ...step, onError })}
            />
          </LibraryField>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={step.modelSelection !== null}
                onCheckedChange={(on) =>
                  onChange({ ...step, modelSelection: on ? bot.modelSelection : null })
                }
              />
              Use another model in this pipeline
            </label>
            {step.modelSelection !== null ? (
              <BotModelPicker
                environmentId={environmentId}
                value={step.modelSelection}
                onChange={(modelSelection) => onChange({ ...step, modelSelection })}
              />
            ) : null}
          </div>
          {anywhereSupported ? (
            <BotTargetField
              environmentId={environmentId}
              botId={bot.id}
              projectId={null}
              value={step.target}
              onChange={(target) => onChange({ ...step, target })}
            />
          ) : null}
        </>
      )}
      <Problems problems={problems} />
    </div>
  );
}

export function PipelineEditor({
  environmentId,
  pipeline,
  allBots,
  canSave,
  onClose,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline | null;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly canSave: boolean;
  readonly onClose: () => void;
  readonly onSaved: (pipeline: BotPipeline) => void;
}) {
  const [draft, setDraft] = useState<PipelineDraft>(() =>
    pipeline === null ? emptyPipelineDraft() : pipelineDraft(pipeline),
  );
  const [idEdited, setIdEdited] = useState(pipeline !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useAtomCommand(bots.savePipeline, { reportFailure: false });
  const runnable = allBots.filter((bot) => bot.archivedAt === null);
  const update = (patch: Partial<PipelineDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const updateStep = (key: string, next: PipelineStepDraft) =>
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.key === key ? next : step)),
    }));

  const built = pipelineInputFromDraft(draft);
  // A string key, since a new object every render would never settle the debounce.
  const builtKey = built.ok ? JSON.stringify(built.input) : "";
  const sentKey = useDebouncedValue(builtKey, CHECK_DEBOUNCE_MS);
  const sent = useMemo(
    () => (sentKey === "" ? null : (JSON.parse(sentKey) as BotPipelineInput)),
    [sentKey],
  );
  const check = useEnvironmentQuery(
    sent === null ? null : bots.checkPipeline({ environmentId, input: { pipeline: sent } }),
  );
  const problems = sentKey === builtKey && built.ok ? (check.data?.problems ?? []) : [];
  const blocked = problems.some((problem) => problem.severity === "error");

  const submit = async () => {
    if (busy || !canSave) return;
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await save({
        environmentId,
        input: {
          pipeline: built.input,
          ...(pipeline === null ? {} : { expectedVersion: pipeline.version }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the pipeline.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={pipeline === null ? "New pipeline" : `Edit ${pipeline.name}`}
      description="Steps run one after another; each fills its bot's inputs from the pipeline's inputs and earlier steps."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !canSave || blocked} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <LibraryField label="Name">
            <Input
              value={draft.name}
              onChange={(event) =>
                update({
                  name: event.target.value,
                  ...(idEdited ? {} : { id: slugFromName(event.target.value) }),
                })
              }
            />
          </LibraryField>
          <LibraryField label="Id">
            <Input
              value={draft.id}
              disabled={pipeline !== null}
              onChange={(event) => {
                setIdEdited(true);
                update({ id: event.target.value });
              }}
            />
          </LibraryField>
        </div>
        <LibraryField label="Description">
          <Input
            value={draft.description}
            onChange={(event) => update({ description: event.target.value })}
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
              No inputs. Add one and refer to it in a step as {"{{input.name}}"}.
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
        <section className="grid gap-2" aria-label="Steps">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Steps</h3>
            <Button
              size="xs"
              variant="outline"
              disabled={draft.steps.length >= BOTS_PIPELINE_MAX_STEPS}
              onClick={() => update({ steps: [...draft.steps, newStepDraft(draft, null)] })}
            >
              <PlusIcon />
              Add step
            </Button>
          </div>
          {draft.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No steps. Add one for each bot the pipeline runs.
            </p>
          ) : null}
          {draft.steps.map((step, index) => (
            <StepCard
              key={step.key}
              environmentId={environmentId}
              draft={draft}
              index={index}
              step={step}
              allBots={runnable}
              problems={problemsOf(problems, step.id.trim())}
              onChange={(next) => updateStep(step.key, next)}
              onMove={(by) =>
                setDraft((current) => {
                  const steps = [...current.steps];
                  const [moved] = steps.splice(index, 1);
                  steps.splice(index + by, 0, moved!);
                  return { ...current, steps };
                })
              }
              onRemove={() =>
                update({ steps: draft.steps.filter((entry) => entry.key !== step.key) })
              }
            />
          ))}
        </section>
        <Problems problems={problemsOf(problems, null)} />
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {!canSave ? (
          <p role="status" className="text-sm text-muted-foreground">
            This connection cannot change pipelines.
          </p>
        ) : null}
      </form>
    </LibraryDialog>
  );
}
