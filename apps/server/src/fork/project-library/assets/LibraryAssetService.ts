import { EnvironmentId } from "@t3tools/contracts";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Semaphore from "effect/Semaphore";
import * as ObjectStore from "./LibraryObjectStore.ts";
export const LibraryAsset = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  attachmentId: Schema.String,
  digest: Schema.String,
  filename: Schema.String,
  contentType: Schema.String,
  bytes: Schema.Number,
  createdAt: Schema.String,
});
export type LibraryAsset = typeof LibraryAsset.Type;
export class LibraryAssetService extends Context.Service<
  LibraryAssetService,
  {
    readonly mode: "local" | "b2";
    readonly put: (input: {
      readonly sourceEnvironmentId: EnvironmentId;
      readonly attachmentId: string;
      readonly filename: string;
      readonly contentType: string;
      readonly bytes: Uint8Array;
    }) => Effect.Effect<LibraryAsset, LibraryError>;
    readonly find: (
      sourceEnvironmentId: EnvironmentId,
      attachmentId: string,
    ) => Effect.Effect<LibraryAsset, LibraryError>;
    readonly read: (asset: LibraryAsset) => Effect.Effect<Uint8Array, LibraryError>;
    readonly url: (asset: LibraryAsset) => Effect.Effect<string | null, LibraryError>;
  }
>()("t3/fork/project-library/assets/LibraryAssetService") {}
interface Row {
  source_environment_id: string;
  source_attachment_id: string;
  digest: string;
  filename: string;
  content_type: string;
  bytes: number;
  created_at: string;
}
const isLibraryError = Schema.is(LibraryError);
const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const objects = yield* ObjectStore.LibraryObjectStore;
  const uploads = yield* Semaphore.make(1);
  const find = (environmentId: EnvironmentId, attachmentId: string) =>
    Effect.gen(function* () {
      const rows =
        yield* sql<Row>`SELECT * FROM fork_library_assets WHERE source_environment_id=${environmentId} AND source_attachment_id=${attachmentId}`;
      if (!rows[0]) return yield* new LibraryError({ reason: "not-found" });
      const row = rows[0];
      return {
        sourceEnvironmentId: EnvironmentId.make(row.source_environment_id),
        attachmentId: row.source_attachment_id,
        digest: row.digest,
        filename: row.filename,
        contentType: row.content_type,
        bytes: row.bytes,
        createdAt: row.created_at,
      };
    }).pipe(
      Effect.mapError((cause) =>
        isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
      ),
    );
  const put: LibraryAssetService["Service"]["put"] = (input) =>
    uploads.withPermits(1)(
      Effect.gen(function* () {
        if (
          !/^[A-Za-z0-9._:-]{1,200}$/.test(input.attachmentId) ||
          !input.filename ||
          input.filename.length > 512 ||
          /[\r\n\0]/.test(input.filename) ||
          !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(input.contentType) ||
          input.bytes.length > ObjectStore.LIBRARY_ASSET_MAX_BYTES
        )
          return yield* new LibraryError({ reason: "invalid" });
        const digest = yield* ObjectStore.assetDigest(crypto, input.bytes);
        const previous = yield* find(input.sourceEnvironmentId, input.attachmentId).pipe(
          Effect.catchTags({
            LibraryError: (error) =>
              error.reason === "not-found" ? Effect.succeed(null) : Effect.fail(error),
          }),
        );
        if (previous) {
          if (previous.digest !== digest || previous.bytes !== input.bytes.length)
            return yield* new LibraryError({ reason: "request-conflict" });
          yield* objects.get(digest);
          return previous;
        }
        yield* objects.put(digest, input.bytes, input.contentType);
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql`INSERT INTO fork_library_assets (source_environment_id,source_attachment_id,digest,filename,content_type,bytes,created_at) VALUES (${input.sourceEnvironmentId},${input.attachmentId},${digest},${input.filename},${input.contentType},${input.bytes.length},${createdAt})`;
        return {
          sourceEnvironmentId: input.sourceEnvironmentId,
          attachmentId: input.attachmentId,
          digest,
          filename: input.filename,
          contentType: input.contentType,
          bytes: input.bytes.length,
          createdAt,
        };
      }).pipe(
        Effect.mapError((cause) =>
          isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
        ),
      ),
    );
  return LibraryAssetService.of({
    mode: objects.mode,
    put,
    find,
    read: (asset) => objects.get(asset.digest),
    url: (asset) => objects.url(asset.digest),
  });
});
export const layer = Layer.effect(LibraryAssetService, make).pipe(Layer.provide(ObjectStore.layer));
