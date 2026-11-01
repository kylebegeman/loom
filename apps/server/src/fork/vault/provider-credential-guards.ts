import {
  ProviderSetupError,
  ServerSettingsError,
  TextGenerationError,
  type ProviderInstanceEnvironment,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { isVaultProviderReference, type VaultError } from "@t3tools/contracts/fork";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import {
  ProviderAdapterProtocolError,
  type ProviderAdapterV2Error,
  type ProviderAdapterV2SessionRuntime,
} from "@t3tools/provider-core/server/ProviderAdapter";
import { ProviderCredentialError, ProviderDriverError } from "@t3tools/provider-core/server/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/process";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { buildUnavailableProviderSnapshot } from "../../provider/unavailableProviderSnapshot.ts";

import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";

export const vaultProviderCredentialMessage = (error: VaultError) =>
  error.reason === "conflict"
    ? "This Vault credential changed. Choose the current Vault item version in this provider's settings."
    : error.reason === "denied" || error.reason === "not-found"
      ? "This Vault credential is no longer available to this provider. Check its binding, item state and protection in Vault settings."
      : error.message;

const vaultBindings = (environment: ProviderInstanceEnvironment) =>
  environment.flatMap((variable) =>
    typeof variable.value !== "string" && isVaultProviderReference(variable.value)
      ? [{ reference: variable.value, variableName: variable.name }]
      : [],
  );

export const withVaultProviderCredentialGuards = Effect.fn(
  "VaultProviderCredentials.guardDriverConstruction",
)(function* <A, E, R>(
  instanceId: ProviderInstanceId,
  environment: ProviderInstanceEnvironment,
  operation: Effect.Effect<A, E, R>,
) {
  const bindings = vaultBindings(environment);
  if (bindings.length === 0) return yield* operation;
  const credentials = yield* VaultProviderCredentials.VaultProviderCredentials;
  const validate = Effect.forEach(
    bindings,
    ({ reference, variableName }) => credentials.validate(reference, { instanceId, variableName }),
    { discard: true },
  );
  let guarded = operation;
  const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
  if (Option.isSome(spawner)) {
    const original = spawner.value;
    guarded = guarded.pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          validate.pipe(
            Effect.mapError((cause) =>
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "VaultProviderCredentials",
                method: "spawn",
                description: vaultProviderCredentialMessage(cause),
                cause,
              }),
            ),
            Effect.andThen(() => original.spawn(command)),
          ),
        ),
      ),
    );
  }
  const host = yield* Effect.serviceOption(ProviderHost.ProviderHost);
  if (Option.isSome(host)) {
    const original = host.value;
    guarded = guarded.pipe(
      Effect.provideService(ProviderHost.ProviderHost, {
        ...original,
        beforeCredentialUse: (original.beforeCredentialUse ?? Effect.void).pipe(
          Effect.andThen(
            validate.pipe(
              Effect.mapError((cause) => new ProviderCredentialError({ operation: "get", cause })),
            ),
          ),
        ),
      }),
    );
  }
  return yield* guarded;
});

export const guardVaultProviderCredentials = Effect.fn(
  "VaultProviderCredentials.guardProviderInstance",
)(function* (instance: ProviderInstance, environment: ProviderInstanceEnvironment) {
  const bindings = vaultBindings(environment);
  if (bindings.length === 0) return instance;
  const credentials = yield* VaultProviderCredentials.VaultProviderCredentials;
  const validate = Effect.forEach(
    bindings,
    ({ reference, variableName }) =>
      credentials.validate(reference, { instanceId: instance.instanceId, variableName }),
    { discard: true },
  );
  const authorizeAdapter = validate.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterProtocolError({
          driver: instance.driverKind,
          detail: vaultProviderCredentialMessage(cause),
          cause,
        }),
    ),
  );
  const guardAdapter =
    <Args extends ReadonlyArray<unknown>, A, E extends ProviderAdapterV2Error, R>(
      operation: (...args: Args) => Effect.Effect<A, E, R>,
    ) =>
    (...args: Args) =>
      authorizeAdapter.pipe(Effect.andThen(() => operation(...args)));
  const guardGeneration =
    <Args extends ReadonlyArray<unknown>, A>(
      operation: (...args: Args) => Effect.Effect<A, TextGenerationError>,
      name: string,
    ) =>
    (...args: Args) =>
      validate.pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: name,
              detail: vaultProviderCredentialMessage(cause),
              cause,
            }),
        ),
        Effect.andThen(() => operation(...args)),
      );
  const guardRuntime = (
    runtime: ProviderAdapterV2SessionRuntime,
  ): ProviderAdapterV2SessionRuntime => ({
    ...runtime,
    ensureThread: guardAdapter(runtime.ensureThread),
    resumeThread: guardAdapter(runtime.resumeThread),
    ...(runtime.injectHistory ? { injectHistory: guardAdapter(runtime.injectHistory) } : {}),
    startTurn: guardAdapter(runtime.startTurn),
    ...(runtime.compactThread ? { compactThread: guardAdapter(runtime.compactThread) } : {}),
    steerTurn: guardAdapter(runtime.steerTurn),
    respondToRuntimeRequest: guardAdapter(runtime.respondToRuntimeRequest),
    rollbackThread: guardAdapter(runtime.rollbackThread),
    forkThread: guardAdapter(runtime.forkThread),
    ...(runtime.uploadFeedback ? { uploadFeedback: guardAdapter(runtime.uploadFeedback) } : {}),
    ...(runtime.mcpApps
      ? {
          mcpApps: {
            listTools: guardAdapter(runtime.mcpApps.listTools),
            callTool: guardAdapter(runtime.mcpApps.callTool),
            readResource: guardAdapter(runtime.mcpApps.readResource),
          },
        }
      : {}),
  });
  const authorizeDriver = validate.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderDriverError({
          driver: instance.driverKind,
          instanceId: instance.instanceId,
          detail: vaultProviderCredentialMessage(cause),
          cause,
        }),
    ),
  );
  const guardDriver =
    <Args extends ReadonlyArray<unknown>, A>(
      operation: (...args: Args) => Effect.Effect<A, ProviderDriverError>,
    ) =>
    (...args: Args) =>
      authorizeDriver.pipe(Effect.andThen(() => operation(...args)));
  const authorizeAuth = validate.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderSetupError({
          instanceId: instance.instanceId,
          operation: "credential-use",
          detail: vaultProviderCredentialMessage(cause),
          cause,
        }),
    ),
  );
  const guardAuth =
    <Args extends ReadonlyArray<unknown>, A>(
      operation: (...args: Args) => Effect.Effect<A, ProviderSetupError>,
    ) =>
    (...args: Args) =>
      authorizeAuth.pipe(Effect.andThen(() => operation(...args)));
  const snapshot = instance.snapshot;
  const unavailable = (cause: VaultError) =>
    buildUnavailableProviderSnapshot({
      driverKind: instance.driverKind,
      instanceId: instance.instanceId,
      displayName: instance.displayName,
      accentColor: instance.accentColor,
      reason: vaultProviderCredentialMessage(cause),
    });
  const auth = instance.auth;
  const adapter = instance.orchestrationAdapter;
  const generation = instance.textGeneration;
  return {
    ...instance,
    snapshot: {
      ...snapshot,
      getSnapshot: validate.pipe(
        Effect.matchEffect({ onFailure: unavailable, onSuccess: () => snapshot.getSnapshot }),
      ),
      refresh: validate.pipe(
        Effect.matchEffect({ onFailure: unavailable, onSuccess: () => snapshot.refresh }),
      ),
      resolveMaintenance: (...args) =>
        validate.pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.succeed({ provider: instance.driverKind, packageName: null, update: null }),
            onSuccess: () => snapshot.resolveMaintenance(...args),
          }),
        ),
      ...(snapshot.refreshUsage
        ? {
            refreshUsage: validate.pipe(
              Effect.mapError(
                (cause) =>
                  new ServerSettingsError({
                    settingsPath: "<provider credential>",
                    operation: "read-file",
                    providerInstanceId: instance.instanceId,
                    cause,
                  }),
              ),
              Effect.andThen(snapshot.refreshUsage),
            ),
          }
        : {}),
    },
    ...(instance.snapshotForCwd ? { snapshotForCwd: guardDriver(instance.snapshotForCwd) } : {}),
    ...(instance.consumeResetCredit
      ? { consumeResetCredit: guardDriver(instance.consumeResetCredit) }
      : {}),
    ...(auth
      ? {
          auth: {
            ...auth,
            start: guardAuth(auth.start),
            complete: guardAuth(auth.complete),
            ...(auth.respond ? { respond: guardAuth(auth.respond) } : {}),
            ...(auth.reconnectProfile
              ? { reconnectProfile: guardAuth(auth.reconnectProfile) }
              : {}),
            ...(auth.importProfile ? { importProfile: guardAuth(auth.importProfile) } : {}),
            ...(auth.adoptCredentials
              ? { adoptCredentials: guardAuth(auth.adoptCredentials) }
              : {}),
            ...(auth.withAccess
              ? {
                  withAccess: <A, E, R>(task: Effect.Effect<A, E, R>) =>
                    authorizeAuth.pipe(Effect.andThen(() => auth.withAccess!(task))),
                }
              : {}),
            ...(auth.refreshMethods
              ? {
                  refreshMethods: validate.pipe(
                    Effect.matchEffect({
                      onFailure: () => Effect.void,
                      onSuccess: () => auth.refreshMethods!,
                    }),
                  ),
                }
              : {}),
          },
        }
      : {}),
    orchestrationAdapter: {
      ...adapter,
      openSession: (...args) =>
        guardAdapter(adapter.openSession)(...args).pipe(Effect.map(guardRuntime)),
    },
    textGeneration: {
      generateCommitMessage: guardGeneration(
        generation.generateCommitMessage,
        "generateCommitMessage",
      ),
      generatePrContent: guardGeneration(generation.generatePrContent, "generatePrContent"),
      generateBranchName: guardGeneration(generation.generateBranchName, "generateBranchName"),
      generateThreadTitle: guardGeneration(generation.generateThreadTitle, "generateThreadTitle"),
      generateReviewGuide: guardGeneration(generation.generateReviewGuide, "generateReviewGuide"),
    },
    ...(instance.refreshModels ? { refreshModels: guardDriver(instance.refreshModels) } : {}),
  } satisfies ProviderInstance;
});
