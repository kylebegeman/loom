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
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { archiveFor, resource, source } from "./Library.testkit.ts";
import {
  LibraryEmbedder,
  LibraryEmbedderError,
  makeOnnxLibraryEmbedder,
  resolveLibraryEmbeddingFiles,
  type LibraryEmbedderShape,
} from "./LibraryEmbedder.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryStore from "./LibraryStore.ts";
import { libraryMatchQuery, parseLibrarySnippet } from "./LibrarySearch.ts";
import { makeLibrarySemanticSearch } from "./LibrarySemanticSearch.ts";
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
  embedder: LibraryEmbedderShape | null = null,
) =>
  withDatabase(
    Effect.gen(function* () {
      yield* runForkMigrationSet(ProjectLibraryMigrations);
      return yield* use(
        yield* LibraryService.LibraryService.pipe(
          Effect.provide(
            serviceLayer.pipe(Layer.provide(Layer.succeed(LibraryEmbedder, embedder))),
          ),
        ),
      );
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
        let page = yield* search(service, { query: "heron", limit: 50 });
        let seen = page.hits.length;
        while (page.nextCursor !== null) {
          page = yield* search(service, { query: "heron", limit: 50, cursor: page.nextCursor });
          seen += page.hits.length;
        }
        // The last cursor starts at offset 1000, and its page is the last one offered.
        expect(seen).toBe(1050);
        expect(page.hits).toHaveLength(50);
      }),
    ),
  );

  it.effect("keeps later pages on the first page's snapshot while history is indexed", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const time = "2026-10-05T09:00:00.000Z";
        const sightings = (texts: string[]) =>
          texts.map((text) => ({ type: "user_message" as const, text, time }));
        const original = sightings(["Osprey over the north marsh today", "Osprey near the dam"]);
        const marsh = yield* conversation(project, { name: "marsh", items: original });
        const river = yield* conversation(project, {
          name: "river",
          items: sightings(["An osprey dove at the river bend", "Second osprey at the river"]),
        });
        yield* service.registerThread({ requestId: "marsh", thread: marsh });
        yield* service.registerThread({ requestId: "river", thread: river });
        const key = (hit: { id: string; position: number }) => `${hit.id}/${hit.position}`;
        const before = (yield* search(service, { query: "osprey" })).hits.map(key);
        expect(before).toHaveLength(4);

        const first = yield* search(service, { query: "osprey", limit: 2 });
        expect(first.nextCursor).not.toBeNull();
        // Stronger matches arrive before the next page: new items in a conversation already
        // indexed, which reindexes it, and a new conversation.
        const louder = sightings(["Osprey osprey", "Osprey osprey osprey"]);
        yield* service.ingestHistory({
          requestId: "more",
          sourceEnvironmentId: source,
          journalId: "journal",
          fromSequence: 0,
          entries: [
            {
              sequence: 1,
              thread: yield* conversation(project, {
                name: "marsh",
                sequence: 2,
                items: [...original, ...louder],
              }),
            },
            { sequence: 2, thread: yield* conversation(project, { name: "lake", items: louder }) },
          ],
        });
        const second = yield* search(service, {
          query: "osprey",
          limit: 2,
          cursor: first.nextCursor!,
        });
        expect(second.nextCursor).toBeNull();
        const paged = [...first.hits, ...second.hits].map(key);
        expect(paged.toSorted()).toEqual(before.toSorted());
        // A new search sees the new history.
        expect((yield* search(service, { query: "osprey" })).hits).toHaveLength(8);
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
          ...[
            "-1",
            "3",
            "3.",
            ".3",
            "03.9",
            "3.0",
            "1001.9",
            "3.99999999999999999",
            "3.9.9",
            " 3.9",
          ].map((cursor) => ({ cursor })),
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

// Words that mean the same thing to the fake embedder. Text with none of them has no meaning.
const CONCEPTS = [
  ["deploy", "deployment", "rollout", "release", "ship", "launch"],
  ["stall", "stuck", "hung", "blocked", "refused", "failed"],
  ["bake", "bread", "oven", "sourdough", "flour"],
];
const meaning = (text: string) => {
  const vector = new Float32Array(CONCEPTS.length);
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const concept = CONCEPTS.findIndex((words) => words.includes(word));
    if (concept >= 0) vector[concept] = 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
};
/** A deterministic embedder that records every text it is asked to embed. */
const fakeEmbedder = (model = "fake-concepts", embedded: string[] = []): LibraryEmbedderShape => ({
  model,
  embed: (text) =>
    Effect.sync(() => {
      embedded.push(text);
      return meaning(text);
    }),
});
const brokenEmbedder: LibraryEmbedderShape = {
  model: "broken",
  embed: () => Effect.fail(new LibraryEmbedderError({ cause: new Error("no model") })),
};
const embedAll = (embedder: LibraryEmbedderShape) =>
  makeLibrarySemanticSearch(embedder).pipe(
    Effect.flatMap((semantic) => semantic.embedPending(1_000)),
  );
const said = (text: string, time = "2026-10-05T10:00:00.000Z") => ({
  type: "user_message" as const,
  text,
  time,
});
/** Conversations about a stuck deploy in different words, and one about bread. */
const meaningFixture = Effect.fnUntraced(function* (
  service: LibraryService.LibraryService["Service"],
) {
  const project = yield* service.createProject({
    requestId: "create",
    title: "AspectAvy",
    resources: [resource],
  });
  const elsewhere = yield* service.createProject({
    requestId: "elsewhere",
    title: "Elsewhere",
    resources: [resource],
  });
  for (const thread of [
    yield* conversation(project, {
      name: "helios",
      items: [said("Why did the Helios rollout stall?"), said("The pinned digest drifted.")],
    }),
    yield* conversation(project, { name: "notes", items: [said("The release is stuck again")] }),
    yield* conversation(project, {
      name: "bread",
      items: [said("Bake the sourdough in a hot oven")],
    }),
    yield* conversation(project, {
      name: "gone",
      deleted: true,
      items: [said("Launch hung overnight")],
    }),
    yield* conversation(elsewhere, { name: "other", items: [said("Ship blocked by review")] }),
  ])
    yield* service.registerThread({ requestId: thread.summary.id, thread });
  return { project, elsewhere };
});
const matches = (result: {
  hits: ReadonlyArray<{ threadId: string; match?: string | undefined }>;
}) => result.hits.map((hit) => [hit.threadId, hit.match]);

describe("Library semantic search", () => {
  it.effect("finds a conversation by meaning when the words differ", () => {
    const embedder = fakeEmbedder();
    return run(
      (service) =>
        Effect.gen(function* () {
          const { project } = yield* meaningFixture(service);
          // Before the backfill reaches it, history matches by words alone.
          expect(matches(yield* search(service, { query: "release stuck" }))).toEqual([
            ["notes", "text"],
          ]);
          yield* embedAll(embedder);

          const result = yield* search(service, { query: "release stuck" });
          expect(result.hits[0]).toMatchObject({ threadId: "notes", match: "both" });
          expect(result.hits[0]!.highlights).toHaveLength(2);
          expect(matches(result).slice(1).toSorted()).toEqual([
            ["helios", "semantic"],
            ["other", "semantic"],
          ]);
          // A meaning-only hit shows the start of the item, with nothing highlighted.
          expect(result.hits.find((hit) => hit.threadId === "helios")).toMatchObject({
            itemId: "helios-item-0",
            role: "user",
            snippet: "Why did the Helios rollout stall?",
            highlights: [],
          });
          expect(result.hits[0]!.rank).toBeGreaterThan(result.hits[1]!.rank);

          // The project filter applies to meaning too; deleted history never returns.
          expect(
            matches(yield* search(service, { query: "release stuck", projectId: project.id })),
          ).toEqual([
            ["notes", "both"],
            ["helios", "semantic"],
          ]);
          // Words with no match and no shared meaning find nothing.
          expect((yield* search(service, { query: "quarterly budget" })).hits).toEqual([]);

          // Paging walks the blended ranking with the same cursor format.
          const first = yield* search(service, { query: "release stuck", limit: 2 });
          expect(first.nextCursor).toMatch(/^2\.\d+$/);
          const rest = yield* search(service, {
            query: "release stuck",
            limit: 2,
            cursor: first.nextCursor!,
          });
          expect(rest.nextCursor).toBeNull();
          expect([...first.hits, ...rest.hits].map((hit) => hit.threadId)).toEqual(
            result.hits.map((hit) => hit.threadId),
          );

          // Asking for words only, or quoting a phrase, is plain full-text search.
          for (const input of [
            { query: "release stuck", semantic: false },
            { query: '"release is stuck"' },
          ]) {
            const words = yield* search(service, input);
            expect(words.hits.map((hit) => hit.threadId)).toEqual(["notes"]);
            expect(words.hits[0]).not.toHaveProperty("match");
          }
        }),
      embedder,
    );
  });

  it.effect("returns the same words-only results without the model or when it fails", () =>
    Effect.gen(function* () {
      const results = [];
      for (const embedder of [null, brokenEmbedder])
        results.push(
          yield* run(
            (service) =>
              Effect.gen(function* () {
                yield* meaningFixture(service);
                const result = yield* search(service, { query: "release stuck" });
                // Project ids are random per run.
                return result.hits.map(({ projectId: _projectId, ...hit }) => hit);
              }),
            embedder,
          ),
        );
      expect(results[0]!.map((hit) => hit.threadId)).toEqual(["notes"]);
      expect(results[0]![0]).not.toHaveProperty("match");
      expect(results[1]).toEqual(results[0]);
    }),
  );

  it.effect("embeds history newest first, resumes where it stopped, and follows edits", () =>
    run((service) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const embedded: string[] = [];
        const semantic = yield* makeLibrarySemanticSearch(fakeEmbedder("fake-concepts", embedded));
        const vectors = () =>
          sql<{ count: number }>`SELECT count(*) AS count FROM fork_library_search_vectors`.pipe(
            Effect.map(([row]) => row!.count),
          );
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const save = Effect.fnUntraced(function* (sequence: number, texts: ReadonlyArray<string>) {
          const thread = yield* conversation(project, {
            name: "evolving",
            sequence,
            items: texts.map((text) => said(text)),
          });
          yield* service.ingestHistory({
            requestId: `save-${sequence}`,
            sourceEnvironmentId: source,
            journalId: "journal",
            fromSequence: sequence - 1,
            entries: [{ sequence, thread }],
          });
        });
        yield* save(1, ["first", "second", "third", "fourth", "fifth"]);

        // An interrupted backfill leaves the rest pending and picks it up without repeating work.
        expect(yield* semantic.embedPending(2)).toBe(2);
        expect(embedded).toEqual(["fifth", "fourth"]);
        expect(yield* semantic.embedPending(16)).toBe(3);
        expect(yield* semantic.embedPending(16)).toBe(0);
        expect(embedded).toEqual(["fifth", "fourth", "third", "second", "first"]);
        expect(yield* vectors()).toBe(5);

        // Edited text is embedded again; removed items lose their vectors.
        yield* save(2, ["first", "second, revised", "third"]);
        expect(yield* vectors()).toBe(2);
        expect(yield* semantic.embedPending(16)).toBe(1);
        expect(embedded.at(-1)).toBe("second, revised");

        // An item edited while it was being embedded is not given the stale vector.
        embedded.length = 0;
        yield* save(3, ["first", "second, revised", "third, revised"]);
        const racing = yield* makeLibrarySemanticSearch({
          model: "fake-concepts",
          embed: (text) =>
            sql`UPDATE fork_library_search_items SET body = 'third, edited meanwhile' WHERE body = ${text}`.pipe(
              Effect.orDie,
              Effect.as(meaning(text)),
            ),
        });
        expect(yield* racing.embedPending(16)).toBe(1);
        expect(yield* vectors()).toBe(2);
        expect(yield* semantic.embedPending(16)).toBe(1);
        expect(embedded).toEqual(["third, edited meanwhile"]);
      }),
    ),
  );

  // Runs the pinned model from LOOM_TEST_EMBEDDINGS_DIR, which holds its two files.
  it.effect.skipIf(!process.env.LOOM_TEST_EMBEDDINGS_DIR)(
    "finds a conversation by meaning with the pinned model",
    () => {
      const resolved = resolveLibraryEmbeddingFiles({
        LOOM_LIBRARY_AUTHORITY: "true",
        LOOM_LIBRARY_EMBEDDINGS_DIR: process.env.LOOM_TEST_EMBEDDINGS_DIR,
      });
      if (!("files" in resolved)) return Effect.die(new Error(resolved.off));
      const embedder = makeOnnxLibraryEmbedder(resolved.files);
      return run(
        (service) =>
          Effect.gen(function* () {
            yield* meaningFixture(service);
            yield* embedAll(embedder);
            const result = yield* search(service, { query: "deployment got stuck" });
            expect(matches(result)).toEqual([
              ["notes", "semantic"],
              ["other", "semantic"],
            ]);
          }),
        embedder,
      );
    },
    60_000,
  );

  it.effect("keeps embedding in the background and replaces another model's vectors", () =>
    run((service) =>
      Effect.gen(function* () {
        const project = yield* service.createProject({
          requestId: "create",
          title: "AspectAvy",
          resources: [resource],
        });
        const register = Effect.fnUntraced(function* (name: string, text: string) {
          const thread = yield* conversation(project, { name, items: [said(text)] });
          yield* service.registerThread({ requestId: name, thread });
        });
        yield* register("old", "Embedded by an earlier model");
        yield* embedAll(fakeEmbedder("earlier-model"));

        const embedded = yield* Queue.unbounded<string>();
        const semantic = yield* makeLibrarySemanticSearch({
          model: "fake-concepts",
          embed: (text) => Queue.offer(embedded, text).pipe(Effect.as(meaning(text))),
        });
        const revisions = yield* SubscriptionRef.make(0);
        yield* Effect.forkChild(semantic.backfill(revisions));
        yield* TestClock.adjust("30 seconds");
        expect(yield* Queue.take(embedded)).toBe("Embedded by an earlier model");

        // Saved history wakes the idle loop.
        yield* register("new", "Saved after startup");
        yield* SubscriptionRef.update(revisions, (revision) => revision + 1);
        expect(yield* Queue.take(embedded)).toBe("Saved after startup");
        const sql = yield* SqlClient.SqlClient;
        const models = yield* sql<{ model: string }>`
          SELECT model FROM fork_library_search_vectors ORDER BY id LIMIT 1`;
        expect(models).toEqual([{ model: "fake-concepts" }]);
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
