import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId, EnvironmentId } from "@t3tools/contracts";
import { LibraryError, LibraryThreadArchive } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import * as LibraryService from "./LibraryService.ts";
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

describe("independent Library catalog and durable history", () => {
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
