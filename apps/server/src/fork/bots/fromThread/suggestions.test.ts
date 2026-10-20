import { describe, expect, it } from "@effect/vitest";
import { ScheduledTaskId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";
import { isoAt } from "../BotBudgets.ts";
import {
  message,
  messageEvent,
  withDraftsHarness,
  type DraftsHarness,
} from "../testing/DraftsHarness.ts";
import { handleDomainEvent } from "./BotDrafts.ts";
import { makeSuggestionsStore, SHAPES_KEPT, SHAPE_IDLE_MS } from "./SuggestionsStore.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-10-01T10:00:00.000Z");
const dayAt = (day: number) => isoAt(START + day * DAY);

/** Opens a thread whose brief reviews `file`, and hands its first message to the reactor. */
const open = (
  harness: DraftsHarness,
  drafts: Effect.Success<DraftsHarness["service"]>,
  threadId: string,
  file: string,
  day: number,
  fields: Parameters<typeof message>[2] = {},
) => {
  const brief = message(threadId, `Review ${file} for bugs`, { at: dayAt(day), ...fields });
  harness.addThread(threadId, [brief]);
  return handleDomainEvent(drafts, messageEvent(brief)).pipe(Effect.as(brief));
};

describe("bot suggestions", () => {
  it.effect("suggests a shape seen in three threads within 14 days, not over 20", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        yield* open(harness, drafts, "a", "src/a.ts", 0);
        yield* open(harness, drafts, "b", "src/b.ts", 3, { createdBy: "agent" });
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);
        yield* open(harness, drafts, "c", "src/c.ts", 6, { createdBy: "agent" });
        const [suggestion] = (yield* drafts.suggestions({})).suggestions;
        expect(suggestion).toMatchObject({
          shape: "review {{file}} for bugs",
          threadIds: ["c", "b", "a"],
          count: 3,
          firstSeenAt: dayAt(0),
          lastSeenAt: dayAt(6),
          startedBy: "agent",
          dismissedAt: null,
        });

        yield* open(harness, drafts, "x", "lib/x.ts", 0, { text: "Delete lib/x.ts" } as never);
        for (const [threadId, day] of [
          ["p", 0],
          ["q", 10],
          ["r", 20],
        ] as const) {
          const brief = message(threadId, `Port src/${threadId}.ts to Effect`, { at: dayAt(day) });
          harness.addThread(threadId, [brief]);
          yield* handleDomainEvent(drafts, messageEvent(brief));
        }
        expect((yield* drafts.suggestions({})).suggestions).toHaveLength(1);
      }),
    ),
  );

  it.effect("counts each thread once, by its first brief", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        const first = yield* open(harness, drafts, "a", "src/a.ts", 0);
        const later = message("a", "Review src/z.ts for bugs", { at: dayAt(1) });
        harness.addThread("a", [first, later]);
        yield* handleDomainEvent(drafts, messageEvent(later));
        yield* handleDomainEvent(
          drafts,
          messageEvent({ ...first, text: "Review src/q.ts for bugs" }),
        );
        // A later message of a thread Loom never saw open does not stand in for its brief.
        const missed = message("m", "Review src/m.ts for bugs", { at: dayAt(1) });
        harness.addThread("m", [message("m", "Hello", { at: dayAt(0) }), missed]);
        yield* handleDomainEvent(drafts, messageEvent(missed));
        yield* open(harness, drafts, "b", "src/b.ts", 2);
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);
      }),
    ),
  );

  it.effect("ignores streaming, assistant, scheduled and bot threads", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        yield* open(harness, drafts, "s", "src/s.ts", 0, { streaming: true });
        yield* open(harness, drafts, "as", "src/as.ts", 0, { role: "assistant" });
        yield* open(harness, drafts, "t", "src/t.ts", 0, {
          scheduledTaskId: ScheduledTaskId.make("task"),
        });
        yield* open(harness, drafts, "sys", "src/sys.ts", 0, { createdBy: "system" });
        yield* open(harness, drafts, "bot-run-1", "src/1.ts", 0);
        yield* open(harness, drafts, "bot-run-draft-1", "src/2.ts", 0);
        yield* open(harness, drafts, "bot-open-1", "src/3.ts", 0);
        yield* open(harness, drafts, "real", "src/real.ts", 0);
        yield* open(harness, drafts, "real2", "src/real2.ts", 0);
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);
        const sql = yield* SqlClient.SqlClient;
        const counted = yield* sql<{
          thread_id: string;
        }>`SELECT thread_id FROM fork_bots_brief_threads ORDER BY thread_id`;
        expect(counted.map((row) => row.thread_id)).toEqual(["real", "real2"]);
      }),
    ),
  );

  it.effect("reopens a dismissed suggestion once after five more threads", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        for (const n of [1, 2, 3]) yield* open(harness, drafts, `t${n}`, `src/${n}.ts`, n);
        const [suggestion] = (yield* drafts.suggestions({})).suggestions;
        yield* drafts.dismissSuggestion({ suggestionId: suggestion!.id, dismissed: true });
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);
        expect((yield* drafts.suggestions({ dismissed: true })).suggestions).toHaveLength(1);

        for (const n of [4, 5, 6, 7]) yield* open(harness, drafts, `t${n}`, `src/${n}.ts`, n);
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);
        yield* open(harness, drafts, "t8", "src/8.ts", 8);
        expect((yield* drafts.suggestions({})).suggestions).toHaveLength(1);

        yield* drafts.dismissSuggestion({ suggestionId: suggestion!.id, dismissed: true });
        for (const n of [9, 10, 11, 12, 13, 14])
          yield* open(harness, drafts, `t${n}`, `src/${n}.ts`, n);
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);

        const restored = yield* drafts.dismissSuggestion({
          suggestionId: suggestion!.id,
          dismissed: false,
        });
        expect(restored.dismissedAt).toBeNull();
      }),
    ),
  );

  it.effect("forgets idle shapes and keeps at most 2,000", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        for (const n of [1, 2, 3]) yield* open(harness, drafts, `t${n}`, `src/${n}.ts`, n);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${SHAPES_KEPT + 5}) INSERT INTO fork_bots_brief_shapes (shape_key, shape, entries_json, total_count, last_seen_at) SELECT 'k' || i, 's', '[]', 1, ${dayAt(10)} FROM n`;
        const store = yield* makeSuggestionsStore;
        yield* store.prune(START + 10 * DAY);
        const count = () =>
          sql<{ n: number }>`SELECT COUNT(*) AS n FROM fork_bots_brief_shapes`.pipe(
            Effect.map((rows) => rows[0]!.n),
          );
        expect(yield* count()).toBe(SHAPES_KEPT);
        // The real shape was the oldest, so the cap took it and its suggestion with it.
        expect((yield* drafts.suggestions({})).suggestions).toEqual([]);

        yield* TestClock.setTime(START + 10 * DAY + SHAPE_IDLE_MS + DAY);
        yield* store.prune(START + 10 * DAY + SHAPE_IDLE_MS + DAY);
        expect(yield* count()).toBe(SHAPES_KEPT - 100);
      }),
    ),
  );
});
