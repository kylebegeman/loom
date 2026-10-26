import { admissionStamp } from "./admission-stamp.ts";
import { observeVaultHealth } from "./health-observation.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultConnections from "./VaultConnections.ts";
import type { ThreadId } from "@t3tools/contracts";
import {
  type VaultApprovalRetryInput,
  vaultSshDestination,
  VaultSshAgentOpen,
  VaultSshAgentOpenInput,
  VaultSshRunInput,
  VaultGitRunInput,
  VaultConnectionError,
  type VaultConnectionPin,
  type VaultSshAgentSession,
  VaultError,
  VaultWorkloadError,
  VaultSshError,
  VaultGitHubError,
  VaultSshRun,
  VaultProfileRun,
  type VaultProfileRunResult,
  VaultGitRun,
  type VaultSshResult,
  type VaultGitResult,
  vaultWorkloadRequestMessage,
  vaultWorkloadProofMessage,
  vaultSshCommandMessage,
  vaultGitCommandMessage,
  vaultGitDestination,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";

type ExecutionFailure = VaultError | VaultSshError | VaultWorkloadError | VaultConnectionError;
type HostedFailure = ExecutionFailure | VaultConnectionError;
type Failure = HostedFailure | VaultGitHubError;
export class VaultLaunch extends Context.Service<
  VaultLaunch,
  {
    readonly admission: (
      operation: Exclude<VaultApprovalRetryInput["operation"], { readonly kind: "github-api" }>,
      threadId: ThreadId,
    ) => Effect.Effect<string, VaultError | VaultSshError | VaultWorkloadError>;
    readonly agent: (
      input: VaultSshAgentOpenInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshAgentSession, HostedFailure>;
    readonly profile: (
      input: VaultProfileRun,
      threadId: ThreadId,
    ) => Effect.Effect<typeof VaultProfileRunResult.Type, Failure>;
    readonly ssh: (
      input: VaultSshRunInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshResult, HostedFailure>;
    readonly git: (
      input: VaultGitRunInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitResult, HostedFailure>;
  }
>()("t3/fork/vault/VaultLaunch") {}
const denied = () => new VaultError({ reason: "denied" });
const isSsh = Schema.is(VaultSshRun),
  isGit = Schema.is(VaultGitRun);
const isAgentOpen = Schema.is(VaultSshAgentOpen),
  isAgentOpenInput = Schema.is(VaultSshAgentOpenInput),
  isSshInput = Schema.is(VaultSshRunInput),
  isGitInput = Schema.is(VaultGitRunInput);
const isProfileRun = Schema.is(VaultProfileRun);
const make = Effect.gen(function* () {
  const identities = yield* BrokerIdentity.BrokerIdentity,
    keys = yield* BrokerCrypto.BrokerCrypto;
  const workloads = yield* VaultWorkloads.VaultWorkloads,
    ssh = yield* VaultSsh.VaultSsh;
  const threads = yield* ThreadManagementService,
    projects = yield* ProjectStoreV2;
  const environment = yield* HostProcess.Environment,
    path = yield* Path.Path,
    crypto = yield* Crypto.Crypto;
  const connections = yield* VaultConnections.VaultConnections;
  // VaultSsh guards before accepting a command and before every agent frame. Full revalidation
  // takes seconds against a live Vault, so it runs once per operation; frames re-check the item
  // version (fixing destination, host and account), workload session and use policy. Only the
  // inspect permission goes unchecked per frame, and it never authorizes signing.
  const pinGuard = (pin: VaultConnectionPin, threadId: ThreadId) =>
    Effect.cached(connections.revalidate(pin, threadId));
  const profiles = yield* VaultProfiles.VaultProfiles,
    github = yield* VaultGitHub.VaultGitHub;
  const configured = environment.LOOM_VAULT_EXECUTION_BROKER_DIR ?? "";
  const hostIdentity = Effect.gen(function* () {
    if (configured && !path.isAbsolute(configured))
      return yield* new VaultWorkloadError({ reason: "not-configured" });
    const connection = yield* identities
      .connection(configured)
      .pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "not-configured" })));
    const machine = yield* identities
      .read(configured, false)
      .pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "not-configured" })));
    if (machine.fingerprint.slice(0, 32) !== connection.machineId) return yield* denied();
    return { connection, machine };
  });
  const run = <A>(
    threadId: ThreadId,
    itemId: string,
    destination: string,
    operation: "ssh-exec" | "git-exec" | "check",
    message: string,
    execute: (
      proof: Parameters<VaultSsh.VaultSsh["Service"]["execute"]>[0]["proof"],
    ) => Effect.Effect<A, ExecutionFailure>,
    retainSession = false,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { connection, machine } = yield* hostIdentity;
        const workload = yield* keys.create.pipe(
          Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })),
        );
        let retained = false;
        const session = yield* Effect.acquireRelease(
          workloads.open(
            { machineId: connection.machineId, publicKey: workload.publicKey, itemId, destination },
            threadId,
          ),
          (session) =>
            retained ? Effect.void : workloads.close(session.id, threadId).pipe(Effect.ignore),
        );
        if (session.environmentId !== connection.environmentId) return yield* denied();
        const payloadDigest = yield* crypto
          .digest("SHA-256", new TextEncoder().encode(message))
          .pipe(
            Effect.map(Hex.encode),
            Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })),
          );
        const request = {
          environmentId: session.environmentId,
          sessionId: session.id,
          requestId: (yield* crypto
            .randomUUIDv4()
            .pipe(
              Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })),
            )).replaceAll("-", ""),
          operation,
          payloadDigest,
          at: yield* Clock.currentTimeMillis,
        };
        const signed = (message: string) =>
          Effect.all({
            machineSignature: keys.sign(machine.privateKey, message),
            workloadSignature: keys.sign(workload.privateKey, message),
          }).pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "invalid-proof" })));
        const challenge = yield* workloads.challenge({
          ...request,
          ...(yield* signed(vaultWorkloadRequestMessage(request))),
        });
        const result = yield* execute({
          challenge,
          ...(yield* signed(vaultWorkloadProofMessage(challenge))),
        });
        retained = retainSession;
        return result;
      }),
    );
  const operations = {
    ssh: Effect.fn("VaultLaunch.ssh")(function* (
      input: VaultSshRun,
      threadId: ThreadId,
      guard: Effect.Effect<void, ExecutionFailure> = Effect.void,
    ) {
      if (!isSsh(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const info = yield* ssh.info(input.id);
      return yield* observeVaultHealth(
        run(
          threadId,
          input.id,
          info.destination,
          "ssh-exec",
          vaultSshCommandMessage(input.command),
          (proof) => ssh.execute({ proof, command: input.command }, guard),
        ),
        input.id,
        input.command.expectedVersion,
        { kind: "ssh", hostname: info.target.hostname, port: info.target.port },
      );
    }),
    git: Effect.fn("VaultLaunch.git")(function* (
      input: VaultGitRun,
      threadId: ThreadId,
      guard: Effect.Effect<void, ExecutionFailure> = Effect.void,
    ) {
      if (!isGit(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const info = yield* ssh.info(input.id);
      const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(denied));
      if (!thread) return yield* denied();
      const project = yield* projects.get(thread.projectId).pipe(Effect.mapError(denied));
      if (Option.isNone(project)) return yield* denied();
      const cwd = thread.worktreePath ?? project.value.workspaceRoot;
      if (!path.isAbsolute(cwd)) return yield* denied();
      const command = {
        kind: "git" as const,
        expectedVersion: input.expectedVersion,
        action: input.action,
        repository: input.repository,
        cwd,
        timeoutMs: input.timeoutMs,
      };
      return yield* observeVaultHealth(
        run(
          threadId,
          input.id,
          vaultGitDestination(info.target, input.repository),
          "git-exec",
          vaultGitCommandMessage(command),
          (proof) => ssh.git({ proof, command }, guard),
        ),
        input.id,
        input.expectedVersion,
        { kind: "ssh", hostname: info.target.hostname, port: info.target.port },
      );
    }),
  };
  return VaultLaunch.of({
    admission: Effect.fn("VaultLaunch.admission")(function* (operation, threadId) {
      const info = yield* ssh.info(operation.input.id);
      const version =
        operation.kind === "ssh"
          ? operation.input.command.expectedVersion
          : operation.input.expectedVersion;
      if (info.item.state !== "active" || info.item.version !== version) return yield* denied();
      if (!info.target.hostKey)
        return yield* new VaultError({ reason: "denied", detail: "untrusted-host" });
      if (
        info.target.hostKey !== operation.target.hostKey ||
        info.destination !== vaultSshDestination(operation.target)
      )
        return yield* denied();
      const destination =
        operation.kind === "ssh"
          ? info.destination
          : vaultGitDestination(info.target, operation.input.repository);
      const { connection, machine } = yield* hostIdentity;
      const workload = yield* workloads.admission(
        { machineId: connection.machineId, itemId: operation.input.id, destination },
        threadId,
      );
      if (
        workload.environmentId !== connection.environmentId ||
        workload.publicKey !== machine.publicKey
      )
        return yield* denied();
      let cwd: string | null = null;
      if (operation.kind === "git-ssh") {
        const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(denied));
        if (!thread) return yield* denied();
        const project = yield* projects.get(thread.projectId).pipe(Effect.mapError(denied));
        if (Option.isNone(project) || project.value.deletedAt !== null) return yield* denied();
        cwd = thread.worktreePath ?? project.value.workspaceRoot;
        if (!path.isAbsolute(cwd)) return yield* denied();
      }
      // Local metadata stamp only. Capacity, challenge/proof, signing and remote access remain unchecked.
      return yield* admissionStamp([
        operation.kind,
        String(info.item.version),
        destination,
        info.target.hostKey,
        workload.context,
        connection.environmentId,
        connection.machineId,
        machine.fingerprint,
        cwd,
      ]);
    }),
    ssh: Effect.fn("VaultLaunch.sshConnection")(function* (input, threadId) {
      if (!isSshInput(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      if ("id" in input) return yield* operations.ssh(input, threadId);
      const pin = yield* connections.require(
        { kind: "ssh", connection: input.connection },
        threadId,
      );
      return yield* operations.ssh(
        { id: pin.item.id, command: { ...input.command, expectedVersion: pin.item.version } },
        threadId,
        yield* pinGuard(pin, threadId),
      );
    }),
    git: Effect.fn("VaultLaunch.gitConnection")(function* (input, threadId) {
      if (!isGitInput(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      if ("id" in input) return yield* operations.git(input, threadId);
      const pin = yield* connections.require(
        { kind: "git-ssh", connection: input.connection, repository: input.repository },
        threadId,
      );
      return yield* operations.git(
        { ...input, id: pin.item.id, expectedVersion: pin.item.version },
        threadId,
        yield* pinGuard(pin, threadId),
      );
    }),
    agent: Effect.fn("VaultLaunch.agent")(function* (raw, threadId) {
      if (!isAgentOpenInput(raw)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const pin =
        !("id" in raw) && "connection" in raw
          ? yield* connections.require({ kind: "ssh", connection: raw.connection }, threadId)
          : null;
      const input = pin
        ? { id: pin.item.id, expectedVersion: pin.item.version }
        : (raw as VaultSshAgentOpen);
      if (pin) yield* connections.revalidate(pin, threadId);
      if (!isAgentOpen(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const info = yield* ssh.info(input.id);
      return yield* run(
        threadId,
        input.id,
        info.destination,
        "check",
        "",
        (proof) => ssh.agentOpen(input, proof, threadId),
        true,
      );
    }),
    profile: Effect.fn("VaultLaunch.profile")(function* (input, threadId) {
      if (!isProfileRun(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const initial = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(denied));
      if (!initial?.activeRunId) return yield* denied();
      const resolved = yield* profiles.resolve(threadId, input.profileId);
      const binding = resolved.bindings.find((b) => b.name === input.binding);
      if (!binding || binding.kind !== input.operation.kind)
        return yield* new VaultSshError({ reason: "invalid-operation" });
      const guard = Effect.gen(function* () {
        yield* profiles.assertActive(resolved.projectId, resolved.profileId);
        const current = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(denied));
        if (
          !current ||
          current.activeRunId !== initial.activeRunId ||
          current.projectId !== initial.projectId ||
          current.providerInstanceId !== initial.providerInstanceId
        )
          return yield* denied();
      });
      if (input.operation.kind === "github")
        return yield* github.run(
          {
            id: binding.itemId,
            expectedVersion: binding.version,
            repository: binding.repository!,
            operation: input.operation.operation,
          },
          threadId,
          guard,
        );
      return yield* input.operation.kind === "ssh"
        ? operations.ssh(
            {
              id: binding.itemId,
              command: {
                expectedVersion: binding.version,
                argv: input.operation.argv,
                timeoutMs: input.operation.timeoutMs,
              },
            },
            threadId,
            guard,
          )
        : operations.git(
            {
              id: binding.itemId,
              expectedVersion: binding.version,
              repository: binding.repository!,
              action: input.operation.action,
              timeoutMs: input.operation.timeoutMs,
            },
            threadId,
            guard,
          );
    }),
  });
});
export const layer = Layer.effect(VaultLaunch, make);
