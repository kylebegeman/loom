import { describe, expect, it } from "vite-plus/test";
import { storageCategorySize, storageWebSettingsUrl } from "./project-storage.ts";

describe("storage measurement presentation", () => {
  it("keeps unknown and partially measured storage distinct from zero", () => {
    const row = {
      kind: "worktrees" as const,
      locations: 1,
      unknownLocations: 1,
      landed: 0,
      released: 0,
      bytes: null,
      knownBytes: 0,
    };
    expect(storageCategorySize(row)).toBe("Not measured");
    expect(storageCategorySize({ ...row, knownBytes: 2048 })).toBe("At least 2.0 KiB");
    expect(storageCategorySize({ ...row, bytes: 0, unknownLocations: 0 })).toBe("0 B");
  });
  it("opens a public web destination without forwarding credentials or query strings", () => {
    expect(storageWebSettingsUrl("https://computer.example/route?token=private#fragment")).toBe(
      "https://computer.example/settings/worktrees",
    );
    for (const address of [
      "ssh://computer.example",
      "https://user:password@computer.example",
      "missing",
      null,
    ])
      expect(storageWebSettingsUrl(address)).toBeNull();
  });
});
