import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The preview hosts one computer serves, keyed by the computer's `loom-host:` subject. */
export interface PreviewHostRow {
  readonly subject: string;
  readonly environmentId: string;
  /** The Library session that registered them; null for this Library's own computer. */
  readonly sessionId: AuthSessionId | null;
  readonly machine: string;
  readonly suffix: string;
}

export const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return {
    put: Effect.fn("PreviewAccessStore.put")(function* (row: PreviewHostRow, updatedAt: string) {
      yield* sql`INSERT INTO fork_preview_hosts (subject, environment_id, session_id, machine, suffix, updated_at)
        VALUES (${row.subject}, ${row.environmentId}, ${row.sessionId}, ${row.machine}, ${row.suffix}, ${updatedAt})
        ON CONFLICT(subject) DO UPDATE SET environment_id=excluded.environment_id,
          session_id=excluded.session_id, machine=excluded.machine, suffix=excluded.suffix,
          updated_at=excluded.updated_at`;
    }),
    remove: Effect.fn("PreviewAccessStore.remove")(function* (subject: string) {
      yield* sql`DELETE FROM fork_preview_hosts WHERE subject=${subject}`;
    }),
    /** Deletes the row only if no newer session has registered the computer since it was read. */
    forget: Effect.fn("PreviewAccessStore.forget")(function* (row: PreviewHostRow) {
      yield* sql`DELETE FROM fork_preview_hosts WHERE subject=${row.subject} AND session_id IS ${row.sessionId}`;
    }),
    list: Effect.fn("PreviewAccessStore.list")(function* () {
      const rows = yield* sql<{
        subject: string;
        environment_id: string;
        session_id: string | null;
        machine: string;
        suffix: string;
      }>`SELECT subject, environment_id, session_id, machine, suffix FROM fork_preview_hosts`;
      return rows.map((row): PreviewHostRow => ({
        subject: row.subject,
        environmentId: row.environment_id,
        sessionId: row.session_id === null ? null : AuthSessionId.make(row.session_id),
        machine: row.machine,
        suffix: row.suffix,
      }));
    }),
  };
});
