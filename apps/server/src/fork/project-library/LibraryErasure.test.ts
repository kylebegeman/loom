import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSettingsWriteScope, ChatAttachmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { FetchHttpClient } from "effect/http";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { LibraryError, LibraryImportShadowRequest } from "@t3tools/contracts/fork";
import { layerMemory } from "../../persistence/Sqlite.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Library from "./LibraryService.ts";
import * as Store from "./LibraryStore.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { LibraryAssetMigrations } from "./assets/migrations.ts";
import { archiveFor, copyFor, resource, source } from "./Library.testkit.ts";

const decodeProof = Schema.decodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryImportShadowRequest)),
);
const owner = { subject: "owner", scopes: [AuthSettingsWriteScope] };
const services = Library.layer.pipe(
  Layer.provideMerge(Assets.layer.pipe(Layer.provide(FetchHttpClient.layer))),
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
  ),
);

it.effect(
  "keeps shared attachment keys and bytes, strips one archive from import proofs, and removes unreferenced bytes",
  () =>
    Effect.gen(function* () {
      yield* runForkMigrationSet(ProjectLibraryMigrations);
      yield* runForkMigrationSet(LibraryAssetMigrations);
      const library = yield* Library.LibraryService;
      const assets = yield* Assets.LibraryAssetService;
      const store = yield* Store.LibraryStore.pipe(Effect.provide(Store.layer));
      const sql = yield* SqlClient.SqlClient;
      const project = yield* library.createProject({
        requestId: "project",
        title: "Project",
        resources: [resource],
      });
      const copy = copyFor(project);
      yield* library.registerCopy({ requestId: "copy", copy });
      const base = yield* archiveFor(project);
      const attachment = (id: string) => ({
        type: "file" as const,
        id: ChatAttachmentId.make(id),
        name: `${id}.txt`,
        mimeType: "text/plain",
        sizeBytes: 3,
      });
      const make = (name: string, ids: string[]) => ({
        ...base,
        summary: { ...base.summary, id: name, threadId: ThreadId.make(name), deleted: true },
        projection: {
          ...base.projection,
          thread: {
            ...base.projection.thread,
            id: ThreadId.make(name),
            deletedAt: base.projection.updatedAt,
          },
          messages: [
            {
              ...base.projection.messages[0]!,
              threadId: ThreadId.make(name),
              attachments: ids.map(attachment),
            },
          ],
        },
      });
      const first = make("first", ["unique", "shared"]);
      const second = make("second", ["shared", "alias"]);
      const unique = yield* assets.put({
        sourceEnvironmentId: source,
        attachmentId: "unique",
        filename: "unique.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([1, 2, 3]),
      });
      yield* assets.put({
        sourceEnvironmentId: source,
        attachmentId: "alias",
        filename: "alias.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([1, 2, 3]),
      });
      const shared = yield* assets.put({
        sourceEnvironmentId: source,
        attachmentId: "shared",
        filename: "shared.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([4, 5, 6]),
      });
      yield* library.importShadow({
        requestId: "import",
        sourceEnvironmentId: source,
        journalId: "journal",
        throughSequence: 0,
        projects: [project],
        copies: [copy],
        threads: [first, second],
      });
      yield* library.eraseConversation({ requestId: "erase-first", id: "first" }, owner);
      expect((yield* assets.find(source, "unique").pipe(Effect.flip)).reason).toBe("not-found");
      expect(Array.from(yield* assets.read(unique))).toEqual([1, 2, 3]);
      expect(Array.from(yield* assets.read(shared))).toEqual([4, 5, 6]);
      const proof = yield* decodeProof((yield* store.importProof("import"))!);
      expect(proof.threads.map((thread) => thread.summary.id)).toEqual(["second"]);
      expect((yield* library.verifyImport({ requestId: "import" })).verified).toBe(true);
      yield* library.eraseConversation({ requestId: "erase-second", id: "second" }, owner);
      expect((yield* assets.read(unique).pipe(Effect.flip)).reason).toBe("io");
      expect((yield* assets.read(shared).pipe(Effect.flip)).reason).toBe("io");
      expect(yield* sql`SELECT COUNT(*) AS count FROM fork_library_assets`).toEqual([{ count: 0 }]);
      expect(
        yield* sql`SELECT COUNT(*) AS count FROM fork_library_erased_assets WHERE pending=1`,
      ).toEqual([{ count: 0 }]);
      yield* assets.put({
        sourceEnvironmentId: source,
        attachmentId: "unique",
        filename: "unique.txt",
        contentType: "text/plain",
        bytes: new Uint8Array([1, 2, 3]),
      });
      yield* library.registerThread({
        requestId: "retry-thread",
        thread: make("retry", ["unique"]),
      });
      const unavailable = yield* Library.LibraryService.pipe(
        Effect.provide(
          Layer.fresh(
            Library.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(Assets.LibraryAssetService, {
                    ...assets,
                    removeUnused: () => Effect.fail(new LibraryError({ reason: "io" })),
                  }),
                  Layer.succeed(ServerEnvironmentIdentity, {
                    getEnvironmentId: Effect.succeed(source),
                  }),
                ),
              ),
            ),
          ),
        ),
      );
      const request = { requestId: "retry-erase", id: "retry" };
      expect((yield* unavailable.eraseConversation(request, owner).pipe(Effect.flip)).reason).toBe(
        "io",
      );
      expect(
        yield* sql`SELECT COUNT(*) AS count FROM fork_library_erased_assets WHERE pending=1`,
      ).toEqual([{ count: 1 }]);
      yield* library.eraseConversation(request, owner);
      expect(
        yield* sql`SELECT COUNT(*) AS count FROM fork_library_erased_assets WHERE pending=1`,
      ).toEqual([{ count: 0 }]);
      expect((yield* assets.read(unique).pipe(Effect.flip)).reason).toBe("io");
    }).pipe(
      Effect.provide(
        services.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              ConfigProvider.layer(
                ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } }),
              ),
              Layer.succeed(HostProcess.Environment, {}),
              layerMemory,
              ServerConfig.layerTest(process.cwd(), { prefix: "library-erasure-test-" }),
            ).pipe(Layer.provideMerge(NodeServices.layer)),
          ),
        ),
      ),
      Effect.scoped,
    ),
);
