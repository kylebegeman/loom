import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { libraryPortableRecoveryPlan } from "./library-portable-recovery.ts";

const sourceEnvironment = EnvironmentId.make("source");
const destinationEnvironment = EnvironmentId.make("destination");
const project: LibraryProject = {
  id: "project",
  title: "Work",
  brief: "",
  revision: 1,
  archived: false,
  resources: [
    {
      id: "repo",
      title: "Code",
      relativePath: ".",
      remoteUrl: "https://example.com/work.git",
      defaultBranch: "main",
    },
  ],
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
};
const copy = (overrides: Partial<LibraryWorkingCopy> = {}): LibraryWorkingCopy => ({
  id: "source-copy",
  projectId: project.id,
  projectRevision: 1,
  environmentId: sourceEnvironment,
  rootPath: "/work",
  ownership: "managed",
  state: "ready",
  registered: true,
  repositories: [
    {
      resourceId: "repo",
      path: "/work",
      localProjectId: ProjectId.make("local"),
      head: "abc",
      branch: "main",
    },
  ],
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  ...overrides,
});
const recovery = {
  sha256: "a".repeat(64),
  byteLength: 100,
  archiveKey: "archive",
  verifiedAt: project.updatedAt,
};
const plan = (
  copies: readonly LibraryWorkingCopy[],
  overrides: Partial<Parameters<typeof libraryPortableRecoveryPlan>[0]> = {},
) =>
  libraryPortableRecoveryPlan({
    project,
    copies,
    destinationEnvironmentId: destinationEnvironment,
    resourceIds: null,
    ...overrides,
  });

describe("portable project files", () => {
  it("uses existing destination files for an ordinary start", () => {
    const local = copy({ id: "local", environmentId: destinationEnvironment });
    expect(plan([copy(), local])).toEqual({ kind: "local", copy: local });
  });
  it("saves a fresh snapshot from the only source, even if an older archive exists", () => {
    const source = copy({ recovery });
    expect(plan([source])).toEqual({ kind: "recover", sourceCopy: source, needsSnapshot: true });
  });
  it("uses a verified released snapshot without contacting the original computer", () => {
    const source = copy({ state: "released", registered: false, recovery });
    expect(plan([source])).toEqual({ kind: "recover", sourceCopy: source, needsSnapshot: false });
  });
  it("reopens a released destination location rather than creating a second copy", () => {
    const local = copy({ state: "released", recovery, environmentId: destinationEnvironment });
    expect(plan([local])).toEqual({ kind: "local", copy: local });
  });
  it("does not choose the newest of conflicting locations", () => {
    const first = copy();
    const second = copy({ id: "other", updatedAt: "2026-10-22T00:00:00.000Z" });
    expect(plan([first, second])).toMatchObject({ kind: "choose", candidates: [first, second] });
  });
  it("does not silently use another destination folder for a source continuation", () => {
    const source = copy();
    const local = copy({ id: "local", environmentId: destinationEnvironment });
    expect(
      plan([source, local], {
        sourceWorkingCopyId: source.id,
        sourceEnvironmentId: sourceEnvironment,
      }),
    ).toMatchObject({ kind: "choose", candidates: [source, local] });
    expect(
      plan([source, local], { sourceWorkingCopyId: source.id, selectedSourceCopyId: local.id }),
    ).toEqual({ kind: "local", copy: local });
  });
  it("pins a continuation to its exact source among other computers", () => {
    const source = copy({ state: "released", recovery });
    expect(
      plan([copy({ id: "other" }), source], {
        sourceWorkingCopyId: source.id,
        sourceEnvironmentId: sourceEnvironment,
      }),
    ).toEqual({ kind: "recover", sourceCopy: source, needsSnapshot: false });
  });
  it("fails a missing or mismatched continuation source instead of cloning", () => {
    expect(plan([], { sourceWorkingCopyId: "missing" })).toMatchObject({ kind: "unavailable" });
    expect(
      plan([copy()], {
        sourceWorkingCopyId: "source-copy",
        sourceEnvironmentId: destinationEnvironment,
      }),
    ).toMatchObject({ kind: "unavailable" });
  });
  it.each(["missing", "failed", "preparing"] as const)(
    "fails a %s source even with stale saved metadata",
    (state) => {
      expect(
        plan([copy({ state, recovery })], { sourceWorkingCopyId: "source-copy" }),
      ).toMatchObject({ kind: "unavailable" });
    },
  );
  it("does not clone over an unverified removed location", () => {
    expect(plan([copy({ state: "released" })])).toMatchObject({ kind: "unavailable" });
    expect(
      plan([copy({ state: "released", recovery: { ...recovery, sha256: "bad" } })]),
    ).toMatchObject({ kind: "unavailable" });
  });
  it("clones a new Git-backed project without previous file locations", () => {
    expect(plan([])).toEqual({ kind: "clone" });
  });
  it("preserves plain-folder projects when moving between computers", () => {
    const plainProject = { ...project, resources: [] };
    const plain = copy({ repositories: [] });
    expect(plan([plain], { project: plainProject })).toEqual({
      kind: "recover",
      sourceCopy: plain,
      needsSnapshot: true,
    });
  });
  it("refuses Git fallback for resources without a remote", () => {
    expect(
      plan([], {
        project: { ...project, resources: [{ ...project.resources[0]!, remoteUrl: null }] },
      }),
    ).toMatchObject({ kind: "unavailable" });
  });
  it("validates scope and relative layout for selected saved files", () => {
    expect(
      plan([copy({ repositories: [{ ...copy().repositories[0]!, path: "/other" }] })], {
        sourceWorkingCopyId: "source-copy",
      }),
    ).toMatchObject({ kind: "unavailable" });
    expect(
      plan([copy()], { resourceIds: ["unknown"], selectedSourceCopyId: "source-copy" }),
    ).toMatchObject({ kind: "unavailable" });
  });
  it("requires a fresh managed layout after removing a repository from the whole project", () => {
    const oldLayout = copy({
      repositories: [
        ...copy().repositories,
        {
          resourceId: "removed",
          path: "/work/removed",
          localProjectId: ProjectId.make("old"),
          head: null,
          branch: null,
        },
      ],
    });
    expect(plan([oldLayout])).toEqual({ kind: "clone" });
    expect(plan([oldLayout], { sourceWorkingCopyId: oldLayout.id })).toMatchObject({
      kind: "unavailable",
    });
    expect(plan([oldLayout], { resourceIds: ["repo"] })).toEqual({
      kind: "recover",
      sourceCopy: oldLayout,
      needsSnapshot: true,
    });
  });
  it("does not reuse a removed external registration or a source from another project", () => {
    expect(
      plan([copy({ registered: false })], { sourceWorkingCopyId: "source-copy" }),
    ).toMatchObject({ kind: "unavailable" });
    expect(
      plan([copy({ projectId: "other" })], { sourceWorkingCopyId: "source-copy" }),
    ).toMatchObject({ kind: "unavailable" });
  });
  it("requires a new choice when a selected location disappears", () => {
    expect(plan([], { selectedSourceCopyId: "gone" })).toMatchObject({ kind: "unavailable" });
  });
});
