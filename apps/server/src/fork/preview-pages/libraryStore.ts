import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryPageReply,
  LibraryPageReplyAckRequest,
  PreviewPageKind,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { Fragment } from "effect/sql/Statement";

/** A page without its HTML, which only the pages host ever reads. */
export interface PageRecord {
  readonly id: string;
  readonly subject: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly kind: PreviewPageKind;
  readonly sizeBytes: number;
  readonly kept: boolean;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly endedAt: string | null;
}

interface PageRow {
  readonly id: string;
  readonly subject: string;
  readonly environment_id: string;
  readonly project_id: string;
  readonly thread_id: string;
  readonly title: string;
  readonly kind: PreviewPageKind;
  readonly size_bytes: number;
  readonly kept: number;
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly ended_at: string | null;
}

interface ReplyRow {
  readonly reply_id: string;
  readonly page_id: string;
  readonly title: string;
  readonly project_id: string;
  readonly thread_id: string;
  readonly text: string;
  readonly created_at: string;
}

const toRecord = (row: PageRow): PageRecord => ({
  id: row.id,
  subject: row.subject,
  environmentId: EnvironmentId.make(row.environment_id),
  projectId: ProjectId.make(row.project_id),
  threadId: ThreadId.make(row.thread_id),
  title: row.title,
  kind: row.kind,
  sizeBytes: row.size_bytes,
  kept: row.kept !== 0,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  endedAt: row.ended_at,
});

/**
 * Timestamps are ISO strings from one formatter, so SQL compares them as text. `cutoff` is now
 * minus the restore window: anything that ended or expired before it is past restoring.
 */
export const makeLibraryStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pageColumns = sql.literal(
    "id, subject, environment_id, project_id, thread_id, title, kind, size_bytes, kept, created_at, expires_at, ended_at",
  );
  const selectPages = (where: Fragment) =>
    sql<PageRow>`SELECT ${pageColumns} FROM fork_preview_pages WHERE ${where}`;
  const pastRestoring = (cutoff: string) =>
    sql`(ended_at IS NOT NULL AND ended_at < ${cutoff}) OR (ended_at IS NULL AND kept = 0 AND expires_at < ${cutoff})`;
  const openAt = (now: string) =>
    sql`(ended_at IS NULL AND (kept = 1 OR expires_at IS NULL OR expires_at > ${now}))`;

  return {
    insertPage: Effect.fn("PreviewPagesLibraryStore.insertPage")(function* (
      page: PageRecord,
      html: Uint8Array,
    ) {
      yield* sql`INSERT INTO fork_preview_pages (id, subject, environment_id, project_id, thread_id, title, kind, html, size_bytes, kept, created_at, updated_at, expires_at, ended_at)
        VALUES (${page.id}, ${page.subject}, ${page.environmentId}, ${page.projectId}, ${page.threadId}, ${page.title}, ${page.kind}, ${html}, ${page.sizeBytes}, ${page.kept ? 1 : 0}, ${page.createdAt}, ${page.createdAt}, ${page.expiresAt}, ${page.endedAt})`;
    }),
    /** Swaps the content of a page and reopens it. */
    replaceContent: Effect.fn("PreviewPagesLibraryStore.replaceContent")(function* (input: {
      readonly id: string;
      readonly title: string;
      readonly kind: PreviewPageKind;
      readonly html: Uint8Array;
      readonly expiresAt: string | null;
      readonly updatedAt: string;
    }) {
      yield* sql`UPDATE fork_preview_pages SET title=${input.title}, kind=${input.kind}, html=${input.html}, size_bytes=${input.html.byteLength}, expires_at=${input.expiresAt}, ended_at=NULL, updated_at=${input.updatedAt} WHERE id=${input.id}`;
    }),
    setLifecycle: Effect.fn("PreviewPagesLibraryStore.setLifecycle")(function* (input: {
      readonly id: string;
      readonly kept: boolean;
      readonly expiresAt: string | null;
      readonly endedAt: string | null;
      readonly updatedAt: string;
    }) {
      yield* sql`UPDATE fork_preview_pages SET kept=${input.kept ? 1 : 0}, expires_at=${input.expiresAt}, ended_at=${input.endedAt}, updated_at=${input.updatedAt} WHERE id=${input.id}`;
    }),
    findPage: Effect.fn("PreviewPagesLibraryStore.findPage")(function* (id: string) {
      const rows = yield* selectPages(sql`id = ${id}`);
      return rows[0] === undefined ? null : toRecord(rows[0]);
    }),
    findPageWithHtml: Effect.fn("PreviewPagesLibraryStore.findPageWithHtml")(function* (
      id: string,
    ) {
      const rows = yield* sql<
        PageRow & { readonly html: Uint8Array }
      >`SELECT ${pageColumns}, html FROM fork_preview_pages WHERE id = ${id}`;
      const row = rows[0];
      return row === undefined ? null : { page: toRecord(row), html: row.html };
    }),
    countOpen: Effect.fn("PreviewPagesLibraryStore.countOpen")(function* (
      subject: string,
      now: string,
    ) {
      const rows = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM fork_preview_pages WHERE subject = ${subject} AND ${openAt(now)}`;
      return rows[0]?.count ?? 0;
    }),
    /** Every page row the subject has, open, restorable or waiting for the sweep. */
    countStored: Effect.fn("PreviewPagesLibraryStore.countStored")(function* (subject: string) {
      const rows = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM fork_preview_pages WHERE subject = ${subject}`;
      return rows[0]?.count ?? 0;
    }),
    /**
     * Deletes up to `limit` of the subject's closed pages, the longest closed first, and returns
     * how many went. Pages with replies still waiting stay, so no reply is lost before delivery.
     */
    dropOldestClosed: Effect.fn("PreviewPagesLibraryStore.dropOldestClosed")(function* (input: {
      readonly subject: string;
      readonly now: string;
      readonly limit: number;
    }) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly id: string }>`SELECT id FROM fork_preview_pages p
            WHERE subject = ${input.subject} AND NOT ${openAt(input.now)}
            AND NOT EXISTS (SELECT 1 FROM fork_preview_page_replies r WHERE r.page_id = p.id AND r.acked_at IS NULL)
            ORDER BY COALESCE(ended_at, expires_at), id LIMIT ${input.limit}`;
          if (rows.length === 0) return 0;
          const ids = rows.map((row) => row.id);
          yield* sql`DELETE FROM fork_preview_page_replies WHERE page_id IN ${sql.in(ids)}`;
          yield* sql`DELETE FROM fork_preview_pages WHERE id IN ${sql.in(ids)}`;
          return ids.length;
        }),
      );
    }),
    /** Open pages first, then those still within the restore window, each newest first. */
    listRestorable: Effect.fn("PreviewPagesLibraryStore.listRestorable")(function* (input: {
      readonly subject: string;
      readonly now: string;
      readonly cutoff: string;
      readonly limit: number;
    }) {
      const rows = yield* selectPages(
        sql`subject = ${input.subject} AND NOT (${pastRestoring(input.cutoff)}) ORDER BY ${openAt(input.now)} DESC, created_at DESC, id DESC LIMIT ${input.limit}`,
      );
      return rows.map(toRecord);
    }),
    replyExists: Effect.fn("PreviewPagesLibraryStore.replyExists")(function* (replyId: string) {
      const rows = yield* sql`SELECT 1 FROM fork_preview_page_replies WHERE reply_id = ${replyId}`;
      return rows.length > 0;
    }),
    countWaitingReplies: Effect.fn("PreviewPagesLibraryStore.countWaitingReplies")(function* (
      subject: string,
    ) {
      const rows = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM fork_preview_page_replies WHERE subject = ${subject} AND acked_at IS NULL`;
      return rows[0]?.count ?? 0;
    }),
    insertReply: Effect.fn("PreviewPagesLibraryStore.insertReply")(function* (reply: {
      readonly replyId: string;
      readonly pageId: string;
      readonly subject: string;
      readonly text: string;
      readonly viewer: string;
      readonly createdAt: string;
    }) {
      // A browser that retries after a lost response sends the same id; one copy is enough.
      yield* sql`INSERT OR IGNORE INTO fork_preview_page_replies (reply_id, page_id, subject, text, viewer, created_at)
        VALUES (${reply.replyId}, ${reply.pageId}, ${reply.subject}, ${reply.text}, ${reply.viewer}, ${reply.createdAt})`;
    }),
    /** Marks up to `limit` deliverable replies as leased until `leasedUntil` and returns them. */
    leaseReplies: Effect.fn("PreviewPagesLibraryStore.leaseReplies")(function* (input: {
      readonly subject: string;
      readonly now: string;
      readonly leasedUntil: string;
      readonly limit: number;
    }) {
      const rows = yield* sql.withTransaction(
        Effect.gen(function* () {
          const due =
            yield* sql<ReplyRow>`SELECT r.reply_id, r.page_id, p.title, p.project_id, p.thread_id, r.text, r.created_at
            FROM fork_preview_page_replies r JOIN fork_preview_pages p ON p.id = r.page_id
            WHERE r.subject = ${input.subject} AND r.acked_at IS NULL AND (r.leased_until IS NULL OR r.leased_until <= ${input.now})
            ORDER BY r.created_at, r.reply_id LIMIT ${input.limit}`;
          if (due.length > 0)
            yield* sql`UPDATE fork_preview_page_replies SET leased_until = ${input.leasedUntil} WHERE reply_id IN ${sql.in(due.map((row) => row.reply_id))}`;
          return due;
        }),
      );
      return rows.map((row): LibraryPageReply => ({
        replyId: row.reply_id,
        pageId: row.page_id,
        pageTitle: row.title,
        projectId: ProjectId.make(row.project_id),
        threadId: ThreadId.make(row.thread_id),
        text: row.text,
        createdAt: row.created_at,
      }));
    }),
    ackReply: Effect.fn("PreviewPagesLibraryStore.ackReply")(function* (
      subject: string,
      ack: LibraryPageReplyAckRequest,
      ackedAt: string,
    ) {
      yield* sql`UPDATE fork_preview_page_replies SET acked_at = ${ackedAt}, outcome = ${ack.outcome}, detail = ${ack.detail ?? null}
        WHERE reply_id = ${ack.replyId} AND subject = ${subject} AND acked_at IS NULL`;
    }),
    /** Records that `subject` signed out every pages browser at `atMs`, or just past the latest sign-out. */
    signOutReaders: Effect.fn("PreviewPagesLibraryStore.signOutReaders")(function* (
      subject: string,
      atMs: number,
    ) {
      // The host mints cookies at max(now, latest sign-out + 1), so a sign-out in the same
      // millisecond, or after the clock stepped back, must still pass the latest one to end them.
      yield* sql`INSERT INTO fork_preview_page_signouts (subject, signed_out_at)
        VALUES (${subject}, MAX(${atMs}, (SELECT COALESCE(MAX(signed_out_at), 0) FROM fork_preview_page_signouts) + 1))
        ON CONFLICT (subject) DO UPDATE SET signed_out_at = excluded.signed_out_at`;
    }),
    /** The latest sign-out by any computer, in Unix milliseconds, or 0 when there was none. */
    readersSignedOutAt: Effect.fn("PreviewPagesLibraryStore.readersSignedOutAt")(function* () {
      const rows = yield* sql<{
        readonly at: number | null;
      }>`SELECT MAX(signed_out_at) AS at FROM fork_preview_page_signouts`;
      return rows[0]?.at ?? 0;
    }),
    /** Deletes pages past restoring with all their replies, and replies acked before `ackedBefore`. */
    purge: Effect.fn("PreviewPagesLibraryStore.purge")(function* (input: {
      readonly cutoff: string;
      readonly ackedBefore: string;
    }) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM fork_preview_page_replies WHERE page_id IN (SELECT id FROM fork_preview_pages WHERE ${pastRestoring(input.cutoff)})`;
          yield* sql`DELETE FROM fork_preview_pages WHERE ${pastRestoring(input.cutoff)}`;
          yield* sql`DELETE FROM fork_preview_page_replies WHERE acked_at IS NOT NULL AND acked_at < ${input.ackedBefore}`;
        }),
      );
    }),
  };
});
