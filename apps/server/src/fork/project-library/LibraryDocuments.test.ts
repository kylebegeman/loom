import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryDocument,
  type LibraryDocumentsPublishRequest,
} from "@t3tools/contracts/fork";
import { parseDecisionDocument } from "@t3tools/shared/fork/library-decisions";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { copyFor, resource, source } from "./Library.testkit.ts";
import { documentDigest, makeLibraryDocuments } from "./LibraryDocuments.ts";
import {
  LibraryEmbedder,
  LibraryEmbedderError,
  type LibraryEmbedderShape,
} from "./LibraryEmbedder.ts";
import * as LibraryService from "./LibraryService.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const serviceLayer = LibraryService.layer.pipe(
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
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("authority")),
    }),
  ),
);
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const service = yield* LibraryService.LibraryService.pipe(Effect.provide(serviceLayer));
  const info = yield* service.info;
  const project = yield* service.createProject({
    requestId: "project",
    title: "Platform",
    resources: [resource],
  });
  const copy = copyFor(project);
  yield* service.registerComputer({
    authorityId: info.authorityId,
    authorityEpoch: info.authorityEpoch,
    computer: {
      environmentId: source,
      label: "Source",
      platform: { os: "darwin", arch: "arm64" },
      appVersion: "1",
      supportsExecution: true,
      endpoints: [],
    },
  });
  yield* service.registerCopy({
    requestId: "copy",
    authorityId: info.authorityId,
    authorityEpoch: info.authorityEpoch,
    copy,
  });
  const document = Effect.fn("test.document")(function* (path: string, text: string) {
    const parsed = {
      ...parseDecisionDocument(path, text),
      projectId: project.id,
      resourceId: resource.id,
    };
    return { ...parsed, digest: yield* documentDigest(parsed) };
  });
  const request = (documents: ReadonlyArray<LibraryDocument>): LibraryDocumentsPublishRequest => ({
    computerId: source,
    projectId: project.id,
    resourceId: resource.id,
    commit: "a".repeat(40),
    documents,
    removed: [],
    authorityId: info.authorityId,
    authorityEpoch: info.authorityEpoch,
  });
  return { service, project, copy, info, document, request };
});
const run = <A, E, R>(
  use: (state: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>,
  embedder: LibraryEmbedderShape | null = null,
) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(
    Effect.provideService(LibraryEmbedder, embedder),
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

describe("Library documents", () => {
  it.effect("publishes idempotently, ranks owner recovery, and filters retired/project/kind", () =>
    run(({ service, document, request, project }) =>
      Effect.gen(function* () {
        const recovery = yield* document(
          "docs/decisions/0001-hosting.md",
          "# 0001. Hosting, accounts and resilience\n- **Status:** Accepted\n- **Date:** 15 October 2026\n## Owner recovery\nA second passkey and a written recovery path restore owner access.",
        );
        const other = yield* document(
          "docs/decisions/0002-projects.md",
          "# Durable projects\nStatus: Accepted\nOwner policy keeps shared Library history and separate account recovery instructions.",
        );
        const retired = yield* document(
          "docs/decisions/0000-retired.md",
          "# Owner recovery\nStatus: Superseded\nSuperseded by: 0001\nOld owner recovery instructions.",
        );
        const catalogueBody = {
          ...recovery,
          path: "docs/ideas.md",
          anchor: "owner-recovery",
          title: "Owner recovery idea",
          kind: "catalogue" as const,
          status: "idea" as const,
          text: "Owner recovery idea for later.",
        };
        const catalogue = { ...catalogueBody, digest: yield* documentDigest(catalogueBody) };
        const input = request([recovery, other, retired, catalogue]);
        expect(yield* service.publishDocuments(input)).toEqual({ published: 4, removed: 0 });
        expect(yield* service.publishDocuments(input)).toEqual({ published: 0, removed: 0 });
        const hits = (yield* service.decisions({
          query: "owner recovery",
          projectId: project.id,
          kind: "decision",
        })).hits;
        expect(hits.map((hit) => hit.path)).toEqual([recovery.path, other.path]);
        expect(hits[0]).toMatchObject({
          repository: resource.remoteUrl,
          date: "15 October 2026",
          status: "accepted",
          commit: input.commit,
        });
        expect(hits[0]!.snippet.length).toBeLessThan(170);
        const all = (yield* service.decisions({ query: "owner recovery", includeRetired: true }))
          .hits;
        expect(all[0]!.path).toBe(recovery.path);
        expect(all.at(-1)).toMatchObject({ status: "superseded", supersededBy: "0001" });
        expect(
          (yield* service.decisions({ query: "owner recovery", projectId: "another-project" }))
            .hits,
        ).toEqual([]);
        expect(
          (yield* service.decisions({ query: "owner recovery", kind: "catalogue" })).hits.map(
            (hit) => hit.anchor,
          ),
        ).toEqual(["owner-recovery"]);
      }),
    ),
  );

  it.effect(
    "rejects foreign project/resource/source, stale authority, invalid content and oversize batches",
    () =>
      run(({ service, document, request }) =>
        Effect.gen(function* () {
          const row = yield* document(
            "docs/decisions/0001.md",
            "# Recovery\nStatus: Accepted\nRecovery is available.",
          );
          const input = request([row]);
          for (const modified of [
            { ...input, documents: [{ ...row, projectId: "foreign" }] },
            { ...input, resourceId: "foreign" },
            { ...input, computerId: EnvironmentId.make("foreign") },
            { ...input, authorityEpoch: input.authorityEpoch + 1 },
            { ...input, documents: [{ ...row, text: "tampered" }] },
            { ...input, documents: [{ ...row, path: "../outside.md" }] },
            { ...input, documents: [row, row] },
            { ...input, documents: Array.from({ length: 51 }, () => row) },
          ])
            expect((yield* service.publishDocuments(modified).pipe(Effect.result))._tag).toBe(
              "Failure",
            );
          expect((yield* service.decisions({ query: "recovery" })).hits).toEqual([]);
        }),
      ),
  );

  it.effect(
    "removes FTS and vectors and hides rows immediately when copy authorization is removed",
    () =>
      run(
        ({ service, document, request, copy }) =>
          Effect.gen(function* () {
            const row = yield* document(
              "docs/decisions/0001.md",
              "# Recovery\nStatus: Accepted\nOwner recovery path.",
            );
            yield* service.publishDocuments(request([row]));
            const index = yield* makeLibraryDocuments;
            yield* index.embedPending();
            const sql = yield* SqlClient.SqlClient;
            expect((yield* sql`SELECT * FROM fork_library_document_vectors`).length).toBe(1);
            yield* service.registerCopy({
              requestId: "unregister",
              copy: { ...copy, registered: false },
            });
            expect((yield* service.decisions({ query: "owner recovery" })).hits).toEqual([]);
            expect((yield* service.publishDocuments(request([row])).pipe(Effect.result))._tag).toBe(
              "Failure",
            );
            yield* service.registerCopy({
              requestId: "register-again",
              copy: { ...copy, registered: true },
            });
            expect(
              yield* service.publishDocuments({
                ...request([]),
                removed: [{ path: row.path, anchor: row.anchor }],
              }),
            ).toEqual({ published: 0, removed: 1 });
            expect(
              (yield* service.decisions({ query: "owner recovery", includeRetired: true })).hits,
            ).toEqual([]);
            expect(yield* sql`SELECT * FROM fork_library_document_vectors`).toEqual([]);
          }),
        { model: "test", embed: () => Effect.succeed(new Float32Array([1, 0])) },
      ),
  );

  it.effect(
    "fuses existing semantic vectors with words and falls back when the model fails",
    () => {
      let fail = false;
      const embedder = {
        model: "test",
        embed: () =>
          fail
            ? Effect.fail(new LibraryEmbedderError({ cause: "fixture" }))
            : Effect.succeed(new Float32Array([1, 0])),
      };
      return run(
        ({ service, document, request }) =>
          Effect.gen(function* () {
            const row = yield* document(
              "docs/adr/0001.md",
              "# Account access\nStatus: Accepted\nA spare credential restores the administrator.",
            );
            yield* service.publishDocuments(request([row]));
            const index = yield* makeLibraryDocuments;
            yield* index.embedPending();
            const semantic = (yield* service.decisions({ query: "owner recovery" })).hits;
            expect(semantic[0]).toMatchObject({ path: row.path, match: "semantic" });
            const both = (yield* service.decisions({ query: "account access" })).hits;
            expect(both[0]).toMatchObject({ path: row.path, match: "both" });
            fail = true;
            expect((yield* service.decisions({ query: "account access" })).hits[0]!.path).toBe(
              row.path,
            );
          }),
        embedder,
      );
    },
  );

  it.effect("an enrolled computer cannot remove another computer's publication", () =>
    run(({ service, document, request, copy, info }) =>
      Effect.gen(function* () {
        const other = EnvironmentId.make("other");
        yield* service.registerComputer({
          authorityId: info.authorityId,
          authorityEpoch: info.authorityEpoch,
          computer: {
            environmentId: other,
            label: "Other",
            platform: { os: "darwin", arch: "arm64" },
            appVersion: "1",
            supportsExecution: true,
            endpoints: [],
          },
        });
        yield* service.registerCopy({
          requestId: "other-copy",
          copy: { ...copy, id: "other-copy", environmentId: other },
        });
        const row = yield* document(
          "docs/adr/0001.md",
          "# Recovery\nStatus: Accepted\nOwner recovery.",
        );
        yield* service.publishDocuments(request([row]));
        expect(
          yield* service.publishDocuments({
            ...request([]),
            computerId: other,
            removed: [{ path: row.path, anchor: row.anchor }],
          }),
        ).toEqual({ published: 0, removed: 0 });
        expect((yield* service.decisions({ query: "owner recovery" })).hits).toHaveLength(1);
      }),
    ),
  );
});
