import * as NodeZlib from "node:zlib";
import { MessageId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId, EnvironmentId } from "@t3tools/contracts";
import {
  LibraryCreateProjectRequest,
  LibraryError,
  LibraryIngestHistoryRequest,
  type LibraryProject,
  LibraryThreadArchive,
} from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import * as CopyHealthPublication from "./LibraryCopyHealthPublication.ts";
import * as LibraryService from "./LibraryService.ts";
import { createHistoryDelta } from "./LibraryHistoryDelta.ts";
import * as LibraryStore from "./LibraryStore.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import {
  source,
  localProjectId,
  threadId,
  resource,
  copyFor,
  archiveFor,
} from "./Library.testkit.ts";
import { validLibraryResources } from "./policy.ts";

const noAssets = Layer.succeed(Assets.LibraryAssetService, {
  mode: "local",
  find: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  read: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  put: () => Effect.fail(new LibraryError({ reason: "io" })),
  url: () => Effect.succeed(null),
});
const serviceLayer = LibraryService.layer.pipe(
  Layer.provide(noAssets),
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("authority")),
    }),
  ),
);
const run = <A, E, R>(
  use: (service: LibraryService.LibraryService["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const service = yield* LibraryService.LibraryService.pipe(Effect.provide(serviceLayer));
    return yield* use(service);
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);
const create = (service: LibraryService.LibraryService["Service"], requestId = "create") =>
  service.createProject({ requestId, title: "AspectAvy", resources: [resource] });
const archiveCodec = Schema.fromJsonString(Schema.toCodecJson(LibraryThreadArchive));
const encodeArchive = Schema.encodeEffect(archiveCodec);
const VERSION_EPOCH = "1970-01-01T00:00:00.000Z";
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value === null || typeof value !== "object"
      ? value
      : Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        );
const sha256Hex = (text: string) =>
  Crypto.Crypto.pipe(
    Effect.flatMap((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(text))),
    Effect.map(Hex.encode),
  );
// Restates the service's record digest, so a change that moves both sides still fails the goldens.
const referenceDigest = (encoded: string) =>
  sha256Hex(JSON.stringify(canonical(JSON.parse(encoded))));
const versionReferenceDigest = (archive: LibraryThreadArchive) =>
  encodeArchive({ ...archive, summary: { ...archive.summary, syncedAt: VERSION_EPOCH } }).pipe(
    Effect.flatMap(referenceDigest),
  );
const encodeIngest = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryIngestHistoryRequest)),
);
const encodeCreate = Schema.encodeEffect(Schema.fromJsonString(LibraryCreateProjectRequest));
const goldenProject: LibraryProject = {
  id: "golden-project",
  title: "AspectAvy",
  brief: "",
  resources: [resource],
  archived: false,
  revision: 1,
  createdAt: VERSION_EPOCH,
  updatedAt: VERSION_EPOCH,
};
const goldenArchive = Effect.fnUntraced(function* (sequence: number, text: string) {
  const thread = yield* archiveFor(goldenProject, sequence);
  return {
    ...thread,
    summary: { ...thread.summary, syncedAt: "2026-03-04T05:06:07.000Z" },
    projection: {
      ...thread.projection,
      messages: [{ ...thread.projection.messages[0]!, text }],
    },
  } satisfies LibraryThreadArchive;
});

describe("independent Library catalog and durable history", () => {
  it.effect(
    "keeps enrolled computer identity and names across offline library visits and rejects unsafe endpoints",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const authority = yield* service.info;
          const computer = {
            environmentId: source,
            label: "Dorothy",
            platform: { os: "darwin", arch: "arm64" },
            appVersion: "0.0.58",
            supportsExecution: true,
            endpoints: ["https://computer.example.test"],
          };
          const request = {
            authorityId: authority.authorityId,
            authorityEpoch: authority.authorityEpoch,
            computer,
          };
          const first = yield* service.registerComputer(request);
          const renamed = yield* service.registerComputer({
            ...request,
            computer: { ...computer, label: "Home Mac" },
          });
          expect(renamed.enrolledAt).toBe(first.enrolledAt);
          expect((yield* service.info).computers?.map((entry) => entry.label)).toEqual([
            "Home Mac",
          ]);
          expect(
            (yield* Effect.result(
              service.registerComputer({
                ...request,
                authorityEpoch: authority.authorityEpoch + 1,
              }),
            ))._tag,
          ).toBe("Failure");
          expect(
            (yield* Effect.result(
              service.registerComputer({
                ...request,
                computer: { ...computer, endpoints: ["https://example.test?token=private"] },
              }),
            ))._tag,
          ).toBe("Failure");
          expect((yield* service.info).computers).toHaveLength(1);
        }),
      ),
  );
  it.effect("execution hosts cannot create a competing shared catalog", () =>
    Effect.gen(function* () {
      yield* runForkMigrationSet(ProjectLibraryMigrations);
      const service = yield* LibraryService.LibraryService.pipe(
        Effect.provide(
          LibraryService.layer.pipe(
            Layer.provide(noAssets),
            Layer.provide(
              Layer.succeed(ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(source),
              }),
            ),
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
          ),
        ),
      );
      expect((yield* service.info).isAuthority).toBe(false);
      const result = yield* Effect.result(create(service));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.reason).toBe("not-authority");
      expect(yield* service.projects({}).pipe(Effect.flip)).toMatchObject({
        reason: "not-authority",
      });
      expect(yield* service.history({ id: "missing" }).pipe(Effect.flip)).toMatchObject({
        reason: "not-authority",
      });
    }).pipe(
      Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.scoped,
    ),
  );
  it.effect(
    "bounds history page bytes while retaining and deduplicating complete compressed archives",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const original = yield* archiveFor(project);
          const archive = {
            ...original,
            summary: { ...original.summary, workingCopyId: null },
            projection: {
              ...original.projection,
              messages: Array.from({ length: 4 }, (_, index) => ({
                ...original.projection.messages[0]!,
                id: MessageId.make(`large-${index}`),
                text: "x".repeat(900000),
              })),
              visibleTurnItems: [],
              turnItems: [],
            },
          };
          yield* service.registerThread({ requestId: "large-history", thread: archive });
          const newest = yield* service.history({ id: archive.summary.id, limit: 100 });
          expect(newest.projection.messages).toHaveLength(2);
          expect(newest.window?.nextOffset).toBe(2);
          const older = yield* service.history({
            id: archive.summary.id,
            offset: newest.window!.nextOffset,
            limit: 100,
          });
          expect(older.projection.messages.map((m) => m.id)).toEqual(["large-0", "large-1"]);
          expect(older.window?.hasMore).toBe(false);
          const sql = yield* SqlClient.SqlClient;
          expect(
            (yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM fork_library_threads`)[0]!.payload_json,
          ).toMatch(/^loom:gzip:/);
          const stats = (yield* sql<{
            count: number;
            bytes: number;
          }>`SELECT COUNT(*) AS count,SUM(length(bytes)) AS bytes FROM fork_library_history_blobs`)[0]!;
          expect(stats.count).toBe(1);
          expect(stats.bytes).toBeLessThan(50000);
          expect(
            (yield* service.history({ id: archive.summary.id })).projection.messages[0]!.text,
          ).toHaveLength(900000);
          yield* sql`UPDATE fork_library_history_blobs SET bytes=${new Uint8Array([1, 2, 3])}`;
          expect((yield* Effect.result(service.history({ id: archive.summary.id })))._tag).toBe(
            "Failure",
          );
          expect(
            (yield* service.history({ id: archive.summary.id, limit: 100 })).projection.messages,
          ).toHaveLength(2);
        }),
      ),
  );
  it.effect("reads bounded chronological history windows without trimming retained history", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        const initial = yield* archiveFor(project);
        const messages = Array.from({ length: 5 }, (_, index) => ({
          ...initial.projection.messages[0]!,
          id: MessageId.make(`message-${index}`),
          text: `Message ${index}`,
        }));
        const archive = {
          ...initial,
          summary: { ...initial.summary, workingCopyId: null },
          projection: { ...initial.projection, messages, visibleTurnItems: [], turnItems: [] },
        };
        yield* service.registerThread({ requestId: "window", thread: archive });
        const newest = yield* service.history({ id: archive.summary.id, limit: 2 });
        expect(newest.projection.messages.map((m) => m.text)).toEqual(["Message 3", "Message 4"]);
        expect(newest.window).toEqual({ offset: 0, totalItems: 5, hasMore: true, nextOffset: 2 });
        const older = yield* service.history({ id: archive.summary.id, offset: 2, limit: 2 });
        expect(older.projection.messages.map((m) => m.text)).toEqual(["Message 1", "Message 2"]);
        expect(
          (yield* service.history({ id: archive.summary.id })).projection.messages,
        ).toHaveLength(5);
        expect(
          (yield* Effect.result(service.history({ id: archive.summary.id, limit: 101 })))._tag,
        ).toBe("Failure");
      }),
    ),
  );
  it.effect("preserves history order and removes obsolete items across archive rewrites", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        const initial = yield* archiveFor(project);
        const makeArchive = (count: number, sequence: number, token: string) => ({
          ...initial,
          summary: { ...initial.summary, workingCopyId: null, sequence },
          projection: {
            ...initial.projection,
            visibleTurnItems: [],
            turnItems: [],
            messages: Array.from({ length: count }, (_, index) => ({
              ...initial.projection.messages[0]!,
              id: MessageId.make(`message-${index}`),
              text: `${token} ${index}`,
            })),
          },
        });
        const original = makeArchive(600, 1, "uniqueobsolete");
        yield* service.registerThread({ requestId: "rewrite-original", thread: original });
        expect(
          (yield* service.history({
            id: original.summary.id,
            offset: 240,
            limit: 100,
          })).projection.messages.map((message) => message.text),
        ).toEqual(original.projection.messages.slice(260, 360).map((message) => message.text));

        const appended = makeArchive(620, 2, "uniqueobsolete");
        yield* service.registerThread({ requestId: "rewrite-append", thread: appended });
        const appendedPage = yield* service.history({ id: appended.summary.id, limit: 100 });
        expect(appendedPage.projection.messages.map((message) => message.text)).toEqual(
          appended.projection.messages.slice(520).map((message) => message.text),
        );
        expect(appendedPage.window?.totalItems).toBe(620);

        const rewritten = makeArchive(270, 3, "uniquereplacement");
        yield* service.registerThread({ requestId: "rewrite-replacement", thread: rewritten });
        const newest = yield* service.history({ id: rewritten.summary.id, limit: 100 });
        expect(newest.projection.messages.map((message) => message.text)).toEqual(
          rewritten.projection.messages.slice(170).map((message) => message.text),
        );
        expect(newest.window?.totalItems).toBe(270);
        const oldest = yield* service.history({
          id: rewritten.summary.id,
          offset: 200,
          limit: 100,
        });
        expect(oldest.projection.messages.map((message) => message.text)).toEqual(
          rewritten.projection.messages.slice(0, 70).map((message) => message.text),
        );
        expect((yield* service.history({ id: rewritten.summary.id })).projection.messages).toEqual(
          rewritten.projection.messages,
        );
        expect(
          (yield* service.search({ query: "uniqueobsolete", limit: 20, semantic: false })).hits,
        ).toEqual([]);
        expect(
          (yield* service.search({ query: "uniquereplacement", limit: 20, semantic: false })).hits,
        ).toHaveLength(20);

        const empty = makeArchive(0, 4, "empty");
        yield* service.registerThread({ requestId: "rewrite-empty", thread: empty });
        const page = yield* service.history({ id: empty.summary.id, limit: 100 });
        expect(page.projection.messages).toEqual([]);
        expect(page.window?.totalItems).toBe(0);
        expect(
          (yield* service.search({ query: "uniquereplacement", limit: 20, semantic: false })).hits,
        ).toEqual([]);
      }),
    ),
  );
  it.effect("pages compact conversation metadata across projects and rejects unbounded reads", () =>
    run((service) =>
      Effect.gen(function* () {
        const firstProject = yield* create(service, "index-project-1");
        const secondProject = yield* create(service, "index-project-2");
        const firstArchive = yield* archiveFor(firstProject);
        const first = {
          ...firstArchive,
          summary: { ...firstArchive.summary, workingCopyId: null },
        };
        const next = yield* archiveFor(secondProject);
        const other = EnvironmentId.make("another-source");
        const second = {
          ...next,
          summary: {
            ...next.summary,
            id: `${other}:${next.summary.threadId}`,
            environmentId: other,
            workingCopyId: null,
          },
        };
        yield* service.registerThread({ requestId: "index-thread-1", thread: first });
        yield* service.registerThread({ requestId: "index-thread-2", thread: second });
        const a = yield* service.threadIndex({ limit: 1 });
        const b = yield* service.threadIndex({ limit: 1, offset: a.nextOffset! });
        expect((yield* service.lookupThread({ sourceEnvironmentId: source, threadId }))?.id).toBe(
          first.summary.id,
        );
        expect(
          yield* service.lookupThread({
            sourceEnvironmentId: EnvironmentId.make("unknown"),
            threadId,
          }),
        ).toBeNull();
        expect(a.threads).toHaveLength(1);
        expect(a.nextOffset).toBe(1);
        expect(a.projectActivity).toEqual(
          expect.arrayContaining([
            { projectId: firstProject.id, conversations: 1, latestAt: first.summary.updatedAt },
            { projectId: secondProject.id, conversations: 1, latestAt: second.summary.updatedAt },
          ]),
        );
        expect(b.projectActivity).toBeUndefined();
        expect(b.threads).toHaveLength(1);
        expect(b.nextOffset).toBeNull();
        expect(new Set([...a.threads, ...b.threads].map((t) => t.projectId)).size).toBe(2);
        expect("projection" in a.threads[0]!).toBe(false);
        const newest = "2026-10-20T15:29:46.828Z";
        const thirdEnvironment = EnvironmentId.make("third-source");
        const third = {
          ...first,
          summary: {
            ...first.summary,
            id: `${thirdEnvironment}:${first.summary.threadId}`,
            environmentId: thirdEnvironment,
            updatedAt: newest,
          },
        };
        yield* service.registerThread({ requestId: "index-thread-3", thread: third });
        expect((yield* service.threadIndex({ limit: 1 })).projectActivity).toEqual(
          expect.arrayContaining([
            { projectId: firstProject.id, conversations: 2, latestAt: newest },
          ]),
        );
        for (const [sequence, lifecycle] of [
          [2, { archived: true }],
          [3, { archived: false, deleted: true }],
        ] as const) {
          yield* service.registerThread({
            requestId: `index-hidden-${sequence}`,
            thread: { ...second, summary: { ...second.summary, sequence, ...lifecycle } },
          });
          expect((yield* service.threadIndex({ limit: 1 })).projectActivity).toEqual([
            { projectId: firstProject.id, conversations: 2, latestAt: newest },
          ]);
        }
        expect((yield* Effect.result(service.threadIndex({ limit: 201 })))._tag).toBe("Failure");
        expect((yield* Effect.result(service.threadIndex({ offset: -1 })))._tag).toBe("Failure");
      }),
    ),
  );

  it.effect(
    "publishes compact committed revisions to every reader across all metadata mutation paths",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const first = yield* Queue.unbounded<number>();
          const second = yield* Queue.unbounded<number>();
          for (const queue of [first, second])
            yield* service.subscribeRefreshes.pipe(
              Stream.runForEach((revision) => Queue.offer(queue, revision)),
              Effect.forkScoped({ startImmediately: true }),
            );
          expect(yield* Queue.take(first)).toBe(0);
          expect(yield* Queue.take(second)).toBe(0);
          const expectRevision = Effect.fnUntraced(function* (expected: number) {
            expect(yield* Queue.take(first)).toBe(expected);
            expect(yield* Queue.take(second)).toBe(expected);
          });
          const project = yield* create(service);
          yield* expectRevision(1);
          expect((yield* service.projects({}))[0]?.id).toBe(project.id);
          const edited = yield* service.updateProject({
            requestId: "edit",
            projectId: project.id,
            expectedRevision: project.revision,
            title: "Updated project",
            brief: project.brief,
            resources: project.resources,
          });
          yield* expectRevision(2);
          const archived = yield* service.archiveProject({
            requestId: "archive",
            projectId: project.id,
            expectedRevision: edited.revision,
            archived: true,
          });
          yield* expectRevision(3);
          expect(yield* service.projects({})).toEqual([]);
          yield* service.registerCopy({ requestId: "copy", copy: copyFor(archived) });
          yield* expectRevision(4);
          expect(yield* service.copies({ projectId: project.id })).toHaveLength(1);
          const thread = yield* archiveFor(archived, 10);
          yield* service.registerThread({ requestId: "thread", thread });
          yield* expectRevision(5);
          expect((yield* service.threads({ projectId: project.id }))[0]?.sequence).toBe(10);
          yield* service.ingestHistory({
            requestId: "history",
            sourceEnvironmentId: source,
            journalId: "journal",
            fromSequence: 0,
            entries: [
              { sequence: 1, thread: { ...thread, summary: { ...thread.summary, sequence: 11 } } },
            ],
          });
          yield* expectRevision(6);
          expect((yield* service.threads({ projectId: project.id }))[0]?.sequence).toBe(11);
          const imported = { ...project, id: "imported-project" };
          yield* service.importShadow({
            requestId: "import",
            sourceEnvironmentId: source,
            journalId: "import-journal",
            projects: [imported],
            copies: [{ ...copyFor(imported), id: "imported-copy", rootPath: "/borrowed/imported" }],
            threads: [],
            throughSequence: 0,
          });
          yield* expectRevision(7);
          expect((yield* service.projects({}))[0]?.id).toBe(imported.id);
          expect(yield* service.subscribeRefreshes.pipe(Stream.runHead)).toMatchObject({
            value: 7,
          });
        }),
      ),
  );
  it.effect(
    "does not invalidate readers for receipt replays, rejected edits, or rolled-back history batches",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const revision = () => service.subscribeRefreshes.pipe(Stream.runHead);
          expect(yield* revision()).toMatchObject({ value: 1 });
          yield* create(service);
          expect(yield* revision()).toMatchObject({ value: 1 });
          expect(
            yield* service
              .updateProject({
                requestId: "rejected",
                projectId: project.id,
                expectedRevision: 2,
                title: "Rejected",
                brief: "",
                resources: [],
              })
              .pipe(Effect.flip),
          ).toMatchObject({ reason: "revision-conflict" });
          expect(yield* revision()).toMatchObject({ value: 1 });
          const thread = yield* archiveFor(project);
          expect(
            yield* service
              .ingestHistory({
                requestId: "failed-batch",
                sourceEnvironmentId: source,
                journalId: "journal",
                fromSequence: 0,
                entries: [
                  {
                    sequence: 1,
                    thread: { ...thread, summary: { ...thread.summary, workingCopyId: null } },
                  },
                  {
                    sequence: 2,
                    thread: {
                      ...thread,
                      summary: {
                        ...thread.summary,
                        environmentId: EnvironmentId.make("wrong-host"),
                      },
                    },
                  },
                ],
              })
              .pipe(Effect.flip),
          ).toMatchObject({ reason: "invalid" });
          expect(yield* revision()).toMatchObject({ value: 1 });
          expect(yield* service.threads({ projectId: project.id })).toEqual([]);
        }),
      ),
  );
  it.effect("does not publish a revision when SQLite rejects the transaction commit", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE test_commit_parent (id TEXT PRIMARY KEY)`;
        yield* sql`CREATE TABLE test_commit_child (id TEXT REFERENCES test_commit_parent(id) DEFERRABLE INITIALLY DEFERRED)`;
        yield* sql`CREATE TRIGGER test_reject_commit AFTER INSERT ON fork_library_commands BEGIN INSERT INTO test_commit_child (id) VALUES (NEW.request_id); END`;
        const rejected = yield* service
          .updateProject({
            requestId: "commit-rejected",
            projectId: project.id,
            expectedRevision: 1,
            title: "Uncommitted edit",
            brief: "",
            resources: project.resources,
          })
          .pipe(Effect.exit);
        expect(rejected._tag).toBe("Failure");
        expect(yield* service.subscribeRefreshes.pipe(Stream.runHead)).toMatchObject({ value: 1 });
        expect(yield* service.project({ projectId: project.id })).toEqual(project);
      }),
    ),
  );
  it.effect("creates a stable project without a computer or folder and replays the command", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        expect(project.id).not.toBe(localProjectId);
        expect(yield* service.copies({ projectId: project.id })).toEqual([]);
        expect(yield* create(service)).toEqual(project);
        const restarted = yield* LibraryService.LibraryService.pipe(
          Effect.provide(Layer.fresh(serviceLayer)),
        );
        expect(yield* restarted.project({ projectId: project.id })).toEqual(project);
        expect((yield* restarted.info).authorityId).toBe((yield* service.info).authorityId);
        expect(
          (yield* service
            .createProject({ requestId: "create", title: "Different" })
            .pipe(Effect.flip)).reason,
        ).toBe("request-conflict");
      }),
    ),
  );
  it.effect(
    "rejects stale concurrent edits and retains pinned composition for old working copies",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const results = yield* Effect.all(
            ["one", "two"].map((requestId) =>
              service
                .updateProject({
                  requestId,
                  projectId: project.id,
                  expectedRevision: 1,
                  title: requestId,
                  brief: "",
                  resources: [],
                })
                .pipe(Effect.result),
            ),
            { concurrency: "unbounded" },
          );
          expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
          expect(results.find((result) => result._tag === "Failure")).toMatchObject({
            failure: { reason: "revision-conflict" },
          });
          expect(
            (yield* service.registerCopy({ requestId: "register", copy: copyFor(project) }))
              .projectRevision,
          ).toBe(1);
          const current = yield* service.project({ projectId: project.id });
          const archived = yield* service.archiveProject({
            requestId: "archive",
            projectId: project.id,
            expectedRevision: current.revision,
            archived: true,
          });
          expect(yield* service.projects({})).toEqual([]);
          yield* service.archiveProject({
            requestId: "reopen",
            projectId: project.id,
            expectedRevision: archived.revision,
            archived: false,
          });
          expect(yield* service.copies({ projectId: project.id })).toHaveLength(1);
        }),
      ),
  );
  it.effect("keeps source identifiers and full history independently of host availability", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const thread = yield* archiveFor(project, 42);
        const seeded = yield* service.registerThread({ requestId: "seed", thread });
        expect(seeded.sequence).toBe(42);
        const input = {
          requestId: "ingest",
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence: 0,
          entries: [{ sequence: 1, thread }],
        };
        expect(yield* service.ingestHistory(input)).toMatchObject({ applied: 1, lastSequence: 1 });
        expect(yield* service.ingestHistory({ ...input, requestId: "replay" })).toMatchObject({
          applied: 0,
          lastSequence: 1,
        });
        const restarted = yield* LibraryService.LibraryService.pipe(
          Effect.provide(Layer.fresh(serviceLayer)),
        );
        const saved = yield* restarted.history({ id: thread.summary.id });
        expect(saved.summary.environmentId).toBe(source);
        expect(saved.projection.thread.projectId).toBe(localProjectId);
        expect(yield* encodeArchive(saved)).toBe(
          yield* encodeArchive({ ...thread, summary: saved.summary }),
        );
        expect(saved.projection.messages[0]?.text).toContain("complete conversation");
        const older = {
          ...thread,
          summary: { ...thread.summary, sequence: 1 },
          projection: { ...thread.projection, messages: [] },
        };
        yield* service.registerThread({ requestId: "older", thread: older });
        expect(
          (yield* service.history({ id: thread.summary.id })).projection.messages,
        ).toHaveLength(1);
      }),
    ),
  );
  it.effect("keeps the latest published copy health and serves it with the copy", () =>
    run((service) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const project = yield* create(service);
        const copy = copyFor(project);
        const healthAt = (checkedAt: string, uncommittedFiles: number) => ({
          copyId: copy.id,
          environmentId: source,
          checkedAt,
          repositories: [
            { resourceId: resource.id, uncommittedFiles, unpushedCommits: 0, checkedAt },
          ],
        });
        const copySaves = () =>
          sql<{
            readonly count: number;
          }>`SELECT COUNT(*) AS count FROM fork_library_events WHERE aggregate_id = ${copy.id} AND event_type = 'copy.saved'`.pipe(
            Effect.map((rows) => rows[0]?.count),
          );
        yield* service.registerCopy({ requestId: "copy", copy });
        expect((yield* service.copies({ projectId: project.id }))[0]?.health).toBeUndefined();

        const reported = healthAt("2026-10-16T01:00:00.000Z", 2);
        yield* service.registerCopy({ requestId: "health", copy: { ...copy, health: reported } });
        expect((yield* service.copies({ projectId: project.id }))[0]?.health).toEqual(reported);
        // A health report alone is not copy history.
        expect(yield* copySaves()).toBe(1);

        // A save without health, from history publishing or an older computer, keeps the report.
        const moved = { ...copy, updatedAt: "2026-10-16T02:00:00.000Z" };
        yield* service.registerCopy({ requestId: "moved", copy: moved });
        expect((yield* service.copies({ projectId: project.id }))[0]).toMatchObject({
          updatedAt: moved.updatedAt,
          health: reported,
        });
        expect(yield* copySaves()).toBe(2);

        // An older report arriving late never replaces a newer one.
        yield* service.registerCopy({
          requestId: "late",
          copy: { ...moved, health: healthAt("2026-10-16T00:30:00.000Z", 9) },
        });
        expect((yield* service.copies({ projectId: project.id }))[0]?.health).toEqual(reported);

        // A stale copy record still delivers a newer report.
        const newer = healthAt("2026-10-16T03:00:00.000Z", 0);
        yield* service.registerCopy({ requestId: "stale", copy: { ...copy, health: newer } });
        expect((yield* service.copies({ projectId: project.id }))[0]).toMatchObject({
          updatedAt: moved.updatedAt,
          health: newer,
        });

        expect(
          (yield* service
            .registerCopy({
              requestId: "foreign",
              copy: { ...moved, health: { ...newer, copyId: "another-copy" } },
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }),
    ),
  );
  it.effect("keeps only the newest health receipt for each copy", () =>
    run((service) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const crypto = yield* Crypto.Crypto;
        const project = yield* create(service);
        const copy = copyFor(project);
        const other = {
          ...copy,
          id: "other-copy",
          rootPath: "/borrowed/other",
          repositories: copy.repositories.map((repository) => ({
            ...repository,
            path: "/borrowed/other/api",
          })),
        };
        yield* service.registerCopy({ requestId: "copy", copy });
        yield* service.registerCopy({ requestId: "other", copy: other });
        const report = (target: typeof copy, digest: string, checkedAt: string) =>
          Effect.gen(function* () {
            const marker = yield* CopyHealthPublication.copyHealthRequestMarker(crypto, target.id);
            yield* service.registerCopy({
              requestId: `journal${marker}${digest}`,
              copy: {
                ...target,
                health: { copyId: target.id, environmentId: source, checkedAt, repositories: [] },
              },
            });
          });
        const healthReceipts = () =>
          sql<{
            readonly request_id: string;
          }>`SELECT request_id FROM fork_library_commands WHERE request_id LIKE 'journal:health:%'`.pipe(
            Effect.map((rows) => rows.map((row) => row.request_id.split(":").at(-1)).toSorted()),
          );

        yield* report(copy, "first", "2026-10-16T01:00:00.000Z");
        yield* report(other, "other", "2026-10-16T01:30:00.000Z");
        yield* report(copy, "second", "2026-10-16T02:00:00.000Z");
        yield* report(copy, "third", "2026-10-16T03:00:00.000Z");
        expect(yield* healthReceipts()).toEqual(["other", "third"]);
        // A replay of a pruned report is harmless: it never replaces the newer health.
        yield* report(copy, "first", "2026-10-16T01:00:00.000Z");
        expect(
          (yield* service.copies({ projectId: project.id }))
            .map((entry) => entry.health?.checkedAt)
            .toSorted(),
        ).toEqual(["2026-10-16T01:30:00.000Z", "2026-10-16T03:00:00.000Z"]);
        expect(yield* healthReceipts()).toEqual(["first", "other"]);
      }),
    ),
  );
  it.effect("rejects sequence gaps, conflicting replays, and rolls back a failed batch", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const thread = yield* archiveFor(project);
        const input = {
          requestId: "batch",
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence: 0,
          entries: [{ sequence: 1, thread }],
        };
        expect(
          (yield* service.ingestHistory({ ...input, fromSequence: 1 }).pipe(Effect.flip)).reason,
        ).toBe("sequence-gap");
        const bad = {
          ...thread,
          summary: { ...thread.summary, environmentId: EnvironmentId.make("wrong") },
        };
        expect(
          (yield* service
            .ingestHistory({ ...input, entries: [input.entries[0]!, { sequence: 2, thread: bad }] })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
        expect((yield* service.history({ id: thread.summary.id }).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        yield* service.ingestHistory(input);
        expect(
          (yield* service
            .ingestHistory({
              ...input,
              requestId: "conflict",
              entries: [
                {
                  sequence: 1,
                  thread: { ...thread, summary: { ...thread.summary, title: "changed" } },
                },
              ],
            })
            .pipe(Effect.flip)).reason,
        ).toBe("sequence-conflict");
      }),
    ),
  );
  it.effect("imports explicit borrowed copies transactionally and verifies preserved history", () =>
    run((service) =>
      Effect.gen(function* () {
        const existing = yield* create(service);
        const imported = {
          ...existing,
          id: "imported",
          resources: [{ ...resource, remoteUrl: "/local/origin", relativePath: "." }],
        };
        const copy = {
          ...copyFor(imported),
          repositories: [{ ...copyFor(imported).repositories[0]!, path: "/borrowed/aspectavy" }],
        };
        const thread = yield* archiveFor(imported, 9);
        const input = {
          requestId: "import",
          sourceEnvironmentId: source,
          journalId: "import-journal",
          projects: [imported],
          copies: [copy],
          threads: [thread],
          throughSequence: 9,
        };
        const receipt = yield* service.importShadow(input);
        expect(receipt).toMatchObject({ projects: 1, copies: 1, threads: 1, verified: true });
        expect(yield* service.verifyImport({ requestId: "import" })).toEqual(receipt);
        const sql = yield* SqlClient.SqlClient;
        // The current conversation is compared directly, so a digest from an earlier contract is
        // harmless while it is current.
        yield* sql`UPDATE fork_library_thread_versions SET payload_json='loom:sha256:stale'`;
        expect(yield* service.verifyImport({ requestId: "import" })).toEqual(receipt);
        // A version kept whole by an earlier release is reduced to a digest of its own archive.
        yield* sql`UPDATE fork_library_thread_versions SET payload_json=(SELECT payload_json FROM fork_library_threads)`;
        yield* service.registerThread({
          requestId: "later",
          thread: { ...thread, summary: { ...thread.summary, sequence: 10 } },
        });
        expect(yield* service.verifyImport({ requestId: "import" })).toMatchObject({
          logicalRecordsVerified: true,
          verified: true,
        });
        // An importing release that predates a defaulted field wrote the proof and its version
        // without it. Today's contract fills the field in, but the proof still verifies.
        const store = yield* LibraryStore.LibraryStore.pipe(Effect.provide(LibraryStore.layer));
        const proof = JSON.parse((yield* store.importProof("import"))!);
        delete proof.threads[0].projection.thread.settledOverride;
        yield* sql`DELETE FROM fork_library_import_proofs WHERE request_id='import'`;
        yield* store.putImportProof("import", JSON.stringify(proof));
        const archived = proof.threads[0];
        const marker = Hex.encode(
          yield* (yield* Crypto.Crypto).digest(
            "SHA-256",
            new TextEncoder().encode(
              JSON.stringify(
                canonical({
                  ...archived,
                  summary: { ...archived.summary, syncedAt: VERSION_EPOCH },
                }),
              ),
            ),
          ),
        );
        yield* sql`UPDATE fork_library_thread_versions SET payload_json=${`loom:sha256:${marker}`} WHERE source_sequence=9`;
        expect(yield* service.verifyImport({ requestId: "import" })).toMatchObject({
          logicalRecordsVerified: true,
          verified: true,
        });
        expect((yield* service.history({ id: thread.summary.id })).projection.thread.id).toBe(
          threadId,
        );
        expect(
          (yield* service
            .registerCopy({ requestId: "release-borrowed", copy: { ...copy, state: "released" } })
            .pipe(Effect.flip)).reason,
        ).toBe("not-managed");
      }),
    ),
  );
  it.effect(
    "verifies retained import records after later edits and detects missing attachment coverage",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const imported = { ...project, id: "with-attachment" };
          const base = yield* archiveFor(imported, 10);
          const attachment = {
            type: "file" as const,
            id: ChatAttachmentId.make("attachment"),
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 3,
          };
          const thread = {
            ...base,
            projection: {
              ...base.projection,
              messages: [{ ...base.projection.messages[0]!, attachments: [attachment] }],
            },
          };
          const request = {
            requestId: "import-attachment",
            sourceEnvironmentId: source,
            journalId: "attachment-journal",
            projects: [imported],
            copies: [copyFor(imported)],
            threads: [thread],
            throughSequence: 0,
          };
          expect(yield* service.importShadow(request)).toMatchObject({
            logicalRecordsVerified: true,
            referencedAssets: 1,
            missingAssets: 1,
            assetBytesVerified: false,
            verified: false,
          });
          yield* service.updateProject({
            requestId: "later-project-edit",
            projectId: imported.id,
            expectedRevision: 1,
            title: "New title",
            brief: "New brief",
            resources: imported.resources,
          });
          yield* service.registerThread({
            requestId: "later-conversation",
            thread: {
              ...thread,
              summary: { ...thread.summary, sequence: 11 },
              projection: {
                ...thread.projection,
                messages: [{ ...thread.projection.messages[0]!, text: "Later conversation" }],
              },
            },
          });
          expect(yield* service.verifyImport({ requestId: request.requestId })).toMatchObject({
            logicalRecordsVerified: true,
            verified: false,
          });
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM fork_library_thread_versions WHERE library_id=${thread.summary.id} AND source_sequence=10`;
          expect(yield* service.verifyImport({ requestId: request.requestId })).toMatchObject({
            logicalRecordsVerified: false,
            verified: false,
          });
        }),
      ),
  );
  it.effect("rejects rewritten archive bodies at the same source watermark", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const thread = yield* archiveFor(project, 2);
        yield* service.registerThread({ requestId: "first", thread });
        const changed = { ...thread, projection: { ...thread.projection, messages: [] } };
        expect(
          (yield* service
            .registerThread({ requestId: "rewritten", thread: changed })
            .pipe(Effect.flip)).reason,
        ).toBe("sequence-conflict");
        expect((yield* service.threads({ projectId: project.id }))[0]?.sequence).toBe(2);
      }),
    ),
  );
  it.effect("keeps one compressed archive per conversation as its history advances", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const first = yield* archiveFor(project, 1);
        const edit = (sequence: number, text: string) => ({
          ...first,
          summary: { ...first.summary, sequence },
          projection: {
            ...first.projection,
            messages: [{ ...first.projection.messages[0]!, text }],
          },
        });
        const second = edit(2, "Second turn");
        const ingest = (
          requestId: string,
          fromSequence: number,
          entries: ReadonlyArray<typeof first>,
        ) =>
          service.ingestHistory({
            requestId,
            sourceEnvironmentId: source,
            journalId: "journal",
            fromSequence,
            entries: entries.map((thread, index) => ({
              sequence: fromSequence + index + 1,
              thread,
            })),
          });
        yield* ingest("first", 0, [first]);
        yield* ingest("second", 1, [second]);
        expect((yield* ingest("replay", 1, [second])).applied).toBe(0);
        yield* service.registerThread({ requestId: "same-again", thread: second });
        const sql = yield* SqlClient.SqlClient;
        expect(yield* sql`SELECT COUNT(*) AS count FROM fork_library_history_blobs`).toEqual([
          { count: 1 },
        ]);
        expect(
          yield* sql`SELECT payload_json FROM fork_library_ingested_entries ORDER BY sequence`,
        ).toEqual([{ payload_json: "" }, { payload_json: "" }]);
        const versions = yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_thread_versions ORDER BY source_sequence`;
        expect(versions).toHaveLength(2);
        expect(versions.every((row) => row.payload_json.startsWith("loom:sha256:"))).toBe(true);
        expect(
          (yield* service.history({ id: first.summary.id })).projection.messages[0]!.text,
        ).toBe("Second turn");
        expect(
          (yield* service
            .registerThread({ requestId: "rewritten", thread: edit(2, "Rewritten") })
            .pipe(Effect.flip)).reason,
        ).toBe("sequence-conflict");
      }),
    ),
  );
  it.effect("keeps the saved conversation when a replay matches it under today's contract", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const thread = yield* archiveFor(project, 2);
        const saved = yield* service.registerThread({ requestId: "first", thread });
        const sql = yield* SqlClient.SqlClient;
        const stored = yield* sql`SELECT payload_json FROM fork_library_threads`;
        // A digest taken before a contract gained a defaulted field no longer matches the archive.
        yield* sql`UPDATE fork_library_thread_versions SET payload_json='loom:sha256:stale'`;
        yield* TestClock.adjust("1 hour");
        expect(yield* service.registerThread({ requestId: "again", thread })).toEqual(saved);
        expect(yield* sql`SELECT payload_json FROM fork_library_threads`).toEqual(stored);
        expect(
          (yield* service
            .registerThread({
              requestId: "rewritten",
              thread: { ...thread, projection: { ...thread.projection, messages: [] } },
            })
            .pipe(Effect.flip)).reason,
        ).toBe("sequence-conflict");
      }),
    ),
  );
  it.effect("frees archives kept by versions saved before versions held only digests", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const first = yield* archiveFor(project, 1);
        yield* service.registerThread({ requestId: "first", thread: first });
        const sql = yield* SqlClient.SqlClient;
        // Earlier releases pointed each version at its first compressed archive, then rewrote the
        // conversation's own archive with a new syncedAt on every replay.
        yield* sql`UPDATE fork_library_thread_versions SET payload_json=(SELECT payload_json FROM fork_library_threads)`;
        const store = yield* LibraryStore.LibraryStore.pipe(Effect.provide(LibraryStore.layer));
        const row = (yield* sql<{
          summary_json: string;
          working_copy_id: string | null;
        }>`SELECT summary_json, working_copy_id FROM fork_library_threads`)[0]!;
        yield* store.putThread({
          id: first.summary.id,
          environmentId: source,
          threadId: first.summary.threadId,
          projectId: project.id,
          workingCopyId: row.working_copy_id,
          sourceSequence: 1,
          summary: row.summary_json,
          payload: yield* encodeArchive({
            ...first,
            summary: { ...first.summary, syncedAt: "2026-02-01T00:00:00.000Z" },
          }),
          updatedAt: first.summary.updatedAt,
        });
        const blobs = sql`SELECT COUNT(*) AS count FROM fork_library_history_blobs`;
        expect(yield* blobs).toEqual([{ count: 2 }]);
        yield* service.registerThread({
          requestId: "second",
          thread: { ...first, summary: { ...first.summary, sequence: 2 } },
        });
        expect(yield* blobs).toEqual([{ count: 1 }]);
        const versions = yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_thread_versions ORDER BY source_sequence`;
        expect(versions.every((row) => row.payload_json.startsWith("loom:sha256:"))).toBe(true);
        expect((yield* service.history({ id: first.summary.id })).summary.sequence).toBe(2);
      }),
    ),
  );
  it.effect(
    "reduces an imported version kept whole to a digest of the encoding it was saved in",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = { ...(yield* create(service)), id: "imported" };
          const copy = copyFor(project);
          const thread = yield* archiveFor(project, 9);
          yield* service.importShadow({
            requestId: "import",
            sourceEnvironmentId: source,
            journalId: "import-journal",
            projects: [project],
            copies: [copy],
            threads: [thread],
            throughSequence: 9,
          });
          // An importing release that predates a defaulted field wrote the proof, the conversation
          // and its version without it, with the version sharing the conversation's archive.
          const sql = yield* SqlClient.SqlClient;
          const store = yield* LibraryStore.LibraryStore.pipe(Effect.provide(LibraryStore.layer));
          const proof = JSON.parse((yield* store.importProof("import"))!);
          delete proof.threads[0].projection.thread.settledOverride;
          yield* sql`DELETE FROM fork_library_import_proofs WHERE request_id='import'`;
          yield* store.putImportProof("import", JSON.stringify(proof));
          const archived = proof.threads[0];
          const row = (yield* sql<{
            summary_json: string;
          }>`SELECT summary_json FROM fork_library_threads`)[0]!;
          yield* store.putThread({
            id: thread.summary.id,
            environmentId: source,
            threadId: thread.summary.threadId,
            projectId: project.id,
            workingCopyId: copy.id,
            sourceSequence: 9,
            summary: row.summary_json,
            payload: JSON.stringify({
              ...archived,
              summary: { ...archived.summary, syncedAt: "2026-02-01T00:00:00.000Z" },
            }),
            updatedAt: thread.summary.updatedAt,
          });
          yield* sql`UPDATE fork_library_thread_versions SET payload_json=(SELECT payload_json FROM fork_library_threads)`;
          const shared = (yield* sql<{
            payload_json: string;
          }>`SELECT payload_json FROM fork_library_threads`)[0]!.payload_json;
          yield* service.registerThread({
            requestId: "later",
            thread: { ...thread, summary: { ...thread.summary, sequence: 10 } },
          });
          // Re-encoding would fill in the field, and the proof would stop matching once a later
          // contract fills in another.
          const stored = Hex.encode(
            yield* (yield* Crypto.Crypto).digest(
              "SHA-256",
              new TextEncoder().encode(
                JSON.stringify(
                  canonical({
                    ...archived,
                    summary: { ...archived.summary, syncedAt: VERSION_EPOCH },
                  }),
                ),
              ),
            ),
          );
          expect(
            yield* sql`SELECT payload_json FROM fork_library_thread_versions WHERE source_sequence=9`,
          ).toEqual([{ payload_json: `loom:sha256:${stored}` }]);
          expect(
            yield* sql`SELECT COUNT(*) AS count FROM fork_library_history_blobs WHERE digest=${shared.slice("loom:gzip:".length)}`,
          ).toEqual([{ count: 0 }]);
          expect(yield* service.verifyImport({ requestId: "import" })).toMatchObject({
            logicalRecordsVerified: true,
            verified: true,
          });
        }),
      ),
  );
  it.effect(
    "hides retired borrowed registrations while preserving their historical association and pinned revision",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const copy = copyFor(project);
          yield* service.registerCopy({ requestId: "copy", copy });
          const thread = yield* archiveFor(project);
          yield* service.registerThread({ requestId: "thread", thread });
          yield* service.updateProject({
            requestId: "brief",
            projectId: project.id,
            expectedRevision: 1,
            title: project.title,
            brief: "Current brief",
            resources: project.resources,
          });
          expect(
            (yield* service.registerCopy({
              requestId: "retire",
              copy: { ...copy, registered: false },
            })).projectRevision,
          ).toBe(1);
          expect(yield* service.copies({ projectId: project.id })).toEqual([]);
          expect(
            (yield* service.copies({ projectId: project.id, includeReleased: true }))[0]
              ?.registered,
          ).toBe(false);
          expect((yield* service.history({ id: thread.summary.id })).summary.workingCopyId).toBe(
            copy.id,
          );
        }),
      ),
  );
  it.effect(
    "saves a chosen project color, keeps it when an edit omits it, and returns to automatic on null",
    () =>
      run((service) =>
        Effect.gen(function* () {
          expect((yield* create(service)).color).toBeUndefined();
          const project = yield* service.createProject({
            requestId: "colored",
            title: "Colored",
            color: "teal",
          });
          expect(project.color).toBe("teal");
          const edit = (requestId: string, expectedRevision: number) => ({
            requestId,
            projectId: project.id,
            expectedRevision,
            title: project.title,
            brief: project.brief,
            resources: project.resources,
          });
          const kept = yield* service.updateProject({ ...edit("keep", 1), brief: "New brief" });
          expect(kept).toMatchObject({ color: "teal", brief: "New brief", revision: 2 });
          const recolored = yield* service.updateProject({ ...edit("recolor", 2), color: "plum" });
          expect(recolored).toMatchObject({ color: "plum", revision: 3 });
          const automatic = yield* service.updateProject({ ...edit("automatic", 3), color: null });
          expect(automatic.revision).toBe(4);
          expect("color" in automatic).toBe(false);
          expect("color" in (yield* service.project({ projectId: project.id }))).toBe(false);
        }),
      ),
  );
  it.effect(
    "saves a project profile as a new revision, keeps it when an edit omits it, and removes it on null",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          expect(project.profile).toBeUndefined();
          const profile = {
            scripts: [
              {
                id: "dev",
                name: "Dev server",
                command: "pnpm dev",
                icon: "play" as const,
                runOnWorktreeCreate: false,
              },
            ],
            requiredTools: [{ id: "node" as const, minimumVersion: "22" }, { id: "pnpm" as const }],
            secretNames: ["GITHUB_TOKEN"],
            preferredEnvironmentIds: [source],
            allowMini: false,
          };
          const edit = (requestId: string, expectedRevision: number) => ({
            requestId,
            projectId: project.id,
            expectedRevision,
            title: project.title,
            brief: project.brief,
            resources: project.resources,
          });
          const saved = yield* service.updateProject({ ...edit("profile", 1), profile });
          expect(saved).toMatchObject({ revision: 2, profile });
          expect((yield* service.project({ projectId: project.id })).profile).toEqual(profile);
          // Each revision pins its own profile, the way it pins the brief.
          const sql = yield* SqlClient.SqlClient;
          const revisions = yield* sql<{
            revision: number;
            payload_json: string;
          }>`SELECT revision, payload_json FROM fork_library_project_revisions WHERE project_id = ${project.id} ORDER BY revision`;
          expect(
            revisions.map((row) => [row.revision, JSON.parse(row.payload_json).profile]),
          ).toEqual([
            [1, undefined],
            [2, profile],
          ]);
          const kept = yield* service.updateProject({ ...edit("keep", 2), brief: "New brief" });
          expect(kept).toMatchObject({ revision: 3, brief: "New brief", profile });
          const removed = yield* service.updateProject({ ...edit("remove", 3), profile: null });
          expect(removed.revision).toBe(4);
          expect("profile" in (yield* service.project({ projectId: project.id }))).toBe(false);
          const rejected = yield* service
            .updateProject({
              ...edit("secret", 4),
              profile: { secretNames: ["AKIAIOSFODNN7EXAMPLE"] },
            })
            .pipe(Effect.flip);
          expect(rejected).toMatchObject({ reason: "invalid" });
          expect(rejected.message).toBe(
            "A secret name looks like it holds a secret. Save only its name; each computer keeps the value.",
          );
          expect(rejected.message).not.toContain("AKIA");
          expect((yield* service.project({ projectId: project.id })).revision).toBe(4);
        }),
      ),
  );
  it.effect(
    "keeps a profile saved under older secret rules through unrelated edits and accepted briefs",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const token = "CGu46u5amB4HBpUsiU7g78UdCQgxY956Zsn2IBAT";
          const deploy = {
            id: "deploy",
            name: "Deploy",
            command: `ship --key ${token}`,
            icon: "play" as const,
            runOnWorktreeCreate: false,
          };
          // A Library from before the opaque-token rule saved this script.
          const sql = yield* SqlClient.SqlClient;
          const older = { ...project, profile: { scripts: [deploy] } };
          yield* sql`UPDATE fork_library_projects SET payload_json = ${JSON.stringify(older)} WHERE id = ${project.id}`;
          const edit = (requestId: string, expectedRevision: number) => ({
            requestId,
            projectId: project.id,
            expectedRevision,
            title: project.title,
            brief: project.brief,
            resources: project.resources,
          });
          const renamed = yield* service.updateProject({
            ...edit("title", 1),
            title: "AspectAvy 2",
            brief: "New brief",
            color: "teal",
          });
          expect(renamed).toMatchObject({ revision: 2, color: "teal", profile: older.profile });
          // Clients resend the whole profile, so the old script rides along with a new change.
          const resent = yield* service.updateProject({
            ...edit("resend", 2),
            title: renamed.title,
            brief: renamed.brief,
            profile: { scripts: [deploy], allowMini: false },
          });
          expect(resent).toMatchObject({ revision: 3, profile: { scripts: [deploy] } });
          const added = yield* service
            .updateProject({
              ...edit("add", 3),
              title: renamed.title,
              brief: renamed.brief,
              profile: { scripts: [deploy, { ...deploy, id: "copy", name: "Copy" }] },
            })
            .pipe(Effect.flip);
          expect(added).toMatchObject({ reason: "invalid" });
          expect(added.message).toMatch(/^Script 2 looks like it holds a secret/);
          expect(added.message).not.toContain(token);
          const proposal = yield* service.proposeBrief(
            {
              requestId: "propose",
              projectId: project.id,
              baseRevision: 3,
              proposedBrief: "Ship the viewer.",
              summary: "Record the goal.",
            },
            {
              kind: "conversation",
              environmentId: EnvironmentId.make("computer"),
              threadId: threadId,
            },
          );
          const accepted = yield* service.acceptBriefProposal({
            requestId: "accept",
            proposalId: proposal.id,
            expectedRevision: 3,
          });
          expect(accepted.project).toMatchObject({
            revision: 4,
            brief: "Ship the viewer.",
            profile: { scripts: [deploy] },
          });
        }),
      ),
  );
  it.effect(
    "refuses new tools outside the catalog but keeps ones a newer catalog saved, and leaves an unchanged project on its revision",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          const edit = (requestId: string, expectedRevision: number) => ({
            requestId,
            projectId: project.id,
            expectedRevision,
            title: project.title,
            brief: project.brief,
            resources: project.resources,
          });
          const unknown = yield* service
            .updateProject({ ...edit("curl", 1), profile: { requiredTools: [{ id: "curl" }] } })
            .pipe(Effect.flip);
          expect(unknown).toMatchObject({ reason: "invalid" });
          expect(unknown.message).toMatch(/^This Library does not know the required tool "curl"\./);
          // A newer Library saved a tool this catalog does not know.
          const sql = yield* SqlClient.SqlClient;
          const newer = { ...project, profile: { requiredTools: [{ id: "zig" }] } };
          yield* sql`UPDATE fork_library_projects SET payload_json = ${JSON.stringify(newer)} WHERE id = ${project.id}`;
          const kept = yield* service.updateProject({
            ...edit("keep-zig", 1),
            profile: { requiredTools: [{ id: "zig", minimumVersion: "0.13" }, { id: "node" }] },
          });
          expect(kept.revision).toBe(2);
          expect(kept.profile?.requiredTools?.map((tool) => tool.id)).toEqual(["zig", "node"]);
          // Saving what is already there is not a new revision.
          const same = yield* service.updateProject({
            ...edit("same", 2),
            profile: { requiredTools: [{ id: "zig", minimumVersion: "0.13" }, { id: "node" }] },
          });
          expect(same).toEqual(kept);
          expect((yield* service.updateProject(edit("omitted", 2))).revision).toBe(2);
          expect(
            (yield* service.updateProject({ ...edit("changed", 2), brief: "Changed" })).revision,
          ).toBe(3);
        }),
      ),
  );
  it.effect("validates repository composition and web references without cloning", () =>
    run((service) =>
      Effect.gen(function* () {
        expect(validLibraryResources([{ ...resource, relativePath: "." }])).toBe(true);
        expect(
          validLibraryResources([
            resource,
            { ...resource, id: "nested", relativePath: "api/nested" },
          ]),
        ).toBe(false);
        expect(
          validLibraryResources([{ ...resource, remoteUrl: "ssh://git@2130706433/team/repo" }]),
        ).toBe(false);
        expect(validLibraryResources([{ ...resource, relativePath: "../escape" }])).toBe(false);
        const link = {
          ...resource,
          id: "design",
          kind: "link" as const,
          url: "https://example.test/spec",
          remoteUrl: null,
          relativePath: "",
        };
        expect(
          (yield* service.createProject({
            requestId: "links",
            title: "Design",
            resources: [resource, link],
          })).resources,
        ).toHaveLength(2);
        expect(validLibraryResources([{ ...link, url: "javascript:alert(1)" }])).toBe(false);
      }),
    ),
  );
});

describe("Library history ingest", () => {
  it.effect(
    "reconstructs deltas atomically and recognizes replay after the base has advanced",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* create(service);
          yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
          const before = yield* archiveFor(project, 1);
          const next = yield* archiveFor(project, 2);
          const after = {
            ...next,
            projection: {
              ...next.projection,
              messages: [
                ...before.projection.messages,
                {
                  ...next.projection.messages[0]!,
                  id: MessageId.make("reply"),
                  text: "Added reply",
                },
              ],
            },
          };
          const common = { sourceEnvironmentId: source, journalId: "delta-journal" };
          yield* service.ingestHistory({
            ...common,
            requestId: "initial",
            fromSequence: 0,
            entries: [{ sequence: 1, thread: before }],
          });
          const entry = createHistoryDelta(before, after);
          const input = {
            ...common,
            requestId: "delta",
            fromSequence: 1,
            entries: [{ sequence: 2, ...entry }],
          };
          expect(yield* service.ingestHistory(input)).toMatchObject({
            applied: 1,
            lastSequence: 2,
          });
          const saved = yield* service.history({ id: before.summary.id });
          expect(saved.projection).toEqual(after.projection);
          expect(yield* service.ingestHistory({ ...input, requestId: "retry" })).toMatchObject({
            applied: 0,
            lastSequence: 2,
          });
          const bad = { ...entry, delta: { ...entry.delta, baseSequence: 0 } };
          expect(
            (yield* service
              .ingestHistory({
                ...common,
                requestId: "bad-base",
                fromSequence: 2,
                entries: [{ sequence: 3, ...bad }],
              })
              .pipe(Effect.flip)).reason,
          ).toBe("sequence-conflict");
          expect((yield* service.history({ id: before.summary.id })).projection).toEqual(
            after.projection,
          );
        }),
      ),
  );

  const historyRows = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      threads:
        yield* sql`SELECT library_id, source_sequence, summary_json, payload_json FROM fork_library_threads`,
      versions:
        yield* sql`SELECT library_id, source_sequence, payload_json FROM fork_library_thread_versions ORDER BY source_sequence`,
      blobs: yield* sql`SELECT digest FROM fork_library_history_blobs`,
      entries:
        yield* sql`SELECT journal_id, sequence, payload_digest FROM fork_library_ingested_entries ORDER BY journal_id, sequence`,
      cursors: yield* sql`SELECT journal_id, last_sequence FROM fork_library_host_cursors`,
    };
  });
  it.effect("keeps the request, entry, version and archive digests earlier releases saved", () =>
    run((service) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* create(service);
        const [created] = yield* sql<{
          fingerprint: string;
        }>`SELECT fingerprint FROM fork_library_commands WHERE request_id = 'create'`;
        expect(created!.fingerprint).toBe(
          yield* referenceDigest(
            yield* encodeCreate({ requestId: "create", title: "AspectAvy", resources: [resource] }),
          ),
        );
        yield* service.importShadow({
          requestId: "golden-import",
          sourceEnvironmentId: source,
          journalId: "import-journal",
          projects: [goldenProject],
          copies: [copyFor(goldenProject)],
          threads: [],
          throughSequence: 0,
        });
        yield* TestClock.adjust("1 hour");
        const first = yield* goldenArchive(1, 'Größe "quoted"\nnext line ✓');
        const second = yield* goldenArchive(2, "Zweite Runde: “typographic” quotes");
        const input = {
          requestId: "golden-ingest",
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence: 0,
          entries: [
            { sequence: 1, thread: first },
            { sequence: 2, thread: second },
          ],
        };
        expect(yield* service.ingestHistory(input)).toMatchObject({ applied: 2, lastSequence: 2 });
        const [command] = yield* sql<{
          fingerprint: string;
        }>`SELECT fingerprint FROM fork_library_commands WHERE request_id = 'golden-ingest'`;
        expect(command!.fingerprint).toBe(yield* referenceDigest(yield* encodeIngest(input)));
        const rows = yield* historyRows;
        expect(rows.entries.map((row) => row.payload_digest)).toEqual([
          yield* referenceDigest(yield* encodeArchive(first)),
          yield* referenceDigest(yield* encodeArchive(second)),
        ]);
        expect(rows.versions.map((row) => row.payload_json)).toEqual([
          `loom:sha256:${yield* versionReferenceDigest(first)}`,
          `loom:sha256:${yield* versionReferenceDigest(second)}`,
        ]);
        const expectedPayload = yield* encodeArchive({
          ...second,
          summary: { ...second.summary, syncedAt: "1970-01-01T01:00:00.000Z" },
        });
        const payloadDigest = yield* sha256Hex(expectedPayload);
        expect(rows.threads.map((row) => row.payload_json)).toEqual([`loom:gzip:${payloadDigest}`]);
        // The import proof keeps its own blob; the first entry's archive was released.
        expect(rows.blobs).toHaveLength(2);
        const [blob] = yield* sql<{
          bytes: Uint8Array;
        }>`SELECT bytes FROM fork_library_history_blobs WHERE digest = ${payloadDigest}`;
        expect(NodeZlib.gunzipSync(blob!.bytes).toString("utf8")).toBe(expectedPayload);
        // Literal digests pin the encoding itself, not just agreement with the restated digest.
        expect({
          create: created!.fingerprint,
          ingest: command!.fingerprint,
          entries: rows.entries.map((row) => row.payload_digest),
          versions: rows.versions.map((row) => row.payload_json),
          archive: payloadDigest,
        }).toEqual({
          create: "ee449c167f9f21dea3f5b385963a43206699cb35d589bea437666c5ff3cb86dc",
          ingest: "27d0cdb8847b02cc6dede21b475564d179bc25cde26f09e2b64713e51dbdddee",
          entries: [
            "2bd55dc0b2c2464aa6b51c94cb092e19c7e5dd3f455d0a6cf44ca94cba6cb559",
            "d90a0127a9a8aa51b020f1141fce20e4f3e648f7c8b1b8f49bdf4d8434714807",
          ],
          versions: [
            "loom:sha256:121af58e732f8f9133160749ab21736062ed04d254e8e5aa5e87b72529d4035f",
            "loom:sha256:ee74346cf8860dd426e16f7442c33ac1c68d9315a7034bdd82e5916bfcc0c2bd",
          ],
          archive: "b3aadd3f306aec936399b067d9df9db8d80e723909eefcc2f620c2a00577c9ad",
        });
        expect(
          yield* service.ingestHistory({ ...input, requestId: "golden-replay" }),
        ).toMatchObject({ applied: 0, lastSequence: 2 });
        expect(yield* historyRows).toEqual(rows);
      }),
    ),
  );
  it.effect("traces history writes with sizes and counts, never ids or conversation text", () => {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    return run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        spans.length = 0;
        const ingests: Array<LibraryIngestHistoryRequest> = [];
        for (const sequence of [1, 2])
          ingests.push({
            requestId: `ingest-${sequence}`,
            sourceEnvironmentId: source,
            journalId: "journal",
            fromSequence: sequence - 1,
            entries: [{ sequence, thread: yield* archiveFor(project, sequence) }],
          });
        const results = [];
        for (const ingest of ingests) results.push(yield* service.ingestHistory(ingest));
        const library = spans.filter((span) => span.name.startsWith("Library"));
        const history = library.filter((span) =>
          /^Library(Service|Store|Search|Timeline)\./.test(span.name),
        );
        expect(new Set(history.map((span) => span.name))).toEqual(
          new Set([
            "LibraryService.ingestHistory",
            "LibraryService.prepareEntries",
            "LibraryService.prepareRequest",
            "LibraryService.mutation",
            "LibraryService.transaction",
            "LibraryService.readPreviousThread",
            "LibraryStore.unpack",
            "LibraryStore.pack",
            "LibraryStore.indexHistory",
            "LibraryStore.release",
            "LibrarySearch.index",
            "LibraryTimeline.recordTimeline",
          ]),
        );
        // Digests read nothing saved, so they are taken before the write lock, not under it.
        const ancestors = (span: Tracer.Span): Array<string> =>
          Option.match(span.parent, {
            onNone: () => [],
            onSome: (parent) => (parent._tag === "Span" ? [parent.name, ...ancestors(parent)] : []),
          });
        for (const name of ["LibraryService.prepareEntries", "LibraryService.prepareRequest"])
          for (const span of history.filter((candidate) => candidate.name === name))
            expect(ancestors(span)).not.toContain("LibraryService.transaction");
        const timeline = history.map((span) => span.name);
        expect(timeline.indexOf("LibraryService.prepareEntries")).toBeLessThan(
          timeline.indexOf("LibraryService.prepareRequest"),
        );
        expect(timeline.indexOf("LibraryService.prepareRequest")).toBeLessThan(
          timeline.indexOf("LibraryService.transaction"),
        );
        const attributes = library.flatMap((span) => [...span.attributes]);
        for (const [key, value] of attributes)
          if (key !== "library.operation") expect(typeof value, key).toBe("number");
        const recorded = JSON.stringify(attributes);
        for (const secret of [
          project.id,
          project.title,
          source,
          threadId,
          "archive-thread",
          "journal",
          "Preserve this complete conversation",
        ])
          expect(recorded).not.toContain(secret);
        expect(attributes).toContainEqual(["library.entries", 1]);
        // A resent batch is answered from its receipt without digesting its entries again.
        spans.length = 0;
        expect(yield* service.ingestHistory(ingests[1]!)).toEqual(results[1]);
        expect(spans.map((span) => span.name)).toContain("LibraryService.prepareRequest");
        expect(spans.map((span) => span.name)).not.toContain("LibraryService.prepareEntries");
      }),
    ).pipe(Effect.withTracer(tracer));
  });
  it.effect("commits concurrent ingests one at a time and publishes each", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const revision = service.subscribeRefreshes.pipe(Stream.runHead);
        const before = Option.getOrThrow(yield* revision);
        const results = yield* Effect.all(
          [1, 2].map((sequence) =>
            Effect.gen(function* () {
              return yield* service.ingestHistory({
                requestId: `concurrent-${sequence}`,
                sourceEnvironmentId: source,
                journalId: `journal-${sequence}`,
                fromSequence: 0,
                entries: [{ sequence: 1, thread: yield* archiveFor(project, sequence) }],
              });
            }),
          ),
          { concurrency: "unbounded" },
        );
        expect(results.map((result) => result.lastSequence)).toEqual([1, 1]);
        expect(Option.getOrThrow(yield* revision)).toBe(before + 2);
        const rows = yield* historyRows;
        expect(rows.cursors).toHaveLength(2);
        expect(rows.threads.map((row) => row.source_sequence)).toEqual([2]);
      }),
    ),
  );
  it.effect("reports ingest failures in the order earlier releases reported them", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const thread = yield* archiveFor(project);
        const authority = yield* service.info;
        const input = {
          requestId: "order",
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence: 0,
          entries: [{ sequence: 1, thread }],
        };
        const reason = (request: LibraryIngestHistoryRequest) =>
          service.ingestHistory(request).pipe(
            Effect.flip,
            Effect.map((error) => error.reason),
          );
        const staleFence = {
          authorityId: authority.authorityId,
          authorityEpoch: authority.authorityEpoch + 1,
        };
        expect(
          yield* reason({
            ...input,
            ...staleFence,
            entries: Array.from({ length: 101 }, (_, index) => ({ sequence: index + 1, thread })),
          }),
        ).toBe("invalid");
        expect(yield* reason({ ...input, ...staleFence, fromSequence: 5 })).toBe("blocked");
        expect(
          yield* reason({
            ...input,
            entries: [
              { sequence: 1, thread },
              { sequence: 3, thread },
            ],
          }),
        ).toBe("sequence-gap");
        expect(yield* service.threads({ projectId: project.id })).toEqual([]);
        yield* service.ingestHistory(input);
        const changed = { ...thread, summary: { ...thread.summary, title: "changed" } };
        const wrongHost = {
          ...thread,
          summary: { ...thread.summary, environmentId: EnvironmentId.make("wrong") },
        };
        expect(
          yield* reason({
            ...input,
            requestId: "conflict-first",
            entries: [
              { sequence: 1, thread: changed },
              { sequence: 2, thread: wrongHost },
            ],
          }),
        ).toBe("sequence-conflict");
        expect(
          yield* reason({
            ...input,
            requestId: "invalid-after-replay",
            entries: [
              { sequence: 1, thread },
              { sequence: 2, thread: wrongHost },
            ],
          }),
        ).toBe("invalid");
        expect(yield* reason({ ...input, entries: [{ sequence: 1, thread: changed }] })).toBe(
          "request-conflict",
        );
      }),
    ),
  );
  it.effect("settles a repeated conversation sequence without saving another archive", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* create(service);
        yield* service.registerCopy({ requestId: "copy", copy: copyFor(project) });
        const thread = yield* archiveFor(project, 5);
        const ingest = (requestId: string, fromSequence: number, archive: LibraryThreadArchive) =>
          service.ingestHistory({
            requestId,
            sourceEnvironmentId: source,
            journalId: "journal",
            fromSequence,
            entries: [{ sequence: fromSequence + 1, thread: archive }],
          });
        yield* ingest("first", 0, thread);
        const { blobs, versions, threads } = yield* historyRows;
        yield* TestClock.adjust("1 hour");
        expect(yield* ingest("again", 1, thread)).toMatchObject({ applied: 1, lastSequence: 2 });
        expect(yield* historyRows).toMatchObject({ blobs, versions, threads });
        expect(
          (yield* ingest("rewritten", 2, {
            ...thread,
            projection: { ...thread.projection, messages: [] },
          }).pipe(Effect.flip)).reason,
        ).toBe("sequence-conflict");
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO fork_library_thread_versions (library_id, source_sequence, payload_json) VALUES (${thread.summary.id}, 6, 'loom:sha256:foreign')`;
        expect(
          (yield* ingest("foreign", 2, {
            ...thread,
            summary: { ...thread.summary, sequence: 6 },
          }).pipe(Effect.flip)).reason,
        ).toBe("sequence-conflict");
        expect((yield* historyRows).blobs).toEqual(blobs);
      }),
    ),
  );
});
