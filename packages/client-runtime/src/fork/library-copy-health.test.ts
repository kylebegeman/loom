import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryRepositoryHealth,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  effectiveLibraryCopyHealth,
  libraryRepositoryCanPull,
  libraryRepositoryHealthSummary,
} from "./library-copy-health.ts";

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

  it("calls out an upstream branch deleted on its remote", () => {
    const gone = { ...noUpstream, upstream: "origin/feature", upstreamGone: true };
    expect(libraryRepositoryHealthSummary({ ...gone, unpushedCommits: 2 })).toBe(
      "main · upstream gone · 2 unpushed",
    );
    expect(libraryRepositoryCanPull({ ...gone, ahead: 0, behind: 1 })).toBe(false);
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

describe("effectiveLibraryCopyHealth", () => {
  const environmentId = EnvironmentId.make("macbook");
  const copy: LibraryWorkingCopy = {
    id: "copy",
    projectId: "project",
    projectRevision: 1,
    environmentId,
    rootPath: "/work/project",
    repositories: [
      {
        resourceId: "web",
        path: "/work/project/web",
        localProjectId: ProjectId.make("local-web"),
        head: null,
        branch: "main",
      },
    ],
    ownership: "managed",
    state: "ready",
    createdAt: "2026-10-16T08:00:00.000Z",
    updatedAt: "2026-10-16T08:00:00.000Z",
  };
  const healthAt = (checkedAt: string, uncommittedFiles = 0): LibraryCopyHealth => ({
    copyId: copy.id,
    environmentId,
    checkedAt,
    repositories: [{ ...base, uncommittedFiles, checkedAt }],
  });
  const published = healthAt("2026-10-16T09:00:00.000Z", 2);

  it("prefers live health from the connected computer", () => {
    const live = healthAt("2026-10-16T12:00:00.000Z");
    expect(
      effectiveLibraryCopyHealth({
        copy: { ...copy, health: published },
        live,
        lastSeenAt: "2026-10-16T12:00:00.000Z",
      }),
    ).toEqual({ health: live, source: "live", asOf: live.checkedAt });
  });

  it("ages the published report by when the Library last heard from the computer", () => {
    expect(
      effectiveLibraryCopyHealth({
        copy: { ...copy, health: published },
        live: null,
        lastSeenAt: "2026-10-16T11:00:00.000Z",
      }),
    ).toEqual({ health: published, source: "published", asOf: "2026-10-16T11:00:00.000Z" });
    expect(
      effectiveLibraryCopyHealth({ copy: { ...copy, health: published }, live: null })?.asOf,
    ).toBe(published.checkedAt);
    expect(
      effectiveLibraryCopyHealth({
        copy: { ...copy, health: published },
        live: null,
        lastSeenAt: "2026-10-16T08:30:00.000Z",
      })?.asOf,
    ).toBe(published.checkedAt);
  });

  it("shows nothing for a computer that never reported", () => {
    expect(effectiveLibraryCopyHealth({ copy, live: null, lastSeenAt: published.checkedAt })).toBe(
      null,
    );
    expect(
      effectiveLibraryCopyHealth({
        copy: { ...copy, health: { ...published, repositories: [] } },
        live: null,
      }),
    ).toBe(null);
  });

  it("ignores health that describes another copy", () => {
    expect(
      effectiveLibraryCopyHealth({
        copy: { ...copy, health: { ...published, copyId: "other" } },
        live: { ...published, environmentId: EnvironmentId.make("other-computer") },
      }),
    ).toBe(null);
  });
});
