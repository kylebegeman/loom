import {
  BotsSaveInput,
  type BotDefinition,
  type BotInputs,
  type BotParameter,
  type BotParameterType,
} from "@t3tools/contracts/fork";
import type {
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type BotWorkspaceChoice = "scratch" | "project" | "worktree";

export interface BotParameterDraft {
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly type: BotParameterType;
  readonly required: boolean;
  readonly defaultValue: string;
  /** One choice per line. */
  readonly choices: string;
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
}

let parameterKeys = 0;
export const newParameterDraft = (): BotParameterDraft => ({
  key: `parameter-${++parameterKeys}`,
  name: "",
  label: "",
  type: "string",
  required: true,
  defaultValue: "",
  choices: "",
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
});

export const botDraft = (bot: BotDefinition): BotDraft => ({
  id: bot.id,
  name: bot.name,
  description: bot.description,
  instructions: bot.instructions,
  parameters: bot.parameters.map((parameter) => ({
    ...newParameterDraft(),
    name: parameter.name,
    label: parameter.label,
    type: parameter.type,
    required: parameter.required,
    defaultValue: parameter.default ?? "",
    choices: (parameter.choices ?? []).join("\n"),
  })),
  modelSelection: bot.modelSelection,
  runtimeMode: bot.runtimeMode,
  interactionMode: bot.interactionMode,
  workspace:
    bot.workspace.type === "scratch" ? "scratch" : bot.workspace.worktree ? "worktree" : "project",
  projectId: bot.workspace.type === "project" ? (bot.workspace.projectId ?? "") : "",
  baseRef: bot.workspace.type === "project" ? (bot.workspace.baseRef ?? "") : "",
  timeoutMinutes: String(bot.timeoutMinutes),
  maxConcurrentRuns: String(bot.maxConcurrentRuns),
  scopeProjectId: bot.scopeProjectId ?? "",
});

/** A readable id from the name, for new bots. */
export const slugFromName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const parameterInput = (parameter: BotParameterDraft): BotParameter => {
  const choices = parameter.choices
    .split(/\r?\n/)
    .map((choice) => choice.trim())
    .filter(Boolean);
  return {
    name: parameter.name.trim(),
    label: parameter.label.trim() || parameter.name.trim(),
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
          },
    timeoutMinutes: Number(draft.timeoutMinutes),
    maxConcurrentRuns: Number(draft.maxConcurrentRuns),
    scopeProjectId: draft.scopeProjectId === "" ? null : draft.scopeProjectId,
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
  const timeout = Number(draft.timeoutMinutes);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120)
    return "The time limit is a whole number of minutes from 1 to 120.";
  const concurrency = Number(draft.maxConcurrentRuns);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    return "Runs at once is a whole number from 1 to 20.";
  return "Check the fields and lengths, then save again.";
};

/** Form values start from each input's default. */
export const initialRunValues = (bot: BotDefinition): Record<string, string> =>
  Object.fromEntries(
    bot.parameters.map((parameter) => [
      parameter.name,
      parameter.default ?? (parameter.type === "boolean" ? "false" : ""),
    ]),
  );

/** Form strings become typed inputs; blank optional inputs are left out for the server's default. */
export const runInputs = (bot: BotDefinition, values: Record<string, string>): BotInputs =>
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
