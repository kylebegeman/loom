import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ThreadId } from "../baseSchemas.ts";
import { ModelHistoryInput, ModelHistory, ModelHistoryRestoreInput } from "./model-history.ts";
const decodeHistory = Schema.decodeUnknownSync(ModelHistory);
const file = { threadId: ThreadId.make("thread"), path: "part.scad" };
it("validates the bounded history page input", () => {
  const decode = Schema.decodeUnknownSync(ModelHistoryInput);
  expect(decode({ file, limit: 50 })).toEqual({ file, limit: 50 });
  expect(() => decode({ file, limit: 51 })).toThrow();
  expect(() => decode({ file, cursor: 0 })).toThrow();
});
it("requires a restore content key, allowing null only for an absent current file", () => {
  const decode = Schema.decodeUnknownSync(ModelHistoryRestoreInput);
  expect(() => decode({ file, checkpointId: "checkpoint", includeDependencies: false })).toThrow();
  expect(
    decode({
      file,
      checkpointId: "checkpoint",
      includeDependencies: false,
      expectedContentKey: null,
    }).expectedContentKey,
  ).toBeNull();
});
it("accepts the non-Git empty state without a fake content key", () =>
  expect(
    decodeHistory({
      versions: [],
      nextCursor: null,
      latestTurn: null,
      current: { present: true, contentKey: null },
      threadRunning: false,
      unavailable: "not-git",
    }).unavailable,
  ).toBe("not-git"));
