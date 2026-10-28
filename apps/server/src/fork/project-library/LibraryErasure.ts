import {
  LibraryError,
  LibraryThreadArchive,
  LibraryDeletedPreferences,
  LibraryImportShadowRequest,
} from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as LibraryStore from "./LibraryStore.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { libraryAttachments, libraryPages } from "./attachments.ts";

const decodeArchive = Schema.decodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryThreadArchive)),
);
const proofCodec = Schema.fromJsonString(Schema.toCodecJson(LibraryImportShadowRequest));
const decodeProof = Schema.decodeEffect(proofCodec);
const encodeProof = Schema.encodeEffect(proofCodec);
const decodePreferences = Schema.decodeEffect(Schema.fromJsonString(LibraryDeletedPreferences));
const isLibraryError = Schema.is(LibraryError);
const validatePreferences = Schema.decodeEffect(LibraryDeletedPreferences);
const encodePreferences = Schema.encodeEffect(Schema.fromJsonString(LibraryDeletedPreferences));
const io = (cause: unknown) =>
  isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause });
const keyOf = (environmentId: string, id: string) => `${environmentId}\0${id}`;

export const makeLibraryErasure = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* LibraryStore.LibraryStore;
  const assets = yield* Assets.LibraryAssetService;
  const preferences = Effect.gen(function* () {
    const rows = yield* sql<{
      value_json: string;
    }>`SELECT value_json FROM fork_library_identity WHERE key='deleted-preferences'`;
    return rows[0] ? yield* decodePreferences(rows[0].value_json) : { retentionDays: 30 };
  }).pipe(Effect.mapError(io));
  const isErased = Effect.fn("LibraryErasure.isErased")(function* (
    environmentId: string,
    threadId: string,
  ) {
    return (
      (yield* sql`SELECT 1 FROM fork_library_erased_threads WHERE source_environment_id=${environmentId} AND source_thread_id=${threadId}`)
        .length > 0
    );
  }, Effect.mapError(io));
  const checkAssets = Effect.fn("LibraryErasure.checkAssets")(function* (
    archive: LibraryThreadArchive,
  ) {
    for (const item of [...libraryAttachments(archive), ...libraryPages(archive)]) {
      if (
        (yield* sql`SELECT 1 FROM fork_library_erased_assets WHERE source_environment_id=${archive.summary.environmentId} AND source_attachment_id=${item.id}`)
          .length
      ) {
        return yield* new LibraryError({
          reason: "archive-unverified",
          detail:
            "An attachment was erased from the Library. Upload this conversation's attachments again, then retry.",
        });
      }
    }
  }, Effect.mapError(io));
  const erase = Effect.fn("LibraryErasure.erase")(function* (id: string) {
    if ((yield* sql`SELECT 1 FROM fork_library_erased_threads WHERE library_id=${id}`).length)
      return { id };
    const payload = yield* store.history(id);
    if (!payload) return yield* new LibraryError({ reason: "not-found" });
    const archive = yield* decodeArchive(payload);
    if (!archive.summary.deleted)
      return yield* new LibraryError({
        reason: "invalid",
        detail: "Delete the conversation before erasing its saved history.",
      });
    const candidates = new Map<string, { environmentId: EnvironmentId; id: string }>();
    const collect = (value: LibraryThreadArchive) => {
      for (const item of [...libraryAttachments(value), ...libraryPages(value)]) {
        candidates.set(keyOf(value.summary.environmentId, item.id), {
          environmentId: value.summary.environmentId,
          id: item.id,
        });
      }
    };
    const retain = (value: LibraryThreadArchive) => {
      for (const item of [...libraryAttachments(value), ...libraryPages(value)])
        candidates.delete(keyOf(value.summary.environmentId, item.id));
    };
    collect(archive);
    const versions = yield* sql<{
      source_sequence: number;
    }>`SELECT source_sequence FROM fork_library_thread_versions WHERE library_id=${id} AND payload_json NOT LIKE 'loom:sha256:%'`;
    for (const version of versions) {
      const saved = yield* store.threadVersion(id, version.source_sequence);
      if (saved && "payload" in saved) collect(yield* decodeArchive(saved.payload));
    }
    yield* sql`INSERT INTO fork_library_erased_threads(library_id,source_environment_id,source_thread_id,erased_at) VALUES (${id},${archive.summary.environmentId},${archive.summary.threadId},${DateTime.formatIso(yield* DateTime.now)})`;
    // Import proofs can bundle unrelated conversations; remove only this conversation's content.
    for (const proof of yield* sql<{
      request_id: string;
    }>`SELECT request_id FROM fork_library_import_proofs`) {
      const text = yield* store.importProof(proof.request_id);
      if (!text) continue;
      const value = yield* decodeProof(text);
      const removed = value.threads.filter((thread) => thread.summary.id === id);
      if (!removed.length) continue;
      for (const thread of removed) collect(thread);
      yield* store.putImportProof(
        proof.request_id,
        yield* encodeProof({
          ...value,
          threads: value.threads.filter((thread) => thread.summary.id !== id),
        }),
      );
    }
    yield* store.eraseThread(id);
    // Only candidate keys are retained in memory while complete surviving archives are scanned.
    for (const row of yield* sql<{
      library_id: string;
    }>`SELECT library_id FROM fork_library_threads`) {
      if (!candidates.size) break;
      const remaining = yield* store.history(row.library_id);
      if (remaining) retain(yield* decodeArchive(remaining));
    }
    for (const row of yield* sql<{
      library_id: string;
      source_sequence: number;
    }>`SELECT library_id,source_sequence FROM fork_library_thread_versions WHERE payload_json NOT LIKE 'loom:sha256:%'`) {
      if (!candidates.size) break;
      const remaining = yield* store.threadVersion(row.library_id, row.source_sequence);
      if (remaining && "payload" in remaining) retain(yield* decodeArchive(remaining.payload));
    }
    for (const proof of yield* sql<{
      request_id: string;
    }>`SELECT request_id FROM fork_library_import_proofs`) {
      if (!candidates.size) break;
      const text = yield* store.importProof(proof.request_id);
      if (!text) continue;
      const value = yield* decodeProof(text);
      for (const thread of value.threads) retain(thread);
    }
    for (const candidate of candidates.values()) {
      const rows = yield* sql<{
        digest: string;
      }>`DELETE FROM fork_library_assets WHERE source_environment_id=${candidate.environmentId} AND source_attachment_id=${candidate.id} RETURNING digest`;
      for (const row of rows)
        yield* sql`INSERT INTO fork_library_erased_assets(source_environment_id,source_attachment_id,digest,pending) VALUES (${candidate.environmentId},${candidate.id},${row.digest},1) ON CONFLICT(source_environment_id,source_attachment_id) DO UPDATE SET digest=excluded.digest,pending=1`;
    }
    return { id };
  }, Effect.mapError(io));
  const cleanup = Effect.fn("LibraryErasure.cleanup")(function* () {
    for (const row of yield* sql<{
      digest: string;
    }>`SELECT DISTINCT digest FROM fork_library_erased_assets WHERE pending=1`) {
      yield* assets.removeUnused(row.digest);
      yield* sql`UPDATE fork_library_erased_assets SET pending=0 WHERE digest=${row.digest}`;
    }
  }, Effect.mapError(io));
  const expired = Effect.gen(function* () {
    const cutoff = DateTime.formatIso(
      DateTime.subtract(yield* DateTime.now, { days: (yield* preferences).retentionDays }),
    );
    return yield* sql<{
      id: string;
    }>`SELECT t.library_id AS id FROM fork_library_threads t LEFT JOIN fork_library_history_headers h ON h.library_id=t.library_id WHERE json_extract(t.summary_json,'$.deleted')=1 AND COALESCE(json_extract(h.payload_json,'$.projection.thread.deletedAt'),t.updated_at)<${cutoff} ORDER BY t.updated_at LIMIT 25`;
  }).pipe(Effect.mapError(io));
  const setPreferences = Effect.fn("LibraryErasure.setPreferences")(function* (
    input: LibraryDeletedPreferences,
  ) {
    const value = yield* validatePreferences(input);
    yield* sql`INSERT INTO fork_library_identity(key,value_json) VALUES ('deleted-preferences',${yield* encodePreferences(value)}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
    return value;
  }, Effect.mapError(io));
  return { preferences, setPreferences, erase, cleanup, expired, isErased, checkAssets };
});
