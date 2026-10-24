import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import {
  BOTS_MAX_PARAMETERS,
  BOTS_MAX_VAULT_SLOTS,
  type BotDefinitionInput,
  type BotOutput,
  type BotParameter,
  type BotParameterType,
  type BotVaultSlot,
  type BotVersionSummary,
  type BotWorkspace,
  type VaultAccessAction,
} from "@t3tools/contracts/fork";
import type {
  BotDraft,
  BotParameterDraft,
  BotVaultSlotDraft,
  BotWorkspaceChoice,
} from "@t3tools/client-runtime/fork";

export const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Ask before actions",
  "auto-accept-edits": "Accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

/** What each permission level lets a run do, since nobody watches a bot run as it works. */
export const RUNTIME_MODE_HINTS: Record<RuntimeMode, string> = {
  "approval-required":
    "Asks before commands and file changes. The run waits in Needs you for each answer.",
  "auto-accept-edits": "Edits files without asking. Other actions wait in Needs you for an answer.",
  auto: "Supported providers approve routine actions. Others still wait for an answer.",
  "full-access": "Runs commands and edits files without asking.",
};

export const INTERACTION_MODE_LABELS: Record<ProviderInteractionMode, string> = {
  default: "Do the work",
  plan: "Plan only",
};

export const WORKSPACE_LABELS: Record<BotWorkspaceChoice, string> = {
  scratch: "Fresh scratch folder",
  project: "Project checkout",
  worktree: "New worktree",
  checkout: "Checkout it is run for",
};

/** The consequence of each workspace, since the labels alone do not say what a run can touch. */
export const WORKSPACE_HINTS: Record<BotWorkspaceChoice, string> = {
  scratch: "An empty folder per run. It cannot see or change any project.",
  project: "Works in the project's main checkout, so its edits land where you work.",
  worktree: "A new git worktree per run, so its edits stay on their own branch.",
  checkout: "Works in the checkout of the thread it is run for, such as a merge in progress.",
};

export const OUTPUT_LABELS: Record<BotOutput, string> = {
  text: "Text",
  verdict: "Verdict",
};

export const PARAMETER_TYPE_LABELS: Record<BotParameterType, string> = {
  string: "Short text",
  text: "Long text",
  number: "Number",
  boolean: "Yes or no",
  choice: "Choice",
};

export const VAULT_ACTION_LABELS: Record<VaultAccessAction, string> = {
  use: "Use it",
  inspect: "See its details",
  reveal: "Reveal its value",
  manage: "Change it",
  export: "Export it",
  delegate: "Hand it on",
};

/** The editor's sections, in page order. */
export type EditorSectionId =
  | "basics"
  | "instructions"
  | "inputs"
  | "runtime"
  | "credentials"
  | "budget"
  | "sharing";

/** What the version list and the editor call each definition field. */
const FIELD_LABELS: { readonly [K in keyof BotDefinitionInput]-?: string } = {
  id: "Id",
  name: "Name",
  description: "Description",
  instructions: "Instructions",
  parameters: "Inputs",
  modelSelection: "Model",
  runtimeMode: "Permissions",
  interactionMode: "Mode",
  output: "Reply",
  workspace: "Runs in",
  scopeProjectId: "Available in",
  timeoutMinutes: "Time limit",
  maxConcurrentRuns: "Runs at once",
  vaultSlots: "Credentials",
  budget: "Budget",
};

const isDefinitionField = (field: string): field is keyof BotDefinitionInput =>
  Object.hasOwn(FIELD_LABELS, field);

/** A field name the server reports, such as `vaultSlots`, in the editor's words. */
export const changedFieldLabel = (field: string): string =>
  isDefinitionField(field)
    ? FIELD_LABELS[field]
    : field
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/^./, (first) => first.toUpperCase());

/** "A", "A and B", "A, B and C". */
export const listText = (items: ReadonlyArray<string>): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export interface DiffContext {
  /** A project's title, or the id when this computer does not know it. */
  readonly projectTitle: (projectId: string) => string;
}

export interface BotFieldChange {
  readonly key: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

export interface BotDefinitionDiff {
  /** Both instruction texts when they differ, for a line diff. */
  readonly instructions: { readonly before: string; readonly after: string } | null;
  /** Every other change in editor order, one row per input or credential. */
  readonly fields: ReadonlyArray<BotFieldChange>;
}

const NONE = "None";

export const modelText = (selection: ModelSelection): string => {
  const options = Array.isArray(selection.options)
    ? selection.options.map((option) => `${option.id} ${String(option.value)}`)
    : [];
  return [`${selection.model} on ${selection.instanceId}`, ...options].join(", ");
};

const workspaceText = (workspace: BotWorkspace, context: DiffContext): string => {
  if (workspace.type === "scratch") return WORKSPACE_LABELS.scratch;
  const project =
    workspace.projectId === null
      ? "the project chosen at run time"
      : context.projectTitle(workspace.projectId);
  if (workspace.worktree)
    return `${WORKSPACE_LABELS.worktree} of ${project}${workspace.baseRef ? ` from ${workspace.baseRef}` : ""}`;
  return workspace.checkout === "caller"
    ? `${WORKSPACE_LABELS.checkout}, in ${project}`
    : `${WORKSPACE_LABELS.project} of ${project}`;
};

const parameterText = (parameter: BotParameter): string =>
  [
    PARAMETER_TYPE_LABELS[parameter.type],
    parameter.required ? "required" : "optional",
    ...(parameter.label === parameter.name ? [] : [`labelled ${parameter.label}`]),
    ...(parameter.description ? [`hint ${parameter.description}`] : []),
    ...(parameter.default === undefined ? [] : [`default ${parameter.default}`]),
    ...(parameter.choices ? [`choices ${parameter.choices.join(" / ")}`] : []),
  ].join(", ");

const slotText = (slot: BotVaultSlot): string =>
  [
    slot.label === slot.name ? null : slot.label,
    VAULT_ACTION_LABELS[slot.action],
    slot.destination ? `only toward ${slot.destination}` : "anywhere the action allows",
  ]
    .filter((part) => part !== null)
    .join(", ");

const scalar =
  <K extends keyof BotDefinitionInput>(
    key: K,
    text: (value: BotDefinitionInput[K], context: DiffContext) => string,
  ) =>
  (before: BotDefinitionInput, after: BotDefinitionInput, context: DiffContext) => {
    const was = text(before[key], context);
    const now = text(after[key], context);
    return was === now ? [] : [{ key, label: FIELD_LABELS[key], before: was, after: now }];
  };

/** Items keyed by name: one row per added, removed or changed item, then one for a new order. */
const itemChanges = <T extends { readonly name: string }>(
  key: string,
  noun: string,
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>,
  text: (item: T) => string,
): ReadonlyArray<BotFieldChange> => {
  const was = new Map(before.map((item) => [item.name, item]));
  const now = new Map(after.map((item) => [item.name, item]));
  const changes: Array<BotFieldChange> = [];
  for (const item of before) {
    const next = now.get(item.name);
    if (next === undefined)
      changes.push({
        key: `${key}:${item.name}`,
        label: `${noun} ${item.name}`,
        before: text(item),
        after: "Removed",
      });
    else if (text(item) !== text(next))
      changes.push({
        key: `${key}:${item.name}`,
        label: `${noun} ${item.name}`,
        before: text(item),
        after: text(next),
      });
  }
  for (const item of after)
    if (!was.has(item.name))
      changes.push({
        key: `${key}:${item.name}`,
        label: `${noun} ${item.name}`,
        before: "Not there",
        after: text(item),
      });
  const kept = (items: ReadonlyArray<T>, other: ReadonlyMap<string, T>) =>
    items.filter((item) => other.has(item.name)).map((item) => item.name);
  const order = { before: kept(before, now), after: kept(after, was) };
  if (order.before.join("\n") !== order.after.join("\n"))
    changes.push({
      key: `${key}:order`,
      label: `${noun} order`,
      before: order.before.join(", "),
      after: order.after.join(", "),
    });
  return changes;
};

const limitText = (value: number | undefined) =>
  value === undefined ? "No limit" : value.toLocaleString("en-US");

/**
 * How each definition field differs. Keyed by every field of the contract, so a field added to
 * bots cannot be left out of the comparison the way credentials once were.
 */
const FIELD_DIFFS: {
  readonly [K in keyof BotDefinitionInput]-?: (
    before: BotDefinitionInput,
    after: BotDefinitionInput,
    context: DiffContext,
  ) => ReadonlyArray<BotFieldChange>;
} = {
  id: scalar("id", (id) => id),
  name: scalar("name", (name) => name),
  description: scalar("description", (description) => description || NONE),
  // Shown as a line diff instead.
  instructions: () => [],
  parameters: (before, after) =>
    itemChanges("parameters", "Input", before.parameters, after.parameters, parameterText),
  modelSelection: scalar("modelSelection", modelText),
  runtimeMode: scalar("runtimeMode", (mode) => RUNTIME_MODE_LABELS[mode]),
  interactionMode: scalar("interactionMode", (mode) => INTERACTION_MODE_LABELS[mode]),
  output: scalar("output", (output) => OUTPUT_LABELS[output ?? "text"]),
  workspace: scalar("workspace", workspaceText),
  scopeProjectId: scalar("scopeProjectId", (projectId, context) =>
    projectId === null ? "Every project" : context.projectTitle(projectId),
  ),
  timeoutMinutes: scalar("timeoutMinutes", (minutes) =>
    minutes === 1 ? "1 minute" : `${minutes} minutes`,
  ),
  maxConcurrentRuns: scalar("maxConcurrentRuns", (runs) => String(runs)),
  vaultSlots: (before, after) =>
    itemChanges(
      "vaultSlots",
      "Credential",
      before.vaultSlots ?? [],
      after.vaultSlots ?? [],
      slotText,
    ),
  budget: (before, after) =>
    (
      [
        ["runsPerDay", "Runs per 24 hours"],
        ["tokensPerDay", "Tokens per 24 hours"],
      ] as const
    ).flatMap(([limit, label]) => {
      const was = limitText(before.budget?.[limit]);
      const now = limitText(after.budget?.[limit]);
      return was === now ? [] : [{ key: `budget:${limit}`, label, before: was, after: now }];
    }),
};

/** What changed between two definitions, in the editor's words and order. */
export const botDefinitionDiff = (
  before: BotDefinitionInput,
  after: BotDefinitionInput,
  context: DiffContext,
): BotDefinitionDiff => ({
  instructions:
    before.instructions === after.instructions
      ? null
      : { before: before.instructions, after: after.instructions },
  fields: (Object.keys(FIELD_DIFFS) as Array<keyof BotDefinitionInput>).flatMap((field) =>
    FIELD_DIFFS[field](before, after, context),
  ),
});

/** What each draft field is called in the editor's status line. */
const DRAFT_FIELD_LABELS: { readonly [K in keyof BotDraft]-?: string } = {
  id: "id",
  name: "name",
  description: "description",
  instructions: "instructions",
  parameters: "inputs",
  modelSelection: "model",
  runtimeMode: "permissions",
  interactionMode: "mode",
  output: "reply",
  workspace: "where it runs",
  projectId: "where it runs",
  baseRef: "where it runs",
  scopeProjectId: "where it is available",
  timeoutMinutes: "time limit",
  maxConcurrentRuns: "runs at once",
  vaultSlots: "credentials",
  runsPerDay: "budget",
  tokensPerDay: "budget",
};

/** A draft field as compared: row keys exist only for React, so they never count as a change. */
const comparable = (draft: BotDraft, field: keyof BotDraft): string => {
  const value = draft[field];
  if (field === "parameters")
    return JSON.stringify(draft.parameters.map(({ key: _key, ...parameter }) => parameter));
  if (field === "vaultSlots")
    return JSON.stringify(draft.vaultSlots.map(({ key: _key, ...slot }) => slot));
  return JSON.stringify(value ?? null);
};

/** The parts of the form that differ from where editing started, in form order; empty if none. */
export const draftChanges = (initial: BotDraft, current: BotDraft): ReadonlyArray<string> => {
  const labels: Array<string> = [];
  for (const field of Object.keys(DRAFT_FIELD_LABELS) as Array<keyof BotDraft>) {
    if (comparable(initial, field) === comparable(current, field)) continue;
    const label = DRAFT_FIELD_LABELS[field];
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
};

/** Ids of the form controls, so a problem can point at and focus its field. */
export const fieldIds = {
  name: "bot-name",
  id: "bot-id",
  description: "bot-description",
  instructions: "bot-instructions",
  model: "bot-model",
  project: "bot-project",
  scope: "bot-scope",
  baseRef: "bot-base-ref",
  timeoutMinutes: "bot-timeout",
  maxConcurrentRuns: "bot-concurrency",
  runsPerDay: "bot-runs-per-day",
  tokensPerDay: "bot-tokens-per-day",
  parameter: (key: string, part: "name" | "label" | "description" | "default" | "choices") =>
    `${key}-${part}`,
  slot: (key: string, part: "name" | "label" | "destination") => `${key}-${part}`,
} as const;

export interface DraftProblem {
  /** The id of the control to fix. */
  readonly field: string;
  readonly section: EditorSectionId;
  readonly message: string;
  /**
   * `missing` waits for the first save, so a new form does not open covered in errors. `invalid`
   * shows as soon as it is typed.
   */
  readonly kind: "missing" | "invalid";
}

const BOT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const SLOT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A limit as typed, with thousands separators allowed; null when left empty. */
const limitValue = (text: string): number | null => {
  const trimmed = text.replace(/[\s,_]/g, "");
  return trimmed === "" ? null : Number(trimmed);
};

const numberValue = (text: string): number | null =>
  text.trim() === "" ? null : Number(text.trim());

const wholeBetween = (value: number | null, minimum: number, maximum: number) =>
  value !== null && Number.isInteger(value) && value >= minimum && value <= maximum;

export const draftChoices = (parameter: Pick<BotParameterDraft, "choices">) =>
  parameter.choices
    .split(/\r?\n/)
    .map((choice) => choice.trim())
    .filter(Boolean);

/** Whether a default still fits after the input's type changes. */
const defaultFits = (parameter: BotParameterDraft, type: BotParameterType) => {
  const value = parameter.defaultValue;
  if (value === "") return true;
  switch (type) {
    case "number":
      return value.trim() !== "" && Number.isFinite(Number(value));
    case "boolean":
      return value === "true" || value === "false";
    case "choice":
      return draftChoices(parameter).includes(value);
    default:
      return true;
  }
};

/** An input with a new type, keeping the default only where the new type can hold it. */
export const withParameterType = (
  parameter: BotParameterDraft,
  type: BotParameterType,
): BotParameterDraft => ({
  ...parameter,
  type,
  defaultValue: defaultFits(parameter, type) ? parameter.defaultValue : "",
});

/** For each name, whether an earlier entry already has it; the first keeps its name. */
const repeats = (names: ReadonlyArray<string>): ReadonlyArray<boolean> => {
  const seen = new Set<string>();
  return names.map((name) => {
    const repeat = name !== "" && seen.has(name);
    seen.add(name);
    return repeat;
  });
};

const parameterProblems = (
  parameter: BotParameterDraft,
  repeat: boolean,
): ReadonlyArray<DraftProblem> => {
  const problems: Array<DraftProblem> = [];
  const add = (
    part: Parameters<typeof fieldIds.parameter>[1],
    kind: DraftProblem["kind"],
    message: string,
  ) =>
    problems.push({
      field: fieldIds.parameter(parameter.key, part),
      section: "inputs",
      kind,
      message,
    });
  const name = parameter.name.trim();
  if (name === "") add("name", "missing", "Name the input.");
  else if (!PARAMETER_NAME.test(name))
    add(
      "name",
      "invalid",
      "Use letters, digits and underscores, starting with a letter or underscore.",
    );
  else if (repeat) add("name", "invalid", "Another input already has this name.");
  if (parameter.label.trim().length > 80)
    add("label", "invalid", "Keep the label to 80 characters.");
  if (parameter.description.trim().length > 500)
    add("description", "invalid", "Keep the hint to 500 characters.");
  if (parameter.defaultValue.length > 20_000)
    add("default", "invalid", "Keep the default to 20,000 characters.");
  else if (!defaultFits(parameter, parameter.type))
    add(
      "default",
      "invalid",
      parameter.type === "number"
        ? "The default must be a number."
        : parameter.type === "choice"
          ? "The default must be one of the choices."
          : "The default must be yes or no.",
    );
  if (parameter.type === "choice") {
    const choices = draftChoices(parameter);
    if (choices.length === 0) add("choices", "missing", "List at least one choice.");
    else if (choices.length > 20) add("choices", "invalid", "List 20 choices at most.");
    else if (choices.some((choice) => choice.length > 200))
      add("choices", "invalid", "Keep each choice to 200 characters.");
  }
  return problems;
};

const slotProblems = (slot: BotVaultSlotDraft, repeat: boolean): ReadonlyArray<DraftProblem> => {
  const problems: Array<DraftProblem> = [];
  const add = (
    part: Parameters<typeof fieldIds.slot>[1],
    kind: DraftProblem["kind"],
    message: string,
  ) =>
    problems.push({ field: fieldIds.slot(slot.key, part), section: "credentials", kind, message });
  const name = slot.name.trim();
  if (name === "") add("name", "missing", "Name the slot.");
  else if (!SLOT_NAME.test(name))
    add(
      "name",
      "invalid",
      "Use lowercase letters, digits and dashes, up to 40, starting with a letter or digit.",
    );
  else if (repeat) add("name", "invalid", "Another slot already has this name.");
  if (slot.label.trim().length > 80) add("label", "invalid", "Keep the label to 80 characters.");
  if (slot.destination.trim().length > 2048)
    add("destination", "invalid", "Keep the destination to 2,048 characters.");
  return problems;
};

/**
 * Every problem in the draft, in page order, each tied to the field that fixes it. Mirrors the
 * save schema's rules and the server's checks on top of them, so a draft without problems saves.
 */
export const draftProblems = (draft: BotDraft): ReadonlyArray<DraftProblem> => {
  const problems: Array<DraftProblem> = [];
  const add = (
    field: string,
    section: EditorSectionId,
    kind: DraftProblem["kind"],
    message: string,
  ) => problems.push({ field, section, kind, message });

  const name = draft.name.trim();
  if (name === "") add(fieldIds.name, "basics", "missing", "Give the bot a name.");
  else if (name.length > 120)
    add(fieldIds.name, "basics", "invalid", "Keep the name to 120 characters.");
  const id = draft.id.trim();
  if (id === "") add(fieldIds.id, "basics", "missing", "Give the bot an id.");
  else if (!BOT_ID.test(id))
    add(
      fieldIds.id,
      "basics",
      "invalid",
      "Use lowercase letters, digits and dashes, up to 64, starting with a letter or digit.",
    );
  if (draft.description.trim().length > 1000)
    add(fieldIds.description, "basics", "invalid", "Keep the description to 1,000 characters.");

  if (draft.instructions.trim() === "")
    add(fieldIds.instructions, "instructions", "missing", "Write the bot's instructions.");
  else if (draft.instructions.length > 20_000)
    add(
      fieldIds.instructions,
      "instructions",
      "invalid",
      "Keep the instructions to 20,000 characters.",
    );

  const inputRepeats = repeats(draft.parameters.map((parameter) => parameter.name.trim()));
  draft.parameters.forEach((parameter, index) =>
    problems.push(...parameterProblems(parameter, inputRepeats[index] === true)),
  );
  if (draft.parameters.length > BOTS_MAX_PARAMETERS)
    add("bot-inputs", "inputs", "invalid", `A bot takes ${BOTS_MAX_PARAMETERS} inputs at most.`);

  if (draft.modelSelection === null) add(fieldIds.model, "runtime", "missing", "Choose a model.");
  // The server refuses this pairing; the save schema alone cannot see it.
  if (
    draft.workspace !== "scratch" &&
    draft.projectId !== "" &&
    draft.scopeProjectId !== "" &&
    draft.projectId !== draft.scopeProjectId
  )
    add(
      fieldIds.project,
      "runtime",
      "invalid",
      "A bot available in one project can only run in that project.",
    );
  if (draft.workspace === "worktree" && draft.baseRef.trim().length > 500)
    add(fieldIds.baseRef, "runtime", "invalid", "Keep the base to 500 characters.");
  if (!wholeBetween(numberValue(draft.timeoutMinutes), 1, 120))
    add(
      fieldIds.timeoutMinutes,
      "runtime",
      "invalid",
      "Use a whole number of minutes from 1 to 120.",
    );
  if (!wholeBetween(numberValue(draft.maxConcurrentRuns), 1, 20))
    add(fieldIds.maxConcurrentRuns, "runtime", "invalid", "Use a whole number from 1 to 20.");

  const slotRepeats = repeats(draft.vaultSlots.map((slot) => slot.name.trim()));
  draft.vaultSlots.forEach((slot, index) =>
    problems.push(...slotProblems(slot, slotRepeats[index] === true)),
  );
  if (draft.vaultSlots.length > BOTS_MAX_VAULT_SLOTS)
    add(
      "bot-credentials",
      "credentials",
      "invalid",
      `A bot takes ${BOTS_MAX_VAULT_SLOTS} slots at most.`,
    );

  const runsPerDay = limitValue(draft.runsPerDay);
  if (runsPerDay !== null && !wholeBetween(runsPerDay, 1, 10_000))
    add(
      fieldIds.runsPerDay,
      "budget",
      "invalid",
      "Use a whole number from 1 to 10,000, or leave it empty.",
    );
  const tokensPerDay = limitValue(draft.tokensPerDay);
  if (tokensPerDay !== null && !wholeBetween(tokensPerDay, 1_000, 10_000_000_000))
    add(
      fieldIds.tokensPerDay,
      "budget",
      "invalid",
      "Use a whole number from 1,000 to 10 billion, or leave it empty.",
    );
  return problems;
};

/** The problems to show: invalid ones always, missing ones once a save was tried. */
export const shownProblems = (problems: ReadonlyArray<DraftProblem>, attempted: boolean) =>
  attempted ? problems : problems.filter((problem) => problem.kind === "invalid");

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

export interface InstructionPlaceholders {
  /** Inputs the instructions name. */
  readonly used: ReadonlyArray<string>;
  /** Names in braces that are not inputs; the server leaves them as written. */
  readonly undeclared: ReadonlyArray<string>;
  /** Inputs the instructions never name, which the bot only sees if it is told about them. */
  readonly unused: ReadonlyArray<string>;
}

/** How the instructions and the inputs line up, read the way the server fills placeholders. */
export const instructionPlaceholders = (
  instructions: string,
  parameterNames: ReadonlyArray<string>,
): InstructionPlaceholders => {
  const declared = new Set(parameterNames.map((name) => name.trim()).filter(Boolean));
  const named: Array<string> = [];
  for (const match of instructions.matchAll(PLACEHOLDER)) {
    const name = (match[1] ?? "").trim();
    if (name !== "" && !named.includes(name)) named.push(name);
  }
  return {
    used: named.filter((name) => declared.has(name)),
    undeclared: named.filter((name) => !declared.has(name)),
    unused: [...declared].filter((name) => !named.includes(name)),
  };
};

/** Whether a name in braces could become an input as written. */
export const isParameterName = (name: string) => PARAMETER_NAME.test(name);

/** What a version changed from the one before, in the editor's words. */
export const versionChangeText = (version: Pick<BotVersionSummary, "version" | "changed">) =>
  version.changed.length > 0
    ? `Changed ${listText(version.changed.map(changedFieldLabel))}.`
    : version.version === 1
      ? "First version."
      : "Nothing changed from the one before.";

export interface VersionCompareOption {
  readonly version: number;
  readonly label: string;
}

/**
 * The versions one can be compared with, newest first: the one before, the stable and the current
 * versions, then any other shown. Versions count up from 1 without gaps, so the one before exists
 * even when it is on another page.
 */
export const versionCompareOptions = (
  version: number,
  known: {
    readonly stable: number | null;
    readonly current: number;
    readonly listed: ReadonlyArray<number>;
  },
): ReadonlyArray<VersionCompareOption> => {
  const tags = new Map<number, Array<string>>();
  const add = (other: number, tag: string | null) => {
    if (other < 1 || other === version || other > known.current) return;
    const list = tags.get(other) ?? [];
    if (tag !== null) list.push(tag);
    tags.set(other, list);
  };
  add(version - 1, "the one before");
  if (known.stable !== null) add(known.stable, "stable");
  add(known.current, "current");
  for (const other of known.listed) add(other, null);
  return [...tags.entries()]
    .sort(([left], [right]) => right - left)
    .map(([other, list]) => ({
      version: other,
      label: list.length > 0 ? `v${other}, ${listText(list)}` : `v${other}`,
    }));
};

/**
 * A figure across versions, oldest first so the line reads as time, leaving out versions without
 * it. Null with fewer than two points, which make no trend.
 */
export const versionTrend = (
  versions: ReadonlyArray<BotVersionSummary>,
  figure: (version: BotVersionSummary) => number | null,
): ReadonlyArray<{ readonly version: number; readonly value: number }> | null => {
  const points = [...versions]
    .sort((left, right) => left.version - right.version)
    .flatMap((version) => {
      const value = figure(version);
      return value === null ? [] : [{ version: version.version, value }];
    });
  return points.length >= 2 ? points : null;
};
