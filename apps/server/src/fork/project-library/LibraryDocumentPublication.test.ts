import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_DECISIONS_FEATURE,
  LibraryError,
  type LibraryDocument,
  type LibraryDocumentsPublishRequest,
  type LibraryProject,
} from "@t3tools/contracts/fork";
import { parseDecisionDocument } from "@t3tools/shared/fork/library-decisions";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { layerMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { copyFor, resource, source } from "./Library.testkit.ts";
import * as Publication from "./LibraryDocumentPublication.ts";
import { documentDigest } from "./LibraryDocuments.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import type { WorkspaceReceipt } from "./LibraryWorkspaceStore.ts";

const project: LibraryProject = {
  id: "project",
  title: "Platform",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const copy = copyFor(project);
const receipt: WorkspaceReceipt = {
  requestId: "copy",
  fingerprint: "copy",
  project,
  copy,
  rootLocalProjectId: null,
  rootCheckpointRepository: true,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
};
const document = Effect.fn("test.document")(function* (index: number) {
  const value = {
    ...parseDecisionDocument(
      `docs/adr/${index}.md`,
      `# Record ${index}\nStatus: Accepted\nOwner recovery ${index}`,
    ),
    projectId: project.id,
    resourceId: resource.id,
  };
  return { ...value, digest: yield* documentDigest(value) };
});
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const rows = yield* Ref.make<ReadonlyArray<LibraryDocument>>([yield* document(1)]);
  const requests = yield* Ref.make<LibraryDocumentsPublishRequest[]>([]);
  const fail = yield* Ref.make(false);
  const registrations = yield* Queue.unbounded<typeof copy>();
  const published = yield* Queue.unbounded<void>();
  const observed = yield* Deferred.make<void>();
  const copies = yield* Ref.make<ReadonlyArray<WorkspaceReceipt>>([receipt]);
  const publisher = {
    info: Effect.succeed({
      environmentId: EnvironmentId.make("library"),
      authorityId: "authority",
      authorityEpoch: 1,
      assets: "local" as const,
      features: [LIBRARY_DECISIONS_FEATURE],
    }),
    project: () => Effect.succeed(project),
    copyRegistrations: Stream.fromQueue(registrations).pipe(
      Stream.onStart(Deferred.succeed(observed, undefined)),
    ),
    publishDocuments: (input: LibraryDocumentsPublishRequest) =>
      Effect.gen(function* () {
        yield* Ref.update(requests, (items) => [...items, input]);
        if (yield* Ref.get(fail)) return yield* new LibraryError({ reason: "io" });
        yield* Queue.offer(published, undefined);
        return { published: input.documents.length, removed: input.removed.length };
      }),
  };
  const options = {
    environmentId: source,
    publisher,
    workspaces: { receipts: Ref.get(copies) },
    source: Publication.LibraryDocumentSource.of({
      read: () =>
        Ref.get(rows).pipe(Effect.map((documents) => ({ commit: "a".repeat(40), documents }))),
    }),
  };
  const publication = yield* Publication.makeDocumentPublication(options);
  return { publication, options, rows, copies, requests, fail, registrations, published, observed };
});
const run = <A, E, R>(use: (state: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

describe("document publication", () => {
  it.effect("skips unchanged records across restarts and publishes removals", () =>
    run(({ publication, options, rows, requests }) =>
      Effect.gen(function* () {
        yield* publication.report;
        yield* publication.report;
        const restarted = yield* Publication.makeDocumentPublication(options);
        yield* restarted.report;
        expect(yield* Ref.get(requests)).toHaveLength(1);
        yield* Ref.set(rows, []);
        yield* restarted.report;
        expect((yield* Ref.get(requests))[1]!.removed).toEqual([
          { path: "docs/adr/1.md", anchor: "" },
        ]);
        yield* restarted.report;
        expect(yield* Ref.get(requests)).toHaveLength(2);
      }),
    ),
  );
  it.effect("retries an unacknowledged batch and bounds requests to 50 total changes", () =>
    run(({ publication, rows, requests, fail }) =>
      Effect.gen(function* () {
        yield* Ref.set(
          rows,
          yield* Effect.forEach(
            Array.from({ length: 112 }, (_, i) => i),
            document,
          ),
        );
        yield* Ref.set(fail, true);
        expect((yield* publication.report.pipe(Effect.result))._tag).toBe("Failure");
        yield* Ref.set(fail, false);
        yield* publication.report;
        const sent = yield* Ref.get(requests);
        expect(sent.map((request) => request.documents.length + request.removed.length)).toEqual([
          50, 50, 50, 12,
        ]);
        expect(sent[0]).toEqual(sent[1]);
        yield* publication.report;
        expect(yield* Ref.get(requests)).toHaveLength(4);
      }),
    ),
  );
  it.effect.each(["edit", "delete"] as const)(
    "replays a lost acknowledgement before %s after restarting",
    (change) =>
      run(({ options, rows, requests, fail }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const remote = new Map<string, LibraryDocument>();
          const durableOptions = {
            ...options,
            publisher: {
              ...options.publisher,
              publishDocuments: (request: LibraryDocumentsPublishRequest) =>
                Effect.gen(function* () {
                  const pending = yield* sql<{
                    payload_json: string;
                  }>`SELECT payload_json FROM fork_library_document_pending_batches`.pipe(
                    Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
                  );
                  expect(pending).toHaveLength(1);
                  expect(JSON.parse(pending[0]!.payload_json)).toEqual(request);
                  for (const row of request.documents) remote.set(row.path, row);
                  for (const row of request.removed) remote.delete(row.path);
                  return yield* options.publisher.publishDocuments(request);
                }),
            },
          };
          const original = (yield* Ref.get(rows))[0]!;
          const publication = yield* Publication.makeDocumentPublication(durableOptions);
          yield* Ref.set(fail, true);
          expect((yield* publication.report.pipe(Effect.result))._tag).toBe("Failure");
          expect(remote.get(original.path)).toEqual(original);
          const changed = {
            ...original,
            text: "# Revised recovery\nStatus: Accepted\nUse a revised key.",
          };
          const updated = { ...changed, digest: yield* documentDigest(changed) };
          yield* Ref.set(rows, change === "delete" ? [] : [updated]);
          yield* Ref.set(fail, false);
          const restarted = yield* Publication.makeDocumentPublication({
            ...durableOptions,
            source: {
              read: () =>
                Effect.gen(function* () {
                  expect(yield* Ref.get(requests)).toHaveLength(2);
                  return { commit: "b".repeat(40), documents: yield* Ref.get(rows) };
                }),
            },
          });
          yield* restarted.report;
          const sent = yield* Ref.get(requests);
          expect(sent).toHaveLength(3);
          expect(sent[1]).toEqual(sent[0]);
          expect(remote.get(original.path)).toEqual(change === "delete" ? undefined : updated);
          const settled = yield* Publication.makeDocumentPublication(durableOptions);
          yield* settled.report;
          expect(yield* Ref.get(requests)).toHaveLength(3);
        }),
      ),
  );

  it.effect("replays a lost removal acknowledgement before publishing recreated content", () =>
    run(({ options, rows, requests, fail }) =>
      Effect.gen(function* () {
        const publication = yield* Publication.makeDocumentPublication(options);
        yield* publication.report;
        const original = (yield* Ref.get(rows))[0]!;
        yield* Ref.set(rows, []);
        yield* Ref.set(fail, true);
        expect((yield* publication.report.pipe(Effect.result))._tag).toBe("Failure");
        yield* Ref.set(rows, [original]);
        yield* Ref.set(fail, false);
        const restarted = yield* Publication.makeDocumentPublication(options);
        yield* restarted.report;
        const sent = yield* Ref.get(requests);
        expect(sent).toHaveLength(4);
        expect(sent[2]).toEqual(sent[1]);
        expect(sent[3]!.documents).toEqual([original]);
      }),
    ),
  );

  it.effect("only reads this computer's registered copies and current repository resources", () =>
    run(({ publication, options, copies }) =>
      Effect.gen(function* () {
        let reads = 0;
        const publisher = yield* Publication.makeDocumentPublication({
          ...options,
          source: {
            read: () => {
              reads++;
              return Effect.succeed({ commit: "a".repeat(40), documents: [] });
            },
          },
        });
        yield* Ref.set(copies, [
          { ...receipt, copy: { ...copy, environmentId: EnvironmentId.make("other") } },
          { ...receipt, copy: { ...copy, registered: false } },
          {
            ...receipt,
            copy: {
              ...copy,
              repositories: [{ ...copy.repositories[0]!, resourceId: "unrelated" }],
            },
          },
        ]);
        yield* publication.report;
        yield* publisher.report;
        expect(reads).toBe(0);
      }),
    ),
  );
  it.effect(
    "isolates a broken repository and retries it without resending acknowledged resources",
    () =>
      run(({ options, requests }) =>
        Effect.gen(function* () {
          const second = { ...resource, id: "second" };
          const expanded = { ...project, resources: [resource, second] };
          const expandedCopy = {
            ...copy,
            repositories: [
              ...copy.repositories,
              { ...copy.repositories[0]!, resourceId: second.id },
            ],
          };
          const crypto = yield* Crypto.Crypto;
          let broken = true;
          const publisher = yield* Publication.makeDocumentPublication({
            ...options,
            publisher: { ...options.publisher, project: () => Effect.succeed(expanded) },
            workspaces: { receipts: Effect.succeed([{ ...receipt, copy: expandedCopy }]) },
            source: {
              read: ({ resource: current }) =>
                Effect.gen(function* () {
                  if (current.id === resource.id && broken)
                    return yield* new LibraryError({ reason: "io" });
                  const value = { ...(yield* document(1)), resourceId: current.id };
                  return {
                    commit: "a".repeat(40),
                    documents: [{ ...value, digest: yield* documentDigest(value) }],
                  };
                }).pipe(Effect.provideService(Crypto.Crypto, crypto)),
            },
          });
          expect((yield* publisher.report.pipe(Effect.result))._tag).toBe("Failure");
          expect((yield* Ref.get(requests)).map((request) => request.resourceId)).toEqual([
            second.id,
          ]);
          broken = false;
          yield* publisher.report;
          yield* publisher.report;
          expect((yield* Ref.get(requests)).map((request) => request.resourceId)).toEqual([
            second.id,
            resource.id,
          ]);
        }),
      ),
  );

  it.effect("keeps acknowledgement baselines separate for computers and authority epochs", () =>
    run(({ options, publication, requests }) =>
      Effect.gen(function* () {
        yield* publication.report;
        const nextEpoch = yield* Publication.makeDocumentPublication({
          ...options,
          publisher: {
            ...options.publisher,
            info: options.publisher.info.pipe(
              Effect.map((info) => ({ ...info, authorityEpoch: 2 })),
            ),
          },
        });
        yield* nextEpoch.report;
        const nextComputer = EnvironmentId.make("next-computer");
        const nextSource = yield* Publication.makeDocumentPublication({
          ...options,
          environmentId: nextComputer,
          workspaces: {
            receipts: Effect.succeed([
              { ...receipt, copy: { ...copy, environmentId: nextComputer } },
            ]),
          },
        });
        yield* nextSource.report;
        yield* nextSource.report;
        expect(
          (yield* Ref.get(requests)).map((request) => [request.computerId, request.authorityEpoch]),
        ).toEqual([
          [source, 1],
          [source, 2],
          [nextComputer, 1],
        ]);
      }),
    ),
  );

  it.effect("runs every 15 minutes and after copy registration", () =>
    run(({ publication, rows, registrations, published, observed }) =>
      Effect.gen(function* () {
        yield* Effect.forkChild(publication.run);
        yield* Deferred.await(observed);
        yield* Queue.take(published);
        yield* Ref.set(rows, [yield* document(2)]);
        yield* Queue.offer(registrations, copy);
        yield* Queue.take(published);
        yield* Ref.set(rows, [yield* document(3)]);
        yield* TestClock.adjust(Publication.DOCUMENT_REPORT_INTERVAL);
        yield* Queue.take(published);
      }),
    ),
  );
});

const withGitSource = <A, E, R>(
  use: (input: {
    readonly source: Publication.LibraryDocumentSource["Service"];
    readonly cwd: string;
    readonly git: (
      args: ReadonlyArray<string>,
    ) => Effect.Effect<string, ProcessRunner.ProcessRunError>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runner = yield* ProcessRunner.ProcessRunner;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "library-documents-" });
    const git = Effect.fn("test.git")(function* (args: ReadonlyArray<string>) {
      const result = yield* runner.run({
        command: "git",
        args: [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgSign=false",
          "-c",
          "user.name=Library Test",
          "-c",
          "user.email=library@example.test",
          ...args,
        ],
        cwd,
      });
      expect(result.code).toBe(0);
      return result.stdout.trim();
    });
    yield* git(["init", "-b", "main"]);
    yield* fs.makeDirectory(`${cwd}/docs/decisions`, { recursive: true });
    yield* fs.writeFileString(
      `${cwd}/docs/decisions/0001-recovery.md`,
      "# 0001. Owner recovery\nStatus: Accepted\nDate: 2026-10-17\nUse a second passkey.",
    );
    yield* fs.writeFileString(
      `${cwd}/docs/ideas.md`,
      "# Ideas\n### Recovery ceremony\nPractice the drill.\n### Device enrollment\nA second item.",
    );
    yield* fs.writeFileString(
      `${cwd}/loom-documents.json`,
      '{"version":1,"sources":[{"glob":"docs/decisions/[0-9]*.md","kind":"decision"},{"path":"docs/ideas.md","kind":"catalogue","split":"###"}]}',
    );
    yield* git(["add", "."]);
    yield* git(["commit", "-m", "fixture"]);
    const source = yield* Publication.LibraryDocumentSource.pipe(
      Effect.provide(Publication.layerSource),
    );
    return yield* use({ source, cwd, git });
  }).pipe(
    Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

describe("committed document source", () => {
  it.effect("limits tree reads to the manifest and literal source directories", () =>
    withGitSource(({ cwd, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${cwd}/loom-documents.json`,
          JSON.stringify({
            version: 1,
            sources: [{ glob: "docs/decis*/[0-9]*.md", kind: "decision" }],
          }),
        );
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "partial directory glob"]);
        const runner = yield* ProcessRunner.ProcessRunner;
        const listings: ReadonlyArray<string>[] = [];
        const reader = yield* Publication.LibraryDocumentSource.pipe(
          Effect.provide(Publication.layerSource),
          Effect.provideService(ProcessRunner.ProcessRunner, {
            run: (input) => {
              if (input.args.includes("ls-tree")) {
                listings.push(input.args.slice(input.args.indexOf("--") + 1));
                if (!input.args.includes("--"))
                  return Effect.fail(
                    new ProcessRunner.ProcessOutputLimitError({
                      command: "git",
                      argumentCount: input.args.length,
                      cwd,
                      stream: "stdout",
                      maxBytes: 2097152,
                      observedBytes: 2097153,
                    }),
                  );
              }
              return runner.run(input);
            },
          }),
        );
        const snapshot = yield* reader.read({ projectId: project.id, resource, cwd });
        expect(snapshot.documents.map((item) => item.path)).toEqual([
          "docs/decisions/0001-recovery.md",
        ]);
        expect(listings).toEqual([["loom-documents.json"], ["docs/"]]);
        yield* fs.writeFileString(`${cwd}/loom-documents.json`, '{"version":1,"sources":[]}');
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "no sources"]);
        listings.length = 0;
        expect((yield* reader.read({ projectId: project.id, resource, cwd })).documents).toEqual(
          [],
        );
        expect(listings).toEqual([["loom-documents.json"]]);
      }),
    ),
  );
  it.effect(
    "explains an oversized source listing instead of reporting a retryable IO failure",
    () =>
      withGitSource(({ cwd }) =>
        Effect.gen(function* () {
          const runner = yield* ProcessRunner.ProcessRunner;
          const reader = yield* Publication.LibraryDocumentSource.pipe(
            Effect.provide(Publication.layerSource),
            Effect.provideService(ProcessRunner.ProcessRunner, {
              run: (input) =>
                input.args.includes("ls-tree") && input.args.includes("-r")
                  ? Effect.fail(
                      new ProcessRunner.ProcessOutputLimitError({
                        command: "git",
                        argumentCount: input.args.length,
                        cwd,
                        stream: "stdout",
                        maxBytes: 2097152,
                        observedBytes: 2097153,
                      }),
                    )
                  : runner.run(input),
            }),
          );
          const error = yield* reader
            .read({ projectId: project.id, resource, cwd })
            .pipe(Effect.flip);
          expect(error.reason).toBe("invalid");
          expect(error.detail).toContain("Narrow the sources in loom-documents.json");
        }),
      ),
  );
  it.effect(
    "reads only default branch objects, including each catalogue heading, with no dirty bytes",
    () =>
      withGitSource(({ source: reader, cwd, git }) =>
        Effect.gen(function* () {
          const input = { projectId: project.id, resource, cwd };
          const initial = yield* reader.read(input);
          expect(initial.documents.map(({ anchor }) => anchor)).toEqual([
            "",
            "recovery-ceremony",
            "device-enrollment",
          ]);
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            `${cwd}/docs/decisions/0001-recovery.md`,
            "# Dirty bytes\nDo not publish.",
          );
          expect(yield* reader.read(input)).toEqual(initial);
          yield* git(["checkout", "-b", "feature"]);
          yield* git(["add", "."]);
          yield* git(["commit", "-m", "feature only"]);
          expect(yield* reader.read(input)).toEqual(initial);
          expect(
            (yield* reader
              .read({ ...input, resource: { ...resource, defaultBranch: "-c" } })
              .pipe(Effect.result))._tag,
          ).toBe("Failure");
        }),
      ),
  );
  it.effect("rejects committed symlink manifests", () =>
    withGitSource(({ source: reader, cwd, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(`${cwd}/loom-documents.json`);
        yield* fs.symlink("docs/ideas.md", `${cwd}/loom-documents.json`);
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "symlink manifest"]);
        expect(
          (yield* reader.read({ projectId: project.id, resource, cwd }).pipe(Effect.result))._tag,
        ).toBe("Failure");
      }),
    ),
  );
  it.effect("fails closed for unsafe committed manifests", () =>
    withGitSource(({ source: reader, cwd, git }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${cwd}/loom-documents.json`,
          '{"version":1,"sources":[{"path":"../outside.md","kind":"decision"}]}',
        );
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "unsafe manifest"]);
        expect(
          (yield* reader.read({ projectId: project.id, resource, cwd }).pipe(Effect.result))._tag,
        ).toBe("Failure");
      }),
    ),
  );
});
