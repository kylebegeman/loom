import { expect, test } from "vite-plus/test";
import { githubTerminalArgs } from "./GitHubCommand.ts";
test("normal gh commands retain flags while repository selection stays explicit", () => {
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: ["pr", "list", "--state", "all", "--repo=Owner/Repo", "--json", "number"],
    }),
  ).toEqual(["pr", "list", "--repo", "owner/repo", "--state", "all", "--json", "number"]);
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: ["pr", "comment", "12", "--body", "See https://example.test"],
    }),
  ).toEqual(["pr", "comment", "12", "--repo", "owner/repo", "--body", "See https://example.test"]);
});
test.each([
  ["auth", "token"],
  ["api", "repos/other/repo"],
  ["extension", "exec", "evil"],
  ["pr", "list", "-R", "other/repo"],
  ["pr", "view", "https://github.com/other/repo/pull/1"],
  ["pr", "view", "other/repo#1"],
  ["repo", "view", "other/repo"],
  ["pr", "list", "--web"],
  ["pr", "list", "--hostname", "example.test"],
  ["pr", "comment", "1", "--body-file", "/private/token"],
])("rejects GH account/destination/interactive escapes: %j", (...argv) => {
  expect(githubTerminalArgs("owner/repo", { tool: "gh", argv })).toBeNull();
});
test("Git HTTPS accepts ordinary remote commands and rejects executable options and destination overrides", () => {
  for (const action of ["fetch", "push", "ls-remote"]) {
    expect(githubTerminalArgs("owner/repo", { tool: "git", argv: [action, "origin"] })).toEqual([
      action,
      "https://github.com/owner/repo.git",
      ...(action === "fetch" ? ["+refs/heads/*:refs/remotes/origin/*"] : []),
    ]);
  }
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "git",
      argv: ["clone", "--depth=1", "https://github.com/Owner/Repo", "checkout"],
    }),
  ).toEqual(["clone", "--depth", "1", "https://github.com/owner/repo.git", "checkout"]);
  for (const argv of [
    ["fetch", "https://evil.test/repo"],
    ["push", "--receive-pack=evil", "origin"],
    ["-c", "credential.helper=evil", "fetch", "origin"],
    ["clone", "https://github.com/owner/repo", "../escape"],
    ["fetch", "--upload-pack", "evil", "origin"],
  ])
    expect(githubTerminalArgs("owner/repo", { tool: "git", argv })).toBeNull();
});
