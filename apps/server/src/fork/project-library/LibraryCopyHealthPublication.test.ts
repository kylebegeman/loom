import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  LibraryError,
  type LibraryCopyHealth,
  type LibraryProject,
  type LibraryRegisterCopyRequest,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Publication from "./LibraryCopyHealthPublication.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import { copyFor, resource, source } from "./Library.testkit.ts";

const project: LibraryProject = {
  id: "health-project",
  title: "AspectAvy",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const copy = copyFor(project);
const healthAt = (checkedAt: string, uncommittedFiles: number): LibraryCopyHealth => ({
  copyId: copy.id,
  environmentId: source,
  checkedAt,
  repositories: [
    { resourceId: resource.id, branch: "main", uncommittedFiles, unpushedCommits: 0, checkedAt },
  ],
});
const receiptFor = (entry: LibraryWorkingCopy): WorkspaceStore.WorkspaceReceipt => ({
  requestId: entry.id,
  fingerprint: entry.id,
  project,
  copy: entry,
  rootLocalProjectId: null,
  rootCheckpointRepository: true,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
});

const fixture = Effect.gen(function* () {
  const copies = yield* Ref.make<ReadonlyArray<LibraryWorkingCopy>>([copy]);
  const health = yield* Ref.make(healthAt("2026-10-16T00:00:00.000Z", 0));
  const reads = yield* Ref.make(0);
  const since = yield* Ref.make<Array<ReadonlyMap<string, string> | undefined>>([]);
  const published = yield* Ref.make<LibraryRegisterCopyRequest[]>([]);
  const failPublish = yield* Ref.make(false);
  const watched = yield* Deferred.make<ReadonlyArray<string>>();
  const statusChanges = yield* Queue.unbounded<void>();
  const workspaces = WorkspaceStore.LibraryWorkspaceStore.of({
    receipts: Ref.get(copies).pipe(Effect.map((entries) => entries.map(receiptFor))),
    bindings: Effect.succeed([]),
    get: () => Effect.succeed(receiptFor(copy)),
    getBinding: () => Effect.die("unused"),
    getBoundProject: () => Effect.succeed(project),
    put: () => Effect.void,
    importBindings: () => Effect.void,
    bind: () => Effect.void,
    repositoriesForRoot: () => Effect.succeed([]),
    validateThreadCwd: (input) => Effect.succeed(input.cwd),
  });
  const publisher = Publisher.LibraryPublisher.of({
    copyRegistrations: Stream.empty,
    publishDocuments: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
    enabled: true,
    info: Effect.succeed({
      environmentId: source,
      authorityId: "authority",
      authorityEpoch: 1,
      assets: "local" as const,
    }),
    registerCopy: (input) =>
      Effect.gen(function* () {
        if (yield* Ref.get(failPublish)) return yield* new LibraryError({ reason: "io" });
        yield* Ref.update(published, (requests) => [...requests, input]);
        return input.copy;
      }),
    recordActivity: () => Effect.die("unused"),
    publishAttachments: () => Effect.succeed(new Set<string>()),
    ingest: () => Effect.die("unused"),
    project: () => Effect.die("unused"),
    proposeBrief: () => Effect.die("unused"),
    registerPreviews: () => Effect.die("unused"),
    publishPage: () => Effect.die("unused"),
    listPages: () => Effect.die("unused"),
    updatePage: () => Effect.die("unused"),
    nextReplies: () => Effect.die("unused"),
    ackReply: () => Effect.die("unused"),
    signOutPageReaders: () => Effect.die("unused"),
  });
  const publication = yield* Publication.makeCopyHealthPublication({
    environmentId: source,
    publisher,
    workspaces,
    source: Publication.LibraryCopyHealthSource.of({
      read: (_copy, heads) =>
        Ref.update(reads, (count) => count + 1).pipe(
          Effect.andThen(Ref.update(since, (all) => [...all, heads])),
          Effect.andThen(Ref.get(health)),
        ),
      changes: (paths) =>
        paths.length === 0
          ? Stream.empty
          : Stream.unwrap(
              Deferred.succeed(watched, paths).pipe(Effect.as(Stream.fromQueue(statusChanges))),
            ),
    }),
    authority: Effect.succeed({
      journalId: "journal",
      authorityId: "authority",
      authorityEpoch: 1,
    }),
  });
  const publishedCount = Ref.get(published).pipe(Effect.map((requests) => requests.length));
  return {
    ...publication,
    copies,
    health,
    reads,
    since,
    published,
    publishedCount,
    failPublish,
    watched,
    // Lets the change pass through the stream's fibers before the test moves the clock.
    statusChanged: Queue.offer(statusChanges, undefined).pipe(
      Effect.andThen(Effect.replicateEffect(Effect.yieldNow, 10, { discard: true })),
    ),
  };
});
const run = <A, E>(
  use: (state: Effect.Success<typeof fixture>) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("copy health publication", () => {
  it.effect("publishes health under the journal fence only when it changed", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.report;
        const [first] = yield* Ref.get(f.published);
        // The marker names the copy, so the Library can drop its earlier health receipts.
        expect(first?.requestId).toMatch(/^journal:health:[a-f0-9]{16}:[a-f0-9]{64}$/);
        expect(first).toMatchObject({ authorityId: "authority", authorityEpoch: 1 });
        expect(first?.copy.health).toEqual(yield* Ref.get(f.health));

        // A later read with new check times but the same state is not news.
        yield* Ref.set(f.health, healthAt("2026-10-16T00:05:00.000Z", 0));
        yield* f.report;
        expect(yield* f.publishedCount).toBe(1);

        yield* Ref.set(f.health, healthAt("2026-10-16T00:10:00.000Z", 3));
        yield* f.report;
        expect(yield* f.publishedCount).toBe(2);
        expect((yield* Ref.get(f.published))[1]?.copy.health?.repositories[0]).toMatchObject({
          uncommittedFiles: 3,
        });
      }),
    ),
  );

  it.effect("retries a report the Library did not accept", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.failPublish, true);
        expect((yield* f.report.pipe(Effect.flip)).reason).toBe("io");
        yield* Ref.set(f.failPublish, false);
        yield* f.report;
        expect(yield* f.publishedCount).toBe(1);
        yield* f.report;
        expect(yield* f.publishedCount).toBe(1);
      }),
    ),
  );

  it.effect("passes each copy's last acknowledged heads to the next read", () =>
    run((f) =>
      Effect.gen(function* () {
        const withHead = (checkedAt: string, head: string): LibraryCopyHealth => {
          const health = healthAt(checkedAt, 0);
          return { ...health, repositories: [{ ...health.repositories[0]!, head }] };
        };
        const one = "1".repeat(40);
        const two = "2".repeat(40);
        yield* Ref.set(f.health, withHead("2026-10-16T00:00:00.000Z", one));
        yield* f.report;
        yield* Ref.set(f.health, withHead("2026-10-16T00:05:00.000Z", two));
        yield* Ref.set(f.failPublish, true);
        yield* f.report.pipe(Effect.flip);
        // The Library never took the second head, so the retry still counts from the first.
        yield* Ref.set(f.failPublish, false);
        yield* f.report;
        yield* f.report;
        expect(yield* Ref.get(f.since)).toEqual([
          undefined,
          new Map([[resource.id, one]]),
          new Map([[resource.id, one]]),
          new Map([[resource.id, two]]),
        ]);
      }),
    ),
  );

  it.effect("skips copies that are not registered and ready here", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.copies, [
          { ...copy, id: "elsewhere", environmentId: "other-computer" as typeof source },
          { ...copy, id: "preparing", state: "preparing" },
          { ...copy, id: "unregistered", registered: false },
        ]);
        yield* f.report;
        expect(yield* Ref.get(f.reads)).toBe(0);
        expect(yield* f.publishedCount).toBe(0);
      }),
    ),
  );

  it.effect("rereads on the interval and after status changes settle", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(f.run);
        // The first report runs at once and starts watching the copy's folders.
        expect(yield* Deferred.await(f.watched)).toEqual(
          copy.repositories.map((repo) => repo.path),
        );
        expect(yield* f.publishedCount).toBe(1);

        // A burst of status changes waits for quiet, then reads once.
        yield* Ref.set(f.health, healthAt("2026-10-16T00:01:00.000Z", 1));
        yield* f.statusChanged;
        yield* TestClock.adjust(Duration.seconds(20));
        yield* f.statusChanged;
        yield* TestClock.adjust(Duration.seconds(29));
        expect(yield* Ref.get(f.reads)).toBe(1);
        expect(yield* f.publishedCount).toBe(1);
        yield* TestClock.adjust(Duration.seconds(1));
        expect(yield* Ref.get(f.reads)).toBe(2);
        expect(yield* f.publishedCount).toBe(2);

        // The interval rereads, and an unchanged result is not published again.
        yield* TestClock.adjust(Publication.HEALTH_REPORT_INTERVAL);
        expect(yield* Ref.get(f.reads)).toBe(3);
        expect(yield* f.publishedCount).toBe(2);
      }),
    ),
  );
});

describe("Library copy health storage rules", () => {
  it("keeps the newest report", () => {
    const older = healthAt("2026-10-16T00:00:00.000Z", 0);
    const newer = healthAt("2026-10-16T01:00:00.000Z", 2);
    expect(Publication.latestCopyHealth(newer, older)).toBe(newer);
    expect(Publication.latestCopyHealth(older, newer)).toBe(newer);
    expect(Publication.latestCopyHealth(newer, undefined)).toBe(newer);
    expect(Publication.latestCopyHealth(undefined, undefined)).toBeUndefined();
  });

  it("accepts only reports about the copy's own repositories", () => {
    const health = healthAt("2026-10-16T00:00:00.000Z", 0);
    expect(Publication.healthBelongsTo(health, copy)).toBe(true);
    expect(Publication.healthBelongsTo({ ...health, copyId: "other" }, copy)).toBe(false);
    expect(
      Publication.healthBelongsTo(
        { ...health, repositories: [{ ...health.repositories[0]!, resourceId: "web" }] },
        copy,
      ),
    ).toBe(false);
  });
});
