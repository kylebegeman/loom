import type { EnvironmentThreadShell } from "../state/models.ts";
import {
  BotsSaveInput,
  isBotRunThreadId,
  type BotBatchSource,
  type BotBatchSourceType,
  type BotDefinition,
  type BotDefinitionInput,
  type BotInputs,
  type BotParameter,
  type BotOutput,
  type BotParameterType,
  type BotVaultSlot,
  type VaultAccessAction,
} from "@t3tools/contracts/fork";
import type {
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `checkout` runs in the checkout of the thread it is started from or for. */
export type BotWorkspaceChoice = "scratch" | "project" | "worktree" | "checkout";

export interface BotParameterDraft {
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly type: BotParameterType;
  readonly required: boolean;
  readonly defaultValue: string;
  /** One choice per line. */
  readonly choices: string;
}

export interface BotVaultSlotDraft {
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly action: VaultAccessAction;
  /** Empty means anywhere the action allows. */
  readonly destination: string;
}

export interface BotDraft {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly parameters: ReadonlyArray<BotParameterDraft>;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspace: BotWorkspaceChoice;
  /** Empty means the caller picks the project at run time. */
  readonly projectId: string;
  readonly baseRef: string;
  readonly timeoutMinutes: string;
  readonly maxConcurrentRuns: string;
  readonly scopeProjectId: string;
  readonly output: BotOutput;
  /** Empty means no limit. */
  readonly runsPerDay: string;
  readonly tokensPerDay: string;
  readonly vaultSlots: ReadonlyArray<BotVaultSlotDraft>;
}

let parameterKeys = 0;
export const newParameterDraft = (): BotParameterDraft => ({
  key: `parameter-${++parameterKeys}`,
  name: "",
  label: "",
  description: "",
  type: "string",
  required: true,
  defaultValue: "",
  choices: "",
});

let slotKeys = 0;
export const newVaultSlotDraft = (): BotVaultSlotDraft => ({
  key: `slot-${++slotKeys}`,
  name: "",
  label: "",
  action: "use",
  destination: "",
});

const vaultSlotDrafts = (slots: ReadonlyArray<BotVaultSlot>): ReadonlyArray<BotVaultSlotDraft> =>
  slots.map((slot) => ({
    ...newVaultSlotDraft(),
    name: slot.name,
    label: slot.label,
    action: slot.action,
    destination: slot.destination ?? "",
  }));

const vaultSlotInput = (slot: BotVaultSlotDraft): BotVaultSlot => ({
  name: slot.name.trim(),
  label: slot.label.trim() || slot.name.trim(),
  action: slot.action,
  ...(slot.destination.trim() === "" ? {} : { destination: slot.destination.trim() }),
});

export const emptyBotDraft = (modelSelection: ModelSelection | null): BotDraft => ({
  id: "",
  name: "",
  description: "",
  instructions: "",
  parameters: [],
  modelSelection,
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
  workspace: "project",
  projectId: "",
  baseRef: "",
  timeoutMinutes: "20",
  maxConcurrentRuns: "2",
  scopeProjectId: "",
  output: "text",
  runsPerDay: "",
  tokensPerDay: "",
  vaultSlots: [],
});

export const parameterDrafts = (
  parameters: ReadonlyArray<BotParameter>,
): ReadonlyArray<BotParameterDraft> =>
  parameters.map((parameter) => ({
    ...newParameterDraft(),
    name: parameter.name,
    label: parameter.label,
    description: parameter.description ?? "",
    type: parameter.type,
    required: parameter.required,
    defaultValue: parameter.default ?? "",
    choices: (parameter.choices ?? []).join("\n"),
  }));

/** A saved bot, or an unsaved one such as a draft from a thread. */
export const botDraft = (bot: BotDefinitionInput): BotDraft => ({
  id: bot.id,
  name: bot.name,
  description: bot.description,
  instructions: bot.instructions,
  parameters: parameterDrafts(bot.parameters),
  modelSelection: bot.modelSelection,
  runtimeMode: bot.runtimeMode,
  interactionMode: bot.interactionMode,
  workspace:
    bot.workspace.type === "scratch"
      ? "scratch"
      : bot.workspace.worktree
        ? "worktree"
        : bot.workspace.checkout === "caller"
          ? "checkout"
          : "project",
  projectId: bot.workspace.type === "project" ? (bot.workspace.projectId ?? "") : "",
  baseRef: bot.workspace.type === "project" ? (bot.workspace.baseRef ?? "") : "",
  timeoutMinutes: String(bot.timeoutMinutes),
  maxConcurrentRuns: String(bot.maxConcurrentRuns),
  scopeProjectId: bot.scopeProjectId ?? "",
  output: bot.output ?? "text",
  runsPerDay: bot.budget?.runsPerDay === undefined ? "" : String(bot.budget.runsPerDay),
  tokensPerDay: bot.budget?.tokensPerDay === undefined ? "" : String(bot.budget.tokensPerDay),
  vaultSlots: vaultSlotDrafts(bot.vaultSlots ?? []),
});

/** Stable form identity ignores row keys that only React uses. */
const draftSignature = (draft: BotDraft): string =>
  JSON.stringify({
    ...draft,
    parameters: draft.parameters.map(({ key: _key, ...parameter }) => parameter),
    vaultSlots: draft.vaultSlots.map(({ key: _key, ...slot }) => slot),
  });

export const hasBotDraftChanges = (initial: BotDraft, current: BotDraft): boolean =>
  draftSignature(initial) !== draftSignature(current);

/** A limit as typed, with thousands separators allowed; null when left empty. */
const limitValue = (text: string): number | null => {
  const trimmed = text.replace(/[\s,_]/g, "");
  return trimmed === "" ? null : Number(trimmed);
};

const budgetFromDraft = (draft: BotDraft) => {
  const runsPerDay = limitValue(draft.runsPerDay);
  const tokensPerDay = limitValue(draft.tokensPerDay);
  if (runsPerDay === null && tokensPerDay === null) return null;
  return {
    ...(runsPerDay === null ? {} : { runsPerDay }),
    ...(tokensPerDay === null ? {} : { tokensPerDay }),
  };
};

/** A readable id from the name, for new bots. */
export { slugFromName } from "@t3tools/contracts/fork";

export const parameterInput = (parameter: BotParameterDraft): BotParameter => {
  const choices = parameter.choices
    .split(/\r?\n/)
    .map((choice) => choice.trim())
    .filter(Boolean);
  return {
    name: parameter.name.trim(),
    label: parameter.label.trim() || parameter.name.trim(),
    ...(parameter.description.trim() === "" ? {} : { description: parameter.description.trim() }),
    type: parameter.type,
    required: parameter.required,
    ...(parameter.defaultValue === "" ? {} : { default: parameter.defaultValue }),
    ...(parameter.type === "choice" ? { choices } : {}),
  };
};

const decodeSave = Schema.decodeUnknownOption(BotsSaveInput);

/** The save request for a draft, or the first problem a person can fix in the form. */
export const saveInputFromDraft = (
  draft: BotDraft,
  expectedVersion: number | undefined,
):
  | { readonly ok: true; readonly input: BotsSaveInput }
  | { readonly ok: false; readonly message: string } => {
  if (draft.modelSelection === null) return { ok: false, message: "Choose a model." };
  const projectId = draft.projectId === "" ? null : (draft.projectId as ProjectId);
  const budget = budgetFromDraft(draft);
  const decoded = decodeSave({
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    instructions: draft.instructions,
    parameters: draft.parameters.map(parameterInput),
    modelSelection: draft.modelSelection,
    runtimeMode: draft.runtimeMode,
    interactionMode: draft.interactionMode,
    workspace:
      draft.workspace === "scratch"
        ? { type: "scratch" }
        : {
            type: "project",
            projectId,
            worktree: draft.workspace === "worktree",
            ...(draft.workspace === "worktree" && draft.baseRef.trim() !== ""
              ? { baseRef: draft.baseRef.trim() }
              : {}),
            ...(draft.workspace === "checkout" ? { checkout: "caller" as const } : {}),
          },
    timeoutMinutes: Number(draft.timeoutMinutes),
    maxConcurrentRuns: Number(draft.maxConcurrentRuns),
    scopeProjectId: draft.scopeProjectId === "" ? null : draft.scopeProjectId,
    // Text is the default, and an older server would refuse a key it does not know.
    ...(draft.output === "verdict" ? { output: "verdict" } : {}),
    ...(budget === null ? {} : { budget }),
    // Older servers have no Vault slots and refuse the key.
    ...(draft.vaultSlots.length === 0 ? {} : { vaultSlots: draft.vaultSlots.map(vaultSlotInput) }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  });
  if (Option.isSome(decoded)) return { ok: true, input: decoded.value };
  return { ok: false, message: describeProblem(draft) };
};

/** Schema errors name paths, not fixes; this names the field to fix. */
const describeProblem = (draft: BotDraft): string => {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.id.trim()))
    return "The id uses lowercase letters, digits and dashes, and starts with a letter or digit.";
  if (draft.name.trim() === "") return "Give the bot a name.";
  if (draft.instructions.trim() === "") return "Write the bot's instructions.";
  for (const parameter of draft.parameters) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(parameter.name.trim()))
      return "Input names use letters, digits and underscores, and start with a letter.";
    if (parameter.type === "choice" && parameter.choices.trim() === "")
      return `List at least one choice for ${parameter.label || parameter.name}.`;
  }
  for (const slot of draft.vaultSlots)
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slot.name.trim()))
      return "Vault slot names use lowercase letters, digits and dashes, and start with a letter or digit.";
  const timeout = Number(draft.timeoutMinutes);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120)
    return "The time limit is a whole number of minutes from 1 to 120.";
  const concurrency = Number(draft.maxConcurrentRuns);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    return "Runs at once is a whole number from 1 to 20.";
  const runsPerDay = limitValue(draft.runsPerDay);
  if (
    runsPerDay !== null &&
    (!Number.isInteger(runsPerDay) || runsPerDay < 1 || runsPerDay > 10_000)
  )
    return "Runs per 24 hours is a whole number from 1 to 10,000, or empty for no limit.";
  const tokensPerDay = limitValue(draft.tokensPerDay);
  if (
    tokensPerDay !== null &&
    (!Number.isInteger(tokensPerDay) || tokensPerDay < 1_000 || tokensPerDay > 10_000_000_000)
  )
    return "Tokens per 24 hours is a whole number from 1,000 to 10 billion, or empty for no limit.";
  return "Check the fields and lengths, then save again.";
};

/** Form values start from each input's default. */
export const initialRunValues = (bot: Pick<BotDefinition, "parameters">): Record<string, string> =>
  Object.fromEntries(
    bot.parameters.map((parameter) => [
      parameter.name,
      parameter.default ?? (parameter.type === "boolean" ? "false" : ""),
    ]),
  );

/** Form strings become typed inputs; blank optional inputs are left out for the server's default. */
export const runInputs = (
  bot: Pick<BotDefinition, "parameters">,
  values: Record<string, string>,
): BotInputs =>
  Object.fromEntries(
    bot.parameters.flatMap((parameter): Array<[string, string | number | boolean]> => {
      const raw = values[parameter.name] ?? "";
      if (raw === "" && parameter.type !== "boolean") return [];
      if (parameter.type === "number") return [[parameter.name, Number(raw)]];
      if (parameter.type === "boolean") return [[parameter.name, raw === "true"]];
      return [[parameter.name, raw]];
    }),
  );

/** Whether the bot leaves the project choice to whoever runs it. */
export const needsProject = (bot: BotDefinition) =>
  bot.workspace.type === "project" &&
  bot.workspace.projectId === null &&
  bot.scopeProjectId === null;

/** Whether a run uses the checkout of a thread rather than a fixed place. */
export const runsInCheckout = (bot: BotDefinition) =>
  bot.workspace.type === "project" && bot.workspace.checkout === "caller";

export interface BotCheckoutChoice {
  readonly threadId: ThreadId;
  readonly label: string;
}

/**
 * Worktrees a `checkout` bot can run in: one per worktree path among the project's live threads,
 * most recently active first.
 */
export const checkoutChoices = (
  shells: ReadonlyArray<
    Pick<
      EnvironmentThreadShell,
      "id" | "projectId" | "title" | "branch" | "worktreePath" | "archivedAt" | "updatedAt"
    >
  >,
  projectId: string,
): ReadonlyArray<BotCheckoutChoice> => {
  const byPath = new Map<string, (typeof shells)[number]>();
  for (const shell of shells) {
    if (shell.projectId !== projectId || shell.worktreePath === null || shell.archivedAt !== null)
      continue;
    if (isBotRunThreadId(shell.id)) continue;
    const seen = byPath.get(shell.worktreePath);
    if (seen === undefined || seen.updatedAt < shell.updatedAt)
      byPath.set(shell.worktreePath, shell);
  }
  return [...byPath.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((shell) => ({
      threadId: shell.id,
      label: `${shell.branch ?? shell.worktreePath} (${shell.title})`,
    }));
};

export type BatchSourceType = Exclude<BotBatchSourceType, "inputs">;

/** What the "Run on many" form holds; the fields of other source types are kept while switching. */
export interface BatchSourceDraft {
  readonly type: BatchSourceType;
  readonly lines: string;
  readonly pattern: string;
  readonly query: string;
  readonly searchMode: "files" | "contents";
  /** "" is the project root. */
  readonly checkoutThreadId: string;
}

export const emptyBatchSourceDraft: BatchSourceDraft = {
  type: "lines",
  lines: "",
  pattern: "",
  query: "",
  searchMode: "files",
  checkoutThreadId: "",
};

/** Whether a source reads files, so it needs a project and may use a thread's checkout. */
export const readsFiles = (type: BatchSourceType) =>
  type === "glob" || type === "conflicts" || type === "search";

/** Whether a source is read from a project; pull requests are listed per project too. */
export const sourceNeedsProject = (type: BatchSourceType) =>
  readsFiles(type) || type === "pullRequests";

/** The source to send, or null while the form is not filled in enough to preview. */
export const batchSourceFromDraft = (draft: BatchSourceDraft): BotBatchSource | null => {
  const checkout =
    draft.checkoutThreadId === "" ? {} : { checkoutThreadId: draft.checkoutThreadId as ThreadId };
  const query = draft.query.trim();
  switch (draft.type) {
    case "lines":
      return draft.lines.trim() === "" ? null : { type: "lines", text: draft.lines };
    case "glob":
      return draft.pattern.trim() === ""
        ? null
        : { type: "glob", pattern: draft.pattern.trim(), ...checkout };
    case "conflicts":
      return { type: "conflicts", ...checkout };
    case "pullRequests":
      return query === "" ? { type: "pullRequests" } : { type: "pullRequests", query };
    case "search":
      return query === "" ? null : { type: "search", mode: draft.searchMode, query, ...checkout };
  }
};

/** The input each item fills by default: the first required text input, else the first input. */
export const defaultItemParameter = (bot: BotDefinition): string =>
  (
    bot.parameters.find(
      (parameter) =>
        parameter.required && (parameter.type === "string" || parameter.type === "text"),
    ) ?? bot.parameters[0]
  )?.name ?? "";
