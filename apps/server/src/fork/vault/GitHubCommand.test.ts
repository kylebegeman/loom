import { expect, test } from "vite-plus/test";
import { githubTerminalArgs, VAULT_PUSH_REMOTE } from "./GitHubCommand.ts";
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
      action === "push" ? VAULT_PUSH_REMOTE : "https://github.com/owner/repo.git",
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

test("Git push and fetch accept the short, upstream, tag and lease forms agents use", () => {
  const git = (...argv: string[]) => githubTerminalArgs("owner/repo", { tool: "git", argv });
  expect(git("push", "-q", "-u", "--follow-tags", "origin", "main")).toEqual([
    "push",
    "--quiet",
    "--set-upstream",
    "--follow-tags",
    VAULT_PUSH_REMOTE,
    "main",
  ]);
  for (const lease of ["refs/heads/reserve:", "main:0123abcd", "main"])
    expect(git("push", `--force-with-lease=${lease}`, "origin", "HEAD:refs/heads/main")).toEqual([
      "push",
      `--force-with-lease=${lease}`,
      VAULT_PUSH_REMOTE,
      "HEAD:refs/heads/main",
    ]);
  expect(git("fetch", "-q", "--no-prune", "origin", "refs/tags/v1:refs/tags/v1")).toEqual([
    "fetch",
    "--quiet",
    "--no-prune",
    "https://github.com/owner/repo.git",
    "refs/tags/v1:refs/tags/v1",
  ]);
  for (const argv of [
    ["push", "--force-with-lease=", "origin"],
    ["push", "--force-with-lease=main:a:b", "origin"],
    ["push", "--force-with-lease=-x", "origin"],
    ["push", "--force-with-lease=main:$(id)", "origin"],
    ["fetch", "-u", "origin"],
  ])
    expect(git(...argv)).toBeNull();
});

test.each([
  ["release", "list", "--exclude-drafts", "--json", "tagName,isDraft"],
  ["release", "view", "v1.2.3", "--json", "assets,targetCommitish"],
  ["release", "edit", "v1.2.3", "--draft=false", "--latest=false"],
  ["release", "upload", "v1.2.3", "dist/app.zip#Desktop", "--clobber"],
  ["release", "download", "v1.2.3", "--dir", "downloads", "--pattern", "*.tar.gz"],
  ["workflow", "list", "--all", "--json", "id,path"],
  ["workflow", "view", "loom-cli-archives.yml", "--yaml"],
  ["workflow", "run", "loom-cli-archives.yml", "--ref", "v1.2.3", "-f", "version=v1.2.3"],
  ["run", "list", "--workflow", "loom-cli-archives.yml", "--commit", "abc123", "--limit", "50"],
  ["run", "view", "39835152512", "--json", "conclusion,jobs"],
  ["run", "watch", "39835152512", "--exit-status", "--interval", "5"],
  ["run", "rerun", "39835152512", "--failed"],
  ["run", "cancel", "39835152512"],
])(
  "routes explicit publication and workflow operations only to the selected repository: %j",
  (...argv) => {
    const routed = githubTerminalArgs("owner/repo", { tool: "gh", argv });
    expect(routed).not.toBeNull();
    const repoIndex = routed!.indexOf("--repo");
    expect(routed!.slice(repoIndex, repoIndex + 2)).toEqual(["--repo", "owner/repo"]);
    expect(routed!.slice(0, 2)).toEqual(argv.slice(0, 2));
    expect([...routed!.slice(0, repoIndex), ...routed!.slice(repoIndex + 2)]).toEqual(argv);
  },
);

test("release creation verifies its source tag and accepts literal checkout files", () => {
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: [
        "release",
        "create",
        "v1.2.3",
        "dist/app.zip",
        "-F",
        "notes.md",
        "--draft",
        "-R=Owner/Repo",
      ],
    }),
  ).toEqual([
    "release",
    "create",
    "v1.2.3",
    "dist/app.zip",
    "--repo",
    "owner/repo",
    "--notes-file",
    "notes.md",
    "--draft",
    "--verify-tag",
  ]);
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: ["release", "download", "v1.2.3", "-D", "downloads"],
    }),
  ).toEqual(["release", "download", "v1.2.3", "--repo", "owner/repo", "--dir", "downloads"]);
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: ["workflow", "run", "release.yml", "--raw-field", "notes=@private.txt"],
    }),
  ).toEqual([
    "workflow",
    "run",
    "release.yml",
    "--repo",
    "owner/repo",
    "--raw-field",
    "notes=@private.txt",
  ]);
});

test.each([
  ["release", "view", "v1", "-R", "other/repo"],
  ["release", "create", "v1", "--notes", "fixed", "--repo=github.com/owner/repo"],
  ["release", "view", "https://github.com/other/repo/releases/tag/v1"],
  ["release", "view"],
  ["release", "create", "v1"],
  ["release", "create", "v1", "--notes", "fixed", "--verify-tag=false"],
  ["release", "edit", "v1", "--tag", "replacement"],
  ["release", "edit", "v1", "--target", "replacement"],
  ["release", "edit", "v1", "--draft=maybe"],
  ["release", "delete", "v1", "--yes"],
  ["release", "upload", "v1"],
  ["release", "upload", "v1", "dist/*.zip"],
  ["release", "upload", "v1", "#label"],
  ["release", "create", "v1", "--notes-file", "-"],
  ["release", "download", "v1"],
  ["release", "download", "v1", "--dir", "out", "--output", "/tmp/override"],
  ["workflow", "run"],
  ["workflow", "run", "release.yml", "-R", "other/repo"],
  ["workflow", "run", "release.yml", "-F", "secret=@/private/token"],
  ["workflow", "run", "release.yml", "--json"],
  ["workflow", "run", "release.yml", "-f", "missing-assignment"],
  ["workflow", "run", "release.yml", "--ref", "../other"],
  ["workflow", "disable", "release.yml"],
  ["run", "view", "https://github.com/other/repo/actions/runs/1"],
  ["run", "view", "1", "--web"],
  ["run", "watch", "1", "--interval", "0"],
  ["run", "list", "--limit", "-1"],
  ["run", "download", "1", "--dir", "out"],
  ["run", "delete", "1"],
])("rejects publication destination, file, interactive and unsupported escapes: %j", (...argv) => {
  expect(githubTerminalArgs("owner/repo", { tool: "gh", argv })).toBeNull();
});

test("flag-shaped text cannot disable source tag verification or satisfy download-directory selection", () => {
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: ["release", "create", "v1", "--notes", "--verify-tag"],
    }),
  ).toEqual([
    "release",
    "create",
    "v1",
    "--repo",
    "owner/repo",
    "--notes",
    "--verify-tag",
    "--verify-tag",
  ]);
  expect(
    githubTerminalArgs("owner/repo", {
      tool: "gh",
      argv: ["release", "download", "v1", "--pattern", "--dir"],
    }),
  ).toBeNull();
});
