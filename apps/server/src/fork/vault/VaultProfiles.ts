import { vaultProfileFromRequirements } from "@t3tools/contracts/fork";
import type { ProjectId, ThreadId, RunId } from "@t3tools/contracts";
import {
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultProfile,
  VaultProfileMutation,
  VaultProfileDefinition,
  VaultProfileResolution,
  type VaultProfileSnapshot,
  type VaultProfilePreview,
  type VaultProfilePreviewInput,
  type VaultProfileBinding,
  vaultGitDestination,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultSsh from "./VaultSsh.ts";

type Failure = VaultError | VaultSshError | VaultWorkloadError;
export class VaultProfiles extends Context.Service<
  VaultProfiles,
  {
    readonly assertActive: (
      projectId: ProjectId,
      profileId: string,
    ) => Effect.Effect<void, VaultError>;
    readonly list: (projectId: ProjectId) => Effect.Effect<VaultProfileSnapshot, VaultError>;
    readonly listForThread: (threadId: ThreadId) => Effect.Effect<VaultProfileSnapshot, VaultError>;
    readonly apply: (
      input: VaultProfileMutation,
      actor: string,
      authorize?: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultProfileSnapshot, VaultError>;
    readonly preview: (
      input: VaultProfilePreviewInput,
    ) => Effect.Effect<VaultProfilePreview, Failure>;
    readonly prepare: (
      threadId: ThreadId,
      profileId: string,
      version: number,
      runId: RunId,
    ) => Effect.Effect<VaultProfileResolution, Failure>;
    readonly resolve: (
      threadId: ThreadId,
      profileId: string | null,
    ) => Effect.Effect<VaultProfileResolution, Failure>;
  }
>()("t3/fork/vault/VaultProfiles") {}
const Registry = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  activeProfileId: Schema.NullOr(Schema.String),
  profiles: Schema.Array(VaultProfile).check(Schema.isMaxLength(32)),
  receipts: Schema.Array(Schema.Struct({ id: Schema.String, fingerprint: Schema.String })).check(
    Schema.isMaxLength(32),
  ),
});
const Pin = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Schema.String,
  threadId: Schema.String,
  runId: Schema.String,
  resolution: VaultProfileResolution,
});
const isMutation = Schema.is(VaultProfileMutation),
  isDefinition = Schema.is(VaultProfileDefinition);
const decodeRegistry = Schema.decodeUnknownOption(Registry),
  encodeRegistry = Schema.encodeEffect(Registry);
const decodePin = Schema.decodeUnknownOption(Pin),
  encodePin = Schema.encodeEffect(Pin);
const encodeMutation = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ actor: Schema.String, input: VaultProfileMutation })),
);
const encodeRunKey = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ threadId: Schema.String, runId: Schema.NullOr(Schema.String) }),
  ),
);
const fail = (reason: VaultError["reason"]) => new VaultError({ reason });
const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore,
    access = yield* VaultAccess.VaultAccess,
    ssh = yield* VaultSsh.VaultSsh;
  const projects = yield* ProjectStoreV2,
    threads = yield* ThreadManagementService,
    identity = yield* ServerEnvironmentIdentity,
    crypto = yield* Crypto.Crypto;
  const environmentId = yield* identity.getEnvironmentId;
  const hash = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => fail("unavailable")),
    );
  const prefix = `environments/${yield* hash(environmentId)}/profiles`;
  const project = Effect.fnUntraced(function* (id: ProjectId) {
    const found = yield* projects.get(id).pipe(Effect.mapError(() => fail("unavailable")));
    if (Option.isNone(found)) return yield* fail("not-found");
    return `${prefix}/${yield* hash(id)}`;
  });
  const threadOf = Effect.fnUntraced(function* (id: ThreadId, requireRun = false) {
    const thread = yield* threads
      .getThreadShell(id)
      .pipe(Effect.mapError(() => fail("unavailable")));
    if (
      !thread ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      (requireRun &&
        (thread.status !== "running" ||
          !thread.activeRunId ||
          thread.runtimeMode !== "full-access" ||
          thread.interactionMode !== "default"))
    )
      return yield* fail("denied");
    return thread;
  });
  const load = Effect.fnUntraced(function* (projectId: ProjectId) {
    const root = yield* project(projectId),
      record = yield* store.read(root + "/registry");
    if (!record)
      return {
        root,
        revision: 0,
        value: {
          schemaVersion: 1 as const,
          activeProfileId: null,
          profiles: [],
          receipts: [],
        } as typeof Registry.Type,
      };
    const decoded = decodeRegistry(Redacted.value(record.value));
    if (Option.isNone(decoded)) return yield* fail("invalid-response");
    const value = decoded.value;
    if (
      new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length ||
      (value.activeProfileId &&
        !value.profiles.some((p) => p.id === value.activeProfileId && p.state === "active"))
    )
      return yield* fail("invalid-response");
    return { root, revision: record.version, value };
  });
  const snapshot = (
    projectId: ProjectId,
    registry: Effect.Success<ReturnType<typeof load>>,
  ): VaultProfileSnapshot => ({
    projectId,
    revision: registry.revision,
    activeProfileId: registry.value.activeProfileId,
    profiles: registry.value.profiles,
  });
  const list = Effect.fn("VaultProfiles.list")(function* (projectId: ProjectId) {
    return snapshot(projectId, yield* load(projectId));
  });
  const inspect = Effect.fnUntraced(function* (
    binding: VaultProfileBinding,
    threadId: ThreadId | null,
  ) {
    const base = {
      name: binding.name,
      itemId: binding.itemId,
      version: null as number | null,
      destination: null as string | null,
    };
    if (!binding.itemId || (binding.kind === "git" && !binding.repository))
      return { ...base, state: "missing" as const };
    const info = yield* ssh.info(binding.itemId).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        VaultError: (error) =>
          error.reason === "not-found" ? Effect.succeed(Option.none()) : Effect.fail(error),
        VaultSshError: (error) =>
          error.reason === "invalid-key" ? Effect.succeed(Option.none()) : Effect.fail(error),
      }),
    );
    if (Option.isNone(info) || info.value.item.state !== "active")
      return { ...base, state: "unavailable" as const };
    const destination =
      binding.kind === "git"
        ? vaultGitDestination(info.value.target, binding.repository!)
        : info.value.destination;
    const current = { ...base, version: info.value.item.version, destination };
    if (threadId) {
      const allowed = yield* access.require(threadId, binding.itemId, "use", destination).pipe(
        Effect.as(true),
        Effect.catchTags({
          VaultError: (error) =>
            error.reason === "denied" || error.reason === "not-found"
              ? Effect.succeed(false)
              : Effect.fail(error),
        }),
      );
      if (!allowed) return { ...base, state: "denied" as const };
    }
    if (!info.value.target.hostKey) return { ...current, state: "untrusted" as const };
    return { ...current, state: threadId ? ("ready" as const) : ("unchecked" as const) };
  });
  const preview = Effect.fn("VaultProfiles.preview")(function* (input: VaultProfilePreviewInput) {
    if (!isDefinition(input.profile)) return yield* fail("invalid-input");
    yield* project(input.projectId);
    if (input.threadId && (yield* threadOf(input.threadId)).projectId !== input.projectId)
      return yield* fail("denied");
    const bindings = yield* Effect.forEach(input.profile.bindings, (binding) =>
      inspect(binding, input.threadId),
    );
    return { ready: bindings.every((b) => b.state === "ready"), bindings };
  });
  const resolve = Effect.fn("VaultProfiles.resolve")(function* (
    threadId: ThreadId,
    requestedId: string | null,
    expectedVersion?: number,
    expectedRunId?: RunId,
  ) {
    const thread = yield* threadOf(threadId, true);
    if (expectedRunId && thread.activeRunId !== expectedRunId) return yield* fail("denied");
    const registry = yield* load(thread.projectId);
    const pinPath =
      registry.root +
      "/runs/" +
      (yield* hash(
        yield* encodeRunKey({ threadId, runId: thread.activeRunId }).pipe(
          Effect.mapError(() => fail("invalid-input")),
        ),
      ));
    const readPin = Effect.gen(function* () {
      const stored = yield* store.read(pinPath);
      if (!stored) return null;
      const decoded = decodePin(Redacted.value(stored.value));
      if (
        Option.isNone(decoded) ||
        decoded.value.environmentId !== environmentId ||
        decoded.value.threadId !== threadId ||
        decoded.value.runId !== thread.activeRunId ||
        decoded.value.resolution.projectId !== thread.projectId
      )
        return yield* fail("invalid-response");
      return decoded.value.resolution;
    });
    let resolution = yield* readPin;
    if (resolution && requestedId && requestedId !== resolution.profileId)
      return yield* fail("conflict");
    if (
      resolution &&
      expectedVersion !== undefined &&
      resolution.profileVersion !== expectedVersion
    )
      return yield* fail("conflict");
    if (!resolution) {
      const selected = registry.value.profiles.find(
        (p) => p.id === (requestedId ?? registry.value.activeProfileId) && p.state === "active",
      );
      if (!selected) return yield* fail("not-found");
      if (expectedVersion !== undefined && selected.version !== expectedVersion)
        return yield* fail("conflict");
      const checked = yield* preview({
        projectId: thread.projectId,
        profile: selected,
        threadId,
      });
      if (!checked.ready) return yield* fail("denied");
      const candidate: VaultProfileResolution = {
        projectId: thread.projectId,
        profileId: selected.id,
        label: selected.label,
        profileVersion: selected.version,
        bindings: selected.bindings.map((binding, i) => ({
          ...binding,
          itemId: binding.itemId!,
          version: checked.bindings[i]!.version!,
          destination: checked.bindings[i]!.destination!,
        })),
      };
      const encoded = yield* encodePin({
        schemaVersion: 1,
        environmentId,
        threadId,
        runId: thread.activeRunId!,
        resolution: candidate,
      }).pipe(Effect.mapError(() => fail("invalid-input")));
      yield* store.write(pinPath, Redacted.make(encoded), 0).pipe(
        Effect.catchTags({
          VaultError: (error) =>
            error.reason === "conflict" ? Effect.succeed(0) : Effect.fail(error),
        }),
      );
      resolution = yield* readPin;
      if (!resolution || (requestedId && resolution.profileId !== requestedId))
        return yield* fail("conflict");
    }
    const current = yield* load(thread.projectId);
    if (!current.value.profiles.some((p) => p.id === resolution.profileId && p.state === "active"))
      return yield* fail("denied");
    const latestThread = yield* threadOf(threadId, true);
    if (
      latestThread.activeRunId !== thread.activeRunId ||
      latestThread.projectId !== thread.projectId ||
      latestThread.providerInstanceId !== thread.providerInstanceId
    )
      return yield* fail("denied");
    for (const binding of resolution.bindings) {
      const current = yield* inspect(binding, threadId);
      if (current.state !== "ready") return yield* fail("denied");
      if (current.version !== binding.version || current.destination !== binding.destination)
        return yield* fail("conflict");
    }
    return resolution;
  });
  return VaultProfiles.of({
    assertActive: (projectId, profileId) =>
      load(projectId).pipe(
        Effect.flatMap((s) =>
          s.value.profiles.some((p) => p.id === profileId && p.state === "active")
            ? Effect.void
            : Effect.fail(fail("denied")),
        ),
      ),
    list,
    listForThread: Effect.fn("VaultProfiles.listForThread")(function* (id) {
      return yield* list((yield* threadOf(id)).projectId);
    }),
    preview,
    apply: Effect.fn("VaultProfiles.apply")(function* (input, actor, authorize = Effect.void) {
      if (!isMutation(input) || !actor.trim() || actor.length > 256)
        return yield* fail("invalid-input");
      yield* authorize;
      const loaded = yield* load(input.projectId),
        fingerprint = yield* hash(
          yield* encodeMutation({ actor, input }).pipe(
            Effect.mapError(() => fail("invalid-input")),
          ),
        );
      const receipt = loaded.value.receipts.find((r) => r.id === input.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) return yield* fail("conflict");
        return snapshot(input.projectId, loaded);
      }
      if (loaded.revision !== input.expectedRevision) return yield* fail("conflict");
      const profiles = [...loaded.value.profiles];
      let activeProfileId = loaded.value.activeProfileId;
      const requested = input.change;
      if (requested.type === "import" && profiles.some((p) => p.id === requested.id))
        return yield* fail("conflict");
      const change =
        input.change.type === "import"
          ? {
              type: "save" as const,
              profile: vaultProfileFromRequirements(input.change.declaration, input.change.id),
            }
          : input.change;
      if (change.type === "activate") {
        if (change.id && !profiles.some((p) => p.id === change.id && p.state === "active"))
          return yield* fail("not-found");
        activeProfileId = change.id;
      } else {
        const id = change.type === "save" ? change.profile.id : change.id,
          index = profiles.findIndex((p) => p.id === id),
          current = profiles[index];
        if (change.type === "save") {
          if (current?.state === "archived") return yield* fail("archived");
          const value = {
            ...change.profile,
            label: change.profile.label.trim(),
            version: (current?.version ?? 0) + 1,
            state: "active" as const,
          };
          if (index < 0) {
            if (profiles.length === 32) return yield* fail("invalid-input");
            profiles.push(value);
          } else profiles[index] = value;
        } else {
          if (!current) return yield* fail("not-found");
          profiles[index] = { ...current, state: change.state, version: current.version + 1 };
          if (change.state === "archived" && activeProfileId === id) activeProfileId = null;
        }
      }
      const value: typeof Registry.Type = {
        schemaVersion: 1,
        activeProfileId,
        profiles,
        receipts: [...loaded.value.receipts, { id: input.operationId, fingerprint }].slice(-32),
      };
      const encoded = yield* encodeRegistry(value).pipe(
        Effect.mapError(() => fail("invalid-input")),
      );
      yield* authorize;
      const revision = yield* store.write(
        loaded.root + "/registry",
        Redacted.make(encoded),
        loaded.revision,
      );
      return snapshot(input.projectId, { ...loaded, revision, value });
    }),
    resolve: (threadId, profileId) => resolve(threadId, profileId),
    prepare: (threadId, profileId, version, runId) => resolve(threadId, profileId, version, runId),
  });
});
export const layer = Layer.effect(VaultProfiles, make);
