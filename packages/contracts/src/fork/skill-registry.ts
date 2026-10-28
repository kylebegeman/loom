import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "../providerInstance.ts";

export const SKILL_REGISTRY_FEATURE = "skill-registry";
export const SKILL_REGISTRY_WS_METHODS = {
  inventory: "loom.skill-registry.inventory",
  setEnabled: "loom.skill-registry.setEnabled",
  sources: "loom.skill-registry.sources",
  fetchSource: "loom.skill-registry.fetchSource",
  watchFetch: "loom.skill-registry.watchFetch",
  cancelFetch: "loom.skill-registry.cancelFetch",
  install: "loom.skill-registry.install",
  previewUpdate: "loom.skill-registry.previewUpdate",
  update: "loom.skill-registry.update",
  remove: "loom.skill-registry.remove",
  readSkill: "loom.skill-registry.readSkill",
  writeSkill: "loom.skill-registry.writeSkill",
  scaffold: "loom.skill-registry.scaffold",
  validate: "loom.skill-registry.validate",
} as const;
export class SkillRegistryError extends Schema.TaggedError<SkillRegistryError>()(
  "SkillRegistryError",
  {
    reason: Schema.Literals([
      "invalid",
      "not-found",
      "conflict",
      "read-only",
      "unsupported",
      "fetch-failed",
      "limit",
      "io",
    ]),
    detail: Schema.String,
  },
) {
  override get message() {
    return this.detail;
  }
}
export const SkillRegistryScope = Schema.Literals(["user", "project", "plugin", "system", "admin"]);
export type SkillRegistryScope = typeof SkillRegistryScope.Type;
export const SkillValidationIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
});
export type SkillValidationIssue = typeof SkillValidationIssue.Type;
export const SkillValidation = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  compatibility: Schema.optionalKey(Schema.String),
  userInvocationOnly: Schema.Boolean,
  userInvocable: Schema.Boolean,
  issues: Schema.Array(SkillValidationIssue),
});
export type SkillValidation = typeof SkillValidation.Type;
export const SkillRegistryAccount = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  label: Schema.String,
  homePath: Schema.NullOr(Schema.String),
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
});
export type SkillRegistryAccount = typeof SkillRegistryAccount.Type;
export const SkillRegistryTarget = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  realPath: Schema.String,
  label: Schema.String,
  scope: SkillRegistryScope,
  seenBy: Schema.Array(ProviderInstanceId),
  isDefault: Schema.Boolean,
});
export type SkillRegistryTarget = typeof SkillRegistryTarget.Type;
export const SkillRegistryVisibility = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  scope: SkillRegistryScope,
  enabled: Schema.Boolean,
  userInvocationOnly: Schema.Boolean,
  userInvocable: Schema.Boolean,
  toggle: Schema.Literals(["claude", "codex", "none"]),
});
export type SkillRegistryVisibility = typeof SkillRegistryVisibility.Type;
export const SkillRegistryInstall = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  name: Schema.String,
  sourceId: Schema.NullOr(Schema.String),
  sourceUrl: Schema.String,
  commit: Schema.NullOr(Schema.String),
  subpath: Schema.String,
  installedAt: Schema.String,
  hash: Schema.String,
});
export type SkillRegistryInstall = typeof SkillRegistryInstall.Type;
export const SkillRegistryEntry = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  compatibility: Schema.optionalKey(Schema.String),
  locations: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      realDir: Schema.String,
      viaSymlink: Schema.Boolean,
      rootId: Schema.String,
    }),
  ),
  visibility: Schema.Array(SkillRegistryVisibility),
  install: Schema.NullOr(SkillRegistryInstall),
  editable: Schema.Boolean,
  containsScripts: Schema.Boolean,
  currentHash: Schema.NullOr(Schema.String),
  modified: Schema.Boolean,
  problems: Schema.Array(SkillValidationIssue),
});
export type SkillRegistryEntry = typeof SkillRegistryEntry.Type;
export const SkillRegistryInventory = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  entries: Schema.Array(SkillRegistryEntry),
  accounts: Schema.Array(SkillRegistryAccount),
  targets: Schema.Array(SkillRegistryTarget),
  unavailable: Schema.Array(
    Schema.Struct({ instanceId: ProviderInstanceId, reason: Schema.String }),
  ),
  scanTruncated: Schema.Boolean,
  generatedAt: Schema.String,
});
export type SkillRegistryInventory = typeof SkillRegistryInventory.Type;
export const SkillSourceSkill = Schema.Struct({
  subpath: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  compatibility: Schema.optionalKey(Schema.String),
  containsScripts: Schema.Boolean,
  files: Schema.Number,
  bytes: Schema.Number,
  issues: Schema.Array(SkillValidationIssue),
});
export type SkillSourceSkill = typeof SkillSourceSkill.Type;
export const SkillRegistrySource = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  ref: Schema.NullOr(Schema.String),
  commit: Schema.String,
  fetchedAt: Schema.String,
  license: Schema.NullOr(Schema.String),
  skills: Schema.Array(SkillSourceSkill),
});
export type SkillRegistrySource = typeof SkillRegistrySource.Type;
export const SkillFetchJob = Schema.Struct({
  id: Schema.String,
  phase: Schema.Literals(["cloning", "scanning", "ready", "failed", "cancelled"]),
  source: Schema.NullOr(SkillRegistrySource),
  error: Schema.NullOr(Schema.String),
});
export type SkillFetchJob = typeof SkillFetchJob.Type;
export const SkillRegistryContext = Schema.Struct({ projectId: Schema.NullOr(ProjectId) });
export const SkillFetchInput = Schema.Struct({
  requestId: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  ref: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type SkillFetchInput = typeof SkillFetchInput.Type;
export const SkillInstallInput = Schema.Struct({
  ...SkillRegistryContext.fields,
  sourceId: Schema.String,
  commit: Schema.String,
  subpaths: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  targetId: Schema.String,
});
export type SkillInstallInput = typeof SkillInstallInput.Type;
export const SkillFileInput = Schema.Struct({ ...SkillRegistryContext.fields, key: Schema.String });
export type SkillFileInput = typeof SkillFileInput.Type;
export const SkillFile = Schema.Struct({
  key: Schema.String,
  path: Schema.String,
  text: Schema.String,
  hash: Schema.String,
  validation: SkillValidation,
});
export type SkillFile = typeof SkillFile.Type;
export const SkillWriteInput = Schema.Struct({
  ...SkillFileInput.fields,
  expectedHash: Schema.String,
  text: Schema.String.check(Schema.isMaxLength(262144)),
});
export type SkillWriteInput = typeof SkillWriteInput.Type;
export const SkillScaffoldInput = Schema.Struct({
  ...SkillRegistryContext.fields,
  targetId: Schema.String,
  name: TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  body: Schema.String.check(Schema.isMaxLength(200000)),
  userInvocationOnly: Schema.Boolean,
  hideFromSlashMenu: Schema.Boolean,
});
export type SkillScaffoldInput = typeof SkillScaffoldInput.Type;
export const SkillSetEnabledInput = Schema.Struct({
  ...SkillFileInput.fields,
  instanceId: ProviderInstanceId,
  enabled: Schema.Boolean,
  scope: Schema.Literals(["project", "account", "allAccounts"]),
});
export type SkillSetEnabledInput = typeof SkillSetEnabledInput.Type;
export const SkillUpdatePreview = Schema.Struct({
  installId: Schema.String,
  fromCommit: Schema.NullOr(Schema.String),
  toCommit: Schema.String,
  currentHash: Schema.String,
  modified: Schema.Boolean,
  reviewToken: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      change: Schema.Literals(["added", "modified", "removed"]),
    }),
  ),
  diff: Schema.String,
  truncated: Schema.Boolean,
});
export type SkillUpdatePreview = typeof SkillUpdatePreview.Type;
export const SkillUpdateInput = Schema.Struct({
  ...SkillRegistryContext.fields,
  installId: Schema.String,
  reviewToken: Schema.String,
  force: Schema.Boolean,
});
export type SkillUpdateInput = typeof SkillUpdateInput.Type;
const errors = Schema.Union([SkillRegistryError, EnvironmentAuthorizationError]);
const M = SKILL_REGISTRY_WS_METHODS;
export const SkillRegistryRpcGroup = RpcGroup.make(
  Rpc.make(M.inventory, {
    payload: Schema.Struct({
      ...SkillRegistryContext.fields,
      refresh: Schema.optional(Schema.Boolean),
    }),
    success: SkillRegistryInventory,
    error: errors,
  }),
  Rpc.make(M.setEnabled, {
    payload: SkillSetEnabledInput,
    success: SkillRegistryInventory,
    error: errors,
  }),
  Rpc.make(M.sources, {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      sources: Schema.Array(SkillRegistrySource),
      installs: Schema.Array(SkillRegistryInstall),
      suggested: Schema.Array(
        Schema.Struct({ name: Schema.String, url: Schema.String, license: Schema.String }),
      ),
    }),
    error: errors,
  }),
  Rpc.make(M.fetchSource, { payload: SkillFetchInput, success: SkillFetchJob, error: errors }),
  Rpc.make(M.watchFetch, {
    payload: Schema.Struct({ requestId: Schema.String }),
    success: SkillFetchJob,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.cancelFetch, {
    payload: Schema.Struct({ requestId: Schema.String }),
    success: Schema.Void,
    error: errors,
  }),
  Rpc.make(M.install, {
    payload: SkillInstallInput,
    success: Schema.Array(SkillRegistryInstall),
    error: errors,
  }),
  Rpc.make(M.previewUpdate, {
    payload: Schema.Struct({ ...SkillRegistryContext.fields, installId: Schema.String }),
    success: SkillUpdatePreview,
    error: errors,
  }),
  Rpc.make(M.update, { payload: SkillUpdateInput, success: SkillRegistryInstall, error: errors }),
  Rpc.make(M.remove, {
    payload: Schema.Struct({ ...SkillFileInput.fields, expectedHash: Schema.String }),
    success: Schema.Struct({ trashPath: Schema.String }),
    error: errors,
  }),
  Rpc.make(M.readSkill, { payload: SkillFileInput, success: SkillFile, error: errors }),
  Rpc.make(M.writeSkill, { payload: SkillWriteInput, success: SkillFile, error: errors }),
  Rpc.make(M.scaffold, { payload: SkillScaffoldInput, success: SkillFile, error: errors }),
  Rpc.make(M.validate, {
    payload: Schema.Struct({ text: SkillWriteInput.fields.text, folderName: Schema.String }),
    success: SkillValidation,
    error: errors,
  }),
);
