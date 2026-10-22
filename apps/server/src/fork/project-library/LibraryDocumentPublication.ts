import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_DECISIONS_FEATURE,
  LIBRARY_DOCUMENT_BATCH_SIZE,
  LibraryError,
  type LibraryDocument,
  LibraryDocumentsPublishRequest,
  type LibraryProject,
  type LibraryResource,
} from "@t3tools/contracts/fork";
import {
  documentSources,
  matchesDocumentSource,
  parseDecisionDocument,
  splitCatalogue,
} from "@t3tools/shared/fork/library-decisions";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as ProcessRunner from "../../processRunner.ts";
import { documentDigest } from "./LibraryDocuments.ts";
import type { LibraryPublisher } from "./LibraryPublisher.ts";
import type { LibraryWorkspaceStore } from "./LibraryWorkspaceStore.ts";

export const DOCUMENT_REPORT_INTERVAL = Duration.minutes(15);
const MAX_TREE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENTS = 10_000;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeBatch = Schema.encodeSync(Schema.fromJsonString(LibraryDocumentsPublishRequest));
const decodeBatch = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LibraryDocumentsPublishRequest),
);
const invalid = () => new LibraryError({ reason: "invalid" });
const io = (cause: unknown) => new LibraryError({ reason: "io", cause });

export class LibraryDocumentSource extends Context.Service<
  LibraryDocumentSource,
  {
    readonly read: (input: {
      readonly projectId: string;
      readonly resource: LibraryResource;
      readonly cwd: string;
    }) => Effect.Effect<
      { readonly commit: string; readonly documents: ReadonlyArray<LibraryDocument> },
      LibraryError
    >;
  }
>()("t3/fork/project-library/LibraryDocumentPublication/LibraryDocumentSource") {}

export const layerSource = Layer.effect(
  LibraryDocumentSource,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const crypto = yield* Crypto.Crypto;
    const git = Effect.fn("LibraryDocumentSource.git")(function* (
      cwd: string,
      args: ReadonlyArray<string>,
      maxOutputBytes = MAX_TREE_BYTES,
    ) {
      const result = yield* runner
        .run({
          command: "git",
          args: [
            "--no-pager",
            "--no-optional-locks",
            "--no-replace-objects",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            ...args,
          ],
          cwd,
          env: { GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
          timeout: "30 seconds",
          maxOutputBytes,
        })
        .pipe(Effect.mapError(io));
      if (result.code !== 0 || result.stdoutTruncated || result.stdoutInvalidUtf8)
        return yield* new LibraryError({ reason: "io" });
      return result.stdout;
    });
    const read = Effect.fn("LibraryDocumentSource.read")(function* (input: {
      readonly projectId: string;
      readonly resource: LibraryResource;
      readonly cwd: string;
    }) {
      const branch = input.resource.defaultBranch;
      if (
        !branch ||
        branch.startsWith("-") ||
        /[\s~^:?*[\\\p{Cc}]/u.test(branch) ||
        branch.includes("..") ||
        branch.includes("@{") ||
        branch.startsWith("/") ||
        branch.endsWith("/") ||
        branch.endsWith(".")
      )
        return yield* invalid();
      const ref = `refs/heads/${branch}`;
      const local = yield* git(
        input.cwd,
        ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
        128,
      ).pipe(Effect.option);
      const commit = (
        local._tag === "Some"
          ? local.value
          : yield* git(
              input.cwd,
              [
                "rev-parse",
                "--verify",
                "--end-of-options",
                `refs/remotes/origin/${branch}^{commit}`,
              ],
              128,
            )
      ).trim();
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(commit)) return yield* invalid();
      const tree = yield* git(input.cwd, ["ls-tree", "-r", "-z", "-l", commit]);
      const files = new Map<string, { oid: string; size: number }>();
      for (const entry of tree.split("\0")) {
        if (!entry) continue;
        const parsed = /^(100644|100755) blob ([a-f0-9]{40,64})\s+(\d+)\t([\s\S]+)$/u.exec(entry);
        if (entry.endsWith("\tloom-documents.json") && !parsed) return yield* invalid();
        if (parsed) files.set(parsed[4]!, { oid: parsed[2]!, size: Number(parsed[3]) });
      }
      const manifest = files.get("loom-documents.json");
      if (manifest && manifest.size > 64 * 1024) return yield* invalid();
      const rawManifest = manifest
        ? yield* git(input.cwd, ["show", "--no-textconv", "--no-ext-diff", manifest.oid], 64 * 1024)
        : undefined;
      const sources = yield* Effect.try({
        try: () => documentSources(rawManifest),
        catch: invalid,
      });
      const documents: LibraryDocument[] = [];
      for (const [path, file] of files) {
        const source = sources.find((source) => matchesDocumentSource(path, source));
        if (!source) continue;
        if (file.size > MAX_SOURCE_BYTES) return yield* invalid();
        const text = yield* git(
          input.cwd,
          ["show", "--no-textconv", "--no-ext-diff", file.oid],
          MAX_SOURCE_BYTES,
        );
        const parsed =
          source.kind === "catalogue"
            ? splitCatalogue(text, source.split ?? "###").map((item) => ({ ...item, path }))
            : [parseDecisionDocument(path, text)];
        for (const item of parsed) {
          if (documents.length >= MAX_DOCUMENTS) return yield* invalid();
          const document = { ...item, projectId: input.projectId, resourceId: input.resource.id };
          documents.push({
            ...document,
            digest: yield* documentDigest(document).pipe(
              Effect.provideService(Crypto.Crypto, crypto),
            ),
          });
        }
      }
      return { commit, documents };
    });
    return LibraryDocumentSource.of({ read });
  }),
);

/** Acknowledgements are persisted per authority fence so restarts retry removals and skip unchanged records. */
export const makeDocumentPublication = Effect.fn("LibraryDocumentPublication.make")(
  function* (input: {
    readonly environmentId: EnvironmentId;
    readonly publisher: Pick<
      LibraryPublisher["Service"],
      "info" | "project" | "publishDocuments" | "copyRegistrations"
    >;
    readonly workspaces: Pick<LibraryWorkspaceStore["Service"], "receipts">;
    readonly source: LibraryDocumentSource["Service"];
  }) {
    const sql = yield* SqlClient.SqlClient;
    const lock = yield* Semaphore.make(1);
    const deliver = Effect.fn("LibraryDocumentPublication.deliver")(function* (
      request: LibraryDocumentsPublishRequest,
      payload: string,
    ) {
      yield* input.publisher.publishDocuments(request);
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            for (const row of request.documents)
              yield* sql`INSERT OR REPLACE INTO fork_library_document_publications (computer_id, authority_id, authority_epoch, project_id, resource_id, path, anchor, digest) VALUES (${request.computerId}, ${request.authorityId}, ${request.authorityEpoch}, ${request.projectId}, ${request.resourceId}, ${row.path}, ${row.anchor}, ${row.digest})`;
            for (const row of request.removed)
              yield* sql`DELETE FROM fork_library_document_publications WHERE computer_id = ${request.computerId} AND authority_id = ${request.authorityId} AND authority_epoch = ${request.authorityEpoch} AND project_id = ${request.projectId} AND resource_id = ${request.resourceId} AND path = ${row.path} AND anchor = ${row.anchor}`;
            yield* sql`DELETE FROM fork_library_document_pending_batches WHERE computer_id = ${request.computerId} AND authority_id = ${request.authorityId} AND authority_epoch = ${request.authorityEpoch} AND project_id = ${request.projectId} AND resource_id = ${request.resourceId} AND payload_json = ${payload}`;
          }),
        )
        .pipe(Effect.mapError(io));
    });
    const report = Effect.fn("LibraryDocumentPublication.report")(function* () {
      const info = yield* input.publisher.info;
      if (!info.features?.includes(LIBRARY_DECISIONS_FEATURE)) return;
      const seen = new Set<string>();
      const projects = new Map<string, LibraryProject>();
      let failure: LibraryError | null = null;
      for (const receipt of yield* input.workspaces.receipts) {
        const copy = receipt.copy;
        if (
          copy.environmentId !== input.environmentId ||
          copy.registered === false ||
          copy.state !== "ready"
        )
          continue;
        const result = yield* Effect.gen(function* () {
          let project = projects.get(copy.projectId);
          if (!project) {
            project = yield* input.publisher.project(copy.projectId);
            projects.set(copy.projectId, project);
          }
          for (const repository of copy.repositories) {
            const resource = project.resources.find(
              (resource) =>
                resource.id === repository.resourceId &&
                resource.kind !== "link" &&
                resource.defaultBranch !== null,
            );
            if (!resource) continue;
            const key = encodeJson([project.id, resource.id]);
            if (seen.has(key)) continue;
            const resourceResult = yield* Effect.gen(function* () {
              // A response can be lost after acceptance. Replay the immutable request before
              // reading new bytes so a later deletion still produces a tombstone from its baseline.
              const pending = yield* sql<{
                payload_json: string;
              }>`SELECT payload_json FROM fork_library_document_pending_batches WHERE computer_id = ${input.environmentId} AND authority_id = ${info.authorityId} AND authority_epoch = ${info.authorityEpoch} AND project_id = ${project.id} AND resource_id = ${resource.id}`.pipe(
                Effect.mapError(io),
              );
              for (const batch of pending) {
                const request = yield* decodeBatch(batch.payload_json).pipe(Effect.mapError(io));
                if (
                  request.computerId !== input.environmentId ||
                  request.authorityId !== info.authorityId ||
                  request.authorityEpoch !== info.authorityEpoch ||
                  request.projectId !== project.id ||
                  request.resourceId !== resource.id
                )
                  return yield* invalid();
                yield* deliver(request, batch.payload_json);
              }
              const snapshot = yield* input.source.read({
                projectId: project.id,
                resource,
                cwd: repository.path,
              });
              const saved = yield* sql<{
                path: string;
                anchor: string;
                digest: string;
              }>`SELECT path, anchor, digest FROM fork_library_document_publications WHERE computer_id = ${input.environmentId} AND authority_id = ${info.authorityId} AND authority_epoch = ${info.authorityEpoch} AND project_id = ${project.id} AND resource_id = ${resource.id}`.pipe(
                Effect.mapError(io),
              );
              const byKey = new Map(
                saved.map((row) => [encodeJson([row.path, row.anchor]), row.digest]),
              );
              const current = new Set(
                snapshot.documents.map((row) => encodeJson([row.path, row.anchor])),
              );
              const changes: Array<
                { document: LibraryDocument } | { removed: { path: string; anchor: string } }
              > = [
                ...snapshot.documents
                  .filter((row) => byKey.get(encodeJson([row.path, row.anchor])) !== row.digest)
                  .map((document) => ({ document })),
                ...saved
                  .filter((row) => !current.has(encodeJson([row.path, row.anchor])))
                  .map(({ path, anchor }) => ({ removed: { path, anchor } })),
              ];
              for (let offset = 0; offset < changes.length; offset += LIBRARY_DOCUMENT_BATCH_SIZE) {
                const batch = changes.slice(offset, offset + LIBRARY_DOCUMENT_BATCH_SIZE);
                const request: LibraryDocumentsPublishRequest = {
                  computerId: input.environmentId,
                  projectId: project.id,
                  resourceId: resource.id,
                  commit: snapshot.commit,
                  authorityId: info.authorityId,
                  authorityEpoch: info.authorityEpoch,
                  documents: batch.flatMap((item) => ("document" in item ? [item.document] : [])),
                  removed: batch.flatMap((item) => ("removed" in item ? [item.removed] : [])),
                };
                const payload = encodeBatch(request);
                yield* sql`INSERT INTO fork_library_document_pending_batches (computer_id, authority_id, authority_epoch, project_id, resource_id, payload_json) VALUES (${request.computerId}, ${request.authorityId}, ${request.authorityEpoch}, ${request.projectId}, ${request.resourceId}, ${payload})`.pipe(
                  Effect.mapError(io),
                );
                yield* deliver(request, payload);
              }
              seen.add(key);
            }).pipe(Effect.result);
            if (resourceResult._tag === "Failure") failure ??= resourceResult.failure;
          }
        }).pipe(Effect.result);
        if (result._tag === "Failure") failure ??= result.failure;
      }
      if (failure) return yield* failure;
    }, lock.withPermit);
    const run = Effect.all(
      [
        report().pipe(Effect.ignore, Effect.repeat(Schedule.spaced(DOCUMENT_REPORT_INTERVAL))),
        input.publisher.copyRegistrations.pipe(
          Stream.runForEach(() => report().pipe(Effect.ignore)),
        ),
      ],
      { concurrency: "unbounded", discard: true },
    );
    return { report: report(), run };
  },
);
