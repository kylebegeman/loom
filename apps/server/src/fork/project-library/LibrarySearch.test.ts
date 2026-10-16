import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import {
  LibraryError,
  LibraryThreadArchive,
  type LibraryProject,
  type LibrarySearchRequest,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { archiveFor, resource, source } from "./Library.testkit.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryStore from "./LibraryStore.ts";
import { libraryMatchQuery, parseLibrarySnippet } from "./LibrarySearch.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

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
const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );
const run = <A, E, R>(
  use: (service: LibraryService.LibraryService["Service"]) => Effect.Effect<A, E, R>,
) =>
  withDatabase(
    Effect.gen(function* () {
      yield* runForkMigrationSet(ProjectLibraryMigrations);
      return yield* use(yield* LibraryService.LibraryService.pipe(Effect.provide(serviceLayer)));
    }),
  );
const encodeArchive = Schema.encodeEffect(
  Schema.fromJsonString(Schema.toCodecJson(LibraryThreadArchive)),
);

const at = (iso: string) => DateTime.makeUnsafe(iso);
const turnItem = (
  threadId: ThreadId,
  position: number,
  item: { type: "user_message" | "assistant_message" | "reasoning"; text: string; time: string },
  visibility: OrchestrationV2ProjectedTurnItem["visibility"] = "local",
): OrchestrationV2ProjectedTurnItem => {
  const id = TurnItemId.make(`${threadId}-item-${position}`);
  const base = {
    id,
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: position,
    status: "completed" as const,
    title: null,
    startedAt: at(item.time),
    completedAt: at(item.time),
    updatedAt: at(item.time),
  };
  return {
    position,
    visibility,
    sourceThreadId: threadId,
    sourceItemId: id,
    item:
      item.type === "user_message"
        ? {
            ...base,
            type: "user_message",
            createdBy: "user",
            creationSource: "web",
            messageId: MessageId.make(`${id}-message`),
            inputIntent: "turn_start",
            text: item.text,
            attachments: [],
          }
        : item.type === "assistant_message"
          ? {
              ...base,
              type: "assistant_message",
              messageId: MessageId.make(`${id}-message`),
              text: item.text,
              streaming: false,
            }
          : { ...base, type: "reasoning", text: item.text, streaming: false },
  };
};
/** A saved conversation from `environmentId`, a computer the Library never contacts. */
const conversation = Effect.fnUntraced(function* (
  project: LibraryProject,
  options: {
    name: string;
    environmentId?: EnvironmentId;
    sequence?: number;
    archived?: boolean;
    deleted?: boolean;
    items: Parameters<typeof turnItem>[2][];
    inherited?: Parameters<typeof turnItem>[2][];
  },
) {
  const base = yield* archiveFor(project, options.sequence ?? 1);
  const environmentId = options.environmentId ?? source;
  const threadId = ThreadId.make(options.name);
  const items = [
    ...(options.inherited ?? []).map((item, index) => turnItem(threadId, index, item, "inherited")),
    ...options.items.map((item, index) =>
      turnItem(threadId, (options.inherited?.length ?? 0) + index, item),
    ),
  ];
  return {
    ...base,
    summary: {
      ...base.summary,
      id: `${environmentId}:${threadId}`,
      environmentId,
      threadId,
      workingCopyId: null,
      title: `Conversation ${options.name}`,
      archived: options.archived ?? false,
      ...(options.deleted === undefined ? {} : { deleted: options.deleted }),
    },
    projection: {
      ...base.projection,
      thread: { ...base.projection.thread, id: threadId, title: `Conversation ${options.name}` },
      messages: [],
      visibleTurnItems: items,
    },
  } satisfies LibraryThreadArchive;
});
const search = (
  service: LibraryService.LibraryService["Service"],
  input: Partial<LibrarySearchRequest> & { query: string },
) => service.search({ limit: 20, ...input });

describe("Library history search", () => {
  it.effect(
    "finds a phrase from an offline computer's conversation with a highlighted snippet",
    () =>
      run((service) =>
        Effect.gen(function* () {
          const project = yield* service.createProject({
            requestId: "create",
            title: "AspectAvy",
            resources: [resource],
          });
          const offline = EnvironmentId.make("offline-laptop");
          const thread = yield* conversation(project, {
            name: "deploy-thread",
            environmentId: offline,
            items: [
              {
                type: "user_message",
                text: "Why did the Helios rollout stall?",
                time: "2026-10-01T10:00:00.000Z",
              },
              {
                type: "reasoning",
                text: "Private reasoning about the Helios rollout.",
                time: "2026-10-01T10:00:01.000Z",
              },
              {
                type: "assistant_message",
                text: "The pinned digest drifted, so the reviewed Helios rollout refused to start.",
                time: "2026-10-01T10:00:02.000Z",
              },
            ],
          });
          yield* service.registerThread({ requestId: "thread", thread });

          const result = yield* search(service, { query: '"pinned digest"' });
          expect(result.nextCursor).toBeNull();
          expect(result.hits).toHaveLength(1);
          const [hit] = result.hits;
          expect(hit).toMatchObject({
            id: thread.summary.id,
            projectId: project.id,
            environmentId: offline,
            threadId: "deploy-thread",
            title: "Conversation deploy-thread",
            archived: false,
            itemId: "deploy-thread-item-2",
            position: 2,
            role: "assistant",
            occurredAt: "2026-10-01T10:00:02.000Z",
          });
          expect(hit!.snippet).toContain("The pinned digest drifted");
          expect(hit!.highlights.map(({ start, end }) => hit!.snippet.slice(start, end))).toEqual([
            "pinned digest",
          ]);

          // Reasoning is not indexed; words match by prefix and in any order.
          const words = yield* search(service, { query: "rollout HELIOS" });
          expect(words.hits.map((entry) => entry.role).toSorted()).toEqual(["assistant", "user"]);
          expect((yield* search(service, { query: "privat reasoning" })).hits).toEqual([]);
          // A control character separates words instead of ending the FTS5 query.
          expect((yield* search(service, { query: "pinned\u0000digest" })).hits).toHaveLength(1);
          // Punctuation alone is not searchable rather than an FTS syntax error.
          expect(yield* search(service, { query: "&& --" })).toEqual({
            hits: [],
            nextCursor: null,
          });
        }),
      ),
  );

  it.effect("never returns deleted conversations and flags archived ones", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const text = "Rotate the signing certificate before Friday.";
        const time = "2026-10-02T09:00:00.000Z";
        const kept = yield* conversation(project, {
          name: "kept",
          archived: true,
          items: [{ type: "user_message", text, time }],
        });
        const removed = yield* conversation(project, {
          name: "removed",
          items: [{ type: "user_message", text, time }],
        });
        yield* service.registerThread({ requestId: "kept", thread: kept });
        yield* service.registerThread({ requestId: "removed", thread: removed });
        expect((yield* search(service, { query: "signing certificate" })).hits).toHaveLength(2);

        const deleted = yield* conversation(project, {
          name: "removed",
          sequence: 2,
          deleted: true,
          items: [{ type: "user_message", text, time }],
        });
        yield* service.ingestHistory({
          requestId: "delete",
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence: 0,
          entries: [{ sequence: 1, thread: deleted }],
        });
        const hits = (yield* search(service, { query: "signing certificate" })).hits;
        expect(hits.map((hit) => [hit.threadId, hit.archived])).toEqual([["kept", true]]);
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM fork_library_search_items WHERE library_id = ${deleted.summary.id}`;
        expect(rows[0]?.count).toBe(0);
      }),
    ),
  );

  it.effect("keeps the index in step as a conversation is edited, deleted and restored", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const time = "2026-10-03T09:00:00.000Z";
        const save = Effect.fnUntraced(function* (
          sequence: number,
          text: string,
          flags: { archived?: boolean; deleted?: boolean } = {},
        ) {
          const thread = yield* conversation(project, {
            name: "evolving",
            sequence,
            ...flags,
            items: [{ type: "user_message", text, time }],
          });
          yield* service.ingestHistory({
            requestId: `save-${sequence}`,
            sourceEnvironmentId: source,
            journalId: "journal",
            fromSequence: sequence - 1,
            entries: [{ sequence, thread }],
          });
        });
        const found = (query: string) =>
          search(service, { query }).pipe(
            Effect.map((result) => result.hits.map((hit) => [hit.snippet, hit.archived])),
          );

        yield* save(1, "Draft the walrus migration");
        expect(yield* found("walrus")).toEqual([["Draft the walrus migration", false]]);
        yield* save(2, "Ship the narwhal migration", { archived: true });
        expect(yield* found("walrus")).toEqual([]);
        expect(yield* found("narwhal")).toEqual([["Ship the narwhal migration", true]]);
        yield* save(3, "Ship the narwhal migration", { deleted: true });
        expect(yield* found("narwhal")).toEqual([]);
        yield* save(4, "Ship the narwhal migration", { deleted: false });
        expect(yield* found("narwhal")).toEqual([["Ship the narwhal migration", false]]);
      }),
    ),
  );

  it.effect("reports highlights as UTF-16 ranges around accented and emoji text", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const thread = yield* conversation(project, {
          name: "unicode",
          items: [
            {
              type: "assistant_message",
              text: "😀🚀 日本語 then the Café menu",
              time: "2026-10-03T09:00:00.000Z",
            },
          ],
        });
        yield* service.registerThread({ requestId: "unicode", thread });
        const [hit] = (yield* search(service, { query: "cafe 日本語" })).hits;
        expect(hit!.highlights.map(({ start, end }) => hit!.snippet.slice(start, end))).toEqual([
          "日本語",
          "Café",
        ]);
      }),
    ),
  );

  it.effect("stops offering a cursor at the deepest page it accepts", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const thread = yield* conversation(project, {
          name: "deep",
          items: Array.from({ length: 1060 }, (_, n) => ({
            type: "user_message" as const,
            text: `Heron sighting ${n}`,
            time: "2026-10-03T09:00:00.000Z",
          })),
        });
        yield* service.registerThread({ requestId: "deep", thread });
        const near = yield* search(service, { query: "heron", limit: 10, cursor: "990" });
        expect(near.nextCursor).toBe("1000");
        const last = yield* search(service, {
          query: "heron",
          limit: 50,
          cursor: near.nextCursor!,
        });
        expect(last.hits).toHaveLength(50);
        expect(last.nextCursor).toBeNull();
      }),
    ),
  );

  it.effect("scopes by project, computer and date, and pages with a cursor", () =>
    run((service) =>
      Effect.gen(function* () {
        const first = yield* service.createProject({
          requestId: "first",
          title: "First",
          resources: [resource],
        });
        const second = yield* service.createProject({
          requestId: "second",
          title: "Second",
          resources: [resource],
        });
        const other = EnvironmentId.make("other-computer");
        const day = (n: number) => `2026-10-0${n}T12:00:00.000Z`;
        const threads = [
          yield* conversation(first, {
            name: "first-a",
            items: [1, 2, 3].map((n) => ({
              type: "user_message" as const,
              text: `Budget review ${n}`,
              time: day(n),
            })),
          }),
          yield* conversation(second, {
            name: "second-a",
            environmentId: other,
            items: [{ type: "assistant_message", text: "Budget review done", time: day(4) }],
          }),
        ];
        for (const thread of threads)
          yield* service.registerThread({ requestId: thread.summary.id, thread });

        const all = yield* search(service, { query: "budget" });
        expect(all.hits).toHaveLength(4);
        const firstOnly = yield* search(service, { query: "budget", projectId: first.id });
        expect(new Set(firstOnly.hits.map((hit) => hit.projectId))).toEqual(new Set([first.id]));
        expect(firstOnly.hits).toHaveLength(3);
        const otherOnly = yield* search(service, { query: "budget", environmentId: other });
        expect(otherOnly.hits.map((hit) => hit.threadId)).toEqual(["second-a"]);
        const window = yield* search(service, { query: "budget", since: day(2), until: day(4) });
        expect(window.hits.map((hit) => hit.occurredAt).toSorted()).toEqual([day(2), day(3)]);

        const page = yield* search(service, { query: "budget", limit: 3 });
        expect(page.hits).toHaveLength(3);
        expect(page.nextCursor).not.toBeNull();
        const rest = yield* search(service, {
          query: "budget",
          limit: 3,
          cursor: page.nextCursor!,
        });
        expect(rest.nextCursor).toBeNull();
        expect(
          new Set([...page.hits, ...rest.hits].map((hit) => `${hit.id}/${hit.position}`)).size,
        ).toBe(4);

        for (const input of [
          { since: "yesterday" },
          { cursor: "-1" },
          { cursor: "5000" },
          { limit: 51 },
        ])
          expect((yield* Effect.result(search(service, { query: "budget", ...input })))._tag).toBe(
            "Failure",
          );
      }),
    ),
  );

  it.effect("indexes a fork's own items once, leaving inherited items to their source", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const fork = yield* conversation(project, {
          name: "fork",
          inherited: [
            { type: "user_message", text: "Original kestrel plan", time: "2026-10-01T00:00:00Z" },
          ],
          items: [
            { type: "user_message", text: "Forked kestrel plan", time: "2026-10-02T00:00:00Z" },
          ],
        });
        yield* service.registerThread({ requestId: "fork", thread: fork });
        const hits = (yield* search(service, { query: "kestrel" })).hits;
        expect(hits.map((hit) => hit.position)).toEqual([1]);
      }),
    ),
  );

  it.effect("backfills conversations saved before search existed", () =>
    withDatabase(
      Effect.gen(function* () {
        const [beforeSearch] = ProjectLibraryMigrations.migrations.flatMap(([id], index) =>
          id === 4 ? [index] : [],
        );
        yield* runForkMigrationSet({
          ...ProjectLibraryMigrations,
          migrations: ProjectLibraryMigrations.migrations.slice(0, beforeSearch),
        });
        const store = yield* LibraryStore.LibraryStore.pipe(Effect.provide(LibraryStore.layer));
        const project: LibraryProject = {
          id: "project",
          title: "AspectAvy",
          brief: "",
          resources: [resource],
          archived: false,
          revision: 1,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        };
        yield* store.putProject({
          id: project.id,
          revision: project.revision,
          archived: project.archived,
          payload: JSON.stringify(project),
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
        for (const thread of [
          yield* conversation(project, {
            name: "saved",
            items: [
              {
                type: "assistant_message",
                text: "Saved osprey notes",
                time: "2026-10-01T00:00:00Z",
              },
            ],
          }),
          yield* conversation(project, {
            name: "gone",
            deleted: true,
            items: [
              {
                type: "assistant_message",
                text: "Deleted osprey notes",
                time: "2026-10-01T00:00:00Z",
              },
            ],
          }),
        ]) {
          const payload = yield* encodeArchive(thread);
          yield* store.putThread({
            id: thread.summary.id,
            environmentId: thread.summary.environmentId,
            threadId: thread.summary.threadId,
            projectId: project.id,
            workingCopyId: null,
            sourceSequence: thread.summary.sequence,
            summary: JSON.stringify(thread.summary),
            payload,
            updatedAt: thread.summary.updatedAt,
          });
        }

        yield* runForkMigrationSet(ProjectLibraryMigrations);
        const service = yield* LibraryService.LibraryService.pipe(Effect.provide(serviceLayer));
        const hits = (yield* service.search({ query: "osprey", limit: 10 })).hits;
        expect(hits.map((hit) => hit.threadId)).toEqual(["saved"]);
      }),
    ),
  );
});

describe("Library search query parsing", () => {
  it("quotes every word, matches long words by prefix and keeps phrases exact", () => {
    expect(libraryMatchQuery('deploy "pinned digest" of LP-04 a')).toBe(
      '"deploy"* "pinned digest" "of" "LP-04"* "a"',
    );
    expect(libraryMatchQuery('say "hi" there"')).toBe('"say"* "hi" "there"*');
    expect(libraryMatchQuery('a"b')).toBe('"a" "b"');
    expect(libraryMatchQuery("&& -- ...")).toBeNull();
  });
  it("ignores control characters and FTS5 operators in user text", () => {
    expect(libraryMatchQuery("a\u0000b NEAR(x) body:secret -c")).toBe(
      '"a" "b" "NEAR(x)"* "body:secret"* "-c"',
    );
  });
  it("turns snippet markers into highlight ranges", () => {
    expect(parseLibrarySnippet("😀 \uE000café\uE001")).toEqual({
      snippet: "😀 café",
      highlights: [{ start: 3, end: 7 }],
    });
    expect(parseLibrarySnippet("…the pinned digest drifted")).toEqual({
      snippet: "…the pinned digest drifted",
      highlights: [
        { start: 5, end: 11 },
        { start: 12, end: 18 },
      ],
    });
  });
});
