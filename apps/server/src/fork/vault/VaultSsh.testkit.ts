import { vaultRun } from "./VaultActiveRun.testkit.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as GitHubTerminal from "./GitHubTerminal.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as VaultProfiles from "./VaultProfiles.ts";
import { EnvironmentId, ThreadId, IsoDateTime, type OrchestrationV2Run } from "@t3tools/contracts";
import {
  vaultBrokerClaimMessage,
  vaultBrokerChallengeMessage,
  vaultBrokerHeartbeatMessage,
  vaultWorkloadRequestMessage,
  vaultWorkloadProofMessage,
  vaultSshCommandMessage,
  vaultGitCommandMessage,
  type VaultGitCommand,
  type VaultSshCommand,
  type VaultWorkloadSession,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { liveThreadShell, idleThreadProjection } from "../../mcp/McpToolAccess.testkit.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as SshCrypto from "./SshCrypto.ts";
import * as SshTransport from "./SshTransport.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";

export const sshFixture = (
  transportLayer: Layer.Layer<
    SshTransport.SshTransport,
    never,
    SshCrypto.SshCrypto
  > = SshTransport.layer,
  githubAdapters = Layer.mergeAll(
    GitHubTransport.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    GitHubCli.layer,
  ),
) =>
  Effect.gen(function* () {
    const random = yield* Crypto.Crypto;
    const id = random.randomUUIDv4().pipe(Effect.map((value) => value.replaceAll("-", "")));
    const environmentId = EnvironmentId.make("ssh-fixture-" + (yield* id)),
      threadId = ThreadId.make("ssh-fixture-thread");
    const state = { thread: liveThreadShell(threadId), runs: [] as OrchestrationV2Run[] };
    const dependencies = Layer.mergeAll(
      Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
      Layer.mock(ThreadManagementService)({
        getThreadShell: (id) => Effect.sync(() => (id === state.thread.id ? state.thread : null)),
        getThreadRecords: (_id, _fields, filter) =>
          Effect.sync(() => ({
            ...idleThreadProjection(state.thread),
            runs: (state.runs.length > 0 || !state.thread.activeRunId
              ? state.runs
              : [vaultRun(state.thread)]
            ).filter((run) => !filter?.runIds || filter.runIds.includes(run.id)),
          })),
      }),
      Layer.mock(ProjectStoreV2)({
        get: (projectId) =>
          Effect.succeed(
            Option.some({
              projectId,
              title: "Disposable project",
              workspaceRoot: "/private/project",
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: IsoDateTime.make("2026-10-18T00:00:00Z"),
              updatedAt: IsoDateTime.make("2026-10-18T00:00:00Z"),
              deletedAt: null,
            }),
          ),
      }),
      BrokerCrypto.layer,
      SshCrypto.layer,
    );
    const coreLayer = VaultCore.layer.pipe(Layer.provide(dependencies));
    const brokerLayer = VaultBrokers.layer.pipe(Layer.provide(dependencies));
    const accessLayer = VaultAccess.layer.pipe(
      Layer.provide(ApprovalNotifications.stub),
      Layer.provide(Layer.merge(coreLayer, dependencies)),
    );
    const workloadsLayer = VaultWorkloads.layer.pipe(
      Layer.provide(Layer.mergeAll(brokerLayer, accessLayer, dependencies)),
    );
    const layer = VaultSsh.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          coreLayer,
          brokerLayer,
          accessLayer,
          workloadsLayer,
          dependencies,
          transportLayer.pipe(Layer.provide(SshCrypto.layer)),
        ),
      ),
    );
    const github = VaultGitHub.layer.pipe(
      Layer.provideMerge(layer),
      Layer.provideMerge(githubAdapters),
      Layer.provideMerge(GitHubTerminal.layer),
    );
    const context = yield* Layer.build(VaultProfiles.layer.pipe(Layer.provideMerge(github))),
      ssh = Context.get(context, VaultSsh.VaultSsh),
      core = Context.get(context, VaultCore.VaultCore),
      access = Context.get(context, VaultAccess.VaultAccess),
      brokers = Context.get(context, VaultBrokers.VaultBrokers),
      workloads = Context.get(context, VaultWorkloads.VaultWorkloads),
      keys = Context.get(context, BrokerCrypto.BrokerCrypto),
      sshKeys = Context.get(context, SshCrypto.SshCrypto);
    const machine = yield* keys.create,
      workload = yield* keys.create;
    const invitation = yield* brokers.begin(
      {
        operationId: yield* id,
        expectedRevision: 0,
        publicKey: machine.publicKey,
        label: "Disposable runner",
        platform: "linux",
      },
      "fixture-admin",
    );
    const claim = yield* brokers.claim({
      invitation,
      signature: yield* keys.sign(machine.privateKey, vaultBrokerClaimMessage(invitation)),
    });
    yield* brokers.apply(
      {
        operationId: yield* id,
        expectedRevision: 2,
        change: {
          type: "approve",
          enrollmentId: invitation.enrollmentId,
          fingerprint: machine.fingerprint,
        },
      },
      "fixture-admin",
    );
    const heartbeatRequest = {
      environmentId,
      machineId: claim.machineId,
      requestId: yield* id,
      at: yield* Clock.currentTimeMillis,
    };
    const heartbeat = yield* brokers.challenge({
      ...heartbeatRequest,
      signature: yield* keys.sign(
        machine.privateKey,
        vaultBrokerChallengeMessage(heartbeatRequest),
      ),
    });
    yield* brokers.heartbeat({
      challenge: heartbeat,
      signature: yield* keys.sign(machine.privateKey, vaultBrokerHeartbeatMessage(heartbeat)),
    });
    const itemId = yield* id,
      grantId = yield* id;
    const grant = (destination: string) =>
      access.apply(
        {
          operationId: "f".repeat(32),
          expectedRevision: 0,
          change: {
            type: "save",
            grant: {
              id: grantId,
              label: "Disposable SSH",
              principal: { kind: "thread", id: threadId },
              itemIds: [itemId],
              actions: ["inspect", "use"],
              projectId: null,
              destination,
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "fixture-admin",
      );
    const session = (destination: string) =>
      workloads.open(
        { machineId: claim.machineId, publicKey: workload.publicKey, itemId, destination },
        threadId,
      );
    const proof = Effect.fnUntraced(function* (
      session: VaultWorkloadSession,
      command: VaultSshCommand | VaultGitCommand,
    ) {
      const payloadDigest = yield* random
        .digest(
          "SHA-256",
          new TextEncoder().encode(
            "kind" in command ? vaultGitCommandMessage(command) : vaultSshCommandMessage(command),
          ),
        )
        .pipe(Effect.map(Hex.encode));
      const request = {
        environmentId,
        sessionId: session.id,
        requestId: yield* id,
        at: yield* Clock.currentTimeMillis,
        operation: "kind" in command ? ("git-exec" as const) : ("ssh-exec" as const),
        payloadDigest,
      };
      const challenge = yield* workloads.challenge({
        ...request,
        machineSignature: yield* keys.sign(
          machine.privateKey,
          vaultWorkloadRequestMessage(request),
        ),
        workloadSignature: yield* keys.sign(
          workload.privateKey,
          vaultWorkloadRequestMessage(request),
        ),
      });
      return {
        challenge,
        machineSignature: yield* keys.sign(
          machine.privateKey,
          vaultWorkloadProofMessage(challenge),
        ),
        workloadSignature: yield* keys.sign(
          workload.privateKey,
          vaultWorkloadProofMessage(challenge),
        ),
      };
    });
    return {
      profiles: Context.get(context, VaultProfiles.VaultProfiles),
      context,
      ssh,
      core,
      access,
      brokers,
      workloads,
      keys,
      sshKeys,
      machine,
      workload,
      state,
      environmentId,
      threadId,
      machineId: claim.machineId,
      itemId,
      grantId,
      id,
      grant,
      session,
      proof,
    };
  });
