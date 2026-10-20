import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import {
  ProjectId,
  ThreadId,
  RunId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
} from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError, VaultItemId, VaultItemSummary } from "./vault-core.ts";
import {
  VaultGitCommand,
  VaultSshCommand,
  VaultSshResult,
  VaultGitResult,
  VaultSshError,
} from "./vault-ssh.ts";
import {
  VaultGitHubRepository,
  VaultGitHubOperation,
  VaultGitHubResult,
  VaultGitHubError,
} from "./vault-github.ts";
import { VaultWorkloadError } from "./vault-workloads.ts";
export const VaultBindingName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/));
export const VaultProfileRequirement = Schema.Struct({
  name: VaultBindingName,
  kind: Schema.Literals(["ssh", "git", "github"]),
});
export const VaultProfileRequirements = Schema.Struct({
  format: Schema.Literal("loom-vault-requirements"),
  version: Schema.Literals([1, 2]),
  label: VaultItemSummary.fields.label,
  requirements: Schema.Array(VaultProfileRequirement).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    Schema.makeFilter((items) => new Set(items.map((item) => item.name)).size === items.length),
  ),
}).check(
  Schema.makeFilter(
    (value) => value.version === 2 || value.requirements.every((r) => r.kind !== "github"),
  ),
);
export type VaultProfileRequirements = typeof VaultProfileRequirements.Type;
export const VaultProfileBinding = Schema.Struct({
  ...VaultProfileRequirement.fields,
  itemId: Schema.NullOr(VaultItemId),
  repository: Schema.NullOr(
    Schema.Union([VaultGitCommand.fields.repository, VaultGitHubRepository]),
  ),
});
export type VaultProfileBinding = typeof VaultProfileBinding.Type;
const isGitHubRepository = Schema.is(VaultGitHubRepository),
  isGitRepository = Schema.is(VaultGitCommand.fields.repository);
const validRepository = (binding: VaultProfileBinding) =>
  binding.kind === "ssh"
    ? binding.repository === null
    : binding.kind === "github"
      ? binding.repository === null || isGitHubRepository(binding.repository)
      : binding.repository === null || isGitRepository(binding.repository);
export const VaultProfileDefinition = Schema.Struct({
  id: VaultItemId,
  label: VaultItemSummary.fields.label,
  bindings: Schema.Array(VaultProfileBinding).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    Schema.makeFilter(
      (bindings) =>
        new Set(bindings.map((b) => b.name)).size === bindings.length &&
        bindings.every(validRepository),
    ),
  ),
});
export type VaultProfileDefinition = typeof VaultProfileDefinition.Type;
export const VaultProfile = Schema.Struct({
  ...VaultProfileDefinition.fields,
  version: PositiveInt,
  state: Schema.Literals(["active", "archived"]),
});
export type VaultProfile = typeof VaultProfile.Type;
export const VaultProfileSnapshot = Schema.Struct({
  projectId: ProjectId,
  revision: NonNegativeInt,
  activeProfileId: Schema.NullOr(VaultItemId),
  profiles: Schema.Array(VaultProfile).check(Schema.isMaxLength(32)),
});
export type VaultProfileSnapshot = typeof VaultProfileSnapshot.Type;
export const VaultProfileMutation = Schema.Struct({
  projectId: ProjectId,
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  change: Schema.Union([
    Schema.Struct({ type: Schema.Literal("save"), profile: VaultProfileDefinition }),
    Schema.Struct({
      type: Schema.Literal("import"),
      id: VaultItemId,
      declaration: VaultProfileRequirements,
    }),
    Schema.Struct({
      type: Schema.Literal("state"),
      id: VaultItemId,
      state: VaultProfile.fields.state,
    }),
    Schema.Struct({ type: Schema.Literal("activate"), id: Schema.NullOr(VaultItemId) }),
  ]),
});
export type VaultProfileMutation = typeof VaultProfileMutation.Type;
export const VaultProfilePreviewInput = Schema.Struct({
  projectId: ProjectId,
  profile: VaultProfileDefinition,
  threadId: Schema.NullOr(ThreadId),
});
export type VaultProfilePreviewInput = typeof VaultProfilePreviewInput.Type;
export const VaultProfilePreview = Schema.Struct({
  ready: Schema.Boolean,
  bindings: Schema.Array(
    Schema.Struct({
      name: VaultBindingName,
      itemId: Schema.NullOr(VaultItemId),
      version: Schema.NullOr(PositiveInt),
      destination: Schema.NullOr(Schema.String),
      state: Schema.Literals([
        "ready",
        "unchecked",
        "missing",
        "unavailable",
        "untrusted",
        "denied",
      ]),
    }),
  ),
});
export type VaultProfilePreview = typeof VaultProfilePreview.Type;
export const VaultProfileResolution = Schema.Struct({
  projectId: ProjectId,
  profileId: VaultItemId,
  label: VaultItemSummary.fields.label,
  profileVersion: PositiveInt,
  bindings: Schema.Array(
    Schema.Struct({
      name: VaultBindingName,
      kind: VaultProfileBinding.fields.kind,
      itemId: VaultItemId,
      version: PositiveInt,
      destination: Schema.String,
      repository: Schema.NullOr(
        Schema.Union([VaultGitCommand.fields.repository, VaultGitHubRepository]),
      ),
    }),
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    Schema.makeFilter(
      (bindings) =>
        new Set(bindings.map((b) => b.name)).size === bindings.length &&
        bindings.every((b) => validRepository(b) && (b.kind === "ssh" || b.repository !== null)),
    ),
  ),
});
export type VaultProfileResolution = typeof VaultProfileResolution.Type;
export const VaultProfileRun = Schema.Struct({
  profileId: Schema.NullOr(VaultItemId),
  binding: VaultBindingName,
  operation: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("ssh"),
      argv: VaultSshCommand.fields.argv,
      timeoutMs: VaultSshCommand.fields.timeoutMs,
    }),
    Schema.Struct({ kind: Schema.Literal("github"), operation: VaultGitHubOperation }),
    Schema.Struct({
      kind: Schema.Literal("git"),
      action: VaultGitCommand.fields.action,
      timeoutMs: VaultGitCommand.fields.timeoutMs,
    }),
  ]),
});
export type VaultProfileRun = typeof VaultProfileRun.Type;
export const VaultProfileRunResult = Schema.Union([
  VaultSshResult,
  VaultGitResult,
  VaultGitHubResult,
]);
export const VaultProfilePinList = Schema.Struct({
  projectId: ProjectId,
  cursor: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
});
export type VaultProfilePinList = typeof VaultProfilePinList.Type;
export const VaultProfilePin = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  threadId: ThreadId,
  runId: RunId,
  version: PositiveInt,
  createdAt: Schema.NullOr(IsoDateTime),
  retiredAt: Schema.NullOr(IsoDateTime),
  runState: Schema.String,
  canRetire: Schema.Boolean,
  resolution: Schema.NullOr(VaultProfileResolution),
});
export type VaultProfilePin = typeof VaultProfilePin.Type;
export const VaultProfilePinPage = Schema.Struct({
  items: Schema.Array(VaultProfilePin),
  nextCursor: Schema.NullOr(Schema.String),
});
export type VaultProfilePinPage = typeof VaultProfilePinPage.Type;
export const VaultProfilePinRetire = Schema.Struct({
  projectId: ProjectId,
  id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  expectedVersion: PositiveInt,
  operationId: VaultItemId,
});
export type VaultProfilePinRetire = typeof VaultProfilePinRetire.Type;
export const VAULT_PROFILE_WS_METHODS = {
  list: "loom.vault-profiles.list",
  pins: "loom.vault-profiles.pins",
  retirePin: "loom.vault-profiles.retirePin",
  apply: "loom.vault-profiles.apply",
  preview: "loom.vault-profiles.preview",
} as const;
const error = Schema.Union([
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultGitHubError,
  EnvironmentAuthorizationError,
]);
export const VaultProfileRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_PROFILE_WS_METHODS.pins, {
    payload: VaultProfilePinList,
    success: VaultProfilePinPage,
    error,
  }),
  Rpc.make(VAULT_PROFILE_WS_METHODS.retirePin, {
    payload: VaultProfilePinRetire,
    success: VaultProfilePin,
    error,
  }),
  Rpc.make(VAULT_PROFILE_WS_METHODS.list, {
    payload: Schema.Struct({ projectId: ProjectId }),
    success: VaultProfileSnapshot,
    error,
  }),
  Rpc.make(VAULT_PROFILE_WS_METHODS.apply, {
    payload: VaultProfileMutation,
    success: VaultProfileSnapshot,
    error,
  }),
  Rpc.make(VAULT_PROFILE_WS_METHODS.preview, {
    payload: VaultProfilePreviewInput,
    success: VaultProfilePreview,
    error,
  }),
);

export const vaultProfileRequirements = (
  profile: VaultProfileDefinition,
): VaultProfileRequirements => ({
  format: "loom-vault-requirements",
  version: profile.bindings.some((b) => b.kind === "github") ? 2 : 1,
  label: profile.label,
  requirements: profile.bindings.map(({ name, kind }) => ({ name, kind })),
});
export const vaultProfileFromRequirements = (
  declaration: VaultProfileRequirements,
  id: string,
): VaultProfileDefinition => ({
  id,
  label: declaration.label,
  bindings: declaration.requirements.map(({ name, kind }) => ({
    name,
    kind,
    itemId: null,
    repository: null,
  })),
});
const parseRequirements = Schema.decodeUnknownOption(
  Schema.fromJsonString(VaultProfileRequirements),
  { onExcessProperty: "error" },
);
export const readVaultProfileRequirements = (text: string): VaultProfileRequirements | null =>
  text.length > 16384 ? null : Option.getOrNull(parseRequirements(text));
