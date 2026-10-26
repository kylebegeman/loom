import { ThreadId } from "@t3tools/contracts";
import { LibraryError, type LibraryThreadArchive } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { receiptsForArchive } from "../agent-receipts/AgentReceipts.ts";
import { isWithheld, withheldError } from "../deleted-history/deletedHistory.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";

export class LibraryHistorySource extends Context.Service<
  LibraryHistorySource,
  {
    readonly snapshotThread: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<LibraryThreadArchive, LibraryError>;
  }
>()("t3/fork/project-library/LibraryHistorySource") {}

const isLibraryError = Schema.is(LibraryError);
const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const workspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const snapshotThread = Effect.fnUntraced(
    function* (input: { readonly threadId: ThreadId }) {
      const environmentId = yield* identity.getEnvironmentId;
      const bound = yield* workspaces.getBinding(input.threadId);
      const saved = bound === null ? yield* workspaces.savedBinding(input.threadId) : null;
      const resolved = bound ?? saved;
      if (resolved === null) return yield* new LibraryError({ reason: "not-found" });
      if (resolved.binding.environmentId !== environmentId)
        return yield* new LibraryError({ reason: "invalid" });
      // The projection and its event watermark are read in one transaction by the store.
      const context = saved?.project ?? (yield* workspaces.getBoundProject(input.threadId));
      if (
        context === null ||
        context.id !== resolved.binding.projectId ||
        context.revision !== resolved.binding.projectRevision
      )
        return yield* new LibraryError({ reason: "invalid" });
      const snapshot = yield* projections.getThreadSnapshot(input.threadId);
      const { projection } = snapshot;
      if (projection.thread.projectId !== resolved.localProjectId)
        return yield* new LibraryError({ reason: "invalid" });
      // Checked after the snapshot: a purge records the deletion as acknowledged before its first
      // delete, so a snapshot that saw any of it is refused here.
      if (projection.thread.deletedAt !== null && (yield* isWithheld(sql, input.threadId)))
        return yield* withheldError();
      // A saved conversation deleted before its first upload never goes to the Library.
      if (
        saved !== null &&
        projection.thread.deletedAt !== null &&
        (yield* sql`SELECT 1 FROM fork_library_source_threads WHERE thread_id=${input.threadId}`)
          .length === 0
      )
        return yield* withheldError();
      const id = Hex.encode(
        yield* crypto.digest(
          "SHA-256",
          new TextEncoder().encode(`${environmentId}\0${input.threadId}`),
        ),
      );
      const receipts = yield* receiptsForArchive(sql, input.threadId, snapshot.snapshotSequence);
      const latestRun = projection.runs.reduce<(typeof projection.runs)[number] | undefined>(
        (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
        undefined,
      );
      return {
        summary: {
          id,
          projectId: resolved.binding.projectId,
          projectRevision: resolved.binding.projectRevision,
          environmentId,
          threadId: input.threadId,
          localProjectId: resolved.localProjectId,
          workingCopyId: resolved.binding.workingCopyId,
          resourceIds: resolved.binding.resourceIds,
          ...(resolved.binding.continuationOf === undefined
            ? {}
            : { continuationOf: resolved.binding.continuationOf }),
          title: projection.thread.title,
          status: latestRun?.status ?? "idle",
          archived: projection.thread.archivedAt !== null,
          settled: projection.thread.settledOverride === "settled",
          deleted: projection.thread.deletedAt !== null,
          createdAt: DateTime.formatIso(projection.thread.createdAt),
          updatedAt: DateTime.formatIso(projection.updatedAt),
          syncedAt: DateTime.formatIso(yield* DateTime.now),
          sequence: snapshot.snapshotSequence,
        },
        context,
        projection,
        ...(receipts.length === 0 ? {} : { receipts }),
      } satisfies LibraryThreadArchive;
    },
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );
  return LibraryHistorySource.of({ snapshotThread });
});
export const layer = Layer.effect(LibraryHistorySource, make);
