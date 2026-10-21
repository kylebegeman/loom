import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import {
  AuthLibraryPublishScope,
  AuthLibraryRecoveryReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { FetchHttpClient, HttpClient, HttpRouter } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import * as Recovery from "./assets/LibraryRecoveryStore.ts";
import { LibraryAssetMigrations } from "./assets/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import * as LibraryService from "./LibraryService.ts";
import * as Publisher from "./LibraryRecoveryPublisher.ts";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { LibraryRecoveryHttpRoutes } from "./assets/recoveryHttp.ts";
import { copyFor, source } from "./Library.testkit.ts";
import { recoveryDescriptorDigest, recoveryGrantSubject } from "./recoveryGrant.ts";

const authority = EnvironmentId.make("library");
const destination = EnvironmentId.make("destination");
const bytes = new TextEncoder().encode("complete immutable archive");
const noAssets = Layer.mock(Assets.LibraryAssetService)({ mode: "local" });
const recoveryLayer = Recovery.layer.pipe(Layer.provide(FetchHttpClient.layer));
const sessionLayer = SessionStore.layer.pipe(Layer.provide(ServerSecretStore.layer));
const serviceLayer = LibraryService.layer.pipe(
  Layer.provide(noAssets),
  Layer.provide(recoveryLayer),
  Layer.provide(sessionLayer),
);
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  yield* runForkMigrationSet(LibraryAssetMigrations);
  const sessions = yield* SessionStore.SessionStore.pipe(Effect.provide(sessionLayer));
  const recovery = yield* Recovery.LibraryRecoveryStore.pipe(Effect.provide(recoveryLayer));
  const service = yield* LibraryService.LibraryService.pipe(Effect.provide(serviceLayer));
  const project = yield* service.createProject({
    requestId: "create",
    title: "Portable project",
    resources: [],
  });
  const copy = {
    ...copyFor(project),
    repositories: [],
    ownership: "managed" as const,
    state: "released" as const,
  };
  const sha256 = Hex.encode(yield* (yield* Crypto.Crypto).digest("SHA-256", bytes));
  const receipt = yield* recovery.put({
    sourceEnvironmentId: source,
    copyId: copy.id,
    sha256,
    byteLength: bytes.length,
    manifest: {
      version: 1,
      projectId: project.id,
      projectRevision: project.revision,
      copyId: copy.id,
      environmentId: source,
      title: project.title,
      rootBasename: "portable",
      manifestFile: "loom-working-copy.json",
    },
    body: Stream.make(bytes),
  });
  yield* service.registerCopy({ requestId: "register", copy: { ...copy, recovery: receipt } });
  const caller = {
    subject: "browser",
    scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
    expiresAt: DateTime.add(yield* DateTime.now, { minutes: 1 }),
  };
  const request = {
    sourceEnvironmentId: source,
    workingCopyId: copy.id,
    destinationEnvironmentId: destination,
  };
  const grant = yield* service.authorizeRecovery(request, caller);
  const session = yield* sessions.verify(grant.accessToken);
  const read = { ...request, sha256, descriptorDigest: yield* recoveryDescriptorDigest(grant) };
  return { service, sessions, recovery, project, copy, grant, session, caller, request, read };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerMemory,
        ServerConfig.layerTest(process.cwd(), { prefix: "portable-recovery-authorization-" }),
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(authority) }),
        Layer.succeed(HostProcess.Environment, { LOOM_LIBRARY_AUTHORITY: "true" }),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.scoped,
  );

describe("destination-authorized recovery", () => {
  it.effect("caps recovery grants at five minutes even for longer lived callers", () =>
    run((f) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const grant = yield* f.service.authorizeRecovery(f.request, {
          ...f.caller,
          expiresAt: DateTime.add(now, { hours: 1 }),
        });
        expect(Date.parse(grant.expiresAt) - now.epochMilliseconds).toBe(5 * 60 * 1000);
        const verified = yield* f.sessions.verify(grant.accessToken);
        expect(verified.expiresAt?.epochMilliseconds).toBe(Date.parse(grant.expiresAt));
      }),
    ),
  );

  it.effect(
    "binds a short lived grant to the immutable source descriptor across later catalog changes",
    () =>
      run((f) =>
        Effect.gen(function* () {
          expect(f.session.scopes).toEqual([AuthLibraryRecoveryReadScope]);
          expect(f.grant.expiresAt).toBe(DateTime.formatIso(f.caller.expiresAt));
          expect(f.session.subject).toBe(yield* recoveryGrantSubject(f.grant));
          yield* f.service.updateProject({
            requestId: "update",
            projectId: f.project.id,
            expectedRevision: f.project.revision,
            title: "Later title",
            brief: f.project.brief,
            resources: f.project.resources,
          });
          yield* f.service.registerCopy({
            requestId: "update-copy",
            copy: { ...f.copy, updatedAt: "2100-01-01T00:00:00Z" },
          });
          const archived = yield* f.service.readRecoveryGrant(f.read, f.session);
          expect(
            (yield* archived.body.pipe(Stream.runCollect)).flatMap((chunk) => [...chunk]),
          ).toEqual([...bytes]);
        }),
      ),
  );
  it.effect("refuses publishers and insufficient or expired caller authority", () =>
    run((f) =>
      Effect.gen(function* () {
        for (const caller of [
          { ...f.caller, scopes: [AuthOrchestrationReadScope] },
          { ...f.caller, subject: `loom-host:${destination}`, scopes: [AuthLibraryPublishScope] },
          { ...f.caller, subject: "mcp-client" },
          { ...f.caller, expiresAt: yield* DateTime.now },
        ])
          expect(
            (yield* f.service.authorizeRecovery(f.request, caller).pipe(Effect.flip)).reason,
          ).toBe("blocked");
        expect(
          (yield* f.service
            .authorizeRecovery({ ...f.request, sourceEnvironmentId: destination }, f.caller)
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
        yield* f.service.registerCopy({ requestId: "remove-recovery", copy: f.copy });
        expect(
          (yield* f.service.authorizeRecovery(f.request, f.caller).pipe(Effect.flip)).reason,
        ).toBe("archive-unverified");
      }),
    ),
  );
  it.effect("rejects cross-copy, source, hash, destination and tampered descriptor reads", () =>
    run((f) =>
      Effect.gen(function* () {
        for (const change of [
          { workingCopyId: "another-copy" },
          { sourceEnvironmentId: destination },
          { sha256: "0".repeat(64) },
          { destinationEnvironmentId: source },
          { descriptorDigest: "0".repeat(64) },
        ])
          expect(
            (yield* f.service
              .readRecoveryGrant({ ...f.read, ...change }, f.session)
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
        for (const change of [
          { projectId: "another-project" },
          { projectRevision: f.copy.projectRevision + 1 },
          { rootPath: "/injected/root" },
          { recovery: { ...f.grant.sourceCopy.recovery!, byteLength: bytes.length + 1 } },
        ]) {
          const descriptorDigest = yield* recoveryDescriptorDigest({
            ...f.grant,
            sourceCopy: { ...f.grant.sourceCopy, ...change },
          });
          expect(
            (yield* f.service
              .readRecoveryGrant({ ...f.read, descriptorDigest }, f.session)
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
        }
        expect(
          (yield* f.service
            .readRecoveryGrant(f.read, { ...f.session, scopes: [AuthLibraryPublishScope] })
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
        expect(
          (yield* f.service
            .readRecoveryGrant(f.read, {
              ...f.session,
              expiresAt: DateTime.add(f.session.expiresAt!, { seconds: 1 }),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("blocked");
      }),
    ),
  );
  it.effect(
    "refuses a stored archive whose project manifest disagrees with the authorized copy",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const archived = yield* f.recovery.get(source, f.copy.id, f.read.sha256);
          for (const manifest of [
            { ...archived.manifest, projectId: "other-project" },
            { ...archived.manifest, projectRevision: archived.manifest.projectRevision + 1 },
          ]) {
            const service = yield* LibraryService.LibraryService.pipe(
              Effect.provide(LibraryService.layer.pipe(Layer.provide(noAssets))),
              Effect.provideService(Recovery.LibraryRecoveryStore, {
                ...f.recovery,
                get: () => Effect.succeed({ ...archived, manifest }),
              }),
              Effect.provideService(SessionStore.SessionStore, f.sessions),
            );
            expect(
              (yield* service.authorizeRecovery(f.request, f.caller).pipe(Effect.flip)).reason,
            ).toBe("archive-unverified");
            expect(
              (yield* service.readRecoveryGrant(f.read, f.session).pipe(Effect.flip)).reason,
            ).toBe("archive-unverified");
          }
        }),
      ),
  );
  it.effect(
    "authenticates local portable recovery with the same exact grant before touching the cache",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const grant = yield* f.service.authorizeRecovery(
            { ...f.request, destinationEnvironmentId: authority },
            f.caller,
          );
          const publisher = yield* Publisher.LibraryRecoveryPublisher.pipe(
            Effect.provide(Publisher.layer),
            Effect.provideService(SessionStore.SessionStore, f.sessions),
            Effect.provideService(Recovery.LibraryRecoveryStore, f.recovery),
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("Local archive uses no network")),
            ),
          );
          const fs = yield* FileSystem.FileSystem;
          const archivePath = (yield* Path.Path).join(
            yield* fs.makeTempDirectoryScoped(),
            "portable.tar",
          );
          yield* publisher.retrievePortable({ grant, archivePath });
          expect([...(yield* fs.readFile(archivePath))]).toEqual([...bytes]);
          const host = yield* f.sessions.issue({
            subject: `loom-host:${authority}`,
            scopes: [AuthLibraryPublishScope],
          });
          for (const tampered of [
            { ...grant, accessToken: host.token },
            { ...grant, sourceCopy: { ...grant.sourceCopy, projectId: "injected" } },
          ]) {
            expect(
              (yield* publisher
                .retrievePortable({ grant: tampered, archivePath })
                .pipe(Effect.flip)).reason,
            ).toBe("blocked");
            expect([...(yield* fs.readFile(archivePath))]).toEqual([...bytes]);
          }
        }),
      ),
  );
  it.effect("serves scoped HTTP grants while preserving cross-computer publisher denial", () =>
    run((f) =>
      Effect.gen(function* () {
        const authenticate = (request: import("effect/http/HttpServerRequest").HttpServerRequest) =>
          f.sessions
            .verify((request.headers.authorization ?? "").replace(/^Bearer /, ""))
            .pipe(
              Effect.mapError(
                (cause) => new EnvironmentAuth.ServerAuthInvalidCredentialError({ cause }),
              ),
            );
        const runtime = Context.make(LibraryService.LibraryService, f.service).pipe(
          Context.add(Recovery.LibraryRecoveryStore, f.recovery),
        );
        const routes = LibraryRecoveryHttpRoutes.pipe(
          Layer.provide(
            Layer.succeed(ForkRuntime, runtime as unknown as Context.Context<ForkServices>),
          ),
          HttpRouter.provideRequest(
            Layer.mergeAll(
              NodeHttpPlatform.layer,
              Layer.succeed(Clock.Clock, yield* Clock.Clock),
              Layer.mock(EnvironmentAuth.EnvironmentAuth)({
                authenticateHttpRequest: authenticate,
                authenticateWebSocketUpgrade: authenticate,
              }),
            ),
          ),
          Layer.provide(NodeServices.layer),
        );
        const hostB = yield* f.sessions.issue({
          subject: `loom-host:${destination}`,
          scopes: [AuthLibraryPublishScope],
        });
        const hostA = yield* f.sessions.issue({
          subject: `loom-host:${source}`,
          scopes: [AuthLibraryPublishScope],
        });
        yield* Effect.acquireUseRelease(
          Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
          (web) =>
            Effect.tryPromise(async () => {
              const url = `https://library.test/api/loom/library/recovery-grants/${destination}/${source}/${f.copy.id}/${f.read.sha256}`;
              const headers = {
                authorization: `Bearer ${f.grant.accessToken}`,
                "x-loom-recovery-descriptor": f.read.descriptorDigest,
              };
              const granted = await web.handler(new Request(url, { headers }));
              expect(granted.status).toBe(200);
              expect([...new Uint8Array(await granted.arrayBuffer())]).toEqual([...bytes]);
              expect(granted.headers.get("cache-control")).toBe("no-store");
              for (const deniedUrl of [
                url.replace(`/${destination}/`, "/another-destination/"),
                url.replace(`/${f.copy.id}/`, "/another-copy/"),
              ])
                expect((await web.handler(new Request(deniedUrl, { headers }))).status).toBe(403);
              expect(
                (
                  await web.handler(
                    new Request(url, {
                      headers: { ...headers, authorization: `Bearer ${hostB.token}` },
                    }),
                  )
                ).status,
              ).toBe(403);
              const ordinary = `https://library.test/api/loom/library/recovery/${source}/${f.copy.id}/${f.read.sha256}`;
              expect(
                (
                  await web.handler(
                    new Request(ordinary, { headers: { authorization: `Bearer ${hostB.token}` } }),
                  )
                ).status,
              ).toBe(403);
              expect(
                (
                  await web.handler(
                    new Request(ordinary, { headers: { authorization: `Bearer ${hostA.token}` } }),
                  )
                ).status,
              ).toBe(200);
              expect((await web.handler(new Request(ordinary, { headers }))).status).toBe(403);
            }),
          (web) => Effect.promise(() => web.dispose()),
        );
      }),
    ),
  );
  it.effect("expires the bearer at its signed descriptor deadline", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* TestClock.adjust("1 minute");
        expect((yield* f.sessions.verify(f.grant.accessToken).pipe(Effect.flip))._tag).toBe(
          "SessionTokenExpiredError",
        );
        expect(
          (yield* f.service.readRecoveryGrant(f.read, f.session).pipe(Effect.flip)).reason,
        ).toBe("blocked");
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
