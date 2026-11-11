import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
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
  LIBRARY_API_FEATURE,
  LIBRARY_SITES_FEATURE,
  type LibrarySitesMutation,
  type SitesError,
  LibraryError,
  type LibraryManagementInvocation,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { directoryPublicKeyFromPem } from "@t3tools/shared/fork/directory";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
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
import * as LibraryApis from "./LibraryApiWorkspaces.ts";
import * as ServerConfig from "../../config.ts";
import * as Management from "./LibraryManagement.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import * as Catalog from "./LibraryService.ts";
import * as Workflows from "./ProjectWorkflows.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import * as SitesService from "../sites/SitesService.ts";

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
  const sitesWrites = yield* Ref.make<LibrarySitesMutation[]>([]);
  const pauseSites = yield* Ref.make(false);
  const sitesEntered = yield* Deferred.make<void>();
  const sitesRelease = yield* Deferred.make<void>();
  const sitesSnapshot = {
    schemaVersion: 1 as const,
    primarySiteId: "example",
    observedAt: "2026-11-05T00:00:00Z",
    staleAfterSeconds: 900,
    sites: [],
    services: [],
    checks: [],
  };
  const siteWrite = (input: LibrarySitesMutation, authorize?: Effect.Effect<void, SitesError>) =>
    Effect.gen(function* () {
      if (yield* Ref.get(pauseSites)) {
        yield* Deferred.succeed(sitesEntered, undefined);
        yield* Deferred.await(sitesRelease);
      }
      yield* authorize ?? Effect.void;
      yield* Ref.update(sitesWrites, (writes) => [...writes, input]);
      return sitesSnapshot;
    });
  const workflows = yield* Workflows.ProjectWorkflows.pipe(
    Effect.provide(Workflows.layer),
    Effect.provideService(Catalog.LibraryService, catalog),
  );
  const apis = yield* LibraryApis.LibraryApiWorkspaces.pipe(
    Effect.provide(LibraryApis.layer),
    Effect.provideService(Catalog.LibraryService, catalog),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(LibraryApis.LibraryApiWorkspaces, apis),
    Layer.succeed(Workflows.ProjectWorkflows, workflows),
    Layer.succeed(Catalog.LibraryService, catalog),
    Layer.mock(LibraryPublisher)({
      enabled: true,
      info: catalog.info.pipe(
        Effect.flatMap((info) =>
          Ref.get(supported).pipe(
            Effect.map((value) => ({
              ...info,
              features: value
                ? [LIBRARY_MANAGEMENT_FEATURE, LIBRARY_API_FEATURE, LIBRARY_SITES_FEATURE]
                : [],
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
        Layer.provide(
          Layer.mock(SitesService.SitesService)({
            saveSite: (input, check) => siteWrite({ action: "saveSite", input }, check),
            saveService: (input, check) => siteWrite({ action: "saveService", input }, check),
            saveCheck: (input, check) => siteWrite({ action: "saveCheck", input }, check),
            runChecks: (check, input) =>
              siteWrite({ action: "runChecks", ...(input ? { input } : {}) }, check),
          }),
        ),
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
                  {
                    reason: result.failure.reason,
                    detail: result.failure.detail,
                    ...(result.failure.accessRepair
                      ? { accessRepair: result.failure.accessRepair }
                      : {}),
                  },
                  { status: 409 },
                ),
          );
        }),
    });
    const manager = yield* Management.LibraryManagement.pipe(
      Effect.provide(
        Management.layer.pipe(
          Layer.provide(dependencies),
          Layer.provide(Layer.mock(SitesService.SitesService)({})),
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
    sitesWrites,
    pauseSites,
    sitesEntered,
    sitesRelease,
    sitesSnapshot,
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
  }).pipe(
    Effect.provide(
      layerMemory.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "library-api-management-" }).pipe(
            Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
          ),
        ),
      ),
    ),
    Effect.scoped,
  );

describe("authority-routed project management", () => {
  it.effect(
    "routes Sites writes through the enrolled Library and rechecks its owner before dispatch",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const input = {
            action: "saveSite" as const,
            input: {
              requestId: "sites-intent",
              expectedEtag: '"base"',
              id: "example",
              name: "Example",
              url: "https://example.test",
              active: false,
              origins: ["https://example.test"],
              serviceIds: [],
              projectIds: [f.project.id],
            },
          };
          expect(
            yield* f.first.manager.sitesAgent(input, {
              threadId,
              providerInstanceId: f.actor.providerInstanceId,
            }),
          ).toEqual(f.sitesSnapshot);
          yield* f.first.manager.sites(
            {
              action: "saveService",
              input: {
                id: "worker",
                name: "Worker",
                url: "https://example.test",
                active: false,
                kind: "website",
              },
            },
            f.actor,
          );
          yield* f.first.manager.sites(
            {
              action: "saveCheck",
              input: {
                id: "health",
                name: "Health",
                url: "https://example.test/health",
                active: false,
                service_id: "worker",
                expected_status: 200,
                content: "",
              },
            },
            f.actor,
          );
          yield* f.first.manager.sites(
            { action: "runChecks", input: { requestId: "run-checks" } },
            f.actor,
          );
          expect((yield* Ref.get(f.sitesWrites)).map((write) => write.action)).toEqual([
            "saveSite",
            "saveService",
            "saveCheck",
            "runChecks",
          ]);
          expect((yield* Ref.get(f.sitesWrites))[3]).toEqual({
            action: "runChecks",
            input: { requestId: "run-checks" },
          });
          expect((yield* Ref.get(f.sent))[0]?.request).toEqual({ kind: "sites", input });
          yield* Ref.set(f.pauseSites, true);
          const pending = yield* f.first.manager.sites(input, f.actor).pipe(Effect.forkChild);
          yield* Deferred.await(f.sitesEntered);
          yield* Ref.set(f.active, []);
          yield* Deferred.succeed(f.sitesRelease, undefined);
          expect((yield* Fiber.join(pending).pipe(Effect.flip)).reason).toBe("blocked");
          expect(yield* Ref.get(f.sitesWrites)).toHaveLength(4);
        }),
      ),
  );

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
          const sharedInput = {
            projectId: f.project.id,
            action: "save" as const,
            requestId: "share-api",
            expectedRevision: 0,
            bundle: {
              id: "a".repeat(24),
              name: "API",
              folders: [],
              workflows: [
                {
                  id: "auth",
                  name: "Auth",
                  failurePolicy: "stop" as const,
                  steps: [],
                  datasets: [
                    {
                      Authorization: "private-dataset-authorization",
                      Cookie: "private-dataset-cookie",
                      name: "fixture",
                    },
                  ],
                },
              ],
              files: [
                { name: "api.json", content: '[{"v":12,"name":"API","folders":[],"requests":[]}]' },
                {
                  name: "local.json",
                  content:
                    '{"v":2,"name":"Local","variables":[{"key":"token","secret":true,"currentValue":"synthetic-private-value"}]}',
                },
              ],
            },
          };
          yield* Ref.set(f.lostReply, true);
          expect(
            (yield* f.first.manager.apiWorkspace(sharedInput, f.actor).pipe(Effect.flip)).reason,
          ).toBe("io");
          yield* Ref.set(f.lostReply, false);
          const shared = yield* second.manager.apiWorkspace(sharedInput, f.actor);
          expect(shared.revision).toBe(1);
          expect(JSON.stringify(shared)).not.toContain("synthetic-private-value");
          expect(JSON.stringify(shared)).not.toContain("private-dataset-");
          expect(
            yield* f.first.manager.apiWorkspace(
              { projectId: f.project.id, action: "read", workspaceId: "a".repeat(24) },
              f.actor,
            ),
          ).toEqual(shared);
          expect(
            (yield* second.manager
              .apiWorkspace({ ...sharedInput, requestId: "stale-api" }, f.actor)
              .pipe(Effect.flip)).reason,
          ).toBe("revision-conflict");
          const sharedNext = yield* second.manager.apiWorkspace(
            {
              ...sharedInput,
              requestId: "share-api-next",
              expectedRevision: 1,
              bundle: { ...sharedInput.bundle, name: "Updated" },
            },
            f.actor,
          );
          expect(sharedNext.revision).toBe(2);
          expect(yield* f.first.manager.apiWorkspace(sharedInput, f.actor)).toEqual(shared);
          for (let revision = 2; revision < 24; revision++)
            yield* second.manager.apiWorkspace(
              {
                ...sharedInput,
                requestId: `revision-${revision}`,
                expectedRevision: revision,
                bundle: { ...sharedInput.bundle, name: `Revision ${revision}` },
              },
              f.actor,
            );
          const sql = yield* SqlClient.SqlClient;
          expect(
            yield* sql`SELECT digest FROM fork_library_api_bundles WHERE project_id=${f.project.id}`,
          ).toHaveLength(20);
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
          yield* f.catalog.archiveProject({
            projectId: f.project.id,
            requestId: "archive-with-api",
            expectedRevision: applied.revision,
            archived: true,
          });
          expect(
            (yield* second.manager.apiWorkspace(
              { projectId: f.project.id, action: "read", workspaceId: sharedInput.bundle.id },
              f.actor,
            )).selected?.name,
          ).toBe("Revision 23");
          const recovered = yield* second.manager.apiWorkspace(
            {
              ...sharedInput,
              requestId: "revision-23",
              expectedRevision: 23,
              bundle: { ...sharedInput.bundle, name: "Revision 23" },
            },
            f.actor,
          );
          expect(recovered.revision).toBe(24);
          expect(recovered.selected?.name).toBe("Revision 23");
          expect(
            (yield* second.manager
              .apiWorkspace(
                { ...sharedInput, requestId: "archived-write", expectedRevision: 24 },
                f.actor,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
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
          const denied = yield* f.receiver
            .issue(
              { environmentId: source, keyFingerprint: f.first.delegation.keyFingerprint },
              publisher,
            )
            .pipe(Effect.flip);
          expect(denied.reason).toBe("blocked");
          expect(denied.accessRepair?.kind).toBe("permission");
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
          const expired = yield* f.receiver.accept(signed, source).pipe(Effect.flip);
          expect(expired.message).toContain("expired or been revoked");
          expect(expired.accessRepair).toEqual({ kind: "sign-in", environmentId: authority });
          const remote = yield* f.first.manager.execute(f.request, f.actor).pipe(Effect.flip);
          expect(remote.accessRepair).toEqual(expired.accessRepair);
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
          expect(
            (yield* f.first.manager
              .execute({ ...f.request, input: { ...f.request.input, dependencies: [] } }, f.actor)
              .pipe(Effect.flip)).message,
          ).toContain("project dependencies");
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
