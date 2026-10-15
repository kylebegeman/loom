import { describe, expect, it } from "vite-plus/test";
import { LIBRARY_CACHE_MAX_AGE_MS, queryCacheRemovals } from "./queryCache";
describe("Library offline cache bounds", () => {
  it("expires old data and discards malformed persisted entries", () => {
    const now = LIBRARY_CACHE_MAX_AGE_MS + 2;
    expect(
      queryCacheRemovals(
        [
          { key: "old", value: { payload: "x", bytes: 1, savedAt: 1 } },
          { key: "broken", value: "legacy" },
          { key: "fresh", value: { payload: "x", bytes: 1, savedAt: now } },
        ],
        now,
      ),
    ).toEqual(["old", "broken"]);
  });
  it("preserves newest histories while bounding total storage", () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      key: index,
      value: { payload: "history", bytes: 8 * 1024 * 1024, savedAt: index + 1 },
    }));
    expect(queryCacheRemovals(entries, 10)).toEqual([1, 0]);
  });
  it("bounds count independently of byte size and rejects oversized histories", () => {
    const entries = Array.from({ length: 201 }, (_, index) => ({
      key: index,
      value: { payload: "history", bytes: 1, savedAt: index + 1 },
    }));
    expect(queryCacheRemovals(entries, 202)).toEqual([0]);
    expect(
      queryCacheRemovals(
        [{ key: "huge", value: { payload: "x", bytes: 9 * 1024 * 1024, savedAt: 1 } }],
        2,
      ),
    ).toEqual(["huge"]);
  });
});
