import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@t3tools/contracts";
import {
  VAULT_ACCESS_WS_METHODS as V,
  VaultError,
  type VaultApprovalCardData,
  type VaultApprovalChange,
  type VaultApprovalInbox,
  type VaultApprovalRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createVaultAccessAtoms } from "./vault-access.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => sessionState }),
}));
const sessionState = Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(
  AsyncResult.success({
    authenticated: true,
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    permissions: [AuthAccessWriteScope],
    scopes: [AuthAccessWriteScope],
  } satisfies AuthSessionState),
);

it.effect.each(["success", "conflict"] as const)(
  "uses a fresh policy for a card decision and handles %s without retrying the write",
  (outcome) =>
    Effect.scoped(
      Effect.gen(function* () {
        const environmentId = EnvironmentId.make("card-decision");
        const request: VaultApprovalRequest = {
          id: "a".repeat(32),
          threadId: ThreadId.make("thread"),
          itemId: "b".repeat(32),
          action: "manage",
          destination: null,
          projectId: "project",
          itemVersion: 1,
          policyRevision: 8,
          revision: 1,
          requestedBy: "thread:thread",
          requestedAt: 0,
          requestExpiresAt: 600000,
          state: "pending",
          decidedBy: null,
          approvedUntil: null,
          grantId: null,
        };
        const card: VaultApprovalCardData = {
          type: "vault_access_request",
          requestId: request.id,
          itemLabel: "Synthetic key",
          itemKind: "secret",
          revision: 1,
          action: request.action,
          destination: null,
          state: "pending",
          requestExpiresAt: 600000,
          approvedUntil: null,
        };
        let inbox: VaultApprovalInbox = {
          policyRevision: 8,
          requests: [request],
          notifications: "stubbed",
          reviewContext: [
            {
              requestId: request.id,
              itemLabel: card.itemLabel,
              threadTitle: "Thread",
              projectTitle: "Project",
              state: "current",
            },
          ],
        };
        const writes: VaultApprovalChange[] = [];
        const session = {
          client: {
            [V.approvalInbox]: () => Effect.sync(() => inbox),
            [V.approvalChange]: (input: VaultApprovalChange) =>
              Effect.suspend(() => {
                writes.push(input);
                const decided: VaultApprovalRequest = {
                  ...request,
                  revision: 2,
                  decidedBy: "owner",
                  state: outcome === "success" ? "approved" : "denied",
                  approvedUntil: outcome === "success" ? 300000 : null,
                  grantId: outcome === "success" ? request.id : null,
                };
                inbox = { ...inbox, policyRevision: 10, requests: [decided] };
                return outcome === "conflict"
                  ? Effect.fail(new VaultError({ reason: "conflict" }))
                  : Effect.succeed(decided);
              }),
          },
        } as unknown as RpcSession;
        const supervisor = {
          target: { environmentId, label: "Card test" },
          state: yield* SubscriptionRef.make({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
          session: yield* SubscriptionRef.make(Option.some(session)),
        } as EnvironmentSupervisor["Service"];
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry, {
            run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
            followStream: (_id, stream) =>
              Stream.provideService(stream, EnvironmentSupervisor, supervisor),
          } as EnvironmentRegistry["Service"]),
        );
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const access = createVaultAccessAtoms(runtime);
        const query = access.approvalInbox({ environmentId, input: {} });
        registry.mount(query);
        expect(
          (yield* AtomRegistry.getResult(registry, query, { suspendOnWaiting: true }))
            .policyRevision,
        ).toBe(8);
        inbox = { ...inbox, policyRevision: 9 };
        if (outcome === "success") {
          const original = registry.get(sessionState);
          if (original._tag !== "Success") return yield* Effect.die("Missing test session");
          registry.set(
            sessionState,
            AsyncResult.success({
              ...original.value,
              permissions: [AuthAccessReadScope],
              scopes: [AuthAccessReadScope],
            }),
          );
          const refused = yield* Effect.promise(() =>
            access.approvalCardChange.run(registry, {
              environmentId,
              input: { card, decision: "approve", durationMs: 300000, operationId: "d".repeat(32) },
            }),
          );
          expect(refused._tag).toBe("Failure");
          expect(writes).toEqual([]);
          registry.set(sessionState, original);
        }
        const result = yield* Effect.promise(() =>
          access.approvalCardChange.run(registry, {
            environmentId,
            input: { card, decision: "approve", durationMs: 300000, operationId: "c".repeat(32) },
          }),
        );
        expect(writes).toEqual([
          {
            id: request.id,
            operationId: "c".repeat(32),
            expectedRevision: 1,
            expectedPolicyRevision: 9,
            decision: "approve",
            durationMs: 300000,
          },
        ]);
        expect(result._tag).toBe("Success");
        if (result._tag === "Success") {
          expect(result.value.card).toMatchObject({
            revision: 2,
            state: outcome === "success" ? "approved" : "denied",
          });
          expect(result.value.message === null).toBe(outcome === "success");
        }
      }),
    ),
);
