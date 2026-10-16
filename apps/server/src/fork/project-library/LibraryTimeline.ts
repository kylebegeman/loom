import {
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  type ThreadPullRequestLinkSource,
} from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_KINDS,
  LibraryError,
  LibraryProject,
  LibraryThreadSummary,
  LibraryTimelineEntry,
  LibraryWorkingCopy,
  type LibraryThreadArchive,
  type LibraryTimelineConversation,
  type LibraryTimelineConversationEntry,
  type LibraryTimelineCopyEntry,
  type LibraryTimelinePullRequestEntry,
  type LibraryTimelineKind,
  type LibraryTimelinePage,
  type LibraryTimelinePullRequest,
  type LibraryTimelineRequest,
} from "@t3tools/contracts/fork";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as LibraryStore from "./LibraryStore.ts";

/**
 * Project timelines live in `fork_library_events` with the Library project as the aggregate and
 * `timeline.<kind>` as the event type. Entries are derived by comparing what a write replaces with
 * what it saves, inside the write's transaction, so replaying the same entry records nothing.
 */
export class LibraryTimeline extends Context.Service<
  LibraryTimeline,
  {
    readonly page: (
      input: LibraryTimelineRequest,
    ) => Effect.Effect<LibraryTimelinePage, LibraryError>;
  }
>()("t3/fork/project-library/LibraryTimeline") {}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const eventType = (kind: LibraryTimelineKind) => `timeline.${kind}`;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export interface LibraryTimelineDraft {
  readonly projectId: string;
  readonly entry: DistributiveOmit<LibraryTimelineEntry, "sequence">;
}

interface TimelinePullRequest extends LibraryTimelinePullRequest {
  readonly linkedAt: string | null;
  readonly state: "open" | "closed" | "merged" | null;
  readonly checksFailing: boolean;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly syncedAt: string | null;
}
/** The parts of a saved conversation its timeline is derived from. */
export interface TimelineThread {
  readonly summary: LibraryThreadSummary;
  readonly settledAt: string | null;
  readonly archivedAt: string | null;
  readonly pullRequests: ReadonlyArray<TimelinePullRequest>;
}

/** First valid time among the preferred ones, else the fallback, as ISO-8601. */
const timeOf = (fallback: string, ...preferred: ReadonlyArray<string | null | undefined>) => {
  for (const candidate of [...preferred, fallback]) {
    if (!candidate) continue;
    const time = DateTime.make(candidate);
    if (Option.isSome(time)) return DateTime.formatIso(time.value);
  }
  return fallback;
};

function pullRequestsOf(thread: {
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
  readonly pullRequests?:
    | ReadonlyArray<{
        readonly source: ThreadPullRequestLinkSource;
        readonly url: string;
        readonly repository: string;
        readonly number: number;
        readonly linkedAt: string;
        readonly snapshot: ThreadPullRequestLink["snapshot"];
      }>
    | undefined;
}): ReadonlyArray<TimelinePullRequest> {
  if (thread.pullRequests !== undefined)
    return thread.pullRequests
      .filter((link) => link.source !== "stack-dismissed")
      .map((link) => ({
        url: link.url,
        repository: link.repository,
        number: link.number,
        title: link.snapshot?.title ?? null,
        linkedAt: link.linkedAt,
        state: link.snapshot?.state ?? null,
        checksFailing: link.snapshot?.checksState === "failing",
        mergedAt: link.snapshot?.mergedAt ?? null,
        closedAt: link.snapshot?.closedAt ?? null,
        syncedAt: link.snapshot?.syncedAt ?? null,
      }));
  // Hosts from before `pullRequests` only report the single linked pull request.
  const legacy = thread.linkedPullRequest;
  if (!legacy) return [];
  return [
    {
      url: legacy.url,
      repository: legacy.repository,
      number: legacy.number,
      title: null,
      linkedAt: null,
      state: null,
      checksFailing: false,
      mergedAt: null,
      closedAt: null,
      syncedAt: null,
    },
  ];
}

export const timelineThread = (archive: LibraryThreadArchive): TimelineThread => {
  const { thread } = archive.projection;
  return {
    summary: archive.summary,
    settledAt: thread.settledAt === null ? null : DateTime.formatIso(thread.settledAt),
    archivedAt: thread.archivedAt === null ? null : DateTime.formatIso(thread.archivedAt),
    pullRequests: pullRequestsOf(thread),
  };
};

/** Conversation and pull request entries for saving `next` over `previous`. */
export function threadTimeline(
  previous: TimelineThread | null,
  next: TimelineThread,
): LibraryTimelineDraft[] {
  const { summary } = next;
  const before = previous?.summary;
  const conversation: LibraryTimelineConversation = {
    id: summary.id,
    threadId: summary.threadId,
    title: summary.title,
  };
  const environmentId = summary.environmentId;
  const drafts: LibraryTimelineDraft[] = [];
  const conversationEntry = (
    kind: (typeof LibraryTimelineConversationEntry.Type)["kind"],
    at: string,
  ) =>
    drafts.push({ projectId: summary.projectId, entry: { kind, at, environmentId, conversation } });
  if (!before)
    conversationEntry("conversation-started", timeOf(summary.updatedAt, summary.createdAt));
  if (summary.settled === true && before?.settled !== true)
    conversationEntry("conversation-settled", timeOf(summary.updatedAt, next.settledAt));
  // Keyed on the transition, so a run that fails again after recovering is recorded again.
  if (summary.status === "failed" && before?.status !== "failed")
    conversationEntry("conversation-failed", timeOf(summary.updatedAt));
  if (summary.archived && before?.archived !== true)
    conversationEntry("conversation-archived", timeOf(summary.updatedAt, next.archivedAt));
  const known = new Map(previous?.pullRequests.map((link) => [link.url, link]));
  for (const link of next.pullRequests) {
    const old = known.get(link.url);
    const pullRequest = {
      url: link.url,
      repository: link.repository,
      number: link.number,
      title: link.title,
    };
    const pullRequestEntry = (
      kind: (typeof LibraryTimelinePullRequestEntry.Type)["kind"],
      at: string,
    ) =>
      drafts.push({
        projectId: summary.projectId,
        entry: { kind, at, environmentId, conversation, pullRequest },
      });
    if (!old) pullRequestEntry("pull-request-linked", timeOf(summary.updatedAt, link.linkedAt));
    if (link.state === "merged" && old?.state !== "merged")
      pullRequestEntry(
        "pull-request-merged",
        timeOf(summary.updatedAt, link.mergedAt, link.syncedAt),
      );
    if (link.state === "closed" && old?.state !== "closed")
      pullRequestEntry(
        "pull-request-closed",
        timeOf(summary.updatedAt, link.closedAt, link.syncedAt),
      );
    if (link.checksFailing && old?.checksFailing !== true)
      pullRequestEntry("pull-request-checks-failed", timeOf(summary.updatedAt, link.syncedAt));
  }
  return drafts;
}

/** A brief revision when a new revision changes the project's title, brief or resources. */
export function projectTimeline(
  previous: LibraryProject | null,
  next: LibraryProject,
): LibraryTimelineDraft[] {
  if (
    previous === null ||
    next.revision <= previous.revision ||
    (previous.title === next.title &&
      previous.brief === next.brief &&
      JSON.stringify(previous.resources) === JSON.stringify(next.resources))
  )
    return [];
  return [
    {
      projectId: next.id,
      entry: {
        kind: "brief-revised",
        at: timeOf(next.updatedAt),
        environmentId: null,
        revision: next.revision,
        title: next.title,
      },
    },
  ];
}

/** Copy added on first save; released or failed when its state changes to one. */
export function copyTimeline(
  previous: LibraryWorkingCopy | null,
  next: LibraryWorkingCopy,
): LibraryTimelineDraft[] {
  const drafts: LibraryTimelineDraft[] = [];
  const copy = { id: next.id, rootPath: next.rootPath };
  const copyEntry = (kind: (typeof LibraryTimelineCopyEntry.Type)["kind"], at: string) =>
    drafts.push({
      projectId: next.projectId,
      entry: { kind, at: timeOf(next.updatedAt, at), environmentId: next.environmentId, copy },
    });
  if (previous === null) copyEntry("copy-added", next.createdAt);
  if (next.state === "released" && previous?.state !== "released")
    copyEntry("copy-released", next.updatedAt);
  if (next.state === "failed" && previous?.state !== "failed")
    copyEntry("copy-failed", next.updatedAt);
  return drafts;
}

const unknownJson = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeSync(unknownJson);
const decodeJson = Schema.decodeOption(unknownJson);
const decodeEntry = Schema.decodeUnknownOption(LibraryTimelineEntry);
const isLibraryError = Schema.is(LibraryError);
const decodeProject = Schema.decodeUnknownOption(Schema.fromJsonString(LibraryProject));
const decodeCopy = Schema.decodeUnknownOption(Schema.fromJsonString(LibraryWorkingCopy));
const decodeSummary = Schema.decodeUnknownOption(Schema.fromJsonString(LibraryThreadSummary));
const decodeLink = Schema.decodeUnknownOption(ThreadPullRequestLink);
const decodeSavedThread = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      settledAt: Schema.optional(Schema.NullOr(Schema.String)),
      archivedAt: Schema.optional(Schema.NullOr(Schema.String)),
      linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
      pullRequests: Schema.optional(Schema.Array(Schema.Unknown)),
    }),
  ),
);

/** Appends entries inside the caller's Library transaction. */
export const recordTimeline = (
  store: LibraryStore.LibraryStore["Service"],
  drafts: ReadonlyArray<LibraryTimelineDraft>,
) =>
  Effect.forEach(
    drafts,
    (draft) =>
      store.appendEvent(
        draft.projectId,
        eventType(draft.entry.kind),
        encodeJson(draft.entry),
        draft.entry.at,
      ),
    { discard: true },
  );

/** Records a project save, comparing it with the revision it replaces. */
export const recordProjectTimeline = Effect.fnUntraced(function* (
  store: LibraryStore.LibraryStore["Service"],
  project: LibraryProject,
) {
  if (project.revision <= 1) return;
  const saved = yield* store.projectRevision(project.id, project.revision - 1);
  const previous = saved === null ? Option.none() : decodeProject(saved);
  if (Option.isSome(previous))
    yield* recordTimeline(store, projectTimeline(previous.value, project));
});

/**
 * Rebuilds approximate entries from rows saved before timelines existed. Runs once, inside the
 * migration that introduces them. Records it cannot read are skipped rather than failing startup.
 */
export const backfillTimeline = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const drafts: LibraryTimelineDraft[] = [];
  // Pull requests sit on the thread object, which the visible-history header keeps uncompressed.
  // Archives saved before that index existed are still plain JSON on the thread row.
  const threads = yield* sql<{ summary_json: string; thread_json: string | null }>`
    SELECT t.summary_json, CASE
      WHEN h.payload_json IS NOT NULL AND json_valid(h.payload_json) THEN json_extract(h.payload_json, '$.projection.thread')
      WHEN t.payload_json NOT LIKE 'loom:gzip:%' AND json_valid(t.payload_json) THEN json_extract(t.payload_json, '$.projection.thread')
    END AS thread_json
    FROM fork_library_threads t LEFT JOIN fork_library_history_headers h ON h.library_id = t.library_id`;
  for (const row of threads) {
    const summary = decodeSummary(row.summary_json);
    if (Option.isNone(summary)) continue;
    const thread = row.thread_json === null ? Option.none() : decodeSavedThread(row.thread_json);
    const links = Option.isSome(thread)
      ? (thread.value.pullRequests ?? []).flatMap((raw) => Option.toArray(decodeLink(raw)))
      : [];
    drafts.push(
      ...threadTimeline(null, {
        summary: summary.value,
        settledAt: Option.isSome(thread) ? (thread.value.settledAt ?? null) : null,
        archivedAt: Option.isSome(thread) ? (thread.value.archivedAt ?? null) : null,
        pullRequests: Option.isSome(thread)
          ? pullRequestsOf({
              linkedPullRequest: thread.value.linkedPullRequest,
              pullRequests: thread.value.pullRequests === undefined ? undefined : links,
            })
          : [],
      }),
    );
  }
  const revisions = yield* sql<{ payload_json: string; previous_json: string }>`
    SELECT r.payload_json, p.payload_json AS previous_json
    FROM fork_library_project_revisions r
    JOIN fork_library_project_revisions p ON p.project_id = r.project_id AND p.revision = r.revision - 1`;
  for (const row of revisions) {
    const [previous, next] = [decodeProject(row.previous_json), decodeProject(row.payload_json)];
    if (Option.isSome(previous) && Option.isSome(next))
      drafts.push(...projectTimeline(previous.value, next.value));
  }
  // Every copy save was logged, so replaying the log recovers each state change.
  const copySaves = yield* sql<{ payload_json: string }>`
    SELECT payload_json FROM fork_library_events WHERE event_type = 'copy.saved' ORDER BY sequence`;
  const copies = new Map<string, LibraryWorkingCopy>();
  for (const row of copySaves) {
    const copy = decodeCopy(row.payload_json);
    if (Option.isNone(copy)) continue;
    drafts.push(...copyTimeline(copies.get(copy.value.id) ?? null, copy.value));
    copies.set(copy.value.id, copy.value);
  }
  const ordered = drafts
    .map((draft, index) => ({ draft, index }))
    .toSorted((a, b) => a.draft.entry.at.localeCompare(b.draft.entry.at) || a.index - b.index);
  for (const { draft } of ordered) {
    const entry = { ...draft.entry, approximate: true };
    yield* sql`INSERT INTO fork_library_events (aggregate_id, event_type, payload_json, created_at) VALUES (${draft.projectId}, ${eventType(entry.kind)}, ${encodeJson(entry)}, ${entry.at})`;
  }
});

const make = Effect.gen(function* () {
  const isAuthority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
    Config.withDefault(false),
  );
  const sql = yield* SqlClient.SqlClient;
  const page = Effect.fnUntraced(
    function* (input: LibraryTimelineRequest) {
      if (!isAuthority) return yield* new LibraryError({ reason: "not-authority" });
      const limit = input.limit ?? DEFAULT_PAGE_SIZE;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_PAGE_SIZE ||
        (input.before !== undefined && (!Number.isSafeInteger(input.before) || input.before < 1))
      )
        return yield* new LibraryError({ reason: "invalid" });
      const project = yield* sql`SELECT 1 FROM fork_library_projects WHERE id = ${input.projectId}`;
      if (project.length === 0) return yield* new LibraryError({ reason: "not-found" });
      const kinds =
        input.kinds === undefined
          ? LIBRARY_TIMELINE_KINDS
          : LIBRARY_TIMELINE_KINDS.filter((kind) => input.kinds!.includes(kind));
      if (kinds.length === 0) return { entries: [], nextBefore: null };
      // Sequences only grow, so a page read with `before` never shifts while new entries arrive.
      const rows = yield* sql<{ sequence: number; payload_json: string }>`
        SELECT sequence, payload_json FROM fork_library_events
        WHERE aggregate_id = ${input.projectId} AND event_type IN ${sql.in(kinds.map(eventType))}
        ${input.before === undefined ? sql`` : sql`AND sequence < ${input.before}`}
        ORDER BY sequence DESC LIMIT ${limit + 1}`;
      const shown = rows.slice(0, limit);
      const entries = shown.flatMap((row) => {
        const payload = decodeJson(row.payload_json);
        return Option.isSome(payload) && typeof payload.value === "object" && payload.value !== null
          ? Option.toArray(decodeEntry({ ...payload.value, sequence: row.sequence }))
          : [];
      });
      return {
        entries,
        nextBefore: rows.length > limit ? (shown.at(-1)?.sequence ?? null) : null,
      };
    },
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );
  return LibraryTimeline.of({ page });
});
export const layer = Layer.effect(LibraryTimeline, make);
