import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { RunId } from "@t3tools/contracts";
import {
  VaultSshError,
  vaultGitDestination,
  type VaultApprovalRetryInput,
  type VaultApprovalChange,
} from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";

const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const command = { expectedVersion: 1, argv: ["/usr/bin/true"], timeoutMs: 1000 };
const requestedRetry = (
  f: Effect.Success<ReturnType<typeof launchFixture>>,
  kind: "ssh" | "git-ssh" = "ssh",
) =>
  Effect.gen(function* () {
    const id = yield* f.id;
    const repository = "team/repo.git";
    yield* f.access.approvalCreate(
      {
        id,
        threadId: f.threadId,
        itemId: f.itemId,
        waitingOperationId: id,
        action: "use",
        destination:
          kind === "ssh" ? f.key.destination : vaultGitDestination(f.key.target, repository),
      },
      `thread:${f.threadId}`,
      Effect.void,
    );
    const decision: VaultApprovalChange = {
      id,
      operationId: yield* f.id,
      expectedRevision: 1,
      expectedPolicyRevision: 0,
      decision: "approve",
      durationMs: 300_000,
    };
    const input: VaultApprovalRetryInput = {
      id,
      waitingOperationId: id,
      expectedRevision: 2,
      previousOutcome: "not-started",
      operation:
        kind === "ssh"
          ? { kind: "ssh", target: f.key.target, input: { id: f.itemId, command } }
          : {
              kind: "git-ssh",
              target: f.key.target,
              input: {
                id: f.itemId,
                expectedVersion: 1,
                repository,
                action: "ls-remote",
                timeoutMs: 1000,
              },
            },
    };
    return { decision, input };
  });
const approve = (
  f: Effect.Success<ReturnType<typeof launchFixture>>,
  decision: VaultApprovalChange,
) => f.access.approvalChange(decision, "human:reviewer", Effect.void);

it.effect.each(["ssh", "git-ssh"] as const)(
  "executes an explicitly retried %s operation using the reviewed timed grant and normal adapter checks",
  (kind) =>
    Effect.gen(function* () {
      let calls = 0;
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  calls++;
                  expect(input.target).toMatchObject({
                    hostname: "example.test",
                    username: "git",
                    port: 22,
                  });
                  return { exitCode: 0, stdout: "synthetic-result" };
                }),
              ),
            ),
        }),
      );
      const { decision, input } = yield* requestedRetry(f, kind);
      const execute = () =>
        input.operation.kind === "ssh"
          ? f.launch.ssh(input.operation.input, f.threadId)
          : input.operation.kind === "git-ssh"
            ? f.launch.git(input.operation.input, f.threadId)
            : Effect.die("fixture");
      expect((yield* execute().pipe(Effect.flip)).reason).toBe("denied");
      expect(calls).toBe(0);
      yield* approve(f, decision);
      const prepared = yield* f.access.approvalPrepareRetry(input, f.threadId);
      expect(prepared).toMatchObject({
        retryState: "policy-valid-recheck-adapter",
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(calls).toBe(0);
      expect((yield* execute()).stdout).toBe("synthetic-result");
      expect(calls).toBe(1);
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      yield* f.access.approvalChange(
        {
          ...decision,
          decision: "revoke",
          operationId: yield* f.id,
          expectedRevision: 2,
          expectedPolicyRevision: 1,
        },
        "human:reviewer",
        Effect.void,
      );
      expect((yield* execute().pipe(Effect.flip)).reason).toBe("denied");
      expect(calls).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect.each(["run", "mode", "item", "expiry"] as const)(
  "refuses an explicit retry after %s changes even if preparation was valid",
  (change) =>
    Effect.gen(function* () {
      let calls = 0;
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(
              Effect.andThen(
                Effect.sync(() => {
                  calls++;
                  return { exitCode: 0, stdout: "" };
                }),
              ),
            ),
        }),
      );
      const { decision, input } = yield* requestedRetry(f);
      yield* approve(f, decision);
      expect((yield* f.access.approvalPrepareRetry(input, f.threadId)).retryState).toBe(
        "policy-valid-recheck-adapter",
      );
      if (change === "run")
        f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement-run") };
      else if (change === "mode")
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      else if (change === "item")
        yield* f.ssh.trust(
          { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, hostKey: null },
          "human",
          Effect.void,
        );
      else yield* TestClock.adjust("5 minutes");
      expect(
        (yield* f.launch.ssh({ id: f.itemId, command }, f.threadId).pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(calls).toBe(0);
      if (change === "mode") f.state.thread = { ...f.state.thread, runtimeMode: "full-access" };
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect.each(["ssh", "git-ssh"] as const)(
  "does not repeat uncertain %s writes and requires outcome review for recovery",
  (kind) =>
    Effect.gen(function* () {
      let calls = 0;
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(
              Effect.andThen(
                Effect.suspend(() => {
                  calls++;
                  return Effect.fail(new VaultSshError({ reason: "timeout" }));
                }),
              ),
            ),
        }),
      );
      const { decision, input: proposed } = yield* requestedRetry(f, kind);
      const input: VaultApprovalRetryInput =
        proposed.operation.kind === "git-ssh"
          ? {
              ...proposed,
              operation: {
                ...proposed.operation,
                input: { ...proposed.operation.input, action: "fetch" },
              },
            }
          : proposed;
      yield* approve(f, decision);
      const prepared = yield* f.access.approvalPrepareRetry(input, f.threadId);
      const execute =
        input.operation.kind === "ssh"
          ? f.launch.ssh(input.operation.input, f.threadId)
          : input.operation.kind === "git-ssh"
            ? f.launch.git(input.operation.input, f.threadId)
            : Effect.die("fixture");
      expect((yield* execute.pipe(Effect.flip)).reason).toBe("timeout");
      const recovery = {
        ...input,
        previousOutcome: "unknown" as const,
        previousOperationDigest: prepared.operationDigest,
      };
      expect(yield* f.access.approvalPrepareRetry(recovery, f.threadId)).toMatchObject({
        retryState: "requires-outcome-review",
        nextStep: "inspect-outcome",
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      yield* f.access.approvalStatus(input.id, f.threadId);
      expect(calls).toBe(1);
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect("rechecks revocation at the transport boundary after an explicit attempt starts", () =>
  Effect.gen(function* () {
    const arrived = yield* Deferred.make<void>();
    const proceed = yield* Deferred.make<void>();
    let effects = 0;
    const f = yield* launchFixture(
      Layer.succeed(SshTransport.SshTransport, {
        execute: (input) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(arrived, undefined);
            yield* Deferred.await(proceed);
            yield* input.authorize;
            effects++;
            return { exitCode: 0, stdout: "" };
          }),
      }),
    );
    const { decision } = yield* requestedRetry(f);
    yield* approve(f, decision);
    const executing = yield* f.launch
      .ssh({ id: f.itemId, command }, f.threadId)
      .pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(arrived);
    yield* f.access.approvalChange(
      {
        ...decision,
        operationId: yield* f.id,
        expectedRevision: 2,
        expectedPolicyRevision: 1,
        decision: "revoke",
      },
      "human:reviewer",
      Effect.void,
    );
    yield* Deferred.succeed(proceed, undefined);
    expect((yield* Fiber.join(executing))._tag).toBe("Failure");
    expect(effects).toBe(0);
    expect(yield* f.workloads.list(f.threadId)).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
