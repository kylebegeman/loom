import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ForkMigrationSet } from "../../persistence/migrations.ts";
export const LibraryAssetMigrations: ForkMigrationSet = {
  slug: "project-library-assets",
  migrations: [
    [
      1,
      "VerifiedObjects",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_library_assets (source_environment_id TEXT NOT NULL, source_attachment_id TEXT NOT NULL, digest TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(source_environment_id,source_attachment_id))`;
      }),
    ],
    [
      2,
      "RecoveryArchives",
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE fork_library_recovery (source_environment_id TEXT NOT NULL, copy_id TEXT NOT NULL, digest TEXT NOT NULL, byte_length INTEGER NOT NULL, archive_key TEXT NOT NULL, manifest_json TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY(source_environment_id,copy_id,digest))`;
      }),
    ],
  ],
};
