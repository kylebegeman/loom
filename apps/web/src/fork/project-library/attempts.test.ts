import { describe, expect, it } from "vite-plus/test";
import { readLibraryAttempt, saveLibraryAttempt } from "./attempts";

describe("Library operation recovery", () => {
  it("retains the same submitted request after browser persistence fails", () => {
    const key = "blocked-request";
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const attempt = JSON.stringify({ prepareRequestId: "original", copy: null });
    saveLibraryAttempt(key, attempt, storage);
    expect(readLibraryAttempt(key, storage)).toBe(attempt);
    const confirmed = JSON.stringify({ prepareRequestId: "original", copy: { id: "same-copy" } });
    saveLibraryAttempt(key, confirmed, storage);
    expect(JSON.parse(readLibraryAttempt(key, storage)!)).toEqual({
      prepareRequestId: "original",
      copy: { id: "same-copy" },
    });
    saveLibraryAttempt(key, null, storage);
    expect(readLibraryAttempt(key, storage)).toBeNull();
  });
  it("keeps a newer receipt and its acknowledgement when storage still contains an older request", () => {
    const key = "stale-storage";
    const storage = {
      getItem: () => "old",
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    saveLibraryAttempt(key, "host-confirmed", storage);
    expect(readLibraryAttempt(key, storage)).toBe("host-confirmed");
    saveLibraryAttempt(key, null, storage);
    expect(readLibraryAttempt(key, storage)).toBeNull();
  });
  it("recovers persisted host receipts before central registration", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const submitted = JSON.stringify({
      host: "dorothy",
      requestId: "one",
      projectId: "loom",
      copyId: "prepared",
    });
    saveLibraryAttempt("persisted-receipt", submitted, storage);
    expect(readLibraryAttempt("persisted-receipt", storage)).toBe(submitted);
    saveLibraryAttempt("persisted-receipt", null, storage);
    expect(values.has("persisted-receipt")).toBe(false);
  });
});
