import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  type TextGenerationError,
  type ProviderSetupError,
  type ProviderAuthState,
  type ServerProvider,
  type ServerSettingsError,
} from "@t3tools/contracts";
import { VaultError, vaultProviderReference } from "@t3tools/contracts/fork";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import type {
  ProviderAdapterV2Error,
  ProviderAdapterV2SessionRuntime,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import type * as Scope from "effect/Scope";

import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";
import {
  guardVaultProviderCredentials,
  withVaultProviderCredentialGuards,
} from "./provider-credential-guards.ts";

const instanceId = ProviderInstanceId.make("api_key_provider");
const driverKind = ProviderDriverKind.make("fixture");
const reference = vaultProviderReference({
  environmentId: EnvironmentId.make("00000000-0000-4000-8000-000000000001"),
  itemId: "c".repeat(32),
  expectedVersion: 1,
});

function setup() {
  const calls: Array<string> = [];
  const consumers: Array<unknown> = [];
  let refusal: VaultError | undefined;
  const action = (name: string) =>
    Effect.sync(() => {
      calls.push(name);
    });
  const runtime = {
    instanceId,
    driver: driverKind,
    providerSessionId: ProviderSessionId.make("session"),
    providerSession: {} as ProviderAdapterV2SessionRuntime["providerSession"],
    events: Stream.empty,
    ensureThread: () => action("ensureThread").pipe(Effect.as({} as never)),
    resumeThread: () => action("resumeThread").pipe(Effect.as({} as never)),
    startTurn: () => action("startTurn"),
    compactThread: () => action("compactThread"),
    steerTurn: () => action("steerTurn"),
    interruptTurn: () => action("interruptTurn"),
    respondToRuntimeRequest: () => action("respondToRuntimeRequest"),
    readThreadSnapshot: () => Effect.die("Not used"),
    rollbackThread: () => action("rollbackThread").pipe(Effect.as({} as never)),
    forkThread: () => action("forkThread").pipe(Effect.as({} as never)),
  } satisfies ProviderAdapterV2SessionRuntime;
  const generation = (name: string) => () => action(name).pipe(Effect.as({} as never));
  const instance: ProviderInstance = {
    instanceId,
    driverKind,
    continuationIdentity: { driverKind, continuationKey: "fixture" },
    displayName: "Fixture",
    enabled: true,
    snapshot: {
      getSnapshot: action("getSnapshot").pipe(Effect.as({} as ServerProvider)),
      refresh: action("refresh").pipe(Effect.as({} as ServerProvider)),
      refreshUsage: action("refreshUsage"),
      resolveMaintenance: () =>
        action("resolveMaintenance").pipe(
          Effect.as({ provider: driverKind, packageName: null, update: null }),
        ),
      applyUsageLimits: () => Effect.void,
      streamChanges: Stream.empty,
    },
    snapshotForCwd: () => action("snapshotForCwd").pipe(Effect.as({} as never)),
    consumeResetCredit: () => action("consumeResetCredit").pipe(Effect.as({} as never)),
    auth: {
      start: () => action("auth.start").pipe(Effect.as({} as ProviderAuthState)),
      complete: () => action("auth.complete").pipe(Effect.as({} as ProviderAuthState)),
      respond: () => action("auth.respond").pipe(Effect.as({} as ProviderAuthState)),
      cancel: () => action("auth.cancel").pipe(Effect.as({} as ProviderAuthState)),
      logout: () => action("auth.logout").pipe(Effect.as({} as ProviderAuthState)),
      subscribe: () => Stream.empty,
    },
    orchestrationAdapter: {
      instanceId,
      driver: driverKind,
      getCapabilities: () => Effect.die("Not used"),
      planSelectionTransition: () => Effect.die("Not used"),
      openSession: () => action("openSession").pipe(Effect.as(runtime)),
    },
    textGeneration: {
      generateCommitMessage: generation("generateCommitMessage"),
      generatePrContent: generation("generatePrContent"),
      generateBranchName: generation("generateBranchName"),
      generateThreadTitle: generation("generateThreadTitle"),
      generateReviewGuide: generation("generateReviewGuide"),
    },
  };
  const credentials: VaultProviderCredentials.VaultProviderCredentials["Service"] = {
    read: () => Effect.die("Guard must not resolve a new credential"),
    validate: (_reference, consumer) =>
      Effect.suspend(() => {
        consumers.push(consumer);
        return refusal ? Effect.fail(refusal) : Effect.void;
      }),
  };
  const guarded = guardVaultProviderCredentials(instance, [
    { name: "OPENAI_API_KEY", value: reference, sensitive: true },
  ]).pipe(Effect.provideService(VaultProviderCredentials.VaultProviderCredentials, credentials));
  return {
    guarded,
    calls,
    consumers,
    credentials,
    refuse: (reason: VaultError["reason"]) => {
      refusal = new VaultError({ reason });
    },
  };
}

describe("Vault provider credential guards", () => {
  it.effect(
    "revalidates a process spawner captured during driver creation before later probes",
    () =>
      Effect.gen(function* () {
        const fixture = setup();
        let launches = 0;
        const original = ChildProcessSpawner.make(() =>
          Effect.sync(() => {
            launches++;
            return {} as ChildProcessSpawner.ChildProcessHandle;
          }),
        );
        const captured = yield* withVaultProviderCredentialGuards(
          instanceId,
          [{ name: "OPENAI_API_KEY", value: reference, sensitive: true }],
          Effect.service(ChildProcessSpawner.ChildProcessSpawner),
        ).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, original),
          Effect.provideService(
            VaultProviderCredentials.VaultProviderCredentials,
            fixture.credentials,
          ),
        );
        yield* captured.spawn(ChildProcess.make("fixture"));
        fixture.refuse("denied");
        const refused = yield* captured.spawn(ChildProcess.make("fixture")).pipe(Effect.result);
        expect(refused._tag).toBe("Failure");
        if (refused._tag === "Failure") expect(refused.failure.message).not.toContain("fixture");
        expect(launches).toBe(1);
      }).pipe(Effect.scoped),
  );

  it.effect.each(["denied", "not-found", "conflict"] as const)(
    "blocks new use of held adapters, sessions and generators after %s without blocking interruption",
    (reason) =>
      Effect.gen(function* () {
        const fixture = setup();
        const instance = yield* fixture.guarded;
        const runtime = yield* instance.orchestrationAdapter.openSession({} as never);
        yield* runtime.startTurn({} as never);
        yield* instance.textGeneration.generateThreadTitle({} as never);
        yield* instance.snapshot.refresh;
        yield* instance.snapshotForCwd!("/fixture");
        yield* instance.consumeResetCredit!();
        yield* instance.auth!.start("owner");
        const before = [...fixture.calls];
        fixture.refuse(reason);

        const attempts: ReadonlyArray<
          Effect.Effect<
            unknown,
            | ProviderAdapterV2Error
            | TextGenerationError
            | ProviderDriverError
            | ProviderSetupError
            | ServerSettingsError,
            Scope.Scope
          >
        > = [
          instance.orchestrationAdapter.openSession({} as never),
          runtime.ensureThread({} as never),
          runtime.resumeThread({} as never),
          runtime.startTurn({} as never),
          runtime.steerTurn({} as never),
          runtime.compactThread!({} as never),
          runtime.respondToRuntimeRequest({} as never),
          runtime.rollbackThread({} as never),
          runtime.forkThread({} as never),
          instance.textGeneration.generateCommitMessage({} as never),
          instance.textGeneration.generatePrContent({} as never),
          instance.textGeneration.generateBranchName({} as never),
          instance.textGeneration.generateThreadTitle({} as never),
          instance.textGeneration.generateReviewGuide({} as never),
          instance.snapshotForCwd!("/fixture"),
          instance.consumeResetCredit!(),
          instance.auth!.start("owner"),
          instance.auth!.complete("owner", { flowId: "flow", callbackUrl: "https://example.test" }),
          instance.auth!.respond!("owner", {} as never),
          instance.snapshot.refreshUsage!,
        ];
        for (const attempt of attempts) {
          expect((yield* Effect.result(attempt))._tag).toBe("Failure");
        }
        expect((yield* instance.snapshot.getSnapshot).availability).toBe("unavailable");
        expect((yield* instance.snapshot.refresh).availability).toBe("unavailable");
        expect((yield* instance.snapshot.resolveMaintenance()).update).toBeNull();
        expect(fixture.calls).toEqual(before);
        expect(fixture.consumers).toEqual(
          fixture.consumers.map(() => ({
            instanceId,
            variableName: "OPENAI_API_KEY",
          })),
        );
        yield* runtime.interruptTurn({} as never);
        yield* instance.auth!.cancel("owner", "flow");
        yield* instance.auth!.logout(Effect.void);
        expect(fixture.calls).toEqual([...before, "interruptTurn", "auth.cancel", "auth.logout"]);
      }).pipe(Effect.scoped),
  );
});
