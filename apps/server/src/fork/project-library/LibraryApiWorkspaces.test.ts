import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as SqlClient from "effect/sql/SqlClient";
import { stableStringify } from "@t3tools/shared/relaySigning";
import type { LibraryApiBundle, LibraryApiRequest } from "@t3tools/contracts/fork";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Config from "../../config.ts";
import * as Persistence from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { LibraryAssetService } from "./assets/LibraryAssetService.ts";
import * as Catalog from "./LibraryService.ts";
import * as Apis from "./LibraryApiWorkspaces.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { resource, source } from "./Library.testkit.ts";

const bundle: LibraryApiBundle = {
  id: "a".repeat(24),
  name: "API",
  folders: [],
  workflows: [],
  files: [{ name: "api.json", content: '[{"v":12,"name":"API","folders":[],"requests":[]}]' }],
};
const hash = Effect.fn("fixture.hash")(function* (value: unknown) {
  const crypto = yield* Crypto.Crypto;
  return Hex.encode(
    yield* crypto.digest("SHA-256", new TextEncoder().encode(stableStringify(value))),
  );
});
const catalogLayer = Catalog.layer.pipe(
  Layer.provide(Layer.mock(LibraryAssetService)({ mode: "local" })),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
  ),
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
);
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const catalog = yield* Catalog.LibraryService.pipe(Effect.provide(catalogLayer));
  const project = yield* catalog.createProject({
    requestId: "project",
    title: "Pulse",
    resources: [resource],
  });
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* Config.ServerConfig;
  const directory = path.join(config.stateDir, "fork", "library-api-workspaces");
  const file = path.join(directory, `${yield* hash(project.id)}.json`);
  const input: LibraryApiRequest = {
    projectId: project.id,
    action: "save",
    requestId: "original",
    expectedRevision: 0,
    bundle,
  };
  const original = {
    projectId: project.id,
    entries: [{ id: bundle.id, name: bundle.name, revision: 1 }],
    revision: 1,
    selected: bundle,
  };
  const digest = yield* hash(bundle);
  const legacy = JSON.stringify({
    versions: { [bundle.id]: 1, ["b".repeat(24)]: 3 },
    entries: [{ revision: 1, bundle }],
    receipts: [
      {
        id: input.requestId,
        fingerprint: yield* hash(input),
        result: { ...original, selected: digest },
      },
    ],
  });
  const seed = fs
    .makeDirectory(directory, { recursive: true })
    .pipe(
      Effect.andThen(fs.writeFileString(file, legacy)),
      Effect.andThen(fs.writeFileString(`${file}.${digest}`, JSON.stringify(bundle))),
    );
  const acquire = Apis.LibraryApiWorkspaces.pipe(
    Effect.provide(Apis.layer),
    Effect.provideService(Catalog.LibraryService, catalog),
  );
  return {
    catalog,
    project,
    sql,
    fs,
    path,
    config,
    directory,
    file,
    input,
    original,
    digest,
    legacy,
    seed,
    acquire,
  };
});
const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        Persistence.layerMemory,
        Config.layerTest(process.cwd(), { prefix: "pulse-storage-" }),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

it.effect(
  "imports every legacy catalog at startup, preserves exact replies and tombstones, and never resurrects the files",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.seed;
      const other = yield* f.catalog.createProject({
        requestId: "other",
        title: "Other",
        resources: [resource],
      });
      const otherFile = f.path.join(f.directory, `${yield* hash(other.id)}.json`);
      yield* f.fs.writeFileString(
        otherFile,
        JSON.stringify({ versions: { [bundle.id]: 7 }, entries: [], receipts: [] }),
      );
      const execution = yield* Apis.LibraryApiWorkspaces.pipe(
        Effect.provide(Apis.layer),
        Effect.provideService(Catalog.LibraryService, {
          ...f.catalog,
          info: f.catalog.info.pipe(Effect.map((info) => ({ ...info, isAuthority: false }))),
        }),
      );
      expect((yield* execution.execute(f.input).pipe(Effect.flip)).reason).toBe("not-authority");
      expect(yield* f.sql`SELECT project_id FROM fork_library_api_catalogs`).toEqual([]);
      const api = yield* f.acquire;
      expect((yield* f.sql`SELECT project_id FROM fork_library_api_catalogs`).length).toBe(2);
      expect(yield* api.execute(f.input)).toEqual(f.original);
      expect(
        (yield* api.execute({ ...f.input, action: "read", workspaceId: "b".repeat(24) })).revision,
      ).toBe(3);
      expect(
        (yield* api
          .execute({
            ...f.input,
            action: "save",
            requestId: "stale",
            workspaceId: "b".repeat(24),
            bundle: { ...bundle, id: "b".repeat(24) },
          })
          .pipe(Effect.flip)).reason,
      ).toBe("revision-conflict");
      const removed = yield* api.execute({
        ...f.input,
        action: "remove",
        workspaceId: bundle.id,
        requestId: "remove",
        expectedRevision: 1,
      });
      expect(removed.revision).toBe(2);
      expect(yield* f.fs.readFileString(f.file)).toBe(f.legacy);
      const restarted = yield* f.acquire;
      expect(
        (yield* restarted.execute({
          projectId: f.project.id,
          action: "read",
          workspaceId: bundle.id,
        })).selected,
      ).toBeNull();
      expect(yield* restarted.execute(f.input)).toEqual(f.original);
      expect(
        (yield* restarted.execute({ projectId: other.id, action: "read", workspaceId: bundle.id }))
          .revision,
      ).toBe(7);
    }).pipe(provide),
);

it.effect(
  "rolls back a failed catalog commit and serializes conflicting writes and exact retries across service instances",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const api = yield* f.acquire;
      const first = yield* api.execute(f.input);
      const input = {
        ...f.input,
        requestId: "second",
        expectedRevision: 1,
        bundle: { ...bundle, name: "Second" },
      };
      yield* f.sql`CREATE TRIGGER reject_api_catalog_update BEFORE UPDATE ON fork_library_api_catalogs BEGIN SELECT RAISE(ABORT,'fixture failure'); END`;
      expect((yield* api.execute(input).pipe(Effect.flip)).reason).toBe("io");
      expect(yield* api.execute(f.input)).toEqual(first);
      expect((yield* f.sql`SELECT digest FROM fork_library_api_bundles`).length).toBe(1);
      yield* f.sql`DROP TRIGGER reject_api_catalog_update`;
      const second = yield* f.acquire;
      const replies = yield* Effect.all([api.execute(input), second.execute(input)], {
        concurrency: 2,
      });
      expect(replies[0]).toEqual(replies[1]);
      expect(replies[0]?.revision).toBe(2);
      const conflicting = yield* Effect.all(
        [
          api
            .execute({
              ...input,
              expectedRevision: 2,
              requestId: "third",
              bundle: { ...bundle, name: "Third" },
            })
            .pipe(Effect.result),
          second
            .execute({
              ...input,
              expectedRevision: 2,
              requestId: "fourth",
              bundle: { ...bundle, name: "Fourth" },
            })
            .pipe(Effect.result),
        ],
        { concurrency: 2 },
      );
      expect(conflicting.filter(Result.isSuccess)).toHaveLength(1);
      expect(conflicting.filter(Result.isFailure).map((r) => r.failure.reason)).toEqual([
        "revision-conflict",
      ]);
    }).pipe(provide),
);

it.effect(
  "leaves corrupt or incomplete legacy data untouched and retries a repaired import atomically",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.seed;
      const oldBundle = { ...bundle, name: "Earlier response" };
      const oldDigest = yield* hash(oldBundle);
      const legacy = JSON.parse(f.legacy);
      legacy.receipts[0].result.selected = oldDigest;
      const text = JSON.stringify(legacy);
      yield* f.fs.writeFileString(f.file, text);
      expect((yield* f.acquire.pipe(Effect.flip)).reason).toBe("io");
      expect(yield* f.fs.readFileString(f.file)).toBe(text);
      expect(yield* f.sql`SELECT project_id FROM fork_library_api_catalogs`).toEqual([]);
      expect(yield* f.sql`SELECT digest FROM fork_library_api_bundles`).toEqual([]);
      yield* f.fs.writeFileString(`${f.file}.${oldDigest}`, JSON.stringify(bundle));
      expect((yield* f.acquire.pipe(Effect.flip)).reason).toBe("io");
      yield* f.fs.writeFileString(`${f.file}.${oldDigest}`, JSON.stringify(oldBundle));
      yield* f.sql`CREATE TRIGGER reject_legacy_import BEFORE INSERT ON fork_library_api_catalogs BEGIN SELECT RAISE(ABORT,'fixture import failure'); END`;
      expect((yield* f.acquire.pipe(Effect.flip)).reason).toBe("io");
      expect(yield* f.sql`SELECT project_id FROM fork_library_api_catalogs`).toEqual([]);
      expect(yield* f.sql`SELECT digest FROM fork_library_api_bundles`).toEqual([]);
      expect(yield* f.fs.readFileString(f.file)).toBe(text);
      yield* f.sql`DROP TRIGGER reject_legacy_import`;
      const api = yield* f.acquire;
      expect((yield* api.execute(f.input)).selected).toEqual(oldBundle);
      expect(
        (yield* api.execute({ projectId: f.project.id, action: "read", workspaceId: bundle.id }))
          .selected,
      ).toEqual(bundle);
    }).pipe(provide),
);

it.live(
  "restores shared definitions and lost-response receipts from a database-only backup on independent state",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.seed;
      const api = yield* f.acquire;
      yield* api.execute({
        ...f.input,
        requestId: "latest",
        expectedRevision: 1,
        bundle: { ...bundle, name: "Latest" },
      });
      const root = yield* f.fs.makeTempDirectoryScoped();
      const backup = f.path.join(root, "backup.sqlite");
      yield* f.sql`VACUUM INTO ${backup}`;
      const restored = yield* Effect.gen(function* () {
        const catalog = yield* Catalog.LibraryService.pipe(Effect.provide(catalogLayer));
        const api = yield* Apis.LibraryApiWorkspaces.pipe(
          Effect.provide(Apis.layer),
          Effect.provideService(Catalog.LibraryService, catalog),
        );
        return {
          read: yield* api.execute({
            projectId: f.project.id,
            action: "read",
            workspaceId: bundle.id,
          }),
          reply: yield* api.execute(f.input),
        };
      }).pipe(
        Effect.provide(Persistence.layerFromPath(backup)),
        Effect.provideService(Config.ServerConfig, {
          ...f.config,
          stateDir: f.path.join(root, "independent-state"),
        }),
      );
      expect(restored.read.selected?.name).toBe("Latest");
      expect(restored.read.revision).toBe(2);
      expect(restored.reply).toEqual(f.original);
    }).pipe(provide),
);
