import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { FetchHttpClient } from "effect/http";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Library from "./LibraryService.ts";
import * as Maintenance from "./LibraryMaintenance.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import * as Recovery from "./assets/LibraryRecoveryStore.ts";
import { LibraryAssetMigrations } from "./assets/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { source, resource, archiveFor, copyFor } from "./Library.testkit.ts";
const storage = Layer.merge(Assets.layer, Recovery.layer).pipe(
  Layer.provide(FetchHttpClient.layer),
);
const services = Layer.merge(Library.layer, Maintenance.layer).pipe(
  Layer.provideMerge(storage),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
  ),
);
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  yield* runForkMigrationSet(LibraryAssetMigrations);
  const library = yield* Library.LibraryService;
  const maintenance = yield* Maintenance.LibraryMaintenance;
  const assets = yield* Assets.LibraryAssetService;
  const project = yield* library.createProject({
    requestId: "project",
    title: "AspectAvy",
    resources: [resource],
  });
  const info = yield* library.info;
  const copy = copyFor(project);
  const copyRequest = {
    requestId: "copy",
    copy,
    authorityId: info.authorityId,
    authorityEpoch: info.authorityEpoch,
  };
  yield* library.registerCopy(copyRequest);
  const base = yield* archiveFor(project, 42);
  const attachment = {
    type: "file" as const,
    id: ChatAttachmentId.make("notes"),
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 3,
  };
  const thread = {
    ...base,
    projection: {
      ...base.projection,
      messages: [{ ...base.projection.messages[0]!, attachments: [attachment] }],
    },
  };
  const asset = yield* assets.put({
    sourceEnvironmentId: source,
    attachmentId: attachment.id,
    filename: attachment.name,
    contentType: attachment.mimeType,
    bytes: new Uint8Array([1, 2, 3]),
  });
  yield* library.ingestHistory({
    requestId: "history",
    sourceEnvironmentId: source,
    journalId: "journal",
    fromSequence: 0,
    entries: [{ sequence: 1, thread }],
  });
  return { library, maintenance, info, copyRequest, asset };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(
    Effect.provide(
      services.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            layerMemory,
            ServerConfig.layerTest(process.cwd(), { prefix: "library-maintenance-test-" }),
          ).pipe(Layer.provideMerge(NodeServices.layer)),
        ),
      ),
    ),
    Effect.provideService(HostProcess.Environment, {}),
    Effect.scoped,
  );
describe("Library backup manifests and authority fencing", () => {
  it.effect("records native-history indexes and detects corrupt or missing attachment bytes", () =>
    run((f) =>
      Effect.gen(function* () {
        const manifest = yield* f.maintenance.manifest({
          databaseDigest: "a".repeat(64),
          databaseBytes: 100,
        });
        expect(manifest).toMatchObject({
          projects: 1,
          copies: 1,
          threads: 1,
          threadVersions: 1,
          assetBytesVerified: true,
          recoveryBytesVerified: true,
          sourceCursors: [{ environmentId: source, journalId: "journal", lastSequence: 1 }],
        });
        expect(manifest.assets[0]?.digest).toBe(f.asset.digest);
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        yield* fs.writeFile(
          path.join(config.stateDir, "project-library", "objects", f.asset.digest),
          new Uint8Array([3, 2, 1]),
        );
        expect(yield* f.maintenance.verifyAssets(manifest)).toMatchObject({
          missing: 1,
          verified: false,
          assetBytesVerified: false,
          recoveryBytesVerified: true,
        });
      }),
    ),
  );
  it.effect(
    "rotates only the expected authority epoch and rejects old fenced receipt replays",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const request = {
            requestId: "rotate",
            expectedAuthorityId: f.info.authorityId,
            expectedEpoch: f.info.authorityEpoch,
          };
          expect(yield* f.maintenance.rotateAuthorityEpoch(request)).toEqual({
            id: f.info.authorityId,
            epoch: 2,
          });
          expect(yield* f.maintenance.rotateAuthorityEpoch(request)).toEqual({
            id: f.info.authorityId,
            epoch: 2,
          });
          expect(
            (yield* f.maintenance
              .rotateAuthorityEpoch({ ...request, requestId: "stale" })
              .pipe(Effect.flip)).reason,
          ).toBe("revision-conflict");
          expect((yield* f.library.registerCopy(f.copyRequest).pipe(Effect.flip)).reason).toBe(
            "blocked",
          );
        }),
      ),
  );
});
