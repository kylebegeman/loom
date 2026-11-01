import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  EnvironmentId,
  authScopeResponse,
  type AuthClientSession,
} from "@t3tools/contracts";
import {
  LIBRARY_MANAGEMENT_FEATURE,
  LibraryError,
  type LibraryManagementInvocation,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { directoryPublicKeyFromPem } from "@t3tools/shared/fork/directory";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { HttpClientResponse } from "effect/http";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { DirectoryService, type DirectoryPin } from "../directory/DirectoryService.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { vaultRun } from "../vault/VaultActiveRun.testkit.ts";
import { resource, source, threadId } from "./Library.testkit.ts";
import { LibraryAssetService } from "./assets/LibraryAssetService.ts";
import { LibraryConnectionService } from "./LibraryConnection.ts";
import * as Management from "./LibraryManagement.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import * as Catalog from "./LibraryService.ts";
import * as Workflows from "./ProjectWorkflows.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const authority = EnvironmentId.make("library");
const memorySecrets = () => {
  const values = new Map<string, Uint8Array>();
  return Layer.mock(ServerSecretStore)({
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(values.get(name))),
    set: (name, value) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
    create: (name, value) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
  });
};
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const catalog = yield* Catalog.LibraryService.pipe(
    Effect.provide(
      Catalog.layer.pipe(
        Layer.provide(Layer.mock(LibraryAssetService)({ mode: "local" })),
        Layer.provide(
          Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(authority) }),
        ),
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
        ),
      ),
    ),
  );
  const project = yield* catalog.createProject({
    requestId: "create",
    title: "Example",
    resources: [resource],
  });
  const owner: AuthClientSession = {
    sessionId: AuthSessionId.make("owner-session"),
    subject: "owner",
    ...authScopeResponse([AuthSettingsWriteScope]),
    method: "bearer-access-token",
    client: { deviceType: "desktop" },
    issuedAt: yield* DateTime.now,
    expiresAt: DateTime.makeUnsafe(
      (yield* DateTime.now).epochMilliseconds + 30 * 24 * 60 * 60 * 1000,
    ),
    lastConnectedAt: null,
    connected: true,
    current: true,
  };
  const active = yield* Ref.make<readonly AuthClientSession[]>([owner]);
  const successors = yield* Ref.make(new Set([owner.sessionId]));
  const pins = yield* Ref.make<ReadonlyMap<EnvironmentId, DirectoryPin>>(new Map());
  const thread = yield* Ref.make(liveThreadShell(threadId));
  const supported = yield* Ref.make(true);
  const sent = yield* Ref.make<LibraryManagementInvocation[]>([]);
  const lostReply = yield* Ref.make(false);
  const workflows = yield* Workflows.ProjectWorkflows.pipe(
    Effect.provide(Workflows.layer),
    Effect.provideService(Catalog.LibraryService, catalog),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(Workflows.ProjectWorkflows, workflows),
    Layer.succeed(Catalog.LibraryService, catalog),
    Layer.mock(LibraryPublisher)({
      enabled: true,
      info: catalog.info.pipe(
        Effect.flatMap((info) =>
          Ref.get(supported).pipe(
            Effect.map((value) => ({
              ...info,
              features: value ? [LIBRARY_MANAGEMENT_FEATURE] : [],
            })),
          ),
        ),
      ),
    }),
    Layer.mock(SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      listActive: () => Ref.get(active),
      renewalsOf: () => Ref.get(successors),
    }),
    Layer.mock(DirectoryService)({
      pinned: (id) => Ref.get(pins).pipe(Effect.map((values) => values.get(id) ?? null)),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: () => Ref.get(thread),
      getThreadRecords: () =>
        Ref.get(thread).pipe(
          Effect.map((shell) => ({
            ...idleThreadProjection(shell),
            runs: [vaultRun(shell, { status: "running" })],
          })),
        ),
    }),
    Layer.succeed(HostProcess.Environment, {}),
  );
  const receiver = yield* Management.LibraryManagement.pipe(
    Effect.provide(
      Management.layer.pipe(
        Layer.provide(dependencies),
        Layer.provide(memorySecrets()),
        Layer.provide(
          Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(authority) }),
        ),
        Layer.provide(
          Layer.mock(LibraryConnectionService)({ current: Effect.succeed({ kind: "authority" }) }),
        ),
      ),
    ),
  );
  const computer = Effect.fn("test.computer")(function* (environmentId: EnvironmentId) {
    const secretLayer = memorySecrets();
    const secrets = yield* ServerSecretStore.pipe(Effect.provide(secretLayer));
    const keys = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
    const connection = Layer.mock(LibraryConnectionService)({
      current: Effect.succeed({
        kind: "remote",
        origin: "https://library.test",
        credential: null,
        endpoint: (path) => `https://library.test${path}`,
        send: () => Effect.die("Use the managed connection"),
      }),
      send: (request) =>
        Effect.gen(function* () {
          if (request.body._tag !== "Uint8Array") throw new Error("Expected a JSON request");
          const input = JSON.parse(
            new TextDecoder().decode(request.body.body),
          ) as LibraryManagementInvocation;
          yield* Ref.update(sent, (items) => [...items, input]);
          const result = yield* receiver.accept(input, environmentId).pipe(Effect.result);
          if (yield* Ref.get(lostReply)) return yield* new LibraryError({ reason: "io" });
          return HttpClientResponse.fromWeb(
            request,
            result._tag === "Success"
              ? Response.json(result.success)
              : Response.json(
                  { reason: result.failure.reason, detail: result.failure.detail },
                  { status: 409 },
                ),
          );
        }),
    });
    const manager = yield* Management.LibraryManagement.pipe(
      Effect.provide(
        Management.layer.pipe(
          Layer.provide(dependencies),
          Layer.provide(Layer.succeed(ServerSecretStore, secrets)),
          Layer.provide(connection),
          Layer.provide(
            Layer.succeed(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(environmentId),
            }),
          ),
        ),
      ),
    );
    const status = yield* manager.status;
    const pin = {
      publicKey: directoryPublicKeyFromPem(keys.publicKey)!,
      keyFingerprint: status.keyFingerprint,
      label: "Computer",
    };
    yield* Ref.update(pins, (values) => new Map(values).set(environmentId, pin));
    const delegation = yield* receiver.issue(
      { environmentId, keyFingerprint: pin.keyFingerprint },
      { ...owner, method: "bearer-access-token", scopes: [AuthSettingsWriteScope] },
    );
    yield* manager.install(delegation);
    return { manager, delegation };
  });
  const first = yield* computer(source);
  const actor = {
    kind: "agent" as const,
    threadId,
    providerInstanceId: (yield* Ref.get(thread)).providerInstanceId,
    runId: (yield* Ref.get(thread)).activeRunId!,
  };
  const request = {
    kind: "update" as const,
    input: {
      requestId: "edit-branch",
      projectId: project.id,
      expectedRevision: project.revision,
      resourceUpdates: [{ id: resource.id, defaultBranch: "next" }],
    },
  };
  return {
    catalog,
    workflows,
    project,
    owner,
    active,
    successors,
    pins,
    thread,
    supported,
    sent,
    lostReply,
    receiver,
    computer,
    first,
    actor,
    request,
  };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

describe("authority-routed project management", () => {
  it.effect(
    "finishes a narrow edit across two enrolled computers and safely replays a lost response",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* Ref.set(f.lostReply, true);
          expect(
            (yield* f.first.manager.execute(f.request, f.actor).pipe(Effect.flip)).reason,
          ).toBe("io");
          yield* Ref.set(f.lostReply, false);
          const result = yield* f.first.manager.execute(f.request, f.actor);
          expect(result.revision).toBe(2);
          expect(result.resources[0]?.defaultBranch).toBe("next");
          const second = yield* f.computer(EnvironmentId.make("second-computer"));
          const followed = yield* second.manager.execute(
            {
              kind: "update",
              input: {
                ...f.request.input,
                requestId: "follow-remote",
                expectedRevision: result.revision,
                resourceUpdates: [{ id: resource.id, defaultBranch: null }],
              },
            },
            f.actor,
          );
          expect(followed.revision).toBe(3);
          expect(
            (yield* f.catalog.project({ projectId: f.project.id })).resources[0]?.defaultBranch,
          ).toBeNull();
          const streamInput = {
            requestId: "workstream",
            id: "release",
            projectId: f.project.id,
            expectedRevision: 0,
            title: "Ship release",
            goal: "Finish shared work",
            state: "active" as const,
            references: [],
          };
          const stream = yield* f.first.manager.saveWorkstream(streamInput, f.actor);
          expect(stream.revision).toBe(1);
          expect(yield* second.manager.saveWorkstream(streamInput, f.actor)).toEqual(stream);
          expect(
            (yield* f.first.manager
              .saveWorkstream({ ...streamInput, requestId: "stale-stream" }, f.actor)
              .pipe(Effect.flip)).reason,
          ).toBe("revision-conflict");
          const blueprint = yield* f.workflows.blueprint({ projectId: f.project.id });
          const applied = yield* second.manager.execute(
            {
              kind: "apply-blueprint",
              input: {
                requestId: "blueprint",
                projectId: f.project.id,
                expectedRevision: followed.revision,
                blueprint: { ...blueprint, brief: "Shared setup" },
              },
            },
            f.actor,
          );
          expect(applied.brief).toBe("Shared setup");
          expect((yield* f.catalog.project({ projectId: f.project.id })).brief).toBe(
            "Shared setup",
          );
        }),
      ),
  );
  it.effect(
    "rejects publisher credentials, changed requests, other computers and revoked management sessions",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const publisher = {
            ...f.owner,
            subject: `loom-host:${source}`,
            scopes: [AuthLibraryPublishScope, AuthSettingsWriteScope],
          };
          yield* Ref.set(f.active, [publisher]);
          expect(
            (yield* f.receiver
              .issue(
                { environmentId: source, keyFingerprint: f.first.delegation.keyFingerprint },
                publisher,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
          yield* Ref.set(f.active, [f.owner]);
          yield* f.first.manager.execute(f.request, f.actor);
          const signed = (yield* Ref.get(f.sent))[0]!;
          expect(
            (yield* f.receiver
              .accept(
                {
                  ...signed,
                  request: {
                    ...f.request,
                    input: { ...f.request.input, requestId: "tampered", title: "Other" },
                  },
                },
                source,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
          expect(
            (yield* f.receiver.accept(signed, EnvironmentId.make("other")).pipe(Effect.flip))
              .reason,
          ).toBe("blocked");
          yield* Ref.set(f.active, [{ ...f.owner, expiresAt: DateTime.makeUnsafe(0) }]);
          expect((yield* f.receiver.accept(signed, source).pipe(Effect.flip)).message).toContain(
            "expired or been revoked",
          );
          yield* Ref.set(f.active, []);
          expect((yield* f.receiver.accept(signed, source).pipe(Effect.flip)).message).toContain(
            "expired or been revoked",
          );
          expect((yield* f.catalog.project({ projectId: f.project.id })).title).toBe(
            f.project.title,
          );
        }),
      ),
  );
  it.effect(
    "follows a renewed owner session but refuses changed machine keys and stale proofs",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const renewed = { ...f.owner, sessionId: AuthSessionId.make("renewed") };
          yield* Ref.set(f.active, [renewed]);
          yield* Ref.set(f.successors, new Set([f.owner.sessionId, renewed.sessionId]));
          yield* f.first.manager.execute(f.request, f.actor);
          const signed = (yield* Ref.get(f.sent))[0]!;
          yield* TestClock.adjust("31 seconds");
          expect((yield* f.receiver.accept(signed, source).pipe(Effect.flip)).reason).toBe(
            "blocked",
          );
          yield* Ref.set(f.pins, new Map());
          expect(
            (yield* f.first.manager.execute(f.request, f.actor).pipe(Effect.flip)).message,
          ).toContain("signing key");
        }),
      ),
  );
  it.effect(
    "checks the current agent turn and reports unsupported Libraries without sending a mutation",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* Ref.set(f.supported, false);
          expect(
            (yield* f.first.manager.execute(f.request, f.actor).pipe(Effect.flip)).message,
          ).toContain("Library version");
          yield* Ref.set(f.supported, true);
          yield* Ref.update(f.thread, (thread) => ({
            ...thread,
            interactionMode: "plan" as const,
          }));
          expect(
            (yield* f.first.manager.execute(f.request, f.actor).pipe(Effect.flip)).message,
          ).toContain("full-access/default");
          yield* Ref.update(f.thread, (thread) => ({
            ...thread,
            interactionMode: "default" as const,
            activeRunId: null,
          }));
          expect(
            (yield* f.first.manager.execute(f.request, f.actor).pipe(Effect.flip)).message,
          ).toContain("ended or changed");
          expect(yield* Ref.get(f.sent)).toEqual([]);
        }),
      ),
  );
});
