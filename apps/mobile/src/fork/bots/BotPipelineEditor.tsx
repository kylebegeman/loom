import { useState } from "react";
import { ScrollView, View } from "react-native";
import { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_MAX_PARAMETERS,
  BOTS_PIPELINE_MAX_STEPS,
  slugFromName,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineProblem,
  type BotTarget,
} from "@t3tools/contracts/fork";
import {
  defaultStepInputs,
  emptyPipelineDraft,
  newParameterDraft,
  newStepDraft,
  pipelineDraft,
  pipelineInputFromDraft,
  stepReferences,
  type PipelineDraft,
  type PipelineStepDraft,
} from "@t3tools/client-runtime/fork";
import { commandValue } from "./runLogic";
import { useBotActionLifetime } from "./useBotActionLifetime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { BotChoice, BotField, BotInput, BotNotice, BotSection, BotToggle } from "./BotControls";
import { BotParameterEditor } from "./BotEditorScreen";
import { BotModelField } from "./BotModelField";
import { RunChoice } from "./BotRunScreen";
import { bots, useBotsCapabilities } from "./state";

function PipelineTargetField({
  environmentId,
  botId,
  value,
  disabled,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId: string;
  readonly value: BotTarget;
  readonly disabled: boolean;
  readonly onChange: (target: BotTarget) => void;
}) {
  const query = useEnvironmentQuery(bots.targets({ environmentId, input: { botId } }));
  const selected = value.type === "environment" ? `environment:${value.environmentId}` : value.type;
  const targets = query.data?.targets.filter((target) => !target.isThisComputer) ?? [];
  return (
    <BotField
      label="Run on"
      hint="Best available chooses the ready computer with the most free slots; this computer wins ties."
    >
      <RunChoice
        label="Computer"
        value={selected}
        disabled={disabled}
        choices={[
          { value: "here", label: "This computer" },
          { value: "best", label: "Best available" },
          ...targets.map((target) => ({
            value: `environment:${target.environmentId}`,
            label: target.label,
            detail: target.ready ? `${target.freeSlots} free slots` : target.reasons.join(" "),
            disabled: !target.ready,
          })),
          ...(value.type === "environment" &&
          !targets.some((target) => target.environmentId === value.environmentId)
            ? [
                {
                  value: selected,
                  label: `Saved computer: ${value.environmentId}`,
                  detail: "This computer is not currently available.",
                  disabled: true,
                },
              ]
            : []),
        ]}
        onChange={(next) =>
          onChange(
            next.startsWith("environment:")
              ? {
                  type: "environment",
                  environmentId: EnvironmentId.make(next.slice("environment:".length)),
                }
              : next === "best"
                ? { type: "best" }
                : { type: "here" },
          )
        }
      />
      <BotNotice
        error={query.error}
        detail={
          query.data?.library === "none"
            ? "Connect this computer to a Library to run shared bots elsewhere."
            : query.data?.library === "unsupported"
              ? "Update the Library server to run shared bots elsewhere."
              : undefined
        }
      />
    </BotField>
  );
}

function PipelineStepEditor({
  environmentId,
  draft,
  index,
  step,
  allBots,
  busy,
  onChange,
  onMove,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: PipelineDraft;
  readonly index: number;
  readonly step: PipelineStepDraft;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly busy: boolean;
  readonly onChange: (step: PipelineStepDraft) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const caps = useBotsCapabilities(environmentId);
  const bot = allBots.find((candidate) => candidate.id === step.botId);
  const runnable = allBots.filter(
    (candidate) => candidate.archivedAt === null || candidate.id === step.botId,
  );
  return (
    <View className="gap-3 rounded-xl border border-border-subtle p-3">
      <Text accessibilityRole="header" className="font-t3-semibold">
        Step {index + 1}
      </Text>
      <BotInput
        label="Step ID"
        value={step.id}
        disabled={busy}
        onChangeText={(id) => onChange({ ...step, id })}
      />
      <RunChoice
        label="Bot"
        value={step.botId}
        disabled={busy}
        choices={[
          ...runnable.map((candidate) => ({
            value: candidate.id as string,
            label: candidate.name,
            ...(candidate.archivedAt ? { detail: "Archived" } : {}),
          })),
          ...(!bot && step.botId
            ? [{ value: step.botId, label: `Unavailable bot: ${step.botId}` }]
            : []),
        ]}
        onChange={(botId) => {
          const selected = allBots.find((candidate) => candidate.id === botId);
          onChange({ ...step, botId, inputs: selected ? defaultStepInputs(draft, selected) : {} });
        }}
      />
      <View className="flex-row flex-wrap gap-2">
        <Button label="Move up" disabled={busy || index === 0} onPress={() => onMove(-1)} />
        <Button
          label="Move down"
          disabled={busy || index === draft.steps.length - 1}
          onPress={() => onMove(1)}
        />
        <Button label="Remove step" disabled={busy} onPress={onRemove} />
      </View>
      <BotChoice
        label="Bot version"
        value={step.version}
        disabled={busy}
        options={[
          { value: "latest", label: "Latest" },
          ...(caps.versionsSupported || step.version === "stable"
            ? [{ value: "stable" as const, label: "Stable" }]
            : []),
          { value: "number", label: "Fixed version" },
        ]}
        onChange={(version) => onChange({ ...step, version })}
      />
      {step.version === "number" ? (
        <BotInput
          label="Version number"
          keyboardType="number-pad"
          value={step.versionNumber}
          disabled={busy}
          onChangeText={(versionNumber) => onChange({ ...step, versionNumber })}
        />
      ) : null}
      <BotToggle
        label="Run once per item as a batch"
        value={step.forEach}
        disabled={busy || (!caps.batchesSupported && !step.forEach)}
        onChange={(forEach) => onChange({ ...step, forEach })}
      />
      {step.forEach ? (
        <>
          <BotInput
            label="Items"
            placeholder="{{steps.review.findings}}"
            value={step.forEachFrom}
            disabled={busy}
            onChangeText={(forEachFrom) => onChange({ ...step, forEachFrom })}
          />
          <BotInput
            label="Item label (optional)"
            placeholder="Finding {{item}}"
            value={step.forEachItemLabel}
            disabled={busy}
            onChangeText={(forEachItemLabel) => onChange({ ...step, forEachItemLabel })}
          />
        </>
      ) : null}
      {(bot?.parameters ?? []).map((parameter) => (
        <BotInput
          key={parameter.name}
          label={`${parameter.label}${parameter.required ? "" : " (optional)"} template`}
          value={step.inputs[parameter.name] ?? ""}
          multiline={parameter.type === "text"}
          disabled={busy}
          onChangeText={(value) =>
            onChange({ ...step, inputs: { ...step.inputs, [parameter.name]: value } })
          }
        />
      ))}
      {Object.keys(step.inputs)
        .filter((name) => !bot?.parameters.some((parameter) => parameter.name === name))
        .map((name) => (
          <View key={name} className="gap-2">
            <BotInput
              label={`Saved input ${name}`}
              value={step.inputs[name] ?? ""}
              disabled={busy}
              onChangeText={(value) =>
                onChange({ ...step, inputs: { ...step.inputs, [name]: value } })
              }
            />
            <Button
              label={`Remove saved input ${name}`}
              disabled={busy}
              onPress={() =>
                onChange({
                  ...step,
                  inputs: Object.fromEntries(
                    Object.entries(step.inputs).filter(([key]) => key !== name),
                  ),
                })
              }
            />
          </View>
        ))}
      <Text className="text-xs text-foreground-muted">
        Available references: {stepReferences(draft, index).join(", ")}
      </Text>
      <BotChoice
        label="On a fail verdict"
        value={step.onFail}
        disabled={busy}
        options={[
          { value: "stop", label: "Stop" },
          { value: "continue", label: "Continue to next step" },
          { value: "loop", label: "Go back to a step" },
        ]}
        onChange={(onFail) =>
          onChange({ ...step, onFail, goTo: step.goTo || draft.steps[0]?.id || "" })
        }
      />
      {step.onFail === "loop" ? (
        <>
          <RunChoice
            label="Go back to"
            value={step.goTo}
            disabled={busy}
            choices={draft.steps
              .slice(0, index + 1)
              .map((candidate) => ({ value: candidate.id, label: candidate.id || "Unnamed step" }))}
            onChange={(goTo) => onChange({ ...step, goTo })}
          />
          <BotInput
            label="Maximum rounds"
            keyboardType="number-pad"
            value={step.maxRounds}
            disabled={busy}
            onChangeText={(maxRounds) => onChange({ ...step, maxRounds })}
          />
        </>
      ) : null}
      <BotChoice
        label="On needs attention"
        value={step.onNeedsAttention}
        disabled={busy}
        options={[
          { value: "stop", label: "Stop" },
          { value: "continue", label: "Continue to next step" },
        ]}
        onChange={(onNeedsAttention) => onChange({ ...step, onNeedsAttention })}
      />
      <BotChoice
        label="When a run fails or times out"
        value={step.onError}
        disabled={busy}
        options={[
          { value: "stop", label: "Stop" },
          { value: "continue", label: "Continue to next step" },
        ]}
        onChange={(onError) => onChange({ ...step, onError })}
      />
      <BotToggle
        label="Override the bot's model"
        value={step.modelSelection !== null}
        disabled={busy || !bot}
        onChange={(enabled) =>
          onChange({ ...step, modelSelection: enabled ? (bot?.modelSelection ?? null) : null })
        }
      />
      {step.modelSelection !== null ? (
        <BotModelField
          environmentId={environmentId}
          value={step.modelSelection}
          disabled={busy}
          onChange={(modelSelection) => onChange({ ...step, modelSelection })}
        />
      ) : null}
      {caps.anywhereSupported && bot ? (
        <PipelineTargetField
          environmentId={environmentId}
          botId={bot.id}
          value={step.target}
          disabled={busy}
          onChange={(target) => onChange({ ...step, target })}
        />
      ) : step.target.type !== "here" ? (
        <Text>
          This step keeps its saved remote destination. Update this computer to change it.
        </Text>
      ) : null}
    </View>
  );
}

export function BotPipelineEditor({
  environmentId,
  pipeline,
  allBots,
  canSave,
  onSaved,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline | null;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly canSave: boolean;
  readonly onSaved: (pipeline: BotPipeline) => void;
  readonly onClose: () => void;
}) {
  const active = useBotActionLifetime();
  const [draft, setDraft] = useState<PipelineDraft>(() =>
    pipeline ? pipelineDraft(pipeline) : emptyPipelineDraft(),
  );
  const [idEdited, setIdEdited] = useState(pipeline !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{
    key: string;
    problems: ReadonlyArray<BotPipelineProblem>;
  } | null>(null);
  const save = useAtomCommand(bots.savePipeline, { reportFailure: false });
  const check = useAtomQueryRunner(bots.checkPipeline, { reportFailure: false, refresh: true });
  const update = (patch: Partial<PipelineDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const built = pipelineInputFromDraft(draft);
  const builtKey = built.ok ? JSON.stringify(built.input) : "";
  const checkDraft = async (saving: boolean) => {
    if (busy || !canSave) return;
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setBusy(true);
    setError(null);
    await check({ environmentId, input: { pipeline: built.input } })
      .then(async (result) => {
        const checked = commandValue(result);
        if (!active.current) return;
        setChecked({ key: builtKey, problems: checked.problems });
        if (checked.problems.some((problem) => problem.severity === "error") || !saving) return;
        const saved = commandValue(
          await save({
            environmentId,
            // A new pipeline expects no pipeline under its id, so it never replaces one that
            // shares its slug, such as a starter.
            input: { pipeline: built.input, expectedVersion: pipeline?.version ?? 0 },
          }),
        );
        if (active.current) onSaved(saved);
      })
      .catch((cause: unknown) => {
        if (!active.current) return;
        const message = cause instanceof Error ? cause.message : "Could not save the pipeline.";
        // For a new pipeline this refusal means the id is taken. Older servers word it as a stale
        // edit, which would confuse someone who never opened one.
        setError(
          pipeline === null && message.startsWith("This pipeline changed since")
            ? `Another pipeline already uses the id ${draft.id.trim()}. Choose another id.`
            : message,
        );
      });
    if (active.current) setBusy(false);
  };
  return (
    <Sheet
      title={pipeline ? `Edit ${pipeline.name}` : "New pipeline"}
      dismissible={!busy}
      onClose={onClose}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View className="gap-4 p-4 pb-12">
          <Text>
            Steps run in order. Fill each bot's inputs from pipeline inputs and earlier steps.
          </Text>
          <BotInput
            label="Name"
            value={draft.name}
            disabled={busy}
            onChangeText={(name) =>
              update({ name, ...(idEdited ? {} : { id: slugFromName(name) }) })
            }
          />
          <BotInput
            label="Pipeline ID"
            value={draft.id}
            disabled={busy || pipeline !== null}
            onChangeText={(id) => {
              setIdEdited(true);
              update({ id });
            }}
          />
          <BotInput
            label="Description"
            value={draft.description}
            disabled={busy}
            multiline
            onChangeText={(description) => update({ description })}
          />
          <BotSection title="Inputs" description="Use inputs in a step as {{input.name}}.">
            {draft.parameters.map((parameter) => (
              <BotParameterEditor
                key={parameter.key}
                parameter={parameter}
                disabled={busy}
                onChange={(next) =>
                  update({
                    parameters: draft.parameters.map((candidate) =>
                      candidate.key === parameter.key ? next : candidate,
                    ),
                  })
                }
                onRemove={() =>
                  update({
                    parameters: draft.parameters.filter(
                      (candidate) => candidate.key !== parameter.key,
                    ),
                  })
                }
              />
            ))}
            <Button
              label="Add input"
              disabled={busy || draft.parameters.length >= BOTS_MAX_PARAMETERS}
              onPress={() => update({ parameters: [...draft.parameters, newParameterDraft()] })}
            />
          </BotSection>
          <BotSection title="Steps">
            {draft.steps.length === 0 ? (
              <Text>Add a step for each bot the pipeline runs.</Text>
            ) : null}
            {draft.steps.map((step, index) => (
              <PipelineStepEditor
                key={step.key}
                environmentId={environmentId}
                draft={draft}
                index={index}
                step={step}
                allBots={allBots}
                busy={busy}
                onChange={(next) =>
                  update({
                    steps: draft.steps.map((candidate) =>
                      candidate.key === step.key ? next : candidate,
                    ),
                  })
                }
                onRemove={() =>
                  update({ steps: draft.steps.filter((candidate) => candidate.key !== step.key) })
                }
                onMove={(by) => {
                  const steps = [...draft.steps];
                  const [moved] = steps.splice(index, 1);
                  if (moved) steps.splice(index + by, 0, moved);
                  update({ steps });
                }}
              />
            ))}
            <Button
              label="Add step"
              disabled={busy || draft.steps.length >= BOTS_PIPELINE_MAX_STEPS}
              onPress={() => update({ steps: [...draft.steps, newStepDraft(draft, null)] })}
            />
          </BotSection>
          {checked?.key === builtKey ? (
            checked.problems.length === 0 ? (
              <Text>Pipeline check passed.</Text>
            ) : (
              checked.problems.map((problem) => (
                <Text
                  key={`${problem.stepId}:${problem.field}:${problem.message}`}
                  accessibilityRole={problem.severity === "error" ? "alert" : undefined}
                >
                  {problem.stepId ? `${problem.stepId}: ` : ""}
                  {problem.message}
                </Text>
              ))
            )
          ) : null}
          <BotNotice
            error={error}
            detail={!canSave ? "This connection cannot save pipelines." : undefined}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={busy ? "Working…" : "Save pipeline"}
              tone="primary"
              disabled={busy || !canSave}
              onPress={() => void checkDraft(true)}
            />
            <Button
              label="Check pipeline"
              disabled={busy || !canSave}
              onPress={() => void checkDraft(false)}
            />
            <Button label="Cancel" disabled={busy} onPress={onClose} />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}
