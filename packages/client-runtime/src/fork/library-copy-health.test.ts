import { describe, expect, it } from "vite-plus/test";
import type { LibraryRepositoryHealth } from "@t3tools/contracts/fork";
import { libraryRepositoryCanPull, libraryRepositoryHealthSummary } from "./library-copy-health.ts";

const base: LibraryRepositoryHealth = {
  resourceId: "web",
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  uncommittedFiles: 0,
  unpushedCommits: 0,
  checkedAt: "2026-10-16T12:00:00.000Z",
};
const repo = (overrides: Partial<LibraryRepositoryHealth>) => ({ ...base, ...overrides });
const { upstream: _upstream, ahead: _ahead, behind: _behind, ...noUpstream } = base;

describe("libraryRepositoryHealthSummary", () => {
  it("combines branch, divergence and changes", () => {
    expect(libraryRepositoryHealthSummary(repo({ behind: 3, uncommittedFiles: 2 }))).toBe(
      "main · 3 behind · 2 changed",
    );
    expect(libraryRepositoryHealthSummary(repo({ ahead: 1, behind: 2 }))).toBe(
      "main · 1 ahead · 2 behind",
    );
    expect(libraryRepositoryHealthSummary(base)).toBe("main · up to date");
  });

  it("names a branch without an upstream and its unpushed commits", () => {
    expect(libraryRepositoryHealthSummary({ ...noUpstream, unpushedCommits: 4 })).toBe(
      "main · no upstream · 4 unpushed",
    );
  });

  it("shows the commit on a detached head", () => {
    const { branch: _branch, ...detached } = noUpstream;
    expect(
      libraryRepositoryHealthSummary({
        ...detached,
        head: "0123456789abcdef0123456789abcdef01234567",
      }),
    ).toBe("detached at 0123456");
  });

  it("describes unreadable repositories specifically", () => {
    const failed = {
      resourceId: "web",
      uncommittedFiles: 0,
      unpushedCommits: 0,
      checkedAt: base.checkedAt,
    };
    expect(libraryRepositoryHealthSummary({ ...failed, error: "missing" })).toBe("Folder missing");
    expect(libraryRepositoryHealthSummary({ ...failed, error: "not-a-repository" })).toBe(
      "Not a Git repository",
    );
  });
});

describe("libraryRepositoryCanPull", () => {
  it("allows only a clean branch that is strictly behind", () => {
    expect(libraryRepositoryCanPull(repo({ behind: 3 }))).toBe(true);
    expect(libraryRepositoryCanPull(repo({ behind: 3, uncommittedFiles: 1 }))).toBe(false);
    expect(libraryRepositoryCanPull(repo({ behind: 3, ahead: 1 }))).toBe(false);
    expect(libraryRepositoryCanPull(base)).toBe(false);
    expect(libraryRepositoryCanPull(noUpstream)).toBe(false);
    expect(libraryRepositoryCanPull(repo({ behind: 3, error: "unreadable" }))).toBe(false);
  });
});
