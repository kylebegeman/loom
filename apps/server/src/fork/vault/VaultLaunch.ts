import { observeVaultHealth } from "./health-observation.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import type { ThreadId } from "@t3tools/contracts";
import {
  VaultSshAgentOpen,
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

type HostedFailure = VaultError | VaultSshError | VaultWorkloadError;
type Failure = HostedFailure | VaultGitHubError;
export class VaultLaunch extends Context.Service<
  VaultLaunch,
  {
    readonly agent: (
      input: VaultSshAgentOpen,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshAgentSession, HostedFailure>;
    readonly profile: (
      input: VaultProfileRun,
      threadId: ThreadId,
    ) => Effect.Effect<typeof VaultProfileRunResult.Type, Failure>;
    readonly ssh: (
      input: VaultSshRun,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshResult, HostedFailure>;
    readonly git: (
      input: VaultGitRun,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitResult, HostedFailure>;
  }
>()("t3/fork/vault/VaultLaunch") {}
const denied = () => new VaultError({ reason: "denied" });
const isSsh = Schema.is(VaultSshRun),
  isGit = Schema.is(VaultGitRun);
const isAgentOpen = Schema.is(VaultSshAgentOpen);
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
  const profiles = yield* VaultProfiles.VaultProfiles,
    github = yield* VaultGitHub.VaultGitHub;
  const configured = environment.LOOM_VAULT_EXECUTION_BROKER_DIR;
  const run = <A>(
    threadId: ThreadId,
    itemId: string,
    destination: string,
    operation: "ssh-exec" | "git-exec" | "check",
    message: string,
    execute: (
      proof: Parameters<VaultSsh.VaultSsh["Service"]["execute"]>[0]["proof"],
    ) => Effect.Effect<A, HostedFailure>,
    retainSession = false,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (!configured || !path.isAbsolute(configured))
          return yield* new VaultWorkloadError({ reason: "not-configured" });
        // The operator enrolls this server identity once. No agent can enroll or approve itself.
        const connection = yield* identities
          .connection(configured)
          .pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "not-configured" })));
        const machine = yield* identities
          .read(configured, false)
          .pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "not-configured" })));
        if (machine.fingerprint.slice(0, 32) !== connection.machineId) return yield* denied();
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
    ssh: Effect.fn("VaultLaunch.ssh")(
      function* (
        input: VaultSshRun,
        threadId: ThreadId,
        guard: Effect.Effect<void, HostedFailure> = Effect.void,
      ) {
        if (!isSsh(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
        const info = yield* ssh.info(input.id);
        return yield* run(
          threadId,
          input.id,
          info.destination,
          "ssh-exec",
          vaultSshCommandMessage(input.command),
          (proof) => ssh.execute({ proof, command: input.command }, guard),
        );
      },
      (effect, input) => observeVaultHealth(effect, input.id, input.command.expectedVersion),
    ),
    git: Effect.fn("VaultLaunch.git")(
      function* (
        input: VaultGitRun,
        threadId: ThreadId,
        guard: Effect.Effect<void, HostedFailure> = Effect.void,
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
        return yield* run(
          threadId,
          input.id,
          vaultGitDestination(info.target, input.repository),
          "git-exec",
          vaultGitCommandMessage(command),
          (proof) => ssh.git({ proof, command }, guard),
        );
      },
      (effect, input) => observeVaultHealth(effect, input.id, input.expectedVersion),
    ),
  };
  return VaultLaunch.of({
    ...operations,
    agent: Effect.fn("VaultLaunch.agent")(function* (input, threadId) {
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
