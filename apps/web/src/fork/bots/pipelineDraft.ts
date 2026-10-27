import {
  BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
  BOTS_PIPELINE_MAX_ROUNDS,
  BOTS_PIPELINE_MAX_STEPS,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineAttempt,
  type BotPipelineId,
  type BotPipelineProblem,
  type BotPipelineRun,
  type BotsSavePipelineInput,
} from "@t3tools/contracts/fork";
import {
  BOT_PIPELINE_RUN_STATES,
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  defaultStepInputs,
  newStepDraft,
  pipelineInputFromDraft,
  type LibraryWorkflowTone,
  type PipelineDraft,
  type PipelineStepDraft,
} from "@t3tools/client-runtime/fork";

/*
 * Pure pipeline logic for the web builder and pages. The draft shape and its mapping to the wire
 * live in client-runtime, shared with mobile; what only the full-page builder needs sits here.
 */

type BotFacts = Pick<BotDefinition, "id" | "name" | "parameters" | "output" | "archivedAt">;
export type BotLookup = (botId: string) => BotFacts | undefined;

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

const gives = (bot: BotFacts | undefined) => bot?.output === "verdict";

/**
 * The version a save must find stored. A new pipeline sends 0, which the server reads as "no
 * pipeline has this id yet", so a new pipeline can never overwrite one that shares its slug.
 */
export const expectedVersionFor = (original: Pick<BotPipeline, "version"> | null): number =>
  original?.version ?? 0;

/** The save request for a draft, or the first problem a person can fix in the form. */
export const saveRequest = (
  draft: PipelineDraft,
  expectedVersion: number,
):
  | { readonly ok: true; readonly input: BotsSavePipelineInput }
  | { readonly ok: false; readonly message: string } => {
  const built = pipelineInputFromDraft(draft);
  return built.ok ? { ok: true, input: { pipeline: built.input, expectedVersion } } : built;
};

const draftSignature = (draft: PipelineDraft) =>
  JSON.stringify({
    ...draft,
    parameters: draft.parameters.map(({ key: _key, ...parameter }) => parameter),
    steps: draft.steps.map(({ key: _key, ...step }) => step),
  });

/** Whether a draft differs from where it started, ignoring the keys that only track rows. */
export const isDraftDirty = (initial: PipelineDraft, current: PipelineDraft) =>
  draftSignature(initial) !== draftSignature(current);

const freeStepId = (draft: PipelineDraft, base: string, exceptKey?: string) => {
  const taken = new Set(
    draft.steps.filter((step) => step.key !== exceptKey).map((step) => step.id.trim()),
  );
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
};

/** A new step for `bot` at `index`, with the key the builder opens it by. */
export const insertStep = (
  draft: PipelineDraft,
  index: number,
  bot: Pick<BotDefinition, "id" | "parameters"> | null,
): { readonly draft: PipelineDraft; readonly key: string } => {
  if (draft.steps.length >= BOTS_PIPELINE_MAX_STEPS) return { draft, key: "" };
  const step = newStepDraft(draft, bot);
  const at = Math.max(0, Math.min(index, draft.steps.length));
  return {
    draft: { ...draft, steps: [...draft.steps.slice(0, at), step, ...draft.steps.slice(at)] },
    key: step.key,
  };
};

/** Moves a step one place up or down; a step already at that end stays. */
export const moveStep = (draft: PipelineDraft, key: string, by: -1 | 1): PipelineDraft => {
  const from = draft.steps.findIndex((step) => step.key === key);
  const to = from + by;
  if (from === -1 || to < 0 || to >= draft.steps.length) return draft;
  const steps = [...draft.steps];
  const [moved] = steps.splice(from, 1);
  if (moved === undefined) return draft;
  steps.splice(to, 0, moved);
  return { ...draft, steps };
};

/**
 * Removes a step. A loop that went back to it loses its target, so the builder asks for another,
 * unless another step still holds the id, as a half-typed duplicate can.
 */
export const removeStep = (draft: PipelineDraft, key: string): PipelineDraft => {
  const removed = draft.steps.find((step) => step.key === key);
  if (removed === undefined) return draft;
  const id = removed.id.trim();
  const steps = draft.steps.filter((step) => step.key !== key);
  if (steps.some((step) => step.id.trim() === id)) return { ...draft, steps };
  return {
    ...draft,
    steps: steps.map((step) =>
      step.onFail === "loop" && step.goTo === id ? { ...step, goTo: "" } : step,
    ),
  };
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Points every reference to step `from` at `to`: templates, the items a step runs over, item
 * labels and loops. Renaming a step therefore never silently breaks the steps that read it.
 */
export const renameReferences = (draft: PipelineDraft, from: string, to: string): PipelineDraft => {
  if (from === "" || from === to) return draft;
  const pattern = new RegExp(String.raw`(\{\{\s*steps\.)${escapeRegExp(from)}(\.)`, "g");
  const rewrite = (template: string) => template.replace(pattern, `$1${to}$2`);
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      inputs: Object.fromEntries(
        Object.entries(step.inputs).map(([name, template]) => [name, rewrite(template)]),
      ),
      forEachFrom: rewrite(step.forEachFrom),
      forEachItemLabel: rewrite(step.forEachItemLabel),
      goTo: step.goTo === from ? to : step.goTo,
    })),
  };
};

/** Whether a step still carries the id the builder made up for it, rather than one a person chose. */
const isAutoStepId = (id: string, botId: string) => {
  const bases = botId === "" ? ["step"] : ["step", botId];
  return bases.some((base) => id === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(id));
};

/** Points every `{{input.from}}` at `to`, so renaming a pipeline input keeps its readers. */
export const renameInputReferences = (
  draft: PipelineDraft,
  from: string,
  to: string,
): PipelineDraft => {
  if (from === "" || from === to) return draft;
  const pattern = new RegExp(String.raw`(\{\{\s*input\.)${escapeRegExp(from)}(\s*\}\})`, "g");
  const rewrite = (template: string) => template.replace(pattern, `$1${to}$2`);
  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      inputs: Object.fromEntries(
        Object.entries(step.inputs).map(([name, template]) => [name, rewrite(template)]),
      ),
      forEachFrom: rewrite(step.forEachFrom),
      forEachItemLabel: rewrite(step.forEachItemLabel),
    })),
  };
};

/**
 * Whether references may follow a step to `id`: a valid id no other step holds. While a person
 * types, an id can pass through another step's, and following it there would merge the two.
 */
export const canTakeStepId = (draft: PipelineDraft, key: string, id: string) =>
  SLUG.test(id) && !draft.steps.some((step) => step.key !== key && step.id.trim() === id);

/** The same for a pipeline input's name. */
export const canTakeInputName = (draft: PipelineDraft, key: string, name: string) =>
  PARAMETER_NAME.test(name) &&
  !draft.parameters.some((parameter) => parameter.key !== key && parameter.name.trim() === name);

/**
 * Gives a step another bot. Templates for inputs the new bot shares by name stay, the rest start
 * from the pipeline's inputs. Gates a text bot cannot have go back to Stop, since the server
 * refuses them and their controls would be hidden. A made-up id follows the new bot.
 */
export const changeStepBot = (
  draft: PipelineDraft,
  key: string,
  bot: Pick<BotDefinition, "id" | "parameters" | "output">,
): PipelineDraft => {
  const step = draft.steps.find((candidate) => candidate.key === key);
  if (step === undefined || step.botId === bot.id) return draft;
  const defaults = defaultStepInputs(draft, bot);
  const inputs = Object.fromEntries(
    bot.parameters.map((parameter) => {
      const kept = step.inputs[parameter.name];
      return [
        parameter.name,
        kept !== undefined && kept.trim() !== "" ? kept : (defaults[parameter.name] ?? ""),
      ];
    }),
  );
  const verdict = bot.output === "verdict";
  const id = isAutoStepId(step.id.trim(), step.botId)
    ? freeStepId(draft, bot.id, step.key)
    : step.id;
  const changed: PipelineStepDraft = {
    ...step,
    id,
    botId: bot.id,
    inputs,
    version: step.version === "number" ? "latest" : step.version,
    versionNumber: "",
    modelSelection: null,
    ...(verdict ? {} : { onFail: "stop", goTo: "", onNeedsAttention: "stop" }),
  };
  const swapped = {
    ...draft,
    steps: draft.steps.map((candidate) => (candidate.key === key ? changed : candidate)),
  };
  return id === step.id ? swapped : renameReferences(swapped, step.id.trim(), id);
};

export type LoopRange = { readonly start: number; readonly end: number };

/** Loops by step index, as the server reads them; a loop to a later or unknown step is left out. */
const draftLoops = (draft: PipelineDraft): ReadonlyArray<LoopRange> =>
  draft.steps.flatMap((step, end) => {
    if (step.onFail !== "loop") return [];
    const start = draft.steps.findIndex((candidate) => candidate.id.trim() === step.goTo);
    return start === -1 || start > end ? [] : [{ start, end }];
  });

export type StepSource = {
  /** The template that reads it, such as `{{steps.review.findings}}`. */
  readonly template: string;
  readonly label: string;
  /** Where it comes from: the pipeline, a step id, the item or the loop. */
  readonly group: string;
};

const STEP_FIELD_LABELS = {
  result: "reply",
  summary: "summary",
  verdict: "verdict",
  findings: "findings",
} as const;
const ITEM_FIELDS = [
  ["item", "The whole item"],
  ["item.title", "Item title"],
  ["item.detail", "Item detail"],
  ["item.path", "Item file"],
  ["item.line", "Item line"],
] as const;

/**
 * What the step at `index` can read, following the server's rules: the pipeline's inputs, earlier
 * steps (and later ones inside a loop it sits in), a verdict step's summary, verdict and findings,
 * the item on a per-item step, and the loop round.
 */
export const stepSources = (
  draft: PipelineDraft,
  index: number,
  botOf: BotLookup,
): ReadonlyArray<StepSource> => {
  const step = draft.steps[index];
  if (step === undefined) return [];
  const loops = draftLoops(draft);
  const readable = draft.steps.filter(
    (other, otherIndex) =>
      other.id.trim() !== "" &&
      (otherIndex < index ||
        loops.some((loop) => loop.start <= index && index <= loop.end && otherIndex <= loop.end)) &&
      otherIndex !== index,
  );
  return [
    ...draft.parameters
      .filter((parameter) => PARAMETER_NAME.test(parameter.name.trim()))
      .map((parameter) => ({
        template: `{{input.${parameter.name.trim()}}}`,
        label: parameter.label.trim() || parameter.name.trim(),
        group: "Pipeline inputs",
      })),
    ...readable.flatMap((other) => {
      const id = other.id.trim();
      const fields = gives(botOf(other.botId))
        ? (["summary", "findings", "verdict", "result"] as const)
        : (["result"] as const);
      return fields.map((field) => ({
        template: `{{steps.${id}.${field}}}`,
        label: `${id} ${STEP_FIELD_LABELS[field]}`,
        group: id,
      }));
    }),
    ...(step.forEach
      ? ITEM_FIELDS.map(([path, label]) => ({ template: `{{${path}}}`, label, group: "This item" }))
      : []),
    { template: "{{round}}", label: "Loop round", group: "Loop" },
  ];
};

/** What a per-item step can run over: an earlier verdict step's findings, or a text input. */
export const itemSources = (
  draft: PipelineDraft,
  index: number,
  botOf: BotLookup,
): ReadonlyArray<StepSource> => [
  ...draft.steps
    .slice(0, index)
    .filter((other) => other.id.trim() !== "" && gives(botOf(other.botId)))
    .map((other) => ({
      template: `{{steps.${other.id.trim()}.findings}}`,
      label: `Each finding of ${other.id.trim()}`,
      group: "Earlier steps",
    })),
  ...draft.parameters
    .filter((parameter) => parameter.type === "text" && PARAMETER_NAME.test(parameter.name.trim()))
    .map((parameter) => ({
      template: `{{input.${parameter.name.trim()}}}`,
      label: `Each line of ${parameter.label.trim() || parameter.name.trim()}`,
      group: "Pipeline inputs",
    })),
];

/** The steps a loop at `index` may go back to: itself and the ones before it. */
export const loopTargets = (draft: PipelineDraft, index: number): ReadonlyArray<string> => [
  ...new Set(
    draft.steps
      .slice(0, index + 1)
      .map((step) => step.id.trim())
      .filter(Boolean),
  ),
];

const INPUT_REFERENCE = /\{\{\s*input\.([A-Za-z0-9_]+)\s*\}\}/g;

/** Which steps read each pipeline input, so an input nobody uses stands out. */
export const inputUsage = (draft: PipelineDraft): ReadonlyMap<string, ReadonlyArray<string>> => {
  const usage = new Map<string, Array<string>>();
  for (const step of draft.steps) {
    const text = [...Object.values(step.inputs), step.forEachFrom, step.forEachItemLabel].join(
      "\n",
    );
    for (const match of text.matchAll(INPUT_REFERENCE)) {
      const name = match[1] ?? "";
      const readers = usage.get(name) ?? [];
      if (!readers.includes(step.id)) readers.push(step.id);
      usage.set(name, readers);
    }
  }
  return usage;
};

const SINGLE_PLACEHOLDER = /^\{\{\s*([^{}]+?)\s*\}\}$/;

/** A step's inputs in one line, such as `target ← input.target · finding ← item`. */
export const mappingSummary = (
  step: Pick<PipelineStepDraft, "inputs">,
): ReadonlyArray<{ readonly name: string; readonly from: string }> =>
  Object.entries(step.inputs)
    .filter(([, template]) => template.trim() !== "")
    .map(([name, template]) => {
      const single = SINGLE_PLACEHOLDER.exec(template.trim());
      return { name, from: single?.[1] ?? "text" };
    });

export type StepReader = {
  readonly stepId: string;
  readonly fields: ReadonlyArray<string>;
};

/** The steps that read `stepId`, and what of it they read, such as its findings. */
export const stepReaders = (draft: PipelineDraft, stepId: string): ReadonlyArray<StepReader> => {
  if (stepId === "") return [];
  const pattern = new RegExp(
    String.raw`\{\{\s*steps\.${escapeRegExp(stepId)}\.(result|summary|verdict|findings)\s*\}\}`,
    "g",
  );
  return draft.steps.flatMap((step) => {
    if (step.id.trim() === stepId) return [];
    const text = [...Object.values(step.inputs), step.forEachFrom, step.forEachItemLabel].join(
      "\n",
    );
    const fields = [...new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ""))];
    return fields.length ? [{ stepId: step.id.trim(), fields }] : [];
  });
};

/**
 * What happens when a step ends badly, in words. A verdict step always says what a fail does;
 * the other gates appear only when they differ from stopping.
 */
export const gateSummary = (
  step: Pick<PipelineStepDraft, "onFail" | "goTo" | "maxRounds" | "onNeedsAttention" | "onError">,
  givesVerdict: boolean,
): ReadonlyArray<string> => [
  ...(givesVerdict
    ? [
        step.onFail === "loop"
          ? `Goes back to ${step.goTo || "an earlier step"} if it fails, up to ${step.maxRounds} ${step.maxRounds === "1" ? "round" : "rounds"}`
          : step.onFail === "continue"
            ? "Carries on if it fails"
            : "Stops if it fails",
        ...(step.onNeedsAttention === "continue" ? ["Carries on if it needs attention"] : []),
      ]
    : []),
  ...(step.onError === "continue" ? ["Carries on if its run errors"] : []),
];

export type BuilderProblem = {
  /** The step's key, or null for the pipeline as a whole. */
  readonly stepKey: string | null;
  /** The field to mark, in the server's names: `id`, `botId`, `inputs.target`, `onFail`… */
  readonly field: string;
  readonly message: string;
  readonly severity: "error" | "warning";
};

/**
 * What a person can fix before the server is asked, each tied to its step and field, so the
 * builder can mark it the moment it appears rather than after Save.
 */
export const draftProblems = (
  draft: PipelineDraft,
  {
    takenIds,
    isNew,
  }: {
    /** Ids of saved pipelines, which a new one may not reuse. */
    readonly takenIds: ReadonlySet<string>;
    readonly isNew: boolean;
  },
): ReadonlyArray<BuilderProblem> => {
  const problems: Array<BuilderProblem> = [];
  const error = (stepKey: string | null, field: string, message: string) =>
    problems.push({ stepKey, field, message, severity: "error" });

  const id = draft.id.trim();
  if (draft.name.trim() === "") error(null, "name", "Give the pipeline a name.");
  if (!SLUG.test(id))
    error(
      null,
      "id",
      id === ""
        ? "Give the pipeline an id."
        : "The id uses lowercase letters, digits and dashes, and starts with a letter or digit.",
    );
  else if (isNew && takenIds.has(id))
    error(null, "id", `Another pipeline already uses the id ${id}. Choose another id.`);

  const names = new Set<string>();
  for (const parameter of draft.parameters) {
    const name = parameter.name.trim();
    const field = `parameters.${parameter.key}`;
    if (!PARAMETER_NAME.test(name))
      error(
        null,
        field,
        "Input names use letters, digits and underscores, and start with a letter.",
      );
    else if (names.has(name)) error(null, field, `Two inputs are named ${name}.`);
    names.add(name);
    if (parameter.type === "choice" && parameter.choices.trim() === "")
      error(
        null,
        field,
        `List at least one choice for ${parameter.label || name || "this input"}.`,
      );
  }

  if (draft.steps.length === 0) error(null, "steps", "Add a step.");
  const seen = new Set<string>();
  for (const [index, step] of draft.steps.entries()) {
    const stepId = step.id.trim();
    if (!SLUG.test(stepId))
      error(
        step.key,
        "id",
        "Step ids use lowercase letters, digits and dashes, and start with a letter or digit.",
      );
    else if (seen.has(stepId)) error(step.key, "id", `Two steps are named ${stepId}.`);
    seen.add(stepId);
    if (step.botId === "") error(step.key, "botId", "Choose a bot for this step.");
    const version = Number(step.versionNumber);
    if (step.version === "number" && (!Number.isInteger(version) || version < 1))
      error(step.key, "version", "Choose the version this step runs.");
    if (step.forEach && step.forEachFrom.trim() === "")
      error(step.key, "forEach.from", "Choose what this step runs once per item of.");
    if (step.onFail === "loop") {
      const rounds = Number(step.maxRounds);
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > BOTS_PIPELINE_MAX_ROUNDS)
        error(
          step.key,
          "onFail",
          `Rounds are a whole number from 1 to ${BOTS_PIPELINE_MAX_ROUNDS}.`,
        );
      if (step.goTo === "") error(step.key, "onFail", "Choose the step to go back to.");
      else if (!loopTargets(draft, index).includes(step.goTo))
        error(step.key, "onFail", "A loop can only go back to this step or an earlier one.");
    }
  }
  return problems;
};

/**
 * Local problems first, then the server's check, each on the step it names. The server knows a
 * step by its id, so a problem lands on the first step with that id. Repeats are dropped.
 */
export const builderProblems = (
  draft: PipelineDraft,
  local: ReadonlyArray<BuilderProblem>,
  checked: ReadonlyArray<BotPipelineProblem>,
): ReadonlyArray<BuilderProblem> => {
  const fromServer = checked.map((problem): BuilderProblem => {
    const step =
      problem.stepId === null
        ? undefined
        : draft.steps.find((candidate) => candidate.id.trim() === problem.stepId);
    return {
      stepKey: step?.key ?? null,
      field: problem.field,
      message: problem.message,
      severity: problem.severity,
    };
  });
  const seen = new Set<string>();
  return [...local, ...fromServer].filter((problem) => {
    const signature = `${problem.stepKey ?? ""}\u0000${problem.field}\u0000${problem.message}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

/**
 * The newest pipeline runs, overall or of one pipeline. Every view asks with this input, so the
 * index, a pipeline's page and its cards share one request each.
 */
export const pipelineRunsInput = (pipelineId?: BotPipelineId) => ({
  limit: BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
  ...(pipelineId === undefined ? {} : { pipelineId }),
});

/** A run's outcome as one tone: its final verdict once it completed, else where it stands. */
export const pipelineRunTone = (
  run: Pick<BotPipelineRun, "status" | "finalVerdict">,
): LibraryWorkflowTone =>
  run.status === "completed" && run.finalVerdict !== null
    ? BOT_VERDICT_STATES[run.finalVerdict].tone
    : BOT_PIPELINE_RUN_STATES[run.status].tone;

export type AttemptTone = LibraryWorkflowTone | "waiting";

/** An attempt's state as one label and tone; how a finished run ended outranks "Done". */
export const attemptState = (
  attempt: Pick<BotPipelineAttempt, "state" | "outcome">,
): { readonly label: string; readonly tone: AttemptTone } => {
  switch (attempt.state) {
    case "pending":
      return { label: "Waiting", tone: "waiting" };
    case "started":
      return { label: "Running", tone: "active" };
    case "skipped":
      return { label: "No items to run", tone: "neutral" };
    case "done": {
      const status = attempt.outcome?.status ?? "completed";
      if (status !== "completed") return BOT_RUN_STATES[status];
      const verdict = attempt.outcome?.verdict;
      return verdict ? BOT_VERDICT_STATES[verdict] : { label: "Done", tone: "success" };
    }
  }
};

export type RunStep = {
  readonly stepId: string;
  /** Null when the run's version is not the one saved now, so its bot is not known. */
  readonly botId: string | null;
  /** Oldest first; more than one when a loop went round or the run was resumed. */
  readonly attempts: ReadonlyArray<BotPipelineAttempt>;
};

/**
 * A run's steps in order with their attempts. Only the pipeline as saved at the run's version
 * says which bot each step used and which steps lay ahead; for an older run the steps are the
 * ones it reached, in the order it reached them.
 */
export const runSteps = (
  run: Pick<BotPipelineRun, "pipelineVersion">,
  attempts: ReadonlyArray<BotPipelineAttempt>,
  pipeline: Pick<BotPipeline, "version" | "steps"> | undefined,
): { readonly steps: ReadonlyArray<RunStep>; readonly exact: boolean } => {
  const byStep = new Map<string, Array<BotPipelineAttempt>>();
  for (const attempt of [...attempts].sort((left, right) => left.seq - right.seq)) {
    const list = byStep.get(attempt.stepId) ?? [];
    list.push(attempt);
    byStep.set(attempt.stepId, list);
  }
  if (pipeline !== undefined && pipeline.version === run.pipelineVersion)
    return {
      exact: true,
      steps: pipeline.steps.map((step) => ({
        stepId: step.id,
        botId: step.botId,
        attempts: byStep.get(step.id) ?? [],
      })),
    };
  return {
    exact: false,
    steps: [...byStep.entries()].map(([stepId, list]) => ({ stepId, botId: null, attempts: list })),
  };
};

/** The highest loop round any attempt reached; 1 for a run that never looped. */
export const highestRound = (attempts: ReadonlyArray<Pick<BotPipelineAttempt, "round">>) =>
  attempts.reduce((highest, attempt) => Math.max(highest, attempt.round), 1);

const spanMs = (from: string, to: string | null) => {
  if (to === null) return null;
  const span = Date.parse(to) - Date.parse(from);
  return Number.isFinite(span) && span >= 0 ? span : null;
};

/** A pipeline's recent record: how often its finished runs passed, and how long one takes. */
export const pipelineRecord = (
  runs: ReadonlyArray<Pick<BotPipelineRun, "status" | "finalVerdict" | "createdAt" | "finishedAt">>,
) => {
  const finished = runs.filter((run) => run.status !== "running" && run.status !== "waiting");
  const passed = finished.filter((run) => pipelineRunTone(run) === "success").length;
  const spans = finished
    .flatMap((run) => {
      const span = spanMs(run.createdAt, run.finishedAt);
      return span === null ? [] : [span];
    })
    .toSorted((left, right) => left - right);
  return {
    finished: finished.length,
    passed,
    typicalMs: spans.length ? (spans[Math.floor(spans.length / 2)] ?? null) : null,
  };
};
