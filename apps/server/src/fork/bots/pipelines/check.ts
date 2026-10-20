import type {
  BotDefinition,
  BotPipelineInput,
  BotPipelineProblem,
  BotPipelineStep,
} from "@t3tools/contracts/fork";

import { checkParameters } from "../render.ts";
import { parseReference, stepLabel, templateReferences, type Reference } from "./templates.ts";

/** The steps from `start` to `end`, inclusive, that a step's `onFail.goTo` repeats. */
export interface LoopRange {
  readonly start: number;
  readonly end: number;
}

/** Loops by index. A `goTo` naming no earlier step is left out; the check reports it. */
export const loopRanges = (steps: ReadonlyArray<BotPipelineStep>): ReadonlyArray<LoopRange> =>
  steps.flatMap((step, end) => {
    const onFail = step.onFail;
    if (onFail === undefined || typeof onFail === "string") return [];
    const start = steps.findIndex((candidate) => candidate.id === onFail.goTo);
    return start === -1 || start > end ? [] : [{ start, end }];
  });

const inLoop = (loops: ReadonlyArray<LoopRange>, from: number, to: number) =>
  loops.some((loop) => loop.start <= from && from <= loop.end && to <= loop.end);

/** A step that changes files in a project, so a later step may want to see its edits. */
const edits = (bot: BotDefinition) =>
  bot.workspace.type === "project" && bot.interactionMode !== "plan";

export interface CheckContext {
  /** Every bot, archived ones included, by id. */
  readonly bots: ReadonlyMap<string, BotDefinition>;
  readonly versionExists: (botId: string, version: number) => boolean;
}

/** The problems with a pipeline, in step order. A warning does not block saving. */
export const checkPipeline = (
  pipeline: BotPipelineInput,
  { bots, versionExists }: CheckContext,
): ReadonlyArray<BotPipelineProblem> => {
  const problems: Array<BotPipelineProblem> = [];
  const error = (stepId: string | null, field: string, message: string) =>
    problems.push({ stepId, field, message, severity: "error" });
  const { steps } = pipeline;

  const parameterProblem = checkParameters(pipeline);
  if (parameterProblem !== null) error(null, "parameters", parameterProblem);
  const textInputs = new Set(
    pipeline.parameters.filter((parameter) => parameter.type === "text").map((p) => p.name),
  );
  const inputNames = new Set(pipeline.parameters.map((parameter) => parameter.name));

  const indexOf = new Map<string, number>();
  for (const [index, step] of steps.entries()) {
    if (indexOf.has(step.id)) error(step.id, "id", `Two steps are named ${step.id}.`);
    else indexOf.set(step.id, index);
  }

  const loops = loopRanges(steps);
  for (const [index, loop] of loops.entries())
    if (loops.some((other, otherIndex) => otherIndex < index && other.end >= loop.start))
      error(
        steps[loop.end]?.id ?? null,
        "onFail",
        "Loops cannot overlap or sit inside each other.",
      );

  const verdictStep = (stepId: string) => {
    const step = steps[indexOf.get(stepId) ?? -1];
    return step !== undefined && bots.get(step.botId)?.output === "verdict";
  };

  /** Where a step may read: earlier steps, and any step of a loop it sits in. */
  const checkReference = (step: BotPipelineStep, index: number, field: string, ref: Reference) => {
    switch (ref.kind) {
      case "input":
        if (!inputNames.has(ref.name))
          error(step.id, field, `The pipeline has no input named ${ref.name}.`);
        return;
      case "item":
        if (step.forEach === undefined)
          error(step.id, field, "Only a step that runs once per item can use {{item}}.");
        return;
      case "round":
        return;
      case "step": {
        const target = indexOf.get(ref.stepId);
        if (target === undefined) return error(step.id, field, `There is no step ${ref.stepId}.`);
        if (target >= index && !inLoop(loops, index, target))
          return error(
            step.id,
            field,
            `${stepLabel(ref.stepId)} runs later, so only a step in the same loop can read it.`,
          );
        if (ref.field !== "result" && !verdictStep(ref.stepId))
          error(
            step.id,
            field,
            `${stepLabel(ref.stepId)} gives no verdict, so it has no ${ref.field}.`,
          );
      }
    }
  };

  for (const [index, step] of steps.entries()) {
    const bot = bots.get(step.botId);
    if (bot === undefined) {
      error(step.id, "botId", `There is no bot ${step.botId}.`);
      continue;
    }
    if (bot.archivedAt !== null) error(step.id, "botId", `${bot.name} is archived.`);
    if (typeof step.version === "number" && !versionExists(bot.id, step.version))
      error(step.id, "version", `${bot.name} has no version ${step.version}.`);

    for (const parameter of bot.parameters)
      if (parameter.required && parameter.default === undefined && !(parameter.name in step.inputs))
        error(step.id, `inputs.${parameter.name}`, `${parameter.label} needs a value.`);
    let usesItem = false;
    for (const [name, template] of Object.entries(step.inputs)) {
      const field = `inputs.${name}`;
      if (!bot.parameters.some((parameter) => parameter.name === name)) {
        error(step.id, field, `${bot.name} has no input named ${name}.`);
        continue;
      }
      const { references, unknown } = templateReferences(template);
      for (const placeholder of unknown)
        error(step.id, field, `${placeholder} is not something a step can read.`);
      for (const reference of references) {
        if (reference.kind === "item") usesItem = true;
        checkReference(step, index, field, reference);
      }
    }

    const verdict = bot.output === "verdict";
    if (!verdict && step.onFail !== undefined)
      error(step.id, "onFail", `${bot.name} gives no verdict, so it cannot fail.`);
    if (!verdict && step.onNeedsAttention !== undefined)
      error(step.id, "onNeedsAttention", `${bot.name} gives no verdict to act on.`);
    const onFail = step.onFail;
    if (onFail !== undefined && typeof onFail !== "string") {
      const target = indexOf.get(onFail.goTo);
      if (target === undefined) error(step.id, "onFail", `There is no step ${onFail.goTo}.`);
      else if (target > index)
        error(step.id, "onFail", "A loop can only go back to this step or an earlier one.");
    }

    if (step.forEach !== undefined) {
      const ref = parseReference(step.forEach.from.trim().replace(/^\{\{|\}\}$/g, ""));
      const fromStep = ref?.kind === "step" ? indexOf.get(ref.stepId) : undefined;
      const valid =
        (ref?.kind === "step" &&
          ref.field === "findings" &&
          fromStep !== undefined &&
          fromStep < index &&
          verdictStep(ref.stepId)) ||
        (ref?.kind === "input" && textInputs.has(ref.name));
      if (!valid)
        error(
          step.id,
          "forEach.from",
          "Run once per finding of an earlier verdict step, or per line of a text input.",
        );
      if (!usesItem)
        error(step.id, "forEach", "One of the step's inputs needs {{item}} to receive each item.");
      if (step.forEach.itemLabel !== undefined)
        for (const reference of templateReferences(step.forEach.itemLabel).references)
          checkReference(step, index, "forEach.itemLabel", reference);
    }

    if (bot.workspace.type === "project" && bot.workspace.worktree) {
      const earlier = steps
        .slice(0, index)
        .map((candidate) => bots.get(candidate.botId))
        .find((candidate) => candidate !== undefined && edits(candidate));
      if (earlier !== undefined)
        problems.push({
          stepId: step.id,
          field: "botId",
          severity: "warning",
          message: `${bot.name} runs in its own worktree, so it will not see changes ${earlier.name} made. Use a bot that runs in the caller's checkout to share edits.`,
        });
    }
  }
  return problems;
};
