// @effect-diagnostics nodeBuiltinImport:off -- Content hashes pin API definitions and idempotent mutation receipts.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  LibraryApiBundle,
  LibraryApiCatalog,
  LibraryError,
  type LibraryApiRequest,
} from "@t3tools/contracts/fork";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { ServerConfig } from "../../config.ts";
import { LibraryService } from "./LibraryService.ts";
import { portableApiJson, portableApiWorkflows } from "../browser-dev-tools/apiPortable.ts";
import { importHoppscotch } from "../browser-dev-tools/hoppscotch.ts";
const StoredResult = Schema.Struct({
  ...LibraryApiCatalog.fields,
  selected: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[a-f\d]{64}$/))),
});
const decodeBundle = Schema.decodeEffect(Schema.fromJsonString(LibraryApiBundle));
const encodeBundle = Schema.encodeEffect(Schema.fromJsonString(LibraryApiBundle));
const Stored = Schema.Struct({
  versions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
  entries: Schema.Array(Schema.Struct({ revision: Schema.Int, bundle: LibraryApiBundle })),
  receipts: Schema.Array(
    Schema.Struct({ id: Schema.String, fingerprint: Schema.String, result: StoredResult }),
  ),
});
const decode = Schema.decodeEffect(Schema.fromJsonString(Stored));
const encode = Schema.encodeEffect(Schema.fromJsonString(Stored));
const digest = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(stableStringify(value)).digest("hex");
export class LibraryApiWorkspaces extends Context.Service<
  LibraryApiWorkspaces,
  { readonly execute: (input: LibraryApiRequest) => Effect.Effect<LibraryApiCatalog, LibraryError> }
>()("t3/fork/project-library/LibraryApiWorkspaces") {}
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const library = yield* LibraryService;
  const sql = yield* SqlClient.SqlClient;
  const isLibraryError = Schema.is(LibraryError);
  const ioError = (cause: unknown) =>
    isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause });
  const legacyFile = (projectId: string) =>
    path.join(config.stateDir, "fork", "library-api-workspaces", `${digest(projectId)}.json`);
  const readBundle = Effect.fn("LibraryApiWorkspaces.readBundle")(function* (
    projectId: string,
    hash: string,
  ) {
    const row = (yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM fork_library_api_bundles WHERE project_id=${projectId} AND digest=${hash}`)[0];
    if (!row)
      return yield* new LibraryError({
        reason: "io",
        detail: "A retained Pulse response is missing from Library storage.",
      });
    const bundle = yield* decodeBundle(row.payload_json);
    if (digest(bundle) !== hash)
      return yield* new LibraryError({
        reason: "io",
        detail: "A retained Pulse response failed its integrity check.",
      });
    return bundle;
  });
  const migrateProject = Effect.fn("LibraryApiWorkspaces.migrateProject")(
    function* (projectId: string) {
      if (
        (yield* sql`SELECT 1 FROM fork_library_api_catalogs WHERE project_id=${projectId}`).length
      )
        return;
      const file = legacyFile(projectId);
      const original = yield* fs.readFileString(file).pipe(
        Effect.catchIf(
          (e) => e.reason._tag === "NotFound",
          () => Effect.succeed(null),
        ),
      );
      if (original === null) return;
      const state = yield* decode(original);
      if (
        new Set(state.entries.map((e) => e.bundle.id)).size !== state.entries.length ||
        new Set(state.receipts.map((r) => r.id)).size !== state.receipts.length ||
        Object.values(state.versions ?? {}).some((revision) => revision < 0) ||
        state.entries.some(
          (e) => e.revision < 1 || (state.versions?.[e.bundle.id] ?? e.revision) !== e.revision,
        ) ||
        state.receipts.some((r) => r.result.projectId !== projectId)
      )
        return yield* new LibraryError({
          reason: "io",
          detail: "The legacy Pulse catalog failed validation. Its files have been preserved.",
        });
      const snapshots = new Map(state.entries.map((e) => [digest(e.bundle), e.bundle]));
      const retained = new Set(
        state.receipts.flatMap((r) => (r.result.selected ? [r.result.selected] : [])),
      );
      for (const hash of retained) {
        if (snapshots.has(hash)) continue;
        const bundle = yield* fs
          .readFileString(`${file}.${hash}`)
          .pipe(Effect.flatMap(decodeBundle));
        if (digest(bundle) !== hash)
          return yield* new LibraryError({
            reason: "io",
            detail:
              "A legacy Pulse response failed its integrity check. Its files have been preserved.",
          });
        snapshots.set(hash, bundle);
      }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (
            (yield* sql`SELECT 1 FROM fork_library_api_catalogs WHERE project_id=${projectId}`)
              .length
          )
            return;
          if ((yield* fs.readFileString(file)) !== original)
            return yield* new LibraryError({
              reason: "revision-conflict",
              detail:
                "The legacy Pulse catalog changed during migration. Stop the older Loom instance and retry.",
            });
          for (const hash of retained) {
            const payload = yield* encodeBundle(snapshots.get(hash)!);
            yield* sql`INSERT INTO fork_library_api_bundles(project_id,digest,payload_json) VALUES (${projectId},${hash},${payload})`;
          }
          const payload = yield* encode(state);
          yield* sql`INSERT INTO fork_library_api_catalogs(project_id,payload_json) VALUES (${projectId},${payload})`;
        }),
      );
    },
    Effect.mapError((cause) =>
      isLibraryError(cause)
        ? cause
        : new LibraryError({
            reason: "io",
            cause,
            detail:
              "Pulse could not migrate its saved catalog and retry receipts. The original files have been preserved.",
          }),
    ),
  );

  const execute = Effect.fn("LibraryApiWorkspaces.execute")(
    function* (input: LibraryApiRequest) {
      if (!(yield* library.info).isAuthority)
        return yield* new LibraryError({ reason: "not-authority" });
      const project = yield* library.project({ projectId: input.projectId });
      yield* migrateProject(input.projectId);
      const row = (yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM fork_library_api_catalogs WHERE project_id=${input.projectId}`)[0];
      const state = row
        ? yield* decode(row.payload_json)
        : ({ entries: [], receipts: [] } as typeof Stored.Type);
      const id = input.workspaceId ?? input.bundle?.id;
      const entry = state.entries.find((e) => e.bundle.id === id);
      const currentRevision = id ? (state.versions?.[id] ?? entry?.revision ?? 0) : 0;
      const read = (): LibraryApiCatalog => ({
        projectId: input.projectId,
        entries: state.entries.map((e) => ({
          id: e.bundle.id,
          name: e.bundle.name,
          revision: e.revision,
        })),
        revision: currentRevision,
        selected: input.action === "list" ? null : (entry?.bundle ?? null),
      });
      if (input.action === "list" || input.action === "read") return read();
      if (!input.requestId || !id) return yield* new LibraryError({ reason: "invalid" });
      const fingerprint = digest(input);
      const receipt = state.receipts.find((r) => r.id === input.requestId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          return yield* new LibraryError({ reason: "request-conflict" });
        const selected = receipt.result.selected
          ? yield* readBundle(input.projectId, receipt.result.selected)
          : null;
        return { ...receipt.result, selected };
      }
      if (project.archived)
        return yield* new LibraryError({
          reason: "blocked",
          detail: "Reopen this project before changing its API workspaces.",
        });
      if (currentRevision !== input.expectedRevision)
        return yield* new LibraryError({ reason: "revision-conflict" });
      let entries = state.entries.filter((e) => e.bundle.id !== id);
      if (input.action === "save") {
        if (!input.bundle || input.bundle.id !== id)
          return yield* new LibraryError({ reason: "invalid" });
        const bundle = yield* Effect.try({
          try: () => {
            const files = input.bundle!.files.map((f) => {
              if (!/^[^/\\\0]+\.json$/.test(f.name)) throw new Error("Invalid filename");
              const content = portableApiJson(f.content);
              importHoppscotch(content, f.name);
              return { name: f.name, content };
            });
            if (new Set(files.map((f) => f.name)).size !== files.length)
              throw new Error("Duplicate files");
            return {
              ...input.bundle!,
              files,
              workflows: portableApiWorkflows(input.bundle!.workflows),
            };
          },
          catch: (cause) => new LibraryError({ reason: "invalid", cause }),
        });
        entries = [...entries, { revision: currentRevision + 1, bundle }];
        if (entries.length > 32 || stableStringify(entries).length > 16777216)
          return yield* new LibraryError({
            reason: "invalid",
            detail: "This project's shared API definitions exceed 16 MiB.",
          });
      }
      const selected = entries.find((e) => e.bundle.id === id);
      const result: LibraryApiCatalog = {
        projectId: input.projectId,
        entries: entries.map((e) => ({
          id: e.bundle.id,
          name: e.bundle.name,
          revision: e.revision,
        })),
        revision: currentRevision + 1,
        selected: selected?.bundle ?? null,
      };
      const selectedHash = result.selected ? digest(result.selected) : null;
      const next = {
        versions: { ...state.versions, [id]: currentRevision + 1 },
        entries,
        receipts: [
          ...state.receipts.slice(-19),
          { id: input.requestId, fingerprint, result: { ...result, selected: selectedHash } },
        ],
      };
      if (result.selected && selectedHash) {
        const payload = yield* encodeBundle(result.selected);
        yield* sql`INSERT INTO fork_library_api_bundles(project_id,digest,payload_json) VALUES (${input.projectId},${selectedHash},${payload}) ON CONFLICT(project_id,digest) DO NOTHING`;
      }
      const payload = yield* encode(next);
      yield* sql`INSERT INTO fork_library_api_catalogs(project_id,payload_json) VALUES (${input.projectId},${payload}) ON CONFLICT(project_id) DO UPDATE SET payload_json=excluded.payload_json`;
      const retained = [
        ...new Set(next.receipts.flatMap((r) => (r.result.selected ? [r.result.selected] : []))),
      ];
      if (retained.length)
        yield* sql`DELETE FROM fork_library_api_bundles WHERE project_id=${input.projectId} AND digest NOT IN ${sql.in(retained)}`;
      else yield* sql`DELETE FROM fork_library_api_bundles WHERE project_id=${input.projectId}`;
      return result;
    },
    (effect) => sql.withTransaction(effect),
    Effect.mapError(ioError),
  );
  if ((yield* library.info).isAuthority) {
    const projects = yield* sql<{
      id: string;
    }>`SELECT id FROM fork_library_projects ORDER BY id`.pipe(Effect.mapError(ioError));
    for (const project of projects) yield* migrateProject(project.id);
  }
  return LibraryApiWorkspaces.of({ execute });
});
export const layer = Layer.effect(LibraryApiWorkspaces, make);
