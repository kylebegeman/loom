import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_KINDS,
  LibraryError,
  type LibraryProject,
  type LibraryThreadArchive,
  type LibraryTimelineEntry,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { archiveFor, copyFor, resource, source } from "./Library.testkit.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryTimeline from "./LibraryTimeline.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const authority = ConfigProvider.layer(
  ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } }),
);
const servicesLayer = Layer.mergeAll(
  LibraryService.layer.pipe(
    Layer.provide(
      Layer.succeed(Assets.LibraryAssetService, {
        mode: "local",
        find: () => Effect.fail(new LibraryError({ reason: "not-found" })),
        read: () => Effect.fail(new LibraryError({ reason: "not-found" })),
        put: () => Effect.fail(new LibraryError({ reason: "io" })),
        url: () => Effect.succeed(null),
      }),
    ),
    Layer.provide(
      Layer.succeed(ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("authority")),
      }),
    ),
  ),
  LibraryTimeline.layer,
).pipe(Layer.provide(authority));

interface Harness {
  readonly library: LibraryService.LibraryService["Service"];
  readonly timeline: LibraryTimeline.LibraryTimeline["Service"];
  readonly project: LibraryProject;
  /** Replicates one journal entry, as a host would after the previous one. */
  readonly ingest: (thread: LibraryThreadArchive) => Effect.Effect<number, LibraryError>;
  /** Replays the last replicated entry under a new request. */
  readonly replay: Effect.Effect<number, LibraryError>;
  /** Conversation entries newest first; the copy registered for every test is left out. */
  readonly kinds: () => Effect.Effect<ReadonlyArray<string>, LibraryError>;
}
const conversationKinds = LIBRARY_TIMELINE_KINDS.filter((kind) => kind.startsWith("conversation-"));
const run = <A, E>(use: (harness: Harness) => Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const { library, timeline } = yield* Effect.all({
      library: LibraryService.LibraryService,
      timeline: LibraryTimeline.LibraryTimeline,
    }).pipe(Effect.provide(servicesLayer));
    const project = yield* library.createProject({
      requestId: "create",
      title: "AspectAvy",
      resources: [resource],
    });
    yield* library.registerCopy({ requestId: "copy", copy: copyFor(project) });
    let sequence = 0;
    let last: LibraryThreadArchive | null = null;
    const send = (requestId: string, fromSequence: number, thread: LibraryThreadArchive) =>
      library
        .ingestHistory({
          requestId,
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence,
          entries: [{ sequence: fromSequence + 1, thread }],
        })
        .pipe(Effect.map((result) => result.applied));
    return yield* use({
      library,
      timeline,
      project,
      ingest: (thread) =>
        Effect.suspend(() => {
          const from = sequence;
          sequence += 1;
          last = thread;
          return send(`ingest-${sequence}`, from, thread);
        }),
      replay: Effect.suspend(() => send(`replay-${sequence}`, sequence - 1, last!)),
      kinds: () =>
        timeline
          .page({ projectId: project.id, kinds: conversationKinds })
          .pipe(Effect.map((page) => page.entries.map((entry) => entry.kind))),
    });
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

/** A later snapshot of the same conversation: newer journal sequence and update time. */
const revise = (
  archive: LibraryThreadArchive,
  minute: number,
  summary: Partial<LibraryThreadArchive["summary"]> = {},
  thread: Partial<LibraryThreadArchive["projection"]["thread"]> = {},
): LibraryThreadArchive => ({
  ...archive,
  summary: {
    ...archive.summary,
    ...summary,
    sequence: archive.summary.sequence + minute,
    updatedAt: `2026-10-16T10:${String(minute).padStart(2, "0")}:00.000Z`,
  },
  projection: { ...archive.projection, thread: { ...archive.projection.thread, ...thread } },
});
const conversation = (project: LibraryProject, index: number) =>
  Effect.gen(function* () {
    const archive = yield* archiveFor(project);
    const id = ThreadId.make(`thread-${index}`);
    return revise(
      {
        summary: { ...archive.summary, id: `conversation-${index}`, threadId: id },
        projection: { ...archive.projection, thread: { ...archive.projection.thread, id } },
      },
      0,
    );
  });
const pullRequestUrl = "https://github.com/example/api/pull/7";
const link = (snapshot: Partial<NonNullable<ThreadPullRequestLink["snapshot"]>> | null) =>
  ({
    host: "github.com",
    repository: "example/api",
    number: 7,
    url: pullRequestUrl,
    source: "created",
    linkedAt: "2026-10-16T10:02:00.000Z",
    snapshot:
      snapshot === null
        ? null
        : {
            state: "open",
            title: "Add the timeline",
            headBranch: "feat/timeline",
            baseBranch: "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-10-16T10:03:00.000Z",
            ...snapshot,
          },
    stack: null,
  }) satisfies ThreadPullRequestLink;

describe("Library project timeline", () => {
  it.effect("records each conversation change once and nothing when an entry is replayed", () =>
    run(({ project, timeline, ingest, replay, kinds }) =>
      Effect.gen(function* () {
        const started = yield* conversation(project, 1);
        expect(yield* ingest(started)).toBe(1);
        expect(yield* replay).toBe(0);
        expect(yield* kinds()).toEqual(["conversation-started"]);

        yield* ingest(revise(started, 1, { status: "running" }));
        expect(yield* kinds()).toEqual(["conversation-started"]);

        const settledAt = DateTime.makeUnsafe("2026-10-16T10:02:00.000Z");
        yield* ingest(revise(started, 2, { status: "completed", settled: true }, { settledAt }));
        yield* ingest(revise(started, 3, { status: "failed", settled: true }, { settledAt }));
        expect(yield* replay).toBe(0);
        // A later snapshot of the same failure is not a second failure.
        yield* ingest(revise(started, 4, { status: "failed", settled: true }, { settledAt }));
        expect(yield* kinds()).toEqual([
          "conversation-failed",
          "conversation-settled",
          "conversation-started",
        ]);

        const archivedAt = DateTime.makeUnsafe("2026-10-16T10:05:00.000Z");
        yield* ingest(
          revise(started, 5, { status: "failed", settled: true, archived: true }, { archivedAt }),
        );
        const page = yield* timeline.page({ projectId: project.id, kinds: conversationKinds });
        expect(page.nextBefore).toBeNull();
        expect(page.entries.map(({ kind, at }) => [kind, at])).toEqual([
          ["conversation-archived", "2026-10-16T10:05:00.000Z"],
          ["conversation-failed", "2026-10-16T10:03:00.000Z"],
          ["conversation-settled", "2026-10-16T10:02:00.000Z"],
          ["conversation-started", started.summary.createdAt],
        ]);
        expect(page.entries[0]).toMatchObject({
          environmentId: source,
          conversation: { id: "conversation-1", threadId: "thread-1", title: "Work on API" },
        });
        expect(page.entries.some((entry) => entry.approximate)).toBe(false);
      }),
    ),
  );

  it.effect("records pull requests linked, failing checks and merged with their URL", () =>
    run(({ project, timeline, ingest, replay }) =>
      Effect.gen(function* () {
        const started = yield* conversation(project, 1);
        yield* ingest(started);
        yield* ingest(revise(started, 1, {}, { pullRequests: [link(null)] }));
        expect(yield* replay).toBe(0);
        yield* ingest(revise(started, 2, {}, { pullRequests: [link({ checksState: "failing" })] }));
        yield* ingest(revise(started, 3, {}, { pullRequests: [link({ checksState: "failing" })] }));
        yield* ingest(
          revise(
            started,
            4,
            {},
            {
              pullRequests: [
                link({
                  state: "merged",
                  checksState: "passing",
                  mergedAt: "2026-10-16T10:04:30.000Z",
                }),
              ],
            },
          ),
        );
        const page = yield* timeline.page({
          projectId: project.id,
          kinds: ["pull-request-linked", "pull-request-merged", "pull-request-checks-failed"],
        });
        expect(
          page.entries.map((entry) =>
            entry.kind.startsWith("pull-request-") && "pullRequest" in entry
              ? [entry.kind, entry.at, entry.pullRequest.url]
              : null,
          ),
        ).toEqual([
          ["pull-request-merged", "2026-10-16T10:04:30.000Z", pullRequestUrl],
          ["pull-request-checks-failed", "2026-10-16T10:03:00.000Z", pullRequestUrl],
          ["pull-request-linked", "2026-10-16T10:02:00.000Z", pullRequestUrl],
        ]);
        expect(page.entries[2]).toMatchObject({
          conversation: { id: "conversation-1" },
          pullRequest: { repository: "example/api", number: 7, title: null },
        });
      }),
    ),
  );

  it.effect("pages by sequence so entries recorded while reading never shift a page", () =>
    run(({ project, timeline, ingest }) =>
      Effect.gen(function* () {
        for (const index of [1, 2, 3, 4, 5]) yield* ingest(yield* conversation(project, index));
        const started = { projectId: project.id, kinds: ["conversation-started"] };
        const first = yield* timeline.page({ ...started, limit: 2 });
        const seen = [...first.entries];
        let before = first.nextBefore;
        let index = 6;
        while (before !== null) {
          // Each older page is read while another conversation replicates.
          const [page] = yield* Effect.all(
            [
              timeline.page({ ...started, before, limit: 2 }),
              ingest(yield* conversation(project, index++)),
            ],
            { concurrency: "unbounded" },
          );
          seen.push(...page.entries);
          before = page.nextBefore;
        }
        const titles = (entries: ReadonlyArray<LibraryTimelineEntry>) =>
          entries.map((entry) => ("conversation" in entry ? entry.conversation.id : entry.kind));
        expect(titles(seen)).toEqual([5, 4, 3, 2, 1].map((n) => `conversation-${n}`));
        const sequences = seen.map((entry) => entry.sequence);
        expect(sequences).toEqual(sequences.toSorted((a, b) => b - a));
        const newest = yield* timeline.page({ ...started, limit: 3 });
        expect(titles(newest.entries)).toEqual(
          [index - 1, index - 2, index - 3].map((n) => `conversation-${n}`),
        );
      }),
    ),
  );

  it.effect("filters by kind, ignores unknown kinds and validates the request", () =>
    run(({ project, timeline, ingest }) =>
      Effect.gen(function* () {
        yield* ingest(yield* conversation(project, 1));
        expect(
          (yield* timeline.page({
            projectId: project.id,
            kinds: ["copy-added", "from-the-future"],
          })).entries,
        ).toMatchObject([
          { kind: "copy-added", copy: { id: "copy", rootPath: "/borrowed/aspectavy" } },
        ]);
        expect(yield* timeline.page({ projectId: project.id, kinds: ["from-the-future"] })).toEqual(
          { entries: [], nextBefore: null },
        );
        expect((yield* timeline.page({ projectId: "missing" }).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        const all = yield* timeline.page({ projectId: project.id });
        expect(all.entries).toHaveLength(2);
        // Nothing precedes the first sequence; a cursor past the newest reads the newest page.
        expect(yield* timeline.page({ projectId: project.id, before: 1 })).toEqual({
          entries: [],
          nextBefore: null,
        });
        expect(yield* timeline.page({ projectId: project.id, before: 1_000_000 })).toEqual(all);
        // A page that ends exactly at the oldest entry has no next page.
        expect((yield* timeline.page({ projectId: project.id, limit: 2 })).nextBefore).toBeNull();
        const newest = yield* timeline.page({ projectId: project.id, limit: 1 });
        expect(newest.nextBefore).toBe(all.entries[0]!.sequence);
        expect(
          yield* timeline.page({ projectId: project.id, before: newest.nextBefore!, limit: 1 }),
        ).toEqual({ entries: [all.entries[1]], nextBefore: null });
        expect(
          (yield* timeline.page({ projectId: project.id, limit: 0 }).pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }),
    ),
  );

  it.effect("records brief revisions and copy state changes from Library writes", () =>
    run(({ project, library, timeline }) =>
      Effect.gen(function* () {
        const revised = yield* library.updateProject({
          requestId: "brief",
          projectId: project.id,
          expectedRevision: project.revision,
          title: project.title,
          brief: "Ship the timeline.",
          resources: project.resources,
        });
        yield* library.registerCopy({
          requestId: "fail-copy",
          copy: { ...copyFor(project), state: "failed", updatedAt: revised.updatedAt },
        });
        expect(
          (yield* timeline.page({ projectId: project.id })).entries.map((entry) => entry.kind),
        ).toEqual(["copy-failed", "brief-revised", "copy-added"]);
      }),
    ),
  );

  it.effect("rebuilds approximate entries for rows saved before the timeline existed", () =>
    run(({ project, timeline, ingest }) =>
      Effect.gen(function* () {
        const started = yield* conversation(project, 1);
        const settledAt = DateTime.makeUnsafe("2026-10-16T10:02:00.000Z");
        yield* ingest(
          revise(
            started,
            2,
            { settled: true },
            { settledAt, pullRequests: [link({ state: "merged", mergedAt: null })] },
          ),
        );
        const sql = yield* SqlClient.SqlClient;
        const recorded = yield* timeline.page({ projectId: project.id });
        yield* sql`DELETE FROM fork_library_events WHERE event_type LIKE 'timeline.%'`;
        yield* LibraryTimeline.backfillTimeline;
        const rebuilt = yield* timeline.page({ projectId: project.id });
        expect(rebuilt.entries.map((entry) => entry.kind).toSorted()).toEqual(
          recorded.entries.map((entry) => entry.kind).toSorted(),
        );
        expect(rebuilt.entries.every((entry) => entry.approximate === true)).toBe(true);
        // Running it again, as a renumbered migration would, adds nothing.
        yield* LibraryTimeline.backfillTimeline;
        expect((yield* timeline.page({ projectId: project.id })).entries).toEqual(rebuilt.entries);
      }),
    ),
  );

  it.effect("records a closed pull request once with its close time", () =>
    run(({ project, timeline, ingest, replay }) =>
      Effect.gen(function* () {
        const started = yield* conversation(project, 1);
        yield* ingest(revise(started, 1, {}, { pullRequests: [link(null)] }));
        const closed = link({ state: "closed", closedAt: "2026-10-16T10:04:00.000Z" });
        yield* ingest(revise(started, 4, {}, { pullRequests: [closed] }));
        expect(yield* replay).toBe(0);
        // A later sync of the same closed pull request is not news.
        const resynced = link({
          state: "closed",
          closedAt: "2026-10-16T10:04:00.000Z",
          syncedAt: "2026-10-16T10:06:00.000Z",
        });
        yield* ingest(revise(started, 6, {}, { pullRequests: [resynced] }));
        const page = yield* timeline.page({
          projectId: project.id,
          kinds: ["pull-request-linked", "pull-request-closed"],
        });
        expect(
          page.entries.map((entry) => [
            entry.kind,
            entry.at,
            "pullRequest" in entry ? entry.pullRequest.url : null,
          ]),
        ).toEqual([
          ["pull-request-closed", "2026-10-16T10:04:00.000Z", pullRequestUrl],
          ["pull-request-linked", "2026-10-16T10:02:00.000Z", pullRequestUrl],
        ]);
      }),
    ),
  );

  it.effect("ignores stale snapshots and keeps each computer's conversation separate", () =>
    run(({ project, library, ingest, kinds }) =>
      Effect.gen(function* () {
        const started = yield* conversation(project, 1);
        yield* ingest(revise(started, 3, { status: "failed" }));
        // Older snapshots arriving late change nothing, including ones that look like news.
        yield* library.registerThread({
          requestId: "late",
          thread: revise(started, 1, { status: "running", settled: true, archived: true }),
        });
        expect(yield* kinds()).toEqual(["conversation-failed", "conversation-started"]);
        // The same thread id on another computer is a different conversation.
        const elsewhere = EnvironmentId.make("other-computer");
        yield* library.registerThread({
          requestId: "elsewhere",
          thread: revise(
            {
              ...started,
              summary: {
                ...started.summary,
                id: "conversation-elsewhere",
                environmentId: elsewhere,
                workingCopyId: null,
              },
            },
            2,
          ),
        });
        expect(yield* kinds()).toEqual([
          "conversation-started",
          "conversation-failed",
          "conversation-started",
        ]);
      }),
    ),
  );

  it.effect("records nothing for a write that fails and rolls back", () =>
    run(({ project, library, kinds }) =>
      Effect.gen(function* () {
        const valid = yield* conversation(project, 2);
        const invalid = {
          ...valid,
          summary: { ...valid.summary, environmentId: EnvironmentId.make("wrong") },
        };
        const failure = yield* library
          .ingestHistory({
            requestId: "batch",
            sourceEnvironmentId: source,
            journalId: "batch-journal",
            fromSequence: 0,
            entries: [
              { sequence: 1, thread: valid },
              { sequence: 2, thread: invalid },
            ],
          })
          .pipe(Effect.flip);
        expect(failure.reason).toBe("invalid");
        expect(yield* kinds()).toEqual([]);
      }),
    ),
  );

  it.effect("dates a failure by when its run finished, not when the Library heard", () =>
    run(({ project }) =>
      Effect.gen(function* () {
        const { summary } = yield* conversation(project, 1);
        const before = {
          summary,
          settledAt: null,
          archivedAt: null,
          failedAt: null,
          pullRequests: [],
        };
        const drafts = LibraryTimeline.threadTimeline(before, {
          ...before,
          summary: { ...summary, status: "failed", updatedAt: "2026-10-16T10:09:00.000Z" },
          failedAt: "2026-10-16T10:04:00.000Z",
        });
        expect(drafts.map(({ entry }) => [entry.kind, entry.at])).toEqual([
          ["conversation-failed", "2026-10-16T10:04:00.000Z"],
        ]);
      }),
    ),
  );
});
