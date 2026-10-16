import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { libraryCopiesForScope, libraryCopyReadiness } from "./library-copy-choice.ts";

const host = EnvironmentId.make("dorothy");
const other = EnvironmentId.make("mini");
const project: LibraryProject = {
  id: "loom",
  title: "Loom",
  brief: "Shared work",
  revision: 2,
  archived: false,
  resources: [
    {
      id: "app",
      title: "App",
      remoteUrl: "https://github.com/owner/app",
      relativePath: "app",
      defaultBranch: null,
    },
    {
      id: "local",
      title: "Local tool",
      remoteUrl: null,
      relativePath: "tool",
      defaultBranch: null,
    },
    {
      id: "docs",
      title: "Design",
      kind: "link",
      url: "https://example.com/design",
      remoteUrl: null,
      relativePath: "",
      defaultBranch: null,
    },
  ],
  createdAt: "2026-10-15T12:00:00Z",
  updatedAt: "2026-10-15T12:00:00Z",
};
const copy = (overrides: Partial<LibraryWorkingCopy> = {}): LibraryWorkingCopy => ({
  id: "copy",
  projectId: project.id,
  projectRevision: 2,
  environmentId: host,
  rootPath: "/workspace/loom",
  repositories: project.resources
    .filter((resource) => resource.kind !== "link")
    .map((resource) => ({
      resourceId: resource.id,
      path: `/workspace/loom/${resource.relativePath}`,
      localProjectId: ProjectId.make(resource.id),
      branch: null,
      head: null,
    })),
  ownership: "managed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  ...overrides,
});

describe("Library working-copy selection", () => {
  it("never substitutes a copy on another computer", () => {
    expect(libraryCopiesForScope(project, [copy({ environmentId: other })], host, null)).toEqual(
      [],
    );
  });
  it("excludes removed registrations from new conversations while accepting legacy registrations", () => {
    expect(libraryCopiesForScope(project, [copy({ registered: false })], host, null)).toEqual([]);
    expect(libraryCopiesForScope(project, [copy()], host, null)).toHaveLength(1);
  });
  it("requires a ready copy of this project", () => {
    expect(
      libraryCopiesForScope(
        project,
        [copy({ state: "missing" }), copy({ projectId: "other" })],
        host,
        null,
      ),
    ).toEqual([]);
  });
  it("reuses older prepared copies when their resources still cover the current scope", () => {
    expect(libraryCopiesForScope(project, [copy({ projectRevision: 1 })], host, null)).toHaveLength(
      1,
    );
  });
  it("requires local repositories for whole-project scope while excluding reference links", () => {
    const partial = copy({
      repositories: copy().repositories.filter((repository) => repository.resourceId === "app"),
    });
    expect(libraryCopiesForScope(project, [partial], host, null)).toEqual([]);
    expect(libraryCopiesForScope(project, [copy()], host, null)).toHaveLength(1);
  });
  it("reuses a borrowed copy that covers the selected component", () => {
    const borrowed = copy({
      ownership: "borrowed",
      repositories: copy().repositories.filter((repository) => repository.resourceId === "local"),
    });
    expect(libraryCopiesForScope(project, [borrowed], host, ["local"])).toEqual([borrowed]);
  });
  it("rejects missing components and reference links as repository scopes", () => {
    expect(libraryCopiesForScope(project, [copy()], host, ["missing"])).toEqual([]);
    expect(libraryCopiesForScope(project, [copy()], host, ["docs"])).toEqual([]);
  });
  it("offers a fresh discussion copy after every repository is removed", () => {
    const discussionProject = { ...project, revision: 3, resources: [] };
    const discussionCopy = copy({ id: "discussion-copy", repositories: [] });
    expect(libraryCopiesForScope(discussionProject, [copy(), discussionCopy], host, null)).toEqual([
      discussionCopy,
    ]);
  });
  it("reuses a superset copy after one repository is removed from the project", () => {
    const narrowedProject = {
      ...project,
      revision: 3,
      resources: project.resources.filter((resource) => resource.id !== "local"),
    };
    expect(libraryCopiesForScope(narrowedProject, [copy()], host, null)).toHaveLength(1);
  });
  it("covers every listed component and rejects duplicate or empty repository scopes", () => {
    expect(libraryCopiesForScope(project, [copy()], host, ["app", "local"])).toHaveLength(1);
    const partial = copy({
      repositories: copy().repositories.filter((repository) => repository.resourceId === "app"),
    });
    expect(libraryCopiesForScope(project, [partial], host, ["app", "local"])).toEqual([]);
    expect(libraryCopiesForScope(project, [copy()], host, ["app", "app"])).toEqual([]);
    expect(libraryCopiesForScope(project, [copy()], host, [])).toEqual([]);
  });
  it("stops reusing a copy once the project moves a repository to another folder", () => {
    const moved = {
      ...project,
      resources: project.resources.map((resource) =>
        resource.id === "app" ? { ...resource, relativePath: "apps/app" } : resource,
      ),
    };
    expect(libraryCopiesForScope(moved, [copy()], host, ["app"])).toEqual([]);
    expect(libraryCopiesForScope(moved, [copy()], host, ["local"])).toHaveLength(1);
  });
  it("matches a root import and tolerates trailing or Windows separators", () => {
    const rootProject = {
      ...project,
      resources: [{ ...project.resources[0]!, relativePath: "." }],
    };
    const rootCopy = copy({
      rootPath: "C:\\workspace\\loom\\",
      repositories: [{ ...copy().repositories[0]!, path: "C:\\workspace\\loom" }],
    });
    expect(libraryCopiesForScope(rootProject, [rootCopy], host, null)).toEqual([rootCopy]);
  });
  it("offers no copies for an archived project", () => {
    expect(libraryCopiesForScope({ ...project, archived: true }, [copy()], host, null)).toEqual([]);
  });
  it("supports a brief-only project without requiring repository resources", () => {
    expect(
      libraryCopiesForScope(
        { ...project, resources: [] },
        [copy({ repositories: [] })],
        host,
        null,
      ),
    ).toHaveLength(1);
  });
});

describe("existing-copy readiness before preparing files", () => {
  it("waits for the first result rather than treating an unstarted query as empty", () => {
    expect(libraryCopyReadiness({ isPending: false, isSuccess: false, error: null })).toBe(
      "loading",
    );
    expect(libraryCopyReadiness({ isPending: true, isSuccess: false, error: null })).toBe(
      "loading",
    );
  });
  it("waits for refreshing copies before offering new preparation", () => {
    expect(libraryCopyReadiness({ isPending: true, isSuccess: true, error: null })).toBe("loading");
  });
  it("allows an empty successful catalog to offer new preparation", () => {
    expect(libraryCopyReadiness({ isPending: false, isSuccess: true, error: null })).toBe("ready");
  });
  it("requires retry after failure and presents loading while that retry is pending", () => {
    expect(
      libraryCopyReadiness({ isPending: false, isSuccess: false, error: "Library unavailable" }),
    ).toBe("error");
    expect(
      libraryCopyReadiness({ isPending: true, isSuccess: false, error: "Library unavailable" }),
    ).toBe("loading");
  });
});
