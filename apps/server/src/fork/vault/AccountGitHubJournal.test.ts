import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { VaultError, VaultGitHubError } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Journal from "./AccountGitHubJournal.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const scope = {
  sourceEnvironmentId: "source",
  keyFingerprint: "key",
  authorityId: "authority",
  ownerSubject: "owner",
  threadId: "thread",
  projectId: "project",
};
const proposal = {
  connection: { resource: "acme/app" },
  repository: "acme/app",
  operation: { action: "issue-create" as const, title: "Fix focus", body: "Restore focus." },
};
const result = {
  account: "acme-agent",
  repository: "acme/app",
  exitCode: 0,
  stdout: "https://github.com/acme/app/issues/42",
};
const input = { operationId: "a".repeat(32), mode: "start" as const, scope, proposal };
const fixture = Effect.gen(function* () {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = {
    calls: 0,
    fault: "none" as "none" | "before" | "after",
    completedFault: "none" as "none" | "before" | "after",
  };
  const backend = Layer.succeed(OpenBaoStore.OpenBaoStore, {
    status: Effect.succeed({ backend: "openbao" as const, state: "ready" as const, origin: null }),
    keys: () => Effect.succeed([]),
    read: (path) => Effect.sync(() => records.get(path) ?? null),
    write: (path, value, expected) =>
      Effect.gen(function* () {
        const version = records.get(path)?.version ?? 0;
        if (version !== expected) return yield* new VaultError({ reason: "conflict" });
        const raw = Redacted.value(value) as { entries: Array<{ id: string; state: string }> };
        const completed = raw.entries.some(
          (entry) => entry.id === input.operationId && entry.state === "completed",
        );
        const fault = completed ? state.completedFault : state.fault;
        if (completed) state.completedFault = "none";
        else state.fault = "none";
        if (fault === "before") return yield* new VaultError({ reason: "unavailable" });
        records.set(path, { value, version: version + 1 });
        if (fault === "after") return yield* new VaultError({ reason: "unavailable" });
        return version + 1;
      }),
  });
  const layer = Journal.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        backend,
        NodeCrypto.layer,
        Layer.succeed(ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make("library")),
        }),
      ),
    ),
  );
  const rebuild = Journal.AccountGitHubJournal.pipe(Effect.provide(Layer.fresh(layer)));
  const service = yield* rebuild;
  const operation = Effect.sync(() => {
    state.calls++;
    return result;
  });
  return { service, rebuild, state, operation };
});

it.effect("recovers a completed write after restart and refuses changed proposals or owners", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const first = yield* f.service.run(input, Effect.void, f.operation);
    expect(first).toEqual({ ...result, operationId: input.operationId });
    const restarted = yield* f.rebuild;
    expect(yield* restarted.run({ ...input, mode: "recover" }, Effect.void, f.operation)).toEqual(
      first,
    );
    expect(f.state.calls).toBe(1);
    expect(
      (yield* restarted
        .run(
          {
            ...input,
            proposal: { ...proposal, operation: { ...proposal.operation, body: "Changed" } },
          },
          Effect.void,
          f.operation,
        )
        .pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(
      (yield* restarted
        .run({ ...input, scope: { ...scope, threadId: "other-thread" } }, Effect.void, f.operation)
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(
      (yield* restarted
        .run(input, Effect.fail(new VaultError({ reason: "denied" })), f.operation)
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(f.state.calls).toBe(1);
  }),
);

it.effect.each(["before", "after"] as const)(
  "never executes after an uncertain reservation write: %s",
  (fault) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.fault = fault;
      expect(yield* f.service.run(input, Effect.void, f.operation).pipe(Effect.flip)).toMatchObject(
        { _tag: "VaultGitHubError", operationId: input.operationId },
      );
      expect(f.state.calls).toBe(0);
      expect(
        yield* f.service
          .run({ ...input, mode: "recover" }, Effect.void, f.operation)
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "VaultGitHubError", operationId: input.operationId });
      expect(f.state.calls).toBe(0);
    }),
);

it.effect.each(["before", "after"] as const)(
  "reconciles a lost completion write without repeating GitHub: %s",
  (fault) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.completedFault = fault;
      expect(yield* f.service.run(input, Effect.void, f.operation).pipe(Effect.flip)).toMatchObject(
        { _tag: "VaultGitHubError", operationId: input.operationId },
      );
      const recovered = yield* f.service
        .run({ ...input, mode: "recover" }, Effect.void, f.operation)
        .pipe(Effect.result);
      expect(recovered._tag).toBe(fault === "before" ? "Failure" : "Success");
      expect(f.state.calls).toBe(1);
    }),
);

it.effect("retains an unknown provider outcome and keeps expired recovery read-only", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const uncertain = f.operation.pipe(
      Effect.andThen(Effect.fail(new VaultGitHubError({ reason: "timeout" }))),
    );
    yield* f.service.run(input, Effect.void, uncertain).pipe(Effect.result);
    expect(
      (yield* f.service
        .run({ ...input, mode: "recover" }, Effect.void, f.operation)
        .pipe(Effect.flip)).reason,
    ).toBe("failed");
    yield* TestClock.adjust("2 days");
    expect(
      (yield* f.service
        .run({ ...input, mode: "recover" }, Effect.void, f.operation)
        .pipe(Effect.flip)).reason,
    ).toBe("receipt-unavailable");
    expect(f.state.calls).toBe(1);
  }),
);

it.effect(
  "allows only one concurrent execution and preserves a completed oversized-output receipt",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const operation = f.operation.pipe(
        Effect.tap(() => Deferred.succeed(started, undefined)),
        Effect.tap(() => Deferred.await(finish)),
      );
      const held = yield* f.service.run(input, Effect.void, operation).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      expect((yield* f.service.run(input, Effect.void, f.operation).pipe(Effect.flip)).reason).toBe(
        "failed",
      );
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(held);
      expect(f.state.calls).toBe(1);
      const large = { ...input, operationId: "b".repeat(32) };
      yield* f.service.run(
        large,
        Effect.void,
        Effect.succeed({ ...result, stdout: "x".repeat(4096) }),
      );
      expect(
        (yield* f.service
          .run({ ...large, mode: "recover" }, Effect.void, f.operation)
          .pipe(Effect.flip)).reason,
      ).toBe("receipt-only");
      expect(f.state.calls).toBe(1);
    }),
);
