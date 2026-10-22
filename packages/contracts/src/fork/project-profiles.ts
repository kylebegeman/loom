import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

export const PROJECT_PROFILES_FEATURE = "project-profiles";
export const PROJECT_PROFILES_WS_METHODS = {
  get: "loom.project-profiles.get",
  update: "loom.project-profiles.update",
  reset: "loom.project-profiles.reset",
  envReport: "loom.project-profiles.envReport",
  varlockValidate: "loom.project-profiles.varlockValidate",
  varlockCommand: "loom.project-profiles.varlockCommand",
  budgetStatus: "loom.project-profiles.budgetStatus",
  getSettings: "loom.project-profiles.getSettings",
  updateSettings: "loom.project-profiles.updateSettings",
} as const;
export const COMMAND_INTENTS = ["dev", "test", "typecheck", "lint", "format", "build"] as const;
export const CommandIntent = Schema.Literals(COMMAND_INTENTS);
export type CommandIntent = typeof CommandIntent.Type;
export const IntentCommand = Schema.Union([
  Schema.TaggedStruct("action", { scriptId: TrimmedNonEmptyString }),
  Schema.TaggedStruct("command", {
    command: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  }),
]);
export type IntentCommand = typeof IntentCommand.Type;
const profileFields = {
  agentNotes: Schema.String.check(Schema.isMaxLength(8000)),
  commands: Schema.Struct({
    dev: Schema.optionalKey(IntentCommand),
    test: Schema.optionalKey(IntentCommand),
    typecheck: Schema.optionalKey(IntentCommand),
    lint: Schema.optionalKey(IntentCommand),
    format: Schema.optionalKey(IntentCommand),
    build: Schema.optionalKey(IntentCommand),
  }),
  budgets: Schema.Struct({
    dailyTokens: Schema.NullOr(PositiveInt),
    threadTokens: Schema.NullOr(PositiveInt),
  }),
  env: Schema.Struct({
    schemaPath: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
    varlock: Schema.Literals(["auto", "never"]),
  }),
  bindings: Schema.Array(
    Schema.Struct({ kind: TrimmedNonEmptyString, id: TrimmedNonEmptyString }),
  ).check(Schema.isMaxLength(200)),
};
export const ProjectProfile = Schema.Struct({
  projectId: ProjectId,
  ...profileFields,
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectProfile = typeof ProjectProfile.Type;
export const ProjectProfilePatch = Schema.Struct(
  Object.fromEntries(
    Object.entries(profileFields).map(([key, value]) => [key, Schema.optionalKey(value)]),
  ) as { [K in keyof typeof profileFields]: Schema.optionalKey<(typeof profileFields)[K]> },
);
export type ProjectProfilePatch = typeof ProjectProfilePatch.Type;
export const defaultProjectProfile = (projectId: ProjectId): ProjectProfile => ({
  projectId,
  agentNotes: "",
  commands: {},
  budgets: { dailyTokens: null, threadTokens: null },
  env: { schemaPath: ".env.schema", varlock: "auto" },
  bindings: [],
  updatedAt: null,
});
export const ProjectProfilesSettings = Schema.Struct({ agentTool: Schema.Boolean });
export type ProjectProfilesSettings = typeof ProjectProfilesSettings.Type;
export const EnvItemStatus = Schema.Union([
  Schema.TaggedStruct("set", { source: Schema.String }),
  Schema.TaggedStruct("missing", {}),
  Schema.TaggedStruct("empty", { source: Schema.String }),
  Schema.TaggedStruct("invalid", { source: Schema.String, reason: Schema.String }),
  Schema.TaggedStruct("resolvedByVarlock", { functionName: Schema.String }),
  Schema.TaggedStruct("unchecked", { source: Schema.String }),
]);
export type EnvItemStatus = typeof EnvItemStatus.Type;
export const EnvItem = Schema.Struct({
  key: Schema.String,
  description: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.String),
  required: Schema.Boolean,
  sensitive: Schema.Boolean,
  example: Schema.NullOr(Schema.String),
  docs: Schema.Array(Schema.Struct({ label: Schema.NullOr(Schema.String), url: Schema.String })),
  tags: Schema.Array(Schema.String),
  line: Schema.Number,
  status: EnvItemStatus,
});
export type EnvItem = typeof EnvItem.Type;
export const VarlockAvailability = Schema.Union([
  Schema.TaggedStruct("available", { version: Schema.String }),
  Schema.TaggedStruct("missing", { installHint: Schema.String }),
]);
export type VarlockAvailability = typeof VarlockAvailability.Type;
export const EnvReport = Schema.Struct({
  root: Schema.String,
  schema: Schema.Union([
    Schema.TaggedStruct("absent", { path: Schema.String }),
    Schema.TaggedStruct("invalid", {
      path: Schema.String,
      message: Schema.String,
      line: Schema.Number,
      column: Schema.Number,
    }),
    Schema.TaggedStruct("ok", {
      path: Schema.String,
      currentEnv: Schema.NullOr(Schema.String),
      imports: Schema.Array(Schema.String),
    }),
  ]),
  items: Schema.Array(EnvItem),
  unschematizedKeys: Schema.Array(Schema.String),
  envFiles: Schema.Array(Schema.String),
  varlock: VarlockAvailability,
});
export type EnvReport = typeof EnvReport.Type;
export const VarlockValidation = Schema.Struct({
  ok: Schema.Boolean,
  itemErrors: Schema.Record(Schema.String, Schema.String),
  rootErrors: Schema.Array(Schema.String),
  durationMs: Schema.Number,
});
export type VarlockValidation = typeof VarlockValidation.Type;
export const BudgetStatus = Schema.Struct({
  day: Schema.String,
  projectTokensToday: Schema.Number,
  dailyTokens: Schema.NullOr(Schema.Number),
  thread: Schema.NullOr(
    Schema.Struct({
      threadId: ThreadId,
      tokens: Schema.Number,
      threadTokens: Schema.NullOr(Schema.Number),
      reported: Schema.Boolean,
    }),
  ),
});
export type BudgetStatus = typeof BudgetStatus.Type;
export class ProjectProfileError extends Schema.TaggedError<ProjectProfileError>()(
  "ProjectProfileError",
  {
    reason: Schema.Literals([
      "project-not-found",
      "thread-not-found",
      "path-outside-checkout",
      "file-too-large",
      "read-failed",
      "write-failed",
      "varlock-missing",
      "varlock-failed",
      "action-not-found",
      "unsupported-platform",
      "sharing-disabled",
      "invalid-profile",
    ]),
  },
) {
  override get message(): string {
    const messages: Record<ProjectProfileError["reason"], string> = {
      "project-not-found": "This project no longer exists.",
      "thread-not-found": "This thread does not belong to the project.",
      "path-outside-checkout": "Env files must stay inside this checkout.",
      "file-too-large": "Env files must be at most 256 KB and 1,000 variables.",
      "read-failed": "Could not read the project profile or env files.",
      "write-failed": "Could not save the project profile.",
      "varlock-missing": "Install varlock to use this.",
      "varlock-failed": "Varlock did not return a valid report.",
      "action-not-found": "This project command is no longer mapped to an action.",
      "unsupported-platform": "This command cannot be safely wrapped on this platform.",
      "sharing-disabled": "Sharing this environment's profiles with agents is disabled.",
      "invalid-profile": "The project profile is invalid.",
    };
    return messages[this.reason];
  }
}
export const ProjectProfileTarget = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
});
export type ProjectProfileTarget = typeof ProjectProfileTarget.Type;
export const ProjectProfileUpdate = Schema.Struct({
  projectId: ProjectId,
  patch: ProjectProfilePatch,
});
export type ProjectProfileUpdate = typeof ProjectProfileUpdate.Type;
export const VarlockCommandInput = Schema.Struct({
  ...ProjectProfileTarget.fields,
  target: Schema.Union([
    Schema.Struct({ intent: CommandIntent }),
    Schema.Struct({ scriptId: TrimmedNonEmptyString }),
  ]),
});
export type VarlockCommandInput = typeof VarlockCommandInput.Type;
const error = Schema.Union([ProjectProfileError, EnvironmentAuthorizationError]);
const M = PROJECT_PROFILES_WS_METHODS;
export const ProjectProfilesRpcGroup = RpcGroup.make(
  Rpc.make(M.get, {
    payload: Schema.Struct({ projectId: ProjectId }),
    success: ProjectProfile,
    error,
  }),
  Rpc.make(M.update, { payload: ProjectProfileUpdate, success: ProjectProfile, error }),
  Rpc.make(M.reset, {
    payload: Schema.Struct({ projectId: ProjectId }),
    success: ProjectProfile,
    error,
  }),
  Rpc.make(M.envReport, { payload: ProjectProfileTarget, success: EnvReport, error }),
  Rpc.make(M.varlockValidate, { payload: ProjectProfileTarget, success: VarlockValidation, error }),
  Rpc.make(M.varlockCommand, {
    payload: VarlockCommandInput,
    success: Schema.Struct({ commandLine: Schema.String, cwd: Schema.String }),
    error,
  }),
  Rpc.make(M.budgetStatus, { payload: ProjectProfileTarget, success: BudgetStatus, error }),
  Rpc.make(M.getSettings, { payload: Schema.Struct({}), success: ProjectProfilesSettings, error }),
  Rpc.make(M.updateSettings, {
    payload: ProjectProfilesSettings,
    success: ProjectProfilesSettings,
    error,
  }),
);
