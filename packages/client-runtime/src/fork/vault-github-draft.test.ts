import { expect, it } from "@effect/vitest";
import * as Redacted from "effect/Redacted";
import { makeVaultGitHubSave, type VaultGitHubDraft } from "./vault-github-draft.ts";
const draft: VaultGitHubDraft = {
  id: "a".repeat(32),
  expectedVersion: 0,
  label: "  Developer GitHub  ",
  repositories: "Owner/Repo, Owner/Other\nteam/source",
  type: "token",
  appId: "7",
  installationId: "42",
  secret: " synthetic_private_token ",
};
it("normalizes portable repository input and redacts private form data", () => {
  const save = makeVaultGitHubSave(draft, "b".repeat(32))!;
  expect(save.repositories).toEqual(["owner/repo", "owner/other", "team/source"]);
  expect(save.label).toBe("Developer GitHub");
  expect(JSON.stringify(save)).not.toContain("synthetic_private_token");
  expect(save.credential?.type).toBe("token");
  if (save.credential?.type === "token")
    expect(Redacted.value(save.credential.token)).toBe("synthetic_private_token");
  const app = makeVaultGitHubSave(
    { ...draft, type: "app", secret: " first\\nsecond " },
    "b".repeat(32),
  )!;
  if (app.credential?.type === "app")
    expect(Redacted.value(app.credential.privateKey)).toBe("first\nsecond");
});
it("rejects empty or excessive allowlists, invalid identity fields and missing private data", () => {
  for (const change of [
    { repositories: "" },
    { repositories: Array.from({ length: 33 }, (_, i) => `owner/repo${i}`).join(",") },
    { type: "app" as const, appId: "invalid" },
    { secret: "  " },
    { expectedVersion: -1 },
  ])
    expect(makeVaultGitHubSave({ ...draft, ...change }, "b".repeat(32))).toBeNull();
});

it("accepts pasted GitHub URLs and SSH remotes, normalizes and deduplicates them", () => {
  const save = makeVaultGitHubSave(
    {
      ...draft,
      repositories:
        "https://github.com/Owner/Repo.git, git@github.com:Owner/Other.git\nowner/repo\nhttps://github.com/owner/third/",
    },
    "b".repeat(32),
  );
  expect(save?.repositories).toEqual(["owner/repo", "owner/other", "owner/third"]);
});
it("refuses credential-bearing URLs, another host, and repository subpages", () => {
  for (const repositories of [
    "https://token@github.com/owner/repo",
    "https://github.com/owner/repo?token=private",
    "https://github.example.com/owner/repo",
    "https://github.com/owner/repo/tree/main",
    "git@other.test:owner/repo.git",
    "http://github.com/owner/repo",
  ]) {
    expect(makeVaultGitHubSave({ ...draft, repositories }, "b".repeat(32))).toBeNull();
  }
});

it("keeps stored credentials only on edits and applies the personal repository cap", () => {
  const edit = { ...draft, expectedVersion: 1, secret: "", appId: "", installationId: "" };
  expect(makeVaultGitHubSave(edit, "b".repeat(32))?.credential).toBeUndefined();
  expect(makeVaultGitHubSave({ ...edit, type: "app" }, "b".repeat(32))?.credential).toBeUndefined();
  expect(makeVaultGitHubSave({ ...edit, expectedVersion: 0 }, "b".repeat(32))).toBeNull();
  const repositories = Array.from({ length: 100 }, (_, i) => `owner/repo${i}`).join(",");
  expect(makeVaultGitHubSave({ ...edit, repositories }, "b".repeat(32))).toBeNull();
  expect(
    makeVaultGitHubSave({ ...edit, repositories }, "b".repeat(32), true)?.repositories,
  ).toHaveLength(100);
  expect(
    makeVaultGitHubSave(
      { ...edit, repositories: repositories + ",owner/overflow" },
      "b".repeat(32),
      true,
    ),
  ).toBeNull();
});
