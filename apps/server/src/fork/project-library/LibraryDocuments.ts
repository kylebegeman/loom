import {
  LIBRARY_DOCUMENT_BATCH_SIZE,
  LIBRARY_DOCUMENT_MAX_BYTES,
  LibraryDocument,
  LibraryDocumentsPublishRequest,
  LibraryDecisionsSearchInput,
  LibraryError,
  LibraryProject,
  LibraryWorkingCopy,
  type LibraryDecisionsSearchResult,
  type LibraryDocumentsPublishResult,
} from "@t3tools/contracts/fork";
import { safeDocumentPath } from "@t3tools/shared/fork/library-decisions";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { LIBRARY_EMBEDDING_MAX_CHARS, LibraryEmbedder } from "./LibraryEmbedder.ts";
import { leadSnippet, libraryMatchQuery } from "./LibrarySearch.ts";
import {
  fuseRankings,
  quantizeEmbedding,
  SEMANTIC_DEPTH,
  SEMANTIC_MIN_SIMILARITY,
  storedSimilarity,
} from "./LibrarySemanticSearch.ts";

export const LIBRARY_DOCUMENTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS fork_library_documents (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, resource_id TEXT NOT NULL, path TEXT NOT NULL, anchor TEXT NOT NULL, computer_id TEXT NOT NULL, commit_id TEXT NOT NULL, digest TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, payload_json TEXT NOT NULL, UNIQUE(project_id, resource_id, path, anchor))`,
  `CREATE INDEX IF NOT EXISTS fork_library_documents_scope ON fork_library_documents(project_id, resource_id, status, kind)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS fork_library_documents_fts USING fts5(title, text, content='fork_library_documents', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER IF NOT EXISTS fork_library_documents_insert AFTER INSERT ON fork_library_documents BEGIN INSERT INTO fork_library_documents_fts(rowid, title, text) VALUES (new.id, new.title, new.text); END`,
  `CREATE TRIGGER IF NOT EXISTS fork_library_documents_delete AFTER DELETE ON fork_library_documents BEGIN INSERT INTO fork_library_documents_fts(fork_library_documents_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text); DELETE FROM fork_library_document_vectors WHERE id = old.id; END`,
  `CREATE TRIGGER IF NOT EXISTS fork_library_documents_update AFTER UPDATE ON fork_library_documents BEGIN INSERT INTO fork_library_documents_fts(fork_library_documents_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text); INSERT INTO fork_library_documents_fts(rowid, title, text) VALUES (new.id, new.title, new.text); END`,
  `CREATE TABLE IF NOT EXISTS fork_library_document_vectors (id INTEGER PRIMARY KEY, model TEXT NOT NULL, scale REAL NOT NULL, vector BLOB NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS fork_library_document_vectors_update AFTER UPDATE OF title, text ON fork_library_documents WHEN old.title IS NOT new.title OR substr(old.text, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) IS NOT substr(new.text, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) BEGIN DELETE FROM fork_library_document_vectors WHERE id = old.id; END`,
  `CREATE TABLE IF NOT EXISTS fork_library_document_publications (computer_id TEXT NOT NULL, authority_id TEXT NOT NULL, authority_epoch INTEGER NOT NULL, project_id TEXT NOT NULL, resource_id TEXT NOT NULL, path TEXT NOT NULL, anchor TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(computer_id, authority_id, authority_epoch, project_id, resource_id, path, anchor))`,
] as const;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeDocument = Schema.encodeSync(Schema.fromJsonString(LibraryDocument));
const decodeDocument = Schema.decodeUnknownSync(Schema.fromJsonString(LibraryDocument));
const decodeProject = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryProject));
const decodeCopy = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryWorkingCopy));
const decodePublish = Schema.decodeUnknownEffect(LibraryDocumentsPublishRequest);
const decodeSearch = Schema.decodeUnknownEffect(LibraryDecisionsSearchInput);
const io = (cause: unknown) => new LibraryError({ reason: "io", cause });
const isLibraryError = Schema.is(LibraryError);
const invalid = () => new LibraryError({ reason: "invalid" });

/** All content and metadata affect publication, including a catalogue item's status. */
export const documentDigest = Effect.fn("LibraryDocuments.documentDigest")(function* (
  document: Omit<LibraryDocument, "digest">,
) {
  const crypto = yield* Crypto.Crypto;
  return Hex.encode(
    yield* crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          encodeJson([
            document.projectId,
            document.resourceId,
            document.path,
            document.anchor,
            document.title,
            document.kind,
            document.status,
            document.date ?? null,
            document.supersededBy ?? null,
            document.text,
          ]),
        ),
      )
      .pipe(Effect.mapError(io)),
  );
});

export const makeLibraryDocuments = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const embedder = yield* LibraryEmbedder;
  // Both ranking paths check current manifest and copy membership. Removing authorization hides
  // saved documents immediately, even before another publisher can refresh the index.
  const authorized = sql`EXISTS (SELECT 1 FROM fork_library_computers AS e WHERE e.environment_id = d.computer_id) AND EXISTS (
    SELECT 1 FROM fork_library_projects AS p, json_each(p.payload_json, '$.resources') AS r
    WHERE p.id = d.project_id AND json_extract(r.value, '$.id') = d.resource_id
      AND coalesce(json_extract(r.value, '$.kind'), 'repository') = 'repository'
  ) AND EXISTS (
    SELECT 1 FROM fork_library_working_copies AS c, json_each(c.payload_json, '$.repositories') AS r
    WHERE c.project_id = d.project_id AND c.environment_id = d.computer_id
      AND c.state IN ('ready', 'missing') AND coalesce(json_extract(c.payload_json, '$.registered'), 1) <> 0
      AND json_extract(r.value, '$.resourceId') = d.resource_id
  )`;

  const publish = Effect.fn("LibraryDocuments.publish")(function* (
    untrusted: LibraryDocumentsPublishRequest,
  ): Effect.fn.Return<LibraryDocumentsPublishResult, LibraryError> {
    const input = yield* decodePublish(untrusted).pipe(Effect.mapError(invalid));
    if (input.documents.length + input.removed.length > LIBRARY_DOCUMENT_BATCH_SIZE)
      return yield* invalid();
    const keys = [...input.documents, ...input.removed].map(({ path, anchor }) =>
      encodeJson([path, anchor]),
    );
    if (
      new Set(keys).size !== keys.length ||
      [...input.documents, ...input.removed].some(
        ({ path, anchor }) => !safeDocumentPath(path) || /[\p{Cc}]/u.test(anchor),
      )
    )
      return yield* invalid();
    for (const document of input.documents) {
      if (
        document.projectId !== input.projectId ||
        document.resourceId !== input.resourceId ||
        new TextEncoder().encode(document.text).length > LIBRARY_DOCUMENT_MAX_BYTES ||
        document.digest !==
          (yield* documentDigest(document).pipe(Effect.provideService(Crypto.Crypto, crypto)))
      )
        return yield* invalid();
    }
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const projects = yield* sql<{
            payload_json: string;
          }>`SELECT payload_json FROM fork_library_projects WHERE id = ${input.projectId}`;
          const saved = projects[0];
          if (!saved) return yield* new LibraryError({ reason: "not-found" });
          const project = yield* decodeProject(saved.payload_json).pipe(Effect.mapError(io));
          const resource = project.resources.find(
            (entry) => entry.id === input.resourceId && entry.kind !== "link",
          );
          if (!resource) return yield* new LibraryError({ reason: "blocked" });
          const computers =
            yield* sql`SELECT 1 FROM fork_library_computers WHERE environment_id = ${input.computerId}`;
          if (computers.length === 0) return yield* new LibraryError({ reason: "blocked" });
          const copies = yield* sql<{
            payload_json: string;
          }>`SELECT payload_json FROM fork_library_working_copies WHERE project_id = ${input.projectId} AND environment_id = ${input.computerId} AND state IN ('ready', 'missing')`;
          const decoded = yield* Effect.forEach(copies, (row) =>
            decodeCopy(row.payload_json).pipe(Effect.mapError(io)),
          );
          if (
            !decoded.some(
              (copy) =>
                copy.registered !== false &&
                copy.repositories.some((repo) => repo.resourceId === input.resourceId),
            )
          )
            return yield* new LibraryError({ reason: "blocked" });
          let published = 0;
          let removed = 0;
          for (const key of input.removed) {
            const rows =
              yield* sql`DELETE FROM fork_library_documents WHERE project_id = ${input.projectId} AND resource_id = ${input.resourceId} AND path = ${key.path} AND anchor = ${key.anchor} AND computer_id = ${input.computerId} RETURNING id`;
            removed += rows.length;
          }
          for (const document of input.documents) {
            const rows =
              yield* sql`INSERT INTO fork_library_documents (project_id, resource_id, path, anchor, computer_id, commit_id, digest, kind, status, title, text, payload_json)
          VALUES (${input.projectId}, ${input.resourceId}, ${document.path}, ${document.anchor}, ${input.computerId}, ${input.commit}, ${document.digest}, ${document.kind}, ${document.status}, ${document.title}, ${document.text}, ${encodeDocument(document)})
          ON CONFLICT(project_id, resource_id, path, anchor) DO UPDATE SET computer_id = excluded.computer_id, commit_id = excluded.commit_id, digest = excluded.digest, kind = excluded.kind, status = excluded.status, title = excluded.title, text = excluded.text, payload_json = excluded.payload_json
          WHERE fork_library_documents.digest <> excluded.digest OR fork_library_documents.computer_id <> excluded.computer_id RETURNING id`;
            published += rows.length;
          }
          return { published, removed };
        }),
      )
      .pipe(Effect.mapError((cause) => (isLibraryError(cause) ? cause : io(cause))));
  });

  const embedPending = Effect.fn("LibraryDocuments.embedPending")(function* () {
    if (!embedder) return 0;
    const pending = yield* sql<{
      id: number;
      title: string;
      text: string;
    }>`SELECT d.id, d.title, substr(d.text, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) AS text FROM fork_library_documents AS d WHERE ${authorized} AND NOT EXISTS (SELECT 1 FROM fork_library_document_vectors AS v WHERE v.id = d.id AND v.model = ${embedder.model}) ORDER BY d.id DESC LIMIT 16`;
    for (const item of pending) {
      const { bytes, scale } = quantizeEmbedding(
        yield* embedder.embed(`${item.title}\n${item.text}`),
      );
      yield* sql`INSERT OR REPLACE INTO fork_library_document_vectors (id, model, scale, vector) SELECT d.id, ${embedder.model}, ${scale}, ${bytes} FROM fork_library_documents AS d WHERE d.id = ${item.id} AND d.title = ${item.title} AND substr(d.text, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) = ${item.text} AND ${authorized}`;
    }
    return pending.length;
  });
  const backfill =
    embedder === null
      ? Effect.never
      : embedPending().pipe(
          Effect.flatMap((count) =>
            Effect.sleep(count === 16 ? Duration.millis(250) : Duration.minutes(5)),
          ),
          Effect.catch(() => Effect.sleep(Duration.minutes(10))),
          Effect.repeat(Schedule.forever),
          Effect.delay(Duration.seconds(30)),
        );
  const search = Effect.fn("LibraryDocuments.search")(
    function* (untrusted: LibraryDecisionsSearchInput) {
      const input = yield* decodeSearch(untrusted).pipe(Effect.mapError(invalid));
      const match = libraryMatchQuery(input.query);
      if (!match) return { hits: [] };
      const scope = sql`${authorized} AND (${input.projectId ?? null} IS NULL OR d.project_id = ${input.projectId ?? null}) AND (${input.kind ?? null} IS NULL OR d.kind = ${input.kind ?? null}) AND (${input.includeRetired === true ? 1 : 0} = 1 OR d.status <> 'superseded')`;
      const words = yield* sql<{
        id: number;
      }>`SELECT d.id FROM fork_library_documents_fts JOIN fork_library_documents AS d ON d.id = fork_library_documents_fts.rowid WHERE fork_library_documents_fts MATCH ${match} AND ${scope} ORDER BY CASE WHEN instr(lower(d.title || char(10) || d.text), lower(${input.query.trim()})) > 0 THEN 0 ELSE 1 END, bm25(fork_library_documents_fts, 2.0, 1.0), d.id LIMIT 100`;
      const query =
        embedder === null || /"[^"]+"/u.test(input.query)
          ? null
          : yield* embedder.embed(input.query).pipe(
              Effect.timeoutOption(Duration.seconds(3)),
              Effect.option,
              Effect.map((result) =>
                result._tag === "Some" && result.value._tag === "Some" ? result.value.value : null,
              ),
            );
      const meanings =
        query === null || embedder === null
          ? []
          : (yield* sql<{
              id: number;
              scale: number;
              vector: Uint8Array;
            }>`SELECT d.id, v.scale, v.vector FROM fork_library_document_vectors AS v JOIN fork_library_documents AS d ON d.id = v.id WHERE v.model = ${embedder.model} AND ${scope}`)
              .map((row) => ({
                id: row.id,
                similarity: storedSimilarity(query, row.scale, row.vector),
              }))
              .filter((row) => row.similarity >= SEMANTIC_MIN_SIMILARITY)
              .sort((a, b) => b.similarity - a.similarity || a.id - b.id)
              .slice(0, SEMANTIC_DEPTH)
              .map(({ id }) => id);
      const ranked = fuseRankings(
        words.map(({ id }) => id),
        meanings,
      );
      if (ranked.length === 0) return { hits: [] };
      const rows = yield* sql<{
        id: number;
        payload_json: string;
        commit_id: string;
        repository: string;
        status: string;
      }>`SELECT d.id, d.payload_json, d.commit_id, d.status, coalesce(json_extract(r.value, '$.remoteUrl'), json_extract(r.value, '$.title')) AS repository FROM fork_library_documents AS d JOIN fork_library_projects AS p ON p.id = d.project_id, json_each(p.payload_json, '$.resources') AS r WHERE d.id IN ${sql.in(ranked.map(({ id }) => id))} AND json_extract(r.value, '$.id') = d.resource_id AND ${scope}`;
      const byId = new Map(rows.map((row) => [row.id, row]));
      // Decided and active records precede ideas; retired records remain marked at the end.
      const statusOrder = (status: string) =>
        status === "superseded" ? 2 : status === "accepted" || status === "in-progress" ? 0 : 1;
      const entries = ranked
        .filter(({ id }) => byId.has(id))
        .sort((a, b) => statusOrder(byId.get(a.id)!.status) - statusOrder(byId.get(b.id)!.status))
        .slice(0, input.limit ?? 20);
      const hits = yield* Effect.forEach(entries, (entry) =>
        Effect.try({
          try: () => {
            const row = byId.get(entry.id)!;
            const document = decodeDocument(row.payload_json);
            return {
              ...document,
              repository: row.repository,
              commit: row.commit_id,
              snippet: leadSnippet(document.text),
              rank: entry.score,
              ...(query === null
                ? {}
                : {
                    match:
                      entry.text && entry.semantic
                        ? ("both" as const)
                        : entry.semantic
                          ? ("semantic" as const)
                          : ("text" as const),
                  }),
            };
          },
          catch: io,
        }),
      );
      return { hits } satisfies LibraryDecisionsSearchResult;
    },
    Effect.mapError((cause) => (isLibraryError(cause) ? cause : io(cause))),
  );
  return { publish, search, embedPending, backfill };
});
