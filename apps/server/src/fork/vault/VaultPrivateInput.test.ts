import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  SecretRef,
  ThreadId,
  SecretRequestError,
} from "@t3tools/contracts";
import { VaultError, type VaultPrivateSave, type VaultItemSummary } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { SecretRequests } from "../../secrets/SecretRequests.ts";
import { VaultAccess } from "./VaultAccess.ts";
import { VaultCore } from "./VaultCore.ts";
import * as VaultPrivateInput from "./VaultPrivateInput.ts";

const threadId = ThreadId.make("private-vault-thread");
const projectId = ProjectId.make("private-vault-project");
const request: VaultPrivateSave = {
  id: "a".repeat(32),
  operationId: "b".repeat(32),
  expectedVersion: 0,
  label: "Private development token",
  kind: "secret",
  secretRef: SecretRef.make("secret-ref:" + "c".repeat(32)),
};
const item: VaultItemSummary = {
  id: request.id,
  label: request.label,
  kind: request.kind,
  state: "active",
  version: 1,
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:00.000Z",
};
function withService<A, E>(
  use: (
    service: VaultPrivateInput.VaultPrivateInput["Service"],
    state: {
      transferred: number;
      committed: boolean;
      operationIds: string[];
      projects: ProjectId[];
    },
  ) => Effect.Effect<A, E>,
  options: { loseResponse?: boolean; missingThread?: boolean } = {},
) {
  const state = {
    transferred: 0,
    committed: false,
    operationIds: [] as string[],
    projects: [] as ProjectId[],
  };
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.mock(VaultAccess)({ require: () => Effect.void }),
    Layer.succeed(HostProcess.Environment, {}),
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("private-test")),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: () => Effect.succeed(options.missingThread ? null : ({ projectId } as never)),
    }),
    Layer.mock(VaultCore)({
      status: Effect.succeed({
        backend: "openbao",
        state: "ready",
        origin: "https://vault.example.test",
      }),
      savedPrivate: () => Effect.sync(() => (state.committed ? item : null)),
      save: (input, actor, authorize, ref) =>
        Effect.gen(function* () {
          expect(actor).toBe(`thread:${threadId}`);
          expect(Redacted.value(input.value!)).toBe("synthetic-private-input");
          expect(ref).toBe(request.secretRef);
          yield* authorize!;
          state.committed = true;
          return item;
        }),
    }),
    Layer.mock(SecretRequests)({
      transfer: (input, callback) =>
        Effect.gen(function* () {
          state.transferred++;
          state.operationIds.push(input.operationId);
          state.projects.push(input.projectId);
          if (state.transferred > 1)
            return yield* new SecretRequestError({ reason: "ref_unavailable" });
          const result = yield* callback("synthetic-private-input");
          if (options.loseResponse)
            return yield* new SecretRequestError({ reason: "consume_failed" });
          return result;
        }),
    }),
  );
  return Effect.gen(function* () {
    return yield* use(yield* VaultPrivateInput.VaultPrivateInput, state);
  }).pipe(Effect.provide(VaultPrivateInput.layer.pipe(Layer.provide(dependencies))));
}
it.effect("recovers a committed private save without consuming its one-use input again", () =>
  withService(
    (service, state) =>
      Effect.gen(function* () {
        expect(
          (yield* service.store(request, threadId, Effect.void).pipe(Effect.flip)).reason,
        ).toBe("consume_failed");
        expect(state.committed).toBe(true);
        expect(yield* service.store(request, threadId, Effect.void)).toEqual(item);
        expect(state.transferred).toBe(1);
        expect(state.projects).toEqual([projectId]);
        expect(state.operationIds[0]).toMatch(/^vault:[a-f0-9]{64}$/);
        expect(state.operationIds[0]).not.toContain(request.secretRef);
      }),
    { loseResponse: true },
  ),
);

it.effect("rechecks authorization before returning a committed receipt", () =>
  withService((service, state) =>
    Effect.gen(function* () {
      yield* service.store(request, threadId, Effect.void);
      const denied = yield* service
        .store(request, threadId, Effect.fail(new VaultError({ reason: "denied" })))
        .pipe(Effect.flip);
      expect(denied.reason).toBe("denied");
      expect(state.transferred).toBe(1);
    }),
  ),
);

it.effect("denies a missing thread before any private input is transferred", () =>
  withService(
    (service, state) =>
      Effect.gen(function* () {
        expect(
          (yield* service.store(request, threadId, Effect.void).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(state.transferred).toBe(0);
        expect(state.committed).toBe(false);
      }),
    { missingThread: true },
  ),
);

it.effect("rechecks a changed permission before committing the private value", () =>
  withService((service, state) =>
    Effect.gen(function* () {
      let checks = 0;
      const authorize = Effect.suspend(() =>
        ++checks === 1 ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
      );
      expect((yield* service.store(request, threadId, authorize).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect(state.committed).toBe(false);
    }),
  ),
);
