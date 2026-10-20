import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  PREVIEW_PAGE_MAX_BYTES,
  PREVIEW_PAGE_REPLY_MAX,
  type LibraryPagePublishRequest,
  type PreviewPagesError,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { PreviewPagesMigrations } from "./libraryMigrations.ts";
import * as PageLibrary from "./PageLibraryService.ts";

const PAGES_ORIGIN = "https://pages.example.test";
const ENV = { LOOM_LIBRARY_AUTHORITY: "true", LOOM_PAGES_ORIGIN: PAGES_ORIGIN };
const START = Date.parse("2026-10-19T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const dorothy: PageLibrary.PageComputer = {
  subject: "loom-host:environment-dorothy",
  environmentId: EnvironmentId.make("environment-dorothy"),
};
const nora: PageLibrary.PageComputer = {
  subject: "loom-host:environment-nora",
  environmentId: EnvironmentId.make("environment-nora"),
};

const publishRequest = (
  overrides: Partial<LibraryPagePublishRequest> = {},
): LibraryPagePublishRequest => ({
  projectId: ProjectId.make("project-loom"),
  threadId: ThreadId.make("thread-plan"),
  title: "Release plan",
  kind: "html",
  html: "<h1>Plan</h1>",
  ...overrides,
});

const reasonOf = <A>(effect: Effect.Effect<A, PreviewPagesError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

const replyId = (index: number) => `reply-${String(index).padStart(6, "0")}`;

const serviceFor = (env: Record<string, string>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(START);
    yield* runForkMigrationSet(PreviewPagesMigrations);
    // Built in the test's scope so the hourly sweep keeps running while the test moves the clock.
    const context = yield* Layer.build(
      PageLibrary.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
    );
    return Context.get(context, PageLibrary.PageLibraryService);
  });

const run = <A, E>(
  env: Record<string, string>,
  use: (
    pages: PageLibrary.PageLibraryService["Service"],
  ) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  serviceFor(env).pipe(
    Effect.flatMap(use),
    Effect.scoped,
    Effect.provide(SqlitePersistenceMemory.pipe(Layer.provideMerge(NodeServices.layer))),
  );

const rows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pages = yield* sql<{ id: string }>`SELECT id FROM fork_preview_pages ORDER BY id`;
  const replies = yield* sql<{
    reply_id: string;
    acked_at: string | null;
    outcome: string | null;
    detail: string | null;
  }>`SELECT reply_id, acked_at, outcome, detail FROM fork_preview_page_replies ORDER BY reply_id`;
  return { pages: pages.map((row) => row.id), replies };
});

describe("PageLibraryService", () => {
  it.effect("is unavailable unless this Library is the authority with an https pages origin", () =>
    Effect.gen(function* () {
      for (const env of [
        {},
        { LOOM_PAGES_ORIGIN: PAGES_ORIGIN },
        { LOOM_LIBRARY_AUTHORITY: "true" },
        { LOOM_LIBRARY_AUTHORITY: "true", LOOM_PAGES_ORIGIN: "https://pages.example.test:8443" },
        { LOOM_LIBRARY_AUTHORITY: "true", LOOM_PAGES_ORIGIN: "http://pages.example.test" },
        { LOOM_LIBRARY_AUTHORITY: "true", LOOM_PAGES_ORIGIN: "not a url" },
      ]) {
        yield* run(env, (pages) =>
          Effect.gen(function* () {
            expect(pages.pagesOrigin).toBeNull();
            expect(yield* reasonOf(pages.publish(dorothy, publishRequest()))).toBe("unavailable");
            expect(yield* reasonOf(pages.list(dorothy))).toBe("unavailable");
            expect(yield* reasonOf(pages.update(dorothy, { pageId: "x", action: "keep" }))).toBe(
              "unavailable",
            );
            expect(yield* reasonOf(pages.view("x"))).toBe("unavailable");
            expect(
              yield* reasonOf(
                pages.addReply({ pageId: "x", replyId: replyId(1), text: "hi", viewer: "owner" }),
              ),
            ).toBe("unavailable");
            expect(yield* reasonOf(pages.nextReplies(dorothy, 0))).toBe("unavailable");
            expect(
              yield* reasonOf(
                pages.ackReply(dorothy, { replyId: replyId(1), outcome: "delivered" }),
              ),
            ).toBe("unavailable");
          }),
        );
      }
      yield* run({ ...ENV, LOOM_PAGES_ORIGIN: ` ${PAGES_ORIGIN}/ignored/path ` }, (pages) =>
        Effect.sync(() => expect(pages.pagesOrigin).toBe(PAGES_ORIGIN)),
      );
    }),
  );

  it.effect("publishes a page and republishes it in place", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const html = "<p>Café ✓</p>";
        const page = yield* pages.publish(dorothy, publishRequest({ title: "  Plan  ", html }));
        expect(page.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(page).toEqual({
          id: page.id,
          url: `${PAGES_ORIGIN}/p/${page.id}`,
          title: "Plan",
          kind: "html",
          projectId: "project-loom",
          threadId: "thread-plan",
          state: "open",
          kept: false,
          sizeBytes: new TextEncoder().encode(html).byteLength,
          createdAt: iso(START),
          expiresAt: iso(START + 30 * DAY),
          endedAt: null,
          restorableUntil: null,
        });
        expect(page.sizeBytes).toBeGreaterThan(html.length);
        expect((yield* pages.view(page.id))?.html).toBe(html);

        yield* TestClock.adjust(DAY);
        const republished = yield* pages.publish(
          dorothy,
          publishRequest({ pageId: page.id, title: "Dossier", kind: "dossier", html: "<p>v2</p>" }),
        );
        expect(republished).toMatchObject({
          id: page.id,
          title: "Dossier",
          kind: "dossier",
          sizeBytes: 9,
          createdAt: iso(START),
          expiresAt: iso(START + 31 * DAY),
        });
        expect(yield* pages.view(page.id)).toEqual({ page: republished, html: "<p>v2</p>" });

        // Only the publishing thread on the publishing computer can replace a page.
        expect(
          yield* reasonOf(
            pages.publish(
              dorothy,
              publishRequest({ pageId: page.id, threadId: ThreadId.make("thread-other") }),
            ),
          ),
        ).toBe("not-found");
        expect(yield* reasonOf(pages.publish(nora, publishRequest({ pageId: page.id })))).toBe(
          "not-found",
        );
        expect(yield* reasonOf(pages.publish(dorothy, publishRequest({ pageId: "missing" })))).toBe(
          "not-found",
        );

        expect(yield* reasonOf(pages.publish(dorothy, publishRequest({ title: "   " })))).toBe(
          "invalid",
        );
        // Under the character limit the schema checks, but over the byte limit once encoded.
        const wide = "é".repeat(PREVIEW_PAGE_MAX_BYTES / 2 + 1);
        expect(yield* reasonOf(pages.publish(dorothy, publishRequest({ html: wide })))).toBe(
          "too-large",
        );
      }),
    ),
  );

  it.effect("keeps, releases, ends and restores a page", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const page = yield* pages.publish(dorothy, publishRequest());

        const kept = yield* pages.update(dorothy, { pageId: page.id, action: "keep" });
        expect(kept).toMatchObject({ state: "open", kept: true, expiresAt: null });
        yield* TestClock.adjust(40 * DAY);
        expect((yield* pages.view(page.id))?.page.state).toBe("open");

        const released = yield* pages.update(dorothy, { pageId: page.id, action: "release" });
        const releasedAt = START + 40 * DAY;
        expect(released).toMatchObject({ kept: false, expiresAt: iso(releasedAt + 30 * DAY) });
        // Release always gives an open page thirty days from the moment it is released.
        yield* TestClock.adjust(DAY);
        const endedAt = START + 41 * DAY;
        expect(yield* pages.update(dorothy, { pageId: page.id, action: "release" })).toMatchObject({
          kept: false,
          expiresAt: iso(endedAt + 30 * DAY),
        });

        const ended = yield* pages.update(dorothy, { pageId: page.id, action: "end" });
        expect(ended).toMatchObject({
          state: "ended",
          kept: false,
          expiresAt: null,
          endedAt: iso(endedAt),
          restorableUntil: iso(endedAt + 7 * DAY),
        });
        expect(yield* pages.view(page.id)).toBeNull();
        for (const action of ["keep", "release", "end"] as const)
          expect(yield* reasonOf(pages.update(dorothy, { pageId: page.id, action }))).toBe(
            "invalid",
          );
        expect(yield* reasonOf(pages.update(nora, { pageId: page.id, action: "restore" }))).toBe(
          "not-found",
        );

        yield* TestClock.adjust(7 * DAY);
        const restored = yield* pages.update(dorothy, { pageId: page.id, action: "restore" });
        expect(restored).toMatchObject({
          state: "open",
          kept: false,
          endedAt: null,
          restorableUntil: null,
          expiresAt: iso(endedAt + 7 * DAY + 30 * DAY),
        });
        expect(yield* reasonOf(pages.update(dorothy, { pageId: page.id, action: "restore" }))).toBe(
          "invalid",
        );
      }),
    ),
  );

  it.effect("expires pages and lists them only while they can be restored", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const first = yield* pages.publish(dorothy, publishRequest({ title: "First" }));
        yield* TestClock.adjust(HOUR);
        const second = yield* pages.publish(dorothy, publishRequest({ title: "Second" }));
        const theirs = yield* pages.publish(nora, publishRequest({ title: "Theirs" }));

        expect((yield* pages.list(dorothy)).map((page) => page.title)).toEqual(["Second", "First"]);
        expect((yield* pages.list(nora)).map((page) => page.id)).toEqual([theirs.id]);

        yield* TestClock.adjust(30 * DAY - HOUR);
        const listed = yield* pages.list(dorothy);
        expect(listed.find((page) => page.id === first.id)).toMatchObject({
          state: "expired",
          expiresAt: iso(START + 30 * DAY),
          restorableUntil: iso(START + 37 * DAY),
        });
        expect(listed.find((page) => page.id === second.id)?.state).toBe("open");
        expect(yield* pages.view(first.id)).toBeNull();
        expect(
          yield* reasonOf(
            pages.addReply({ pageId: first.id, replyId: replyId(1), text: "hi", viewer: "owner" }),
          ),
        ).toBe("not-found");

        yield* TestClock.adjust(7 * DAY);
        expect(yield* pages.update(dorothy, { pageId: first.id, action: "restore" })).toMatchObject(
          { state: "open", expiresAt: iso(START + 67 * DAY) },
        );
        // An hour later the second page is past its window: it is gone, not restorable.
        yield* TestClock.adjust(HOUR + 1);
        expect(
          yield* reasonOf(pages.update(dorothy, { pageId: second.id, action: "restore" })),
        ).toBe("not-found");
        expect((yield* pages.list(dorothy)).map((page) => page.id)).toEqual([first.id]);
      }),
    ),
  );

  it.effect("purges pages past restoring with their replies, and old acked replies", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const ending = yield* pages.publish(dorothy, publishRequest({ title: "Ending" }));
        const staying = yield* pages.publish(dorothy, publishRequest({ title: "Staying" }));
        yield* pages.update(dorothy, { pageId: staying.id, action: "keep" });
        for (const [index, pageId] of [ending.id, staying.id].entries())
          yield* pages.addReply({ pageId, replyId: replyId(index), text: "note", viewer: "owner" });
        yield* pages.ackReply(dorothy, { replyId: replyId(1), outcome: "delivered" });
        yield* pages.update(dorothy, { pageId: ending.id, action: "end" });

        yield* TestClock.adjust(7 * DAY - MINUTE);
        expect((yield* rows).pages).toHaveLength(2);
        expect((yield* rows).replies).toHaveLength(2);

        // The sweep runs hourly from start, so seven days and an hour is its first pass past the window.
        yield* TestClock.adjust(HOUR + MINUTE);
        expect(yield* rows).toEqual({ pages: [staying.id], replies: [] });
      }),
    ),
  );

  it.effect("caps open pages per computer", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const first = yield* pages.publish(dorothy, publishRequest());
        yield* Effect.forEach(Array.from({ length: 499 }), () =>
          pages.publish(dorothy, publishRequest()),
        );
        expect(yield* reasonOf(pages.publish(dorothy, publishRequest()))).toBe("blocked");
        // Other computers have their own room, and updating an open page takes none.
        yield* pages.publish(nora, publishRequest());
        yield* pages.publish(dorothy, publishRequest({ pageId: first.id, html: "<p>v2</p>" }));

        yield* pages.update(dorothy, { pageId: first.id, action: "end" });
        const replacement = yield* pages.publish(dorothy, publishRequest());
        expect(
          yield* reasonOf(pages.update(dorothy, { pageId: first.id, action: "restore" })),
        ).toBe("blocked");
        expect(yield* reasonOf(pages.publish(dorothy, publishRequest({ pageId: first.id })))).toBe(
          "blocked",
        );
        yield* pages.update(dorothy, { pageId: replacement.id, action: "end" });
        expect((yield* pages.update(dorothy, { pageId: first.id, action: "restore" })).state).toBe(
          "open",
        );
      }),
    ),
  );

  it.effect("validates replies, caps waiting ones and ignores a retried send", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const page = yield* pages.publish(dorothy, publishRequest());
        const reply = (id: string, text = "Ship it") =>
          pages.addReply({ pageId: page.id, replyId: id, text, viewer: "owner" });

        expect(yield* reasonOf(reply("short"))).toBe("invalid");
        expect(yield* reasonOf(reply("has spaces in it"))).toBe("invalid");
        expect(yield* reasonOf(reply(replyId(1), "   "))).toBe("invalid");
        expect(yield* reasonOf(reply(replyId(1), "x".repeat(PREVIEW_PAGE_REPLY_MAX + 1)))).toBe(
          "invalid",
        );
        expect(
          yield* reasonOf(
            pages.addReply({ pageId: "missing", replyId: replyId(1), text: "hi", viewer: "o" }),
          ),
        ).toBe("not-found");

        yield* Effect.forEach(Array.from({ length: 1000 }), (_, index) => reply(replyId(index)));
        expect(yield* reasonOf(reply(replyId(1000)))).toBe("blocked");
        // A browser retrying a send that already landed hears success even on a full queue.
        yield* reply(replyId(999));
        yield* pages.ackReply(dorothy, { replyId: replyId(0), outcome: "delivered" });
        yield* reply(replyId(1000));
        expect((yield* rows).replies).toHaveLength(1001);
      }),
    ),
  );

  it.effect("leases replies, redelivers them after the lease lapses and stops after an ack", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const page = yield* pages.publish(dorothy, publishRequest({ title: "Plan" }));
        for (let index = 0; index < 25; index++) {
          yield* pages.addReply({
            pageId: page.id,
            replyId: replyId(index),
            text: `  reply ${index}  `,
            viewer: "owner",
          });
          yield* TestClock.adjust(1);
        }

        const firstBatch = yield* pages.nextReplies(dorothy, 0);
        expect(firstBatch).toHaveLength(20);
        expect(firstBatch[0]).toEqual({
          replyId: replyId(0),
          pageId: page.id,
          pageTitle: "Plan",
          projectId: "project-loom",
          threadId: "thread-plan",
          text: "reply 0",
          createdAt: iso(START),
        });
        expect((yield* pages.nextReplies(dorothy, 0)).map((reply) => reply.replyId)).toEqual(
          [20, 21, 22, 23, 24].map(replyId),
        );
        expect(yield* pages.nextReplies(dorothy, 0)).toEqual([]);
        expect(yield* pages.nextReplies(nora, 0)).toEqual([]);

        yield* pages.ackReply(dorothy, { replyId: replyId(0), outcome: "delivered" });
        yield* pages.ackReply(dorothy, {
          replyId: replyId(1),
          outcome: "rejected",
          detail: "The thread was archived.",
        });
        // Another computer cannot settle this computer's reply, and unknown ids are a no-op.
        yield* pages.ackReply(nora, { replyId: replyId(2), outcome: "delivered" });
        yield* pages.ackReply(dorothy, { replyId: "reply-unknown", outcome: "delivered" });

        yield* TestClock.adjust(2 * MINUTE);
        const redelivered = yield* pages.nextReplies(dorothy, 0);
        expect(redelivered.map((reply) => reply.replyId)).toEqual(
          Array.from({ length: 20 }, (_, index) => replyId(index + 2)),
        );
        const { replies } = yield* rows;
        expect(replies.slice(0, 3)).toEqual([
          { reply_id: replyId(0), acked_at: iso(START + 25), outcome: "delivered", detail: null },
          {
            reply_id: replyId(1),
            acked_at: iso(START + 25),
            outcome: "rejected",
            detail: "The thread was archived.",
          },
          { reply_id: replyId(2), acked_at: null, outcome: null, detail: null },
        ]);
      }),
    ),
  );

  it.effect("waits for the next reply and wakes when one arrives", () =>
    run(ENV, (pages) =>
      Effect.gen(function* () {
        const page = yield* pages.publish(dorothy, publishRequest());
        const theirs = yield* pages.publish(nora, publishRequest());

        const waiting = yield* Effect.forkChild(pages.nextReplies(dorothy, 25_000));
        yield* TestClock.adjust("1 second");
        expect(waiting.pollUnsafe()).toBeUndefined();
        // A reply for another computer leaves this one waiting.
        yield* pages.addReply({ pageId: theirs.id, replyId: replyId(1), text: "a", viewer: "o" });
        yield* TestClock.adjust("1 second");
        expect(waiting.pollUnsafe()).toBeUndefined();
        yield* pages.addReply({ pageId: page.id, replyId: replyId(2), text: "b", viewer: "o" });
        expect((yield* Fiber.join(waiting)).map((reply) => reply.replyId)).toEqual([replyId(2)]);

        const idle = yield* Effect.forkChild(pages.nextReplies(dorothy, 25_000));
        yield* TestClock.adjust("24 seconds");
        expect(idle.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 second");
        expect(yield* Fiber.join(idle)).toEqual([]);

        // A closed request must not take a reply with it.
        const closed = yield* Effect.forkChild(pages.nextReplies(dorothy, 25_000));
        yield* TestClock.adjust("1 second");
        yield* Fiber.interrupt(closed);
        yield* pages.addReply({ pageId: page.id, replyId: replyId(3), text: "c", viewer: "o" });
        expect((yield* pages.nextReplies(dorothy, 0)).map((reply) => reply.replyId)).toEqual([
          replyId(3),
        ]);
      }),
    ),
  );
});
