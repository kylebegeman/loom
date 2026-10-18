import type { ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultWorkloadError,
  VaultSshError,
  VaultSshRun,
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
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";

type Failure = VaultError | VaultSshError | VaultWorkloadError;
export class VaultLaunch extends Context.Service<
  VaultLaunch,
  {
    readonly ssh: (
      input: VaultSshRun,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshResult, Failure>;
    readonly git: (
      input: VaultGitRun,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitResult, Failure>;
  }
>()("t3/fork/vault/VaultLaunch") {}
const denied = () => new VaultError({ reason: "denied" });
const isSsh = Schema.is(VaultSshRun),
  isGit = Schema.is(VaultGitRun);
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
  const configured = environment.LOOM_VAULT_EXECUTION_BROKER_DIR;
  const run = <A>(
    threadId: ThreadId,
    itemId: string,
    destination: string,
    operation: "ssh-exec" | "git-exec",
    message: string,
    execute: (
      proof: Parameters<VaultSsh.VaultSsh["Service"]["execute"]>[0]["proof"],
    ) => Effect.Effect<A, Failure>,
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
          .read(configured)
          .pipe(Effect.mapError(() => new VaultWorkloadError({ reason: "not-configured" })));
        if (machine.fingerprint.slice(0, 32) !== connection.machineId) return yield* denied();
        const workload = yield* keys.create.pipe(
          Effect.mapError(() => new VaultWorkloadError({ reason: "unavailable" })),
        );
        const session = yield* Effect.acquireRelease(
          workloads.open(
            { machineId: connection.machineId, publicKey: workload.publicKey, itemId, destination },
            threadId,
          ),
          (session) => workloads.close(session.id, threadId).pipe(Effect.ignore),
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
        return yield* execute({
          challenge,
          ...(yield* signed(vaultWorkloadProofMessage(challenge))),
        });
      }),
    );
  return VaultLaunch.of({
    ssh: Effect.fn("VaultLaunch.ssh")(function* (input, threadId) {
      if (!isSsh(input)) return yield* new VaultSshError({ reason: "invalid-operation" });
      const info = yield* ssh.info(input.id);
      return yield* run(
        threadId,
        input.id,
        info.destination,
        "ssh-exec",
        vaultSshCommandMessage(input.command),
        (proof) => ssh.execute({ proof, command: input.command }),
      );
    }),
    git: Effect.fn("VaultLaunch.git")(function* (input, threadId) {
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
        (proof) => ssh.git({ proof, command }),
      );
    }),
  });
});
export const layer = Layer.effect(VaultLaunch, make);
