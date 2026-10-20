import type { ModelSelection } from "@t3tools/contracts";
import {
  BOTS_PIPELINE_MAX_ROUNDS,
  BotPipelineInput,
  type BotDefinition,
  type BotPipelineGate,
  type BotPipelineProblem,
  type BotPipelineStep,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { parameterDrafts, parameterInput, type BotParameterDraft } from "./draft";

export type PipelineVersionChoice = "latest" | "stable" | "number";
/** `loop` goes back to another step, at most a number of rounds. */
export type PipelineFailChoice = BotPipelineGate | "loop";

export interface PipelineStepDraft {
  readonly key: string;
  readonly id: string;
  readonly botId: string;
  readonly version: PipelineVersionChoice;
  readonly versionNumber: string;
  /** A template per input of the step's bot. */
  readonly inputs: Readonly<Record<string, string>>;
  readonly forEach: boolean;
  readonly forEachFrom: string;
  readonly onFail: PipelineFailChoice;
  readonly goTo: string;
  readonly maxRounds: string;
  readonly onNeedsAttention: BotPipelineGate;
  readonly onError: BotPipelineGate;
  /** Null runs the step on its bot's model. */
  readonly modelSelection: ModelSelection | null;
}

export interface PipelineDraft {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<BotParameterDraft>;
  readonly steps: ReadonlyArray<PipelineStepDraft>;
}

let stepKeys = 0;

/** A step for `bot`, its inputs filled from pipeline inputs of the same name. */
export const newStepDraft = (
  draft: PipelineDraft,
  bot: Pick<BotDefinition, "id" | "parameters"> | null,
): PipelineStepDraft => {
  const taken = new Set(draft.steps.map((step) => step.id));
  const base = bot?.id ?? "step";
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return {
    key: `step-${++stepKeys}`,
    id,
    botId: bot?.id ?? "",
    version: "latest",
    versionNumber: "",
    inputs: bot === null ? {} : defaultStepInputs(draft, bot),
    forEach: false,
    forEachFrom: "",
    onFail: "stop",
    goTo: "",
    maxRounds: "3",
    onNeedsAttention: "stop",
    onError: "stop",
    modelSelection: null,
  };
};

export const defaultStepInputs = (
  draft: Pick<PipelineDraft, "parameters">,
  bot: Pick<BotDefinition, "parameters">,
): Record<string, string> => {
  const names = new Set(draft.parameters.map((parameter) => parameter.name.trim()));
  return Object.fromEntries(
    bot.parameters.map((parameter) => [
      parameter.name,
      names.has(parameter.name) ? `{{input.${parameter.name}}}` : "",
    ]),
  );
};

export const emptyPipelineDraft = (): PipelineDraft => ({
  id: "",
  name: "",
  description: "",
  parameters: [],
  steps: [],
});

export const pipelineDraft = (pipeline: BotPipelineInput): PipelineDraft => ({
  id: pipeline.id,
  name: pipeline.name,
  description: pipeline.description,
  parameters: parameterDrafts(pipeline.parameters),
  steps: pipeline.steps.map((step) => ({
    key: `step-${++stepKeys}`,
    id: step.id,
    botId: step.botId,
    version: typeof step.version === "number" ? "number" : (step.version ?? "latest"),
    versionNumber: typeof step.version === "number" ? String(step.version) : "",
    inputs: step.inputs,
    forEach: step.forEach !== undefined,
    forEachFrom: step.forEach?.from ?? "",
    onFail: typeof step.onFail === "object" ? "loop" : (step.onFail ?? "stop"),
    goTo: typeof step.onFail === "object" ? step.onFail.goTo : "",
    maxRounds: typeof step.onFail === "object" ? String(step.onFail.maxRounds) : "3",
    onNeedsAttention: step.onNeedsAttention ?? "stop",
    onError: step.onError ?? "stop",
    modelSelection: step.modelSelection ?? null,
  })),
});

/** Stop is the default of every gate, so it is left out of the saved step. */
const stepInput = (step: PipelineStepDraft): BotPipelineStep => {
  const inputs = Object.fromEntries(
    Object.entries(step.inputs).filter(([, template]) => template.trim() !== ""),
  );
  return {
    id: step.id.trim(),
    botId: step.botId,
    ...(step.version === "stable"
      ? { version: "stable" as const }
      : step.version === "number"
        ? { version: Number(step.versionNumber) }
        : {}),
    inputs,
    ...(step.forEach ? { forEach: { from: step.forEachFrom.trim() } } : {}),
    ...(step.onFail === "loop"
      ? { onFail: { goTo: step.goTo, maxRounds: Number(step.maxRounds) } }
      : step.onFail === "continue"
        ? { onFail: "continue" as const }
        : {}),
    ...(step.onNeedsAttention === "continue" ? { onNeedsAttention: "continue" as const } : {}),
    ...(step.onError === "continue" ? { onError: "continue" as const } : {}),
    ...(step.modelSelection === null ? {} : { modelSelection: step.modelSelection }),
  };
};

const decodePipeline = Schema.decodeUnknownOption(BotPipelineInput);

/** The pipeline a draft describes, or the first problem a person can fix in the form. */
export const pipelineInputFromDraft = (
  draft: PipelineDraft,
):
  | { readonly ok: true; readonly input: BotPipelineInput }
  | { readonly ok: false; readonly message: string } => {
  const decoded = decodePipeline({
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    parameters: draft.parameters.map(parameterInput),
    steps: draft.steps.map(stepInput),
  });
  if (Option.isSome(decoded)) return { ok: true, input: decoded.value };
  return { ok: false, message: describeProblem(draft) };
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const describeProblem = (draft: PipelineDraft): string => {
  if (!SLUG.test(draft.id.trim()))
    return "The id uses lowercase letters, digits and dashes, and starts with a letter or digit.";
  if (draft.name.trim() === "") return "Give the pipeline a name.";
  for (const parameter of draft.parameters) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(parameter.name.trim()))
      return "Input names use letters, digits and underscores, and start with a letter.";
    if (parameter.type === "choice" && parameter.choices.trim() === "")
      return `List at least one choice for ${parameter.label || parameter.name}.`;
  }
  if (draft.steps.length === 0) return "Add a step.";
  for (const step of draft.steps) {
    const name = step.id.trim() || "A step";
    if (!SLUG.test(step.id.trim()))
      return "Step ids use lowercase letters, digits and dashes, and start with a letter or digit.";
    if (step.botId === "") return `Choose a bot for ${name}.`;
    const version = Number(step.versionNumber);
    if (step.version === "number" && (!Number.isInteger(version) || version < 1))
      return `The version of ${name} is a whole number from 1.`;
    if (step.forEach && step.forEachFrom.trim() === "")
      return `Say what ${name} runs once per item of, such as {{steps.review.findings}}.`;
    const rounds = Number(step.maxRounds);
    if (
      step.onFail === "loop" &&
      (!Number.isInteger(rounds) || rounds < 1 || rounds > BOTS_PIPELINE_MAX_ROUNDS)
    )
      return `Rounds for ${name} are a whole number from 1 to ${BOTS_PIPELINE_MAX_ROUNDS}.`;
    if (step.onFail === "loop" && step.goTo === "") return `Choose the step ${name} goes back to.`;
  }
  return "Check the fields and lengths, then save again.";
};

/** Problems of one step, or of the pipeline as a whole for a null step. */
export const problemsOf = (
  problems: ReadonlyArray<BotPipelineProblem>,
  stepId: string | null,
): ReadonlyArray<BotPipelineProblem> => problems.filter((problem) => problem.stepId === stepId);

/** References a step can use in its templates, for the editor's hint. */
export const stepReferences = (draft: PipelineDraft, index: number): ReadonlyArray<string> => [
  ...draft.parameters
    .map((parameter) => parameter.name.trim())
    .filter(Boolean)
    .map((name) => `{{input.${name}}}`),
  ...draft.steps
    .slice(0, index)
    .map((step) => step.id.trim())
    .filter(Boolean)
    .map((id) => `{{steps.${id}.summary}}`),
  ...(draft.steps[index]?.forEach ? ["{{item}}"] : []),
  "{{round}}",
];
