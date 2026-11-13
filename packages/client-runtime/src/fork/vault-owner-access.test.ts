import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthEnvironmentMaintainScope,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { VAULT_ACCESS_WS_METHODS as V, type VaultPolicySnapshot } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry, EnvironmentNotRegisteredError } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { AVAILABLE_CONNECTION_STATE, BearerConnectionTarget } from "../connection/model.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createVaultAccessAtoms, vaultOwnerAccessSummary } from "./vault-access.ts";

describe("owner access status", () => {
  it("keeps absent legacy policy restricted", () => {
    expect(vaultOwnerAccessSummary(undefined)).toMatchObject({
      enabled: false,
      title: "Restricted access",
    });
    expect(vaultOwnerAccessSummary(null).description).toContain("Existing project grants");
  });

  it("requires a bound owner before reporting owner access", () => {
    expect(vaultOwnerAccessSummary({ mode: "owner-trusted", ownerId: null }).enabled).toBe(false);
    expect(
      vaultOwnerAccessSummary({ mode: "owner-trusted", ownerId: "owner-local" }),
    ).toMatchObject({
      enabled: true,
      actionLabel: "Use restricted access",
    });
  });

  it("retains owner identity when the environment returns to restricted access", () => {
    expect(vaultOwnerAccessSummary({ mode: "restricted", ownerId: "owner-local" })).toMatchObject({
      enabled: false,
      actionLabel: "Enable owner access",
    });
  });
});

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => sessionState }),
}));
const sessionState = Atom.make(
  AsyncResult.success({
    authenticated: true,
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    scopes: [AuthEnvironmentMaintainScope],
    permissions: [AuthEnvironmentMaintainScope],
  } satisfies AuthSessionState),
);

it.effect("a mode change refreshes other mounted policy views only in its destination", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const destination = EnvironmentId.make("owner-policy-refresh");
      const other = EnvironmentId.make("other-owner-policy");
      const policies = new Map<EnvironmentId, VaultPolicySnapshot>(
        [destination, other].map((environmentId) => [
          environmentId,
          {
            environmentId,
            revision: 0,
            grants: [],
            audit: [],
            omittedAuditEvents: 0,
            ownerPolicy: {
              environmentId,
              mode: "restricted",
              ownerId: null,
              revision: 0,
              updatedAt: null,
              updatedBy: null,
            },
          },
        ]),
      );
      const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();
      for (const environmentId of [destination, other]) {
        const session = {
          client: {
            [V.snapshot]: () => Effect.sync(() => policies.get(environmentId)!),
            [V.setOwnerPolicy]: () =>
              Effect.sync(() => {
                const current = policies.get(environmentId)!;
                const changed: VaultPolicySnapshot = {
                  ...current,
                  revision: current.revision + 1,
                  ownerPolicy: {
                    environmentId,
                    ownerId: "a".repeat(32),
                    mode: "owner-trusted",
                    revision: current.revision + 1,
                    updatedAt: 1,
                    updatedBy: "owner",
                  },
                };
                policies.set(environmentId, changed);
                return changed;
              }),
          },
        } as unknown as RpcSession;
        supervisors.set(environmentId, {
          target: new BearerConnectionTarget({
            environmentId,
            label: "Policy test",
            connectionId: "fixture",
          }),
          state: yield* SubscriptionRef.make({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
          session: yield* SubscriptionRef.make(Option.some(session)),
        } as EnvironmentSupervisor["Service"]);
      }
      const runtime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry, {
          run: (environmentId, effect) =>
            Effect.provideService(effect, EnvironmentSupervisor, supervisors.get(environmentId)!),
          followStream: (environmentId, stream) =>
            Stream.provideService(stream, EnvironmentSupervisor, supervisors.get(environmentId)!),
        } as EnvironmentRegistry["Service"]),
      );
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const settings = createVaultAccessAtoms(runtime);
      const connections = createVaultAccessAtoms(runtime);
      const views = [
        settings.snapshot({ environmentId: destination, input: {} }),
        connections.snapshot({ environmentId: destination, input: {} }),
        connections.snapshot({ environmentId: other, input: {} }),
      ];
      for (const view of views) {
        registry.mount(view);
        expect(
          (yield* AtomRegistry.getResult(registry, view, { suspendOnWaiting: true })).ownerPolicy
            ?.mode,
        ).toBe("restricted");
      }
      const changed = yield* Effect.promise(() =>
        settings.setOwnerPolicy.run(registry, {
          environmentId: destination,
          input: { operationId: "b".repeat(32), expectedRevision: 0, mode: "owner-trusted" },
        }),
      );
      expect(changed._tag).toBe("Success");
      for (const view of views.slice(0, 2))
        expect(
          (yield* AtomRegistry.getResult(registry, view, { suspendOnWaiting: true })).ownerPolicy
            ?.mode,
        ).toBe("owner-trusted");
      expect(
        (yield* AtomRegistry.getResult(registry, views[2]!, { suspendOnWaiting: true })).ownerPolicy
          ?.mode,
      ).toBe("restricted");
    }),
  ),
);

it.effect("routes an owner link through the reviewed computer and its signed-in Library", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const sourceId = EnvironmentId.make("owner-link-source");
      const libraryId = EnvironmentId.make("owner-link-library");
      const state = {
        libraryConnected: false,
        preparedSource: sourceId,
        revision: 1,
        applied: false,
      };
      const request = () => ({
        operationId: "a".repeat(32),
        expectedRevision: state.revision,
        ownerId: "b".repeat(32),
        inventoryEnvironmentId: sourceId,
        sourceEnvironmentId: state.preparedSource,
        libraryEnvironmentId: libraryId,
        authorityId: "authority",
        authorityEpoch: 1,
        keyFingerprint: "c".repeat(64),
      });
      const approved = { request: request(), token: "d".repeat(64), expiresAt: 300_000 };
      const snapshot = {
        environmentId: sourceId,
        revision: 2,
        grants: [],
        audit: [],
        omittedAuditEvents: 0,
      };
      const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();
      for (const environmentId of [sourceId, libraryId]) {
        const session = {
          client: {
            [V.ownerLinkPrepare]: () => Effect.sync(request),
            [V.ownerLinkApprove]: (input: unknown) =>
              Effect.sync(() => {
                expect(environmentId).toBe(libraryId);
                expect(input).toEqual(request());
                return approved;
              }),
            [V.ownerLinkApply]: (input: unknown) =>
              Effect.sync(() => {
                expect(environmentId).toBe(sourceId);
                expect(input).toEqual(approved);
                state.applied = true;
                return snapshot;
              }),
          },
        } as unknown as RpcSession;
        supervisors.set(environmentId, {
          target: new BearerConnectionTarget({
            environmentId,
            label: "Owner link",
            connectionId: "test",
          }),
          state: yield* SubscriptionRef.make({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
          session: yield* SubscriptionRef.make(Option.some(session)),
        } as EnvironmentSupervisor["Service"]);
      }
      const runtime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry, {
          run: (id, effect) =>
            id === libraryId && !state.libraryConnected
              ? Effect.fail(new EnvironmentNotRegisteredError({ environmentId: id }))
              : Effect.provideService(effect, EnvironmentSupervisor, supervisors.get(id)!),
        } as EnvironmentRegistry["Service"]),
      );
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const command = createVaultAccessAtoms(runtime).linkOwner;
      const target = {
        environmentId: sourceId,
        input: { operationId: "a".repeat(32), expectedRevision: 1, mode: "owner-trusted" as const },
      };
      const missing = yield* Effect.promise(() => command.run(registry, target));
      expect(missing._tag).toBe("Failure");
      if (missing._tag === "Failure")
        expect(Cause.squash(missing.cause)).toMatchObject({
          message: expect.stringMatching(/Sign in to your Library/),
        });
      expect(state.applied).toBe(false);
      state.libraryConnected = true;
      state.preparedSource = libraryId;
      expect((yield* Effect.promise(() => command.run(registry, target)))._tag).toBe("Failure");
      state.preparedSource = sourceId;
      state.revision = 2;
      expect((yield* Effect.promise(() => command.run(registry, target)))._tag).toBe("Failure");
      expect(state.applied).toBe(false);
      state.revision = 1;
      expect((yield* Effect.promise(() => command.run(registry, target)))._tag).toBe("Success");
      expect(state.applied).toBe(true);
    }),
  ),
);
