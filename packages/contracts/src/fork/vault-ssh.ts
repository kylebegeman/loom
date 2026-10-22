import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError } from "./vault-core.ts";
import { VaultWorkloadError } from "./vault-workloads.ts";
import * as Schema from "effect/Schema";
import { PositiveInt } from "../baseSchemas.ts";
import { VaultItemId, VaultItemSummary } from "./vault-core.ts";
import { VaultWorkloadProof } from "./vault-workloads.ts";
import { VaultConnectionSelector } from "./vault-connections.ts";

const reasons = {
  unsupported:
    "This SSH operation requires macOS/Linux, OpenSSH with host-bound authentication and Ed25519 host keys.",
  "invalid-key": "The SSH key or pinned host key is invalid or unsupported.",
  "untrusted-host":
    "This SSH destination has no trusted host key. An administrator must verify and pin it before use.",
  "invalid-operation":
    "The SSH command or destination does not match this workload and key version.",
  failed:
    "SSH could not authenticate or complete the connection using the pinned host and dedicated key.",
  timeout:
    "The SSH operation exceeded its time limit. Its remote effects may already have occurred.",
  "output-limit":
    "The SSH operation exceeded its output limit. Its remote effects may already have occurred.",
  capacity: "Too many SSH operations are active. Retry after one finishes.",
} as const;
export class VaultSshError extends Schema.TaggedError<VaultSshError>()("VaultSshError", {
  reason: Schema.Literals(
    Object.keys(reasons) as [keyof typeof reasons, ...Array<keyof typeof reasons>],
  ),
}) {
  override get message() {
    return reasons[this.reason];
  }
}
export const VaultSshPublicKey = Schema.String.check(
  Schema.isPattern(/^ssh-ed25519 [A-Za-z0-9+/]{68}$/),
);
export const VaultSshTarget = Schema.Struct({
  hostname: Schema.String.check(Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/)),
  username: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  hostKey: Schema.NullOr(VaultSshPublicKey),
});
export type VaultSshTarget = typeof VaultSshTarget.Type;
export const vaultSshDestination = (target: VaultSshTarget) =>
  `ssh://${target.username}@${target.hostname}:${target.port}`;
export const VaultSshGenerate = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  label: VaultItemSummary.fields.label,
  target: VaultSshTarget,
});
export type VaultSshGenerate = typeof VaultSshGenerate.Type;
export const VaultSshInfo = Schema.Struct({
  item: VaultItemSummary,
  target: VaultSshTarget,
  publicKey: VaultSshPublicKey,
  fingerprint: Schema.String,
  hostFingerprint: Schema.NullOr(Schema.String),
  destination: Schema.String,
});
export type VaultSshInfo = typeof VaultSshInfo.Type;
export const VaultSshTrust = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  expectedVersion: PositiveInt,
  hostKey: Schema.NullOr(VaultSshPublicKey),
});
export type VaultSshTrust = typeof VaultSshTrust.Type;
export const VaultSshCommand = Schema.Struct({
  expectedVersion: PositiveInt,
  argv: Schema.Array(
    Schema.String.check(
      Schema.isMaxLength(1024),
      Schema.makeFilter((value) =>
        [...value].every(
          (character) => character.codePointAt(0)! >= 32 && character.codePointAt(0)! !== 127,
        ),
      ),
    ),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 8000 })),
});
export type VaultSshCommand = typeof VaultSshCommand.Type;
export const VaultSshExecute = Schema.Struct({
  proof: VaultWorkloadProof,
  command: VaultSshCommand,
});
export type VaultSshExecute = typeof VaultSshExecute.Type;
export const VaultSshResult = Schema.Struct({
  sessionId: VaultItemId,
  requestId: VaultItemId,
  exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  stdout: Schema.String.check(Schema.isMaxLength(2048)),
});
export type VaultSshResult = typeof VaultSshResult.Type;
export const vaultSshCommandMessage = (command: VaultSshCommand) =>
  JSON.stringify([
    "loom-vault-ssh-exec-v1",
    command.expectedVersion,
    command.argv,
    command.timeoutMs,
  ]);

export const VaultSshProbe = Schema.Struct({ id: VaultItemId, expectedVersion: PositiveInt });
export type VaultSshProbe = typeof VaultSshProbe.Type;
export const VaultSshProbeResult = Schema.Struct({
  id: VaultItemId,
  version: PositiveInt,
  destination: Schema.String,
  fingerprint: Schema.String,
  hostFingerprint: Schema.String,
  checkedAt: Schema.Int,
  authenticated: Schema.Literal(true),
});
export type VaultSshProbeResult = typeof VaultSshProbeResult.Type;
export const VAULT_SSH_WS_METHODS = {
  info: "loom.vault-ssh.info",
  generate: "loom.vault-ssh.generate",
  trust: "loom.vault-ssh.trust",
  probe: "loom.vault-ssh.probe",
} as const;
const rpcError = Schema.Union([
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  EnvironmentAuthorizationError,
]);
export const VaultSshRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_SSH_WS_METHODS.info, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: VaultSshInfo,
    error: rpcError,
  }),
  Rpc.make(VAULT_SSH_WS_METHODS.generate, {
    payload: VaultSshGenerate,
    success: VaultSshInfo,
    error: rpcError,
  }),
  Rpc.make(VAULT_SSH_WS_METHODS.trust, {
    payload: VaultSshTrust,
    success: VaultSshInfo,
    error: rpcError,
  }),
  Rpc.make(VAULT_SSH_WS_METHODS.probe, {
    payload: VaultSshProbe,
    success: VaultSshProbeResult,
    error: rpcError,
  }),
);

export const VaultGitCommand = Schema.Struct({
  kind: Schema.Literal("git"),
  expectedVersion: PositiveInt,
  action: Schema.Literals(["ls-remote", "fetch"]),
  repository: Schema.String.check(
    Schema.isPattern(/^\/?[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,1023}$/),
    Schema.makeFilter(
      (value) =>
        !value
          .replace(/^\//, "")
          .split("/")
          .some((part) => part === "." || part === ".." || part === ""),
    ),
  ),
  cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 30000 })),
});
export type VaultGitCommand = typeof VaultGitCommand.Type;
export const VaultSshGitProbe = Schema.Struct({
  id: VaultItemId,
  expectedVersion: PositiveInt,
  repository: VaultGitCommand.fields.repository,
});
export type VaultSshGitProbe = typeof VaultSshGitProbe.Type;
export const VaultSshGitProbeResult = Schema.Struct({
  ...VaultSshProbeResult.fields,
  repository: VaultGitCommand.fields.repository,
  readable: Schema.Literal(true),
});
export type VaultSshGitProbeResult = typeof VaultSshGitProbeResult.Type;

export const VaultGitRun = Schema.Struct({
  id: VaultItemId,
  expectedVersion: PositiveInt,
  action: VaultGitCommand.fields.action,
  repository: VaultGitCommand.fields.repository,
  timeoutMs: VaultGitCommand.fields.timeoutMs,
});
export type VaultGitRun = typeof VaultGitRun.Type;
export const VaultSshRun = Schema.Struct({ id: VaultItemId, command: VaultSshCommand });
export type VaultSshRun = typeof VaultSshRun.Type;
export const VaultGitExecute = Schema.Struct({
  proof: VaultWorkloadProof,
  command: VaultGitCommand,
});
export type VaultGitExecute = typeof VaultGitExecute.Type;
export const VaultGitResult = Schema.Struct({
  sessionId: VaultItemId,
  requestId: VaultItemId,
  exitCode: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  stdout: Schema.String.check(Schema.isMaxLength(65536)),
});
export type VaultGitResult = typeof VaultGitResult.Type;
export const vaultGitCommandMessage = (command: VaultGitCommand) =>
  JSON.stringify([
    "loom-vault-git-exec-v1",
    command.expectedVersion,
    command.action,
    command.repository,
    command.cwd,
    command.timeoutMs,
  ]);
export const vaultGitDestination = (target: VaultSshTarget, repository: string) =>
  `git+${vaultSshDestination(target)}/${repository.startsWith("/") ? ":absolute/" + repository.slice(1) : repository}`;

export const VaultSshRunInput = Schema.Union([
  VaultSshRun,
  Schema.Struct({
    connection: VaultConnectionSelector,
    command: Schema.Struct({
      argv: VaultSshCommand.fields.argv,
      timeoutMs: VaultSshCommand.fields.timeoutMs,
    }),
  }),
]);
export type VaultSshRunInput = typeof VaultSshRunInput.Type;
export const VaultGitRunInput = Schema.Union([
  VaultGitRun,
  Schema.Struct({
    connection: VaultConnectionSelector,
    action: VaultGitRun.fields.action,
    repository: VaultGitRun.fields.repository,
    timeoutMs: VaultGitRun.fields.timeoutMs,
  }),
]);
export type VaultGitRunInput = typeof VaultGitRunInput.Type;
