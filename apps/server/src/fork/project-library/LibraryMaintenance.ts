import {
  LibraryError,
  LibraryId,
  LibraryRequestId,
  LibraryRecoveryManifest,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as LibraryStore from "./LibraryStore.ts";
import * as Recovery from "./assets/LibraryRecoveryStore.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { LibraryAsset } from "./assets/LibraryAssetService.ts";
import { LibraryThreadArchive } from "@t3tools/contracts/fork";
import { libraryAttachments } from "./attachments.ts";

const Authority = Schema.Struct({
  id: LibraryId,
  epoch: Schema.Int.check(Schema.isGreaterThan(0)),
});
export const LibraryBackupManifest = Schema.Struct({
  version: Schema.Literal(1),
  createdAt: Schema.String,
  authority: Authority,
  database: Schema.Struct({
    digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    bytes: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
  projects: Schema.Int,
  copies: Schema.Int,
  threads: Schema.Int,
  threadVersions: Schema.Int,
  sourceCursors: Schema.Array(
    Schema.Struct({
      environmentId: Schema.String,
      journalId: Schema.String,
      lastSequence: Schema.Int,
    }),
  ),
  assets: Schema.Array(LibraryAsset),
  missingReferences: Schema.Array(
    Schema.Struct({ sourceEnvironmentId: Schema.String, attachmentId: Schema.String }),
  ),
  storageMode: Schema.Literals(["local", "b2"]),
  recovery: Schema.Array(
    Schema.Struct({
      sourceEnvironmentId: LibraryAsset.fields.sourceEnvironmentId,
      copyId: Schema.String,
      digest: Schema.String,
      byteLength: Schema.Int,
      archiveKey: Schema.String,
      manifest: LibraryRecoveryManifest,
      verifiedAt: Schema.String,
    }),
  ),
  recoveryBytesVerified: Schema.Boolean,
  assetBytesVerified: Schema.Boolean,
});
export type LibraryBackupManifest = typeof LibraryBackupManifest.Type;
export class LibraryMaintenance extends Context.Service<
  LibraryMaintenance,
  {
    readonly manifest: (input: {
      readonly databaseDigest: string;
      readonly databaseBytes: number;
    }) => Effect.Effect<LibraryBackupManifest, LibraryError>;
    readonly verifyAssets: (manifest: LibraryBackupManifest) => Effect.Effect<
      {
        readonly assets: number;
        readonly missing: number;
        readonly verified: boolean;
        readonly assetBytesVerified: boolean;
        readonly recoveryBytesVerified: boolean;
      },
      LibraryError
    >;
    readonly rotateAuthorityEpoch: (input: {
      readonly requestId: string;
      readonly expectedAuthorityId: string;
      readonly expectedEpoch: number;
    }) => Effect.Effect<typeof Authority.Type, LibraryError>;
  }
>()("t3/fork/project-library/LibraryMaintenance") {}
const authorityCodec = Schema.fromJsonString(Authority);
const decodeAuthority = Schema.decodeEffect(authorityCodec);
const encodeAuthority = Schema.encodeEffect(authorityCodec);
const decodeRecoveryManifest = Schema.decodeEffect(Schema.fromJsonString(LibraryRecoveryManifest));
const decodeArchive = Schema.decodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryThreadArchive)),
);
const Rotation = Schema.Struct({
  requestId: LibraryRequestId,
  expectedAuthorityId: LibraryId,
  expectedEpoch: Schema.Int.check(Schema.isGreaterThan(0)),
});
const encodeRotation = Schema.encodeEffect(Schema.fromJsonString(Rotation));
const isLibraryError = Schema.is(LibraryError);
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* LibraryStore.LibraryStore;
  const assets = yield* Assets.LibraryAssetService;
  const recovery = yield* Recovery.LibraryRecoveryStore;
  const crypto = yield* Crypto.Crypto;
  const mapError = (cause: unknown) =>
    isLibraryError(cause) ? cause : new LibraryError({ reason: "io" });
  const authority = Effect.gen(function* () {
    const row = (yield* sql<{
      value_json: string;
    }>`SELECT value_json FROM fork_library_identity WHERE key='authority'`)[0];
    if (!row) return yield* new LibraryError({ reason: "not-found" });
    return yield* decodeAuthority(row.value_json);
  });
  const verifyAssets = Effect.fnUntraced(function* (manifest: LibraryBackupManifest) {
    let missing = manifest.missingReferences.length;
    for (const asset of manifest.assets) {
      const valid = yield* Effect.gen(function* () {
        const saved = yield* assets.find(asset.sourceEnvironmentId, asset.attachmentId);
        if (saved.digest !== asset.digest || saved.bytes !== asset.bytes) return false;
        const bytes = yield* assets.read(saved);
        const digest = Hex.encode(yield* crypto.digest("SHA-256", bytes));
        return bytes.length === asset.bytes && digest === asset.digest;
      }).pipe(Effect.orElseSucceed(() => false));
      if (!valid) missing++;
    }
    const missingAssets = missing;
    for (const archive of manifest.recovery) {
      const valid = yield* recovery
        .verify(archive.sourceEnvironmentId, archive.copyId, archive.digest)
        .pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      if (!valid) missing++;
    }
    return {
      assets: manifest.assets.length + manifest.recovery.length,
      missing,
      verified: missing === 0,
      assetBytesVerified: missingAssets === 0,
      recoveryBytesVerified: missing === missingAssets,
    };
  });
  const manifest = Effect.fnUntraced(
    function* (input: { readonly databaseDigest: string; readonly databaseBytes: number }) {
      if (
        !/^[a-f0-9]{64}$/.test(input.databaseDigest) ||
        !Number.isInteger(input.databaseBytes) ||
        input.databaseBytes <= 0
      )
        return yield* new LibraryError({ reason: "invalid" });
      const identity = yield* authority;
      const rows = yield* sql<{
        source_environment_id: string;
        source_attachment_id: string;
        digest: string;
        filename: string;
        content_type: string;
        bytes: number;
        created_at: string;
      }>`SELECT * FROM fork_library_assets ORDER BY source_environment_id,source_attachment_id`;
      const storedAssets = rows.map((row) => ({
        sourceEnvironmentId: LibraryAsset.fields.sourceEnvironmentId.make(
          row.source_environment_id,
        ),
        attachmentId: row.source_attachment_id,
        digest: row.digest,
        filename: row.filename,
        contentType: row.content_type,
        bytes: row.bytes,
        createdAt: row.created_at,
      }));
      const references = new Map<string, { sourceEnvironmentId: string; attachmentId: string }>();
      // Versions keep only digests, so the attachments a backup must cover are the ones the saved
      // conversations still show.
      for (const row of yield* sql<{
        library_id: string;
      }>`SELECT library_id FROM fork_library_threads ORDER BY library_id`) {
        const payload = yield* store.history(row.library_id);
        if (!payload) return yield* new LibraryError({ reason: "not-found" });
        const archive = yield* decodeArchive(payload);
        for (const attachment of libraryAttachments(archive))
          references.set(`${archive.summary.environmentId}\0${attachment.id}`, {
            sourceEnvironmentId: archive.summary.environmentId,
            attachmentId: attachment.id,
          });
      }
      const present = new Set(
        storedAssets.map((asset) => `${asset.sourceEnvironmentId}\0${asset.attachmentId}`),
      );
      const missingReferences = [...references.entries()]
        .filter(([key]) => !present.has(key))
        .map(([, value]) => value);
      const recoveryRows = yield* sql<{
        source_environment_id: string;
        copy_id: string;
        digest: string;
        byte_length: number;
        archive_key: string;
        manifest_json: string;
        verified_at: string;
      }>`SELECT * FROM fork_library_recovery ORDER BY source_environment_id,copy_id,digest`;
      const recoveryArchives = yield* Effect.forEach(recoveryRows, (row) =>
        decodeRecoveryManifest(row.manifest_json).pipe(
          Effect.map((manifest) => ({
            sourceEnvironmentId: LibraryAsset.fields.sourceEnvironmentId.make(
              row.source_environment_id,
            ),
            copyId: row.copy_id,
            digest: row.digest,
            byteLength: row.byte_length,
            archiveKey: row.archive_key,
            manifest,
            verifiedAt: row.verified_at,
          })),
        ),
      );
      const counts = (yield* sql<{
        projects: number;
        copies: number;
        threads: number;
        versions: number;
      }>`SELECT (SELECT COUNT(*) FROM fork_library_projects) AS projects,(SELECT COUNT(*) FROM fork_library_working_copies) AS copies,(SELECT COUNT(*) FROM fork_library_threads) AS threads,(SELECT COUNT(*) FROM fork_library_thread_versions) AS versions`)[0]!;
      const cursors = yield* sql<{
        environment_id: string;
        journal_id: string;
        last_sequence: number;
      }>`SELECT environment_id,journal_id,last_sequence FROM fork_library_host_cursors ORDER BY environment_id,journal_id`;
      const draft = {
        version: 1 as const,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        authority: identity,
        database: { digest: input.databaseDigest, bytes: input.databaseBytes },
        projects: counts.projects,
        copies: counts.copies,
        threads: counts.threads,
        threadVersions: counts.versions,
        sourceCursors: cursors.map((row) => ({
          environmentId: row.environment_id,
          journalId: row.journal_id,
          lastSequence: row.last_sequence,
        })),
        assets: storedAssets,
        missingReferences,
        storageMode: assets.mode,
        recovery: recoveryArchives,
        recoveryBytesVerified: false,
        assetBytesVerified: false,
      };
      const verified = yield* verifyAssets(draft);
      return {
        ...draft,
        recoveryBytesVerified: verified.recoveryBytesVerified,
        assetBytesVerified: verified.assetBytesVerified,
      };
    },
    (effect) => sql.withTransaction(effect),
    Effect.mapError(mapError),
  );
  const rotateAuthorityEpoch = Effect.fnUntraced(
    function* (input: {
      readonly requestId: string;
      readonly expectedAuthorityId: string;
      readonly expectedEpoch: number;
    }) {
      const fingerprint = yield* encodeRotation(input);
      const receipt = (yield* sql<{
        operation: string;
        fingerprint: string;
        result_json: string;
      }>`SELECT operation,fingerprint,result_json FROM fork_library_commands WHERE request_id=${input.requestId}`)[0];
      if (receipt) {
        if (receipt.operation !== "rotate-authority" || receipt.fingerprint !== fingerprint)
          return yield* new LibraryError({ reason: "request-conflict" });
        return yield* decodeAuthority(receipt.result_json);
      }
      const current = yield* authority;
      if (current.id !== input.expectedAuthorityId || current.epoch !== input.expectedEpoch)
        return yield* new LibraryError({ reason: "revision-conflict" });
      const next = { ...current, epoch: current.epoch + 1 };
      const payload = yield* encodeAuthority(next);
      yield* sql`UPDATE fork_library_identity SET value_json=${payload} WHERE key='authority'`;
      yield* sql`INSERT INTO fork_library_commands(request_id,operation,fingerprint,result_json) VALUES (${input.requestId},'rotate-authority',${fingerprint},${payload})`;
      yield* sql`INSERT INTO fork_library_events(aggregate_id,event_type,payload_json,created_at) VALUES (${current.id},'authority.rotated',${payload},${DateTime.formatIso(yield* DateTime.now)})`;
      return next;
    },
    (effect) => sql.withTransaction(effect),
    Effect.mapError(mapError),
  );
  return LibraryMaintenance.of({ manifest, verifyAssets, rotateAuthorityEpoch });
});
export const layer = Layer.effect(LibraryMaintenance, make).pipe(Layer.provide(LibraryStore.layer));
