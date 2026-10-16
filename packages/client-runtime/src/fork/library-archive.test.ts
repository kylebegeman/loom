import { describe, expect, it } from "vite-plus/test";
import { shouldRefreshLibraryArchive } from "./library-archive.ts";

describe("saved conversation freshness", () => {
  it("reloads only when the displayed conversation has newer saved history", () => {
    const archive = { id: "displayed", sequence: 10 };
    expect(shouldRefreshLibraryArchive(archive, { id: "displayed", sequence: 11 })).toBe(true);
    expect(shouldRefreshLibraryArchive(archive, { id: "other", sequence: 11 })).toBe(false);
    expect(shouldRefreshLibraryArchive(archive, { id: "displayed", sequence: 10 })).toBe(false);
    expect(shouldRefreshLibraryArchive(archive, { id: "displayed", sequence: 9 })).toBe(false);
  });
  it("keeps the initial history request independent of the summary catalog", () => {
    expect(shouldRefreshLibraryArchive(null, { id: "displayed", sequence: 1 })).toBe(false);
    expect(shouldRefreshLibraryArchive({ id: "displayed", sequence: 1 }, undefined)).toBe(false);
  });
});
