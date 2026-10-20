import { expect, it } from "vite-plus/test";
import { isProtectedFixturePath } from "./fixtureHome.ts";
const shared = "/Users/test/.t3",
  isolated = shared + "/worktrees/loom/vault/.t3";
it("permits the recognized worktree home below the installed-home ancestor", () => {
  expect(isProtectedFixturePath(isolated, shared, isolated, isolated)).toBe(false);
  expect(
    isProtectedFixturePath(isolated + "/userdata/statev2.sqlite", shared, isolated, isolated),
  ).toBe(false);
});
it("protects live state, arbitrary nested homes and symlinks resolving outside the worktree home", () => {
  for (const target of [shared, shared + "/userdata", shared + "/userdata/statev2.sqlite"]) {
    expect(isProtectedFixturePath(target, shared, isolated, isolated)).toBe(true);
    expect(isProtectedFixturePath(target, shared, target, isolated)).toBe(true);
  }
  expect(
    isProtectedFixturePath(shared + "/arbitrary", shared, shared + "/arbitrary", isolated),
  ).toBe(true);
  expect(isProtectedFixturePath(isolated, shared, isolated, null)).toBe(true);
});
