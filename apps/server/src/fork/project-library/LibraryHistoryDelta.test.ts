import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { applyHistoryDelta, createHistoryDelta } from "./LibraryHistoryDelta.ts";
import { archiveFor, resource } from "./Library.testkit.ts";
import * as Schema from "effect/Schema";
import { LibraryThreadArchive, type LibraryProject } from "@t3tools/contracts/fork";

const project: LibraryProject = {
  id: "project",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

describe("Library history deltas", () => {
  it.effect("recognizes unchanged rows after persistence changes object field order", () =>
    Effect.gen(function* () {
      const before = yield* archiveFor(project, 1);
      const codec = Schema.toCodecJson(LibraryThreadArchive);
      const persisted = yield* Schema.decodeEffect(codec)(
        yield* Schema.encodeEffect(codec)(before),
      );
      const after = { ...before, summary: { ...before.summary, sequence: 2 } };
      const entry = createHistoryDelta(persisted, after);
      expect(entry.delta.prefixes.messages).toBe(1);
      expect(entry.thread.projection.messages).toEqual([]);
      expect(yield* applyHistoryDelta(persisted, entry.thread, entry.delta)).toEqual(after);
    }),
  );

  it.effect("retains unchanged collections while transferring appended and changed tails", () =>
    Effect.gen(function* () {
      const before = yield* archiveFor(project, 1);
      const next = yield* archiveFor(project, 2);
      const previousMessage = before.projection.messages[0]!;
      const after = {
        ...next,
        projection: {
          ...next.projection,
          messages: [previousMessage, ...next.projection.messages],
        },
      };
      const entry = createHistoryDelta(before, after);
      expect(entry.delta.prefixes.messages).toBe(1);
      expect(entry.thread.projection.messages).toHaveLength(after.projection.messages.length - 1);
      expect(yield* applyHistoryDelta(before, entry.thread, entry.delta)).toEqual(after);
      expect(before.projection.messages).toHaveLength(1);
    }),
  );
  it.effect("reconstructs truncation and edits in the middle without retaining removed rows", () =>
    Effect.gen(function* () {
      const before = yield* archiveFor(project, 1);
      const next = yield* archiveFor(project, 2);
      const after = { ...next, projection: { ...next.projection, messages: [] } };
      const entry = createHistoryDelta(before, after);
      expect(yield* applyHistoryDelta(before, entry.thread, entry.delta)).toEqual(after);
      const edited = createHistoryDelta(before, next);
      expect(yield* applyHistoryDelta(before, edited.thread, edited.delta)).toEqual(next);
    }),
  );
  it.effect("refuses a mismatched base, changed binding, paged history, or escaping prefix", () =>
    Effect.gen(function* () {
      const before = yield* archiveFor(project, 1);
      const after = yield* archiveFor(project, 2);
      const entry = createHistoryDelta(before, after);
      const attempts = [
        applyHistoryDelta(before, entry.thread, { ...entry.delta, baseSequence: 0 }),
        applyHistoryDelta(
          before,
          { ...entry.thread, summary: { ...entry.thread.summary, projectId: "other" } },
          entry.delta,
        ),
        applyHistoryDelta(
          before,
          { ...entry.thread, window: { offset: 0, totalItems: 1, hasMore: false } },
          entry.delta,
        ),
        applyHistoryDelta(before, entry.thread, {
          ...entry.delta,
          prefixes: { ...entry.delta.prefixes, messages: 999 },
        }),
      ];
      for (const attempt of attempts)
        expect((yield* attempt.pipe(Effect.flip)).reason).toBe("sequence-conflict");
    }),
  );
});
