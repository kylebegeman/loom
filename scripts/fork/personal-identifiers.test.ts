// @effect-diagnostics nodeBuiltinImport:off - Exercises the standalone check against a throwaway git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { addedLines, parseAllowList, parseDenyList, scanLine } from "./personal-identifiers.ts";

// Built at runtime so this file never contains the identifiers it tests.
const tailnetHost = (machine: string, tailnet: string) => `${machine}.${tailnet}${".ts.net"}`;
const homePath = (root: string, name: string) => `/${root}/${name}/src/app.ts`;
const rules = (path: string, text: string, deny = "", allow = "") =>
  scanLine(path, 1, text, parseDenyList(deny), parseAllowList(allow)).map(({ rule, match }) => [
    rule,
    match,
  ]);

it.each([
  ["a tail-hex tailnet", tailnetHost("maple", "tail9c2e4f"), true],
  ["a two-word tailnet", tailnetHost("maple", "cobra-tuna"), true],
  ["the documented placeholder", tailnetHost("machine", "tailnet"), false],
  ["the numeric placeholder", tailnetHost("maple", "tail1234"), false],
  ["a single-label name", `desk${".ts.net"}`, false],
])("flags tailnet names: %s", (_name, host, flagged) => {
  expect(rules("docs/a.md", `open http://${host}:8317`)).toEqual(
    flagged ? [["tailnet name", host]] : [],
  );
});

it.each([
  ["a real account", homePath("Users", "morgan"), `/Users/${"morgan"}`],
  ["a Linux account", homePath("home", "morgan"), `/home/${"morgan"}`],
  ["the placeholder", homePath("Users", "me"), null],
  ["a fixture account", homePath("Users", "loom-replay"), null],
  ["a template", homePath("Users", "<name>"), null],
  ["a relative path", `apps/mobile/src/features/home/morgan.ts`, null],
])("flags home directories: %s", (_name, text, match) => {
  expect(rules("docs/a.md", text)).toEqual(match ? [["home directory", match]] : []);
});

it.each([
  [
    "a real-looking ID in source",
    "apps/server/src/a.ts",
    "3f9c2a7e-5b1d-4e8f-9a6c-2d7b8e1f4c03",
    true,
  ],
  [
    "the same ID in a test",
    "apps/server/src/a.test.ts",
    "3f9c2a7e-5b1d-4e8f-9a6c-2d7b8e1f4c03",
    false,
  ],
  [
    "the same ID in a fixtures folder",
    "packages/x/fixtures/a.json",
    "3f9c2a7e-5b1d-4e8f-9a6c-2d7b8e1f4c03",
    false,
  ],
  ["an RFC sample", "apps/server/src/a.ts", "550e8400-e29b-41d4-a716-446655440000", false],
  ["a patterned ID", "apps/server/src/a.ts", "11111111-2222-4333-8444-555555555555", false],
])("flags UUIDs outside fixtures: %s", (_name, path, uuid, flagged) => {
  expect(rules(path, `const id = "${uuid}";`)).toEqual(
    flagged ? [["UUID outside test fixtures", uuid]] : [],
  );
});

it("matches deny-list literals and expressions case-insensitively, and skips comments", () => {
  const deny = "# my machines\nmaple-hub\nre:\\bacme\\.(?:io|dev)\\b\n";
  expect(rules("a.md", "Run it on Maple-Hub, then acme.DEV and acme.ioo.", deny)).toEqual([
    ["deny list entry 1", "Maple-Hub"],
    ["deny list entry 2", "acme.DEV"],
  ]);
  expect(rules("a.md", "a regex metacharacter: maple-hubx", "maple.hub")).toEqual([]);
});

it("allowlists a reviewed line for the generic rules only", () => {
  const host = tailnetHost("maple", "tail9c2e4f");
  const allow = `docs/**/*.md\tsee ${host}\n`;
  expect(rules("docs/fork/a.md", `see ${host} for setup`, "", allow)).toEqual([]);
  expect(rules("docs/a.ts", `see ${host} for setup`, "", allow)).toEqual([["tailnet name", host]]);
  expect(rules("docs/fork/a.md", `use ${host} instead`, "", allow)).toEqual([
    ["tailnet name", host],
  ]);
  expect(rules("docs/fork/a.md", `see ${host} for setup`, "maple", allow)).toEqual([
    ["deny list entry 1", "maple"],
  ]);
});

it("reads added lines and their numbers from a zero-context diff", () => {
  const diff = [
    "diff --git a/a.md b/a.md",
    "--- a/a.md",
    "+++ b/a.md",
    "@@ -3 +3,2 @@",
    "-old",
    "+first",
    "+second",
    "@@ -10,0 +11 @@",
    "+third",
    "diff --git a/gone.md b/gone.md",
    "--- a/gone.md",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-removed",
  ].join("\n");
  expect(addedLines(diff)).toEqual([
    { path: "a.md", line: 3, text: "first" },
    { path: "a.md", line: 4, text: "second" },
    { path: "a.md", line: 11, text: "third" },
  ]);
});

it("fails only on lines a change adds that upstream does not already carry", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "personal-identifiers-"));
  try {
    const run = (args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
      NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.resolve(import.meta.dirname, "personal-identifiers.ts"), ...args],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            LOOM_PERSONAL_DENYLIST: "",
            LOOM_PERSONAL_DENYLIST_FILE: "",
            ...env,
          },
        },
      );
    const git = (...args: ReadonlyArray<string>) =>
      NodeChildProcess.execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args],
        {
          cwd: root,
        },
      );
    const upstreamHost = tailnetHost("moon", "tail9f3a1b");
    git("init", "-q", "-b", "main");
    NodeFS.writeFileSync(NodePath.join(root, "a.md"), `upstream uses ${upstreamHost}\n`);
    git("add", ".");
    git("commit", "-q", "-m", "upstream");
    git("tag", "v1.0.0");

    // The fork repeats upstream's line, so the diff adds it, but upstream's copy exempts it.
    NodeFS.writeFileSync(
      NodePath.join(root, "a.md"),
      `upstream uses ${upstreamHost}\nfork uses maple-hub\nupstream uses ${upstreamHost}\n`,
    );
    git("commit", "-qam", "fork");
    expect(run(["--base", "v1.0.0"]).stdout).toContain("none found");
    git("tag", "-d", "v1.0.0");
    expect(run(["--base", "HEAD~1"]).stdout).toContain("a.md:3: tailnet name");
    git("tag", "v1.0.0", "HEAD~1");

    const denyFile = NodePath.join(root, ".git", "deny");
    NodeFS.writeFileSync(denyFile, "maple-hub\n");
    const denied = run(["--base", "v1.0.0"], { LOOM_PERSONAL_DENYLIST_FILE: denyFile });
    expect(denied.status).toBe(1);
    expect(denied.stdout).toContain("a.md:2: deny list entry 1: maple-hub");
    expect(run(["--base", "v1.0.0"], { LOOM_PERSONAL_DENYLIST: "re:maple-h.b" }).status).toBe(1);

    NodeFS.writeFileSync(
      NodePath.join(root, "notes.md"),
      `untracked ${tailnetHost("maple", "tail9c2e4f")}\n`,
    );
    const untracked = run(["--base", "HEAD"]);
    expect(untracked.status).toBe(1);
    expect(untracked.stdout).toContain("notes.md:1: tailnet name");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
