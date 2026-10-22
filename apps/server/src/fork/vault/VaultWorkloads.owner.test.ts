import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  MessageId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { newerVaultRun, vaultRun } from "./VaultActiveRun.testkit.ts";
import * as AccessPolicy from "./AccessPolicy.ts";
import { journalFixture } from "./OperationJournal.testkit.ts";
import * as Redacted from "effect/Redacted";
import { memoryVault } from "./VaultLaunch.testkit.ts";
import { sshFixture } from "./VaultSsh.testkit.ts";
import * as SshTransport from "./SshTransport.ts";
import * as Layer from "effect/Layer";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { threadShellFromProjection } from "../../orchestration-v2/ProjectionStore.ts";

const command = { expectedVersion: 1, argv: ["true"], timeoutMs: 1000 };
const setup = (pinHost = true) =>
  Effect.gen(function* () {
    const state = { calls: 0 };
    const f = yield* sshFixture(
      Layer.succeed(SshTransport.SshTransport, {
        execute: (input) =>
          input.authorize.pipe(
            Effect.andThen(() =>
              Effect.sync(() => {
                state.calls++;
                return { exitCode: 0, stdout: "ok" };
              }),
            ),
          ),
      }),
    );
    const host = yield* f.sshKeys.create;
    const key = yield* f.ssh.generate(
      {
        id: f.itemId,
        operationId: yield* f.id,
        label: "Owner connection",
        target: {
          hostname: "example.test",
          username: "git",
          port: 22,
          hostKey: pinHost ? host.publicKey : null,
        },
      },
      "owner",
      Effect.void,
    );
    yield* f.access.setOwnerPolicy(
      { operationId: yield* f.id, expectedRevision: 0, mode: "owner-trusted" },
      "owner",
      Effect.void,
    );
    return { ...f, key, execution: state };
  });
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(Layer.merge(memoryVault, NodeServices.layer)));

it.effect(
  "revalidates real owner policy after proof issuance and allows cleanup after disable",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* setup();
        const session = yield* f.session(f.key.destination);
        expect(
          (yield* f.ssh.execute({ proof: yield* f.proof(session, command), command })).exitCode,
        ).toBe(0);
        expect(f.execution.calls).toBe(1);
        const pending = yield* f.proof(session, command);
        yield* f.access.setOwnerPolicy(
          { operationId: yield* f.id, expectedRevision: 1, mode: "restricted" },
          "owner",
          Effect.void,
        );
        expect((yield* f.ssh.execute({ proof: pending, command }).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect((yield* f.workloads.revalidate(session).pipe(Effect.flip)).reason).toBe("denied");
        expect(f.execution.calls).toBe(1);
        yield* f.workloads.close(session.id, f.threadId);
        expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      }),
    ),
);
it.effect.each([
  "archive",
  "host-disabled",
  "destination",
  "key-version",
  "run",
  "runtime",
  "plan",
  "untrusted-host",
] as const)(
  "owner trust retains the %s execution boundary without a remote side effect",
  (failure) =>
    run(
      Effect.gen(function* () {
        const f = yield* setup(failure !== "untrusted-host");
        const session = yield* f.session(
          failure === "destination" ? "ssh://git@other.test:22" : f.key.destination,
        );
        const operation = failure === "key-version" ? { ...command, expectedVersion: 2 } : command;
        const proof = yield* f.proof(session, operation);
        if (failure === "archive")
          yield* f.core.change(
            { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
            "owner",
          );
        if (failure === "host-disabled") {
          const snapshot = yield* f.brokers.snapshot;
          yield* f.brokers.apply(
            {
              operationId: yield* f.id,
              expectedRevision: snapshot.revision,
              change: { type: "disable", machineId: f.machineId },
            },
            "owner",
          );
        }
        if (failure === "run")
          f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement-run") };
        if (failure === "runtime")
          f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
        if (failure === "plan") f.state.thread = { ...f.state.thread, interactionMode: "plan" };
        const result = yield* f.ssh.execute({ proof, command: operation }).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(f.execution.calls).toBe(0);
      }),
    ),
);
it.effect(
  "owner policy follows a new authenticated active run and keeps a running root behind a cancelled queued turn",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* setup();
        const original = yield* f.session(f.key.destination);
        f.state.thread = { ...f.state.thread, activeRunId: RunId.make("new-owner-run") };
        expect((yield* f.workloads.revalidate(original).pipe(Effect.flip)).reason).toBe("denied");
        const current = yield* f.session(f.key.destination);
        newerVaultRun(f.state, "cancelled");
        expect(
          (yield* f.ssh.execute({ proof: yield* f.proof(current, command), command })).exitCode,
        ).toBe(0);
        expect(f.execution.calls).toBe(1);
      }),
    ),
);

it.effect(
  "owner trust preserves exact reviewed grants and reserved one-time intents without execution authority",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* journalFixture;
        const preview = yield* f.access.protectionMigrationPreview(
          {
            expectedPolicyRevision: 1,
            selections: [{ itemId: f.itemId, itemVersion: 1, mode: "one-time" }],
          },
          "human",
          Effect.void,
        );
        const [path, stored] = [...f.records.entries()].find(([key]) =>
          key.endsWith("/access-policy"),
        )!;
        f.records.set(path, {
          value: Redacted.make(preview.proposal),
          version: stored.version + 1,
        });
        yield* f.access.setOwnerPolicy(
          { operationId: yield* f.id, expectedRevision: 2, mode: "owner-trusted" },
          "human",
          Effect.void,
        );
        const proposal: AccessPolicy.IntentProposal = {
          requestId: f.input.id,
          expectedRequestRevision: 2,
          waitingOperationId: f.input.waitingOperationId,
          operation: f.input.operation,
        };
        const checked = yield* f.access.intentPreview(proposal, "human", Effect.void);
        const reviewed = yield* f.access.intentReview(
          {
            ...proposal,
            id: yield* f.id,
            expectedPolicyRevision: checked.policyRevision,
            reviewedDigest: checked.binding.operationDigest,
            expiresAt: checked.expiresNoLaterThan,
          },
          "human",
          Effect.void,
        );
        expect(reviewed.canExecute).toBe(false);
        const reserved = yield* f.access.intentReserve(
          {
            ...proposal,
            id: reviewed.intent.id,
            expectedIntentRevision: reviewed.intent.revision,
            expectedPolicyRevision: (yield* f.access.snapshot).revision,
          },
          f.threadId,
          Effect.void,
        );
        expect(reserved.intent.state).toBe("reserved");
        expect(reserved.canExecute).toBe(false);
        expect(
          (yield* f.access
            .require(f.threadId, f.itemId, "use", f.key.destination)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* f.core.reveal({ id: f.itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
        ).toBe("denied");
        const revision = (yield* f.access.snapshot).revision;
        yield* f.access.setOwnerPolicy(
          { operationId: yield* f.id, expectedRevision: revision, mode: "restricted" },
          "human",
          Effect.void,
        );
        expect(
          (yield* f.access.intentStatus(reviewed.intent.id, "human", Effect.void)).intent,
        ).toEqual(reserved.intent);
      }),
    ),
);
it.effect(
  "an owner allow cannot replace the exact real grant required by a protected operation intent",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* journalFixture;
        const preview = yield* f.access.protectionMigrationPreview(
          {
            expectedPolicyRevision: 1,
            selections: [{ itemId: f.itemId, itemVersion: 1, mode: "one-time" }],
          },
          "human",
          Effect.void,
        );
        const [path, stored] = [...f.records.entries()].find(([key]) =>
          key.endsWith("/access-policy"),
        )!;
        f.records.set(path, {
          value: Redacted.make(preview.proposal),
          version: stored.version + 1,
        });
        yield* f.access.setOwnerPolicy(
          { operationId: yield* f.id, expectedRevision: 2, mode: "owner-trusted" },
          "human",
          Effect.void,
        );
        const grantId = (yield* f.access.snapshot).grants[0]!.definition.id;
        yield* f.access.apply(
          {
            operationId: yield* f.id,
            expectedRevision: 3,
            change: { type: "state", id: grantId, state: "revoked" },
          },
          "human",
          Effect.void,
        );
        expect(
          (yield* f.access
            .intentPreview(
              {
                requestId: f.input.id,
                expectedRequestRevision: 2,
                waitingOperationId: f.input.waitingOperationId,
                operation: f.input.operation,
              },
              "human",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);

it.effect.each([
  ["claude", "claude-sonnet-4-6"],
  ["cursor", "composer-2"],
  ["grok", "grok-4.5"],
  ["opencode", "openai/gpt-5"],
  ["antigravity", "gemini-2.5-pro"],
  ["pi", "gpt-5"],
] as const)(
  "a fresh owner thread switches coherently from Codex to %s without grants or a profile",
  ([provider, model]) =>
    run(
      Effect.gen(function* () {
        const f = yield* setup();
        const ownerId = (yield* f.access.snapshot).ownerPolicy?.ownerId;
        const threadId = ThreadId.make(`fresh-owner-${provider}`);
        f.state.thread = {
          ...liveThreadShell(threadId),
          projectId: f.state.thread.projectId,
          activeRunId: RunId.make(`fresh-owner-codex-${provider}`),
        };
        f.state.runs = [vaultRun(f.state.thread)];
        const open = () =>
          f.workloads.open(
            {
              machineId: f.machineId,
              publicKey: f.workload.publicKey,
              itemId: f.itemId,
              destination: f.key.destination,
            },
            threadId,
          );
        const first = yield* open();
        expect(
          (yield* f.ssh.execute({ proof: yield* f.proof(first, command), command })).exitCode,
        ).toBe(0);
        const pending = yield* f.proof(first, command);
        const instanceId = ProviderInstanceId.make(provider);
        f.state.thread = {
          ...f.state.thread,
          providerInstanceId: instanceId,
          modelSelection: { instanceId, model },
          activeRunId: RunId.make(`fresh-owner-${provider}-run`),
        };
        f.state.runs = [vaultRun(f.state.thread)];
        expect((yield* f.ssh.execute({ proof: pending, command }).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        const next = yield* open();
        expect(next.providerInstanceId).toBe(instanceId);
        expect(next.runId).toBe(f.state.runs[0]!.id);
        expect(
          (yield* f.ssh.execute({ proof: yield* f.proof(next, command), command })).exitCode,
        ).toBe(0);
        expect(f.execution.calls).toBe(2);
        const snapshot = yield* f.access.snapshot;
        expect(snapshot).toMatchObject({
          revision: 1,
          grants: [],
          ownerPolicy: { ownerId, mode: "owner-trusted" },
        });
        expect((yield* f.profiles.list(f.state.thread.projectId)).profiles).toEqual([]);
        expect(yield* f.profiles.currentPin(threadId)).toBeNull();
        expect(snapshot.audit[0]?.authorization).toMatchObject({
          category: "owner-trusted",
          ownerId,
          threadId,
          runId: next.runId,
        });
      }),
    ),
);

it.effect.each(["subagent", "scheduled"] as const)(
  "a %s-origin run executes a real signed owner workload without grants or profiles",
  (origin) =>
    run(
      Effect.gen(function* () {
        const f = yield* setup();
        const threadId = ThreadId.make(`owner-${origin}-thread`);
        const instanceId = ProviderInstanceId.make("claude");
        const thread = {
          ...liveThreadShell(threadId),
          projectId: f.state.thread.projectId,
          createdBy: "agent" as const,
          creationSource: "mcp" as const,
          providerInstanceId: instanceId,
          modelSelection: { instanceId, model: "claude-sonnet-4-6" },
          activeRunId: RunId.make(`owner-${origin}-run`),
          lineage:
            origin === "subagent"
              ? {
                  parentThreadId: f.threadId,
                  rootThreadId: f.threadId,
                  relationshipToParent: "subagent" as const,
                }
              : { parentThreadId: null, rootThreadId: threadId, relationshipToParent: null },
        };
        const messageId = MessageId.make(
          origin === "scheduled"
            ? "scheduled-task-message:owner-schedule:1:scheduled"
            : "owner-subagent-message",
        );
        // The scheduler retains its creator/source and tags the dispatch message, not the thread.
        const projection = {
          ...idleThreadProjection(thread),
          runs: [vaultRun(thread, { userMessageId: messageId })],
          messages: [
            {
              id: messageId,
              threadId,
              runId: thread.activeRunId,
              nodeId: null,
              createdBy: thread.createdBy,
              creationSource: thread.creationSource,
              ...(origin === "scheduled"
                ? { scheduledTaskId: ScheduledTaskId.make("owner-schedule") }
                : { senderThreadId: f.threadId }),
              role: "user" as const,
              text: "Use the owner connection",
              attachments: [],
              streaming: false,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
            },
          ],
        };
        f.state.thread = threadShellFromProjection(projection);
        f.state.runs = projection.runs;
        const session = yield* f.workloads.open(
          {
            machineId: f.machineId,
            publicKey: f.workload.publicKey,
            itemId: f.itemId,
            destination: f.key.destination,
          },
          threadId,
        );
        expect(
          (yield* f.ssh.execute({ proof: yield* f.proof(session, command), command })).exitCode,
        ).toBe(0);
        expect(f.execution.calls).toBe(1);
        expect((yield* f.access.snapshot).grants).toEqual([]);
        expect((yield* f.profiles.list(thread.projectId)).profiles).toEqual([]);
        expect(yield* f.profiles.currentPin(threadId)).toBeNull();
        for (const action of ["manage", "delegate", "reveal", "export"] as const)
          expect(
            (yield* f.access
              .require(threadId, f.itemId, action, f.key.destination)
              .pipe(Effect.flip)).reason,
          ).toBe("denied");
      }),
    ),
);

it.effect.each(["approval-required", "plan"] as const)(
  "an owner subagent downgraded to %s cannot execute its pending proof or expand access",
  (mode) =>
    run(
      Effect.gen(function* () {
        const f = yield* setup();
        const childId = ThreadId.make(`owner-${mode}-child`);
        f.state.thread = {
          ...liveThreadShell(childId),
          projectId: f.state.thread.projectId,
          createdBy: "agent",
          creationSource: "mcp",
          activeRunId: RunId.make(`owner-${mode}-child-run`),
          lineage: {
            parentThreadId: f.threadId,
            rootThreadId: f.threadId,
            relationshipToParent: "subagent",
          },
        };
        f.state.runs = [vaultRun(f.state.thread)];
        const open = () =>
          f.workloads.open(
            {
              machineId: f.machineId,
              publicKey: f.workload.publicKey,
              itemId: f.itemId,
              destination: f.key.destination,
            },
            childId,
          );
        const session = yield* open();
        const pending = yield* f.proof(session, command);
        f.state.thread =
          mode === "plan"
            ? { ...f.state.thread, interactionMode: "plan" }
            : { ...f.state.thread, runtimeMode: "approval-required" };
        expect((yield* f.ssh.execute({ proof: pending, command }).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect((yield* open().pipe(Effect.flip)).reason).toBe("denied");
        expect(
          (yield* f.access.require(childId, f.itemId, "use", f.key.destination).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect(
          (yield* f.access
            .setOwnerPolicy(
              { operationId: yield* f.id, expectedRevision: 1, mode: "restricted" },
              `thread:${childId}`,
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(yield* f.access.snapshot).toMatchObject({
          revision: 1,
          grants: [],
          ownerPolicy: { mode: "owner-trusted" },
        });
        expect(f.execution.calls).toBe(0);
      }),
    ),
);
