// @effect-diagnostics preferSchemaOverJson:off -- fixtures intentionally exercise opaque archive JSON stored by LibraryStore.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as SqlClient from "effect/sql/SqlClient";
import { runForkMigrationSet } from "../src/fork/persistence/migrations.ts";
import { LibraryEmbedder } from "../src/fork/project-library/LibraryEmbedder.ts";
import { makeLibrarySearch } from "../src/fork/project-library/LibrarySearch.ts";
import * as LibraryStore from "../src/fork/project-library/LibraryStore.ts";
import { ProjectLibraryMigrations } from "../src/fork/project-library/migrations.ts";

export async function createLibraryBenchmarkFixture(historyItems: number) {
  const runtime = ManagedRuntime.make(
    LibraryStore.layer.pipe(
      Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        const sql = yield* SqlClient.SqlClient;
        const store = yield* LibraryStore.LibraryStore;
        const search = yield* makeLibrarySearch.pipe(Effect.provideService(LibraryEmbedder, null));
        const timestamp = "2026-10-01T00:00:00.000Z";
        const id = `benchmark-history-${historyItems}`;
        const messages = Array.from({ length: historyItems }, (_, position) => ({
          id: `message-${position}`,
          role: position % 2 === 0 ? "user" : "assistant",
          text: `History item ${position}: inspect project ${position % 37}, preserve the complete conversation and verify deployment topic ${position % 997}.`,
          createdAt: timestamp,
        }));
        const archive = (revision: "A" | "B") => ({
          summary: { id, title: "Synthetic performance history", sequence: 1 },
          projection: {
            messages: messages.map((message, position) =>
              position === historyItems - 1
                ? { ...message, text: `${message.text} Revision ${revision}.` }
                : message,
            ),
            visibleTurnItems: [],
            runs: [],
          },
        });
        const a = archive("A");
        const b = archive("B");
        const input = (value: typeof a) => ({
          id,
          environmentId: "benchmark-environment",
          threadId: "benchmark-thread",
          projectId: "benchmark-project",
          workingCopyId: null,
          sourceSequence: 1,
          summary: JSON.stringify(value.summary),
          payload: JSON.stringify(value),
          updatedAt: timestamp,
        });
        const first = input(a);
        const second = input(b);
        const write = (value: typeof first) =>
          store.transaction(store.putThread(value).pipe(Effect.andThen(search.index(id))));
        yield* sql`INSERT INTO fork_library_projects (id, revision, archived, payload_json, created_at, updated_at)
          VALUES ('benchmark-project', 1, 0, '{}', ${timestamp}, ${timestamp})`;
        yield* write(first);
        yield* write(second);
        const rewrite = write(first).pipe(Effect.andThen(write(second)));
        const inspect = Effect.gen(function* () {
          const newest = yield* store.historyWindow(id, 0, 40);
          const older = yield* store.historyWindow(id, 40, 40);
          const retained = yield* store.history(id);
          const counts = (yield* sql<{ browsing: number; searchable: number; blobs: number }>`
            SELECT
              (SELECT COUNT(*) FROM fork_library_history_items WHERE library_id = ${id}) AS browsing,
              (SELECT COUNT(*) FROM fork_library_search_items WHERE library_id = ${id}) AS searchable,
              (SELECT COUNT(*) FROM fork_library_history_blobs) AS blobs`)[0]!;
          return { newest, older, retained, counts };
        });
        return {
          expected: {
            retained: second.payload,
            newest: b.projection.messages.slice(-40),
            older: b.projection.messages.slice(-80, -40),
          },
          rewrite: () => runtime.runPromise(rewrite),
          inspect: () => runtime.runPromise(inspect),
          close: () => runtime.dispose(),
        };
      }),
    );
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
