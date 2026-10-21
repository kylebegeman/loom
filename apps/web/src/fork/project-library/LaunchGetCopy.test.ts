import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
vi.mock("./ProfileReadiness", () => ({}));
import {
  libraryLaunchPathOverlaps,
  libraryLaunchRetainedCopy,
  libraryLaunchRootPath,
} from "./LaunchGetCopy";

const project: LibraryProject = {
  id: "project",
  title: "My project!",
  revision: 1,
  brief: "",
  resources: [],
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("host"),
  rootPath: "/retained/project",
  repositories: [],
  ownership: "managed",
  state: "released",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const input = {
  project,
  environmentId: copy.environmentId,
  newProjectsRoot: "/projects/",
  copies: [] as readonly LibraryWorkingCopy[],
};

describe("project launch location", () => {
  it("suggests a project folder on the chosen computer without a folder wizard", () => {
    expect(libraryLaunchRootPath(input)).toBe("/projects/my-project");
    expect(libraryLaunchRootPath({ ...input, newProjectsRoot: "C:\\Projects\\" })).toBe(
      "C:\\Projects\\my-project",
    );
    expect(libraryLaunchRootPath({ ...input, newProjectsRoot: undefined })).toBe("");
  });
  it("reopens in the most recent retained location on the same computer", () => {
    expect(libraryLaunchRootPath({ ...input, copies: [copy] })).toBe(copy.rootPath);
    expect(
      libraryLaunchRootPath({
        ...input,
        copies: [copy, { ...copy, rootPath: "/newer", updatedAt: "2026-10-16T12:00:00.000Z" }],
      }),
    ).toBe("/newer");
  });
  it("never uses another project's or computer's location or unregistered files", () => {
    expect(
      libraryLaunchRootPath({
        ...input,
        copies: [
          { ...copy, projectId: "other-project" },
          { ...copy, environmentId: EnvironmentId.make("other-computer") },
          { ...copy, registered: false },
        ],
      }),
    ).toBe("/projects/my-project");
  });
});

const repository = (id: string, relativePath = id) => ({
  id,
  title: id,
  relativePath,
  kind: "repository" as const,
  remoteUrl: `https://github.com/example/${id}.git`,
  defaultBranch: null,
});
const multiProject = {
  ...project,
  revision: 2,
  resources: [repository("app"), repository("docs")],
};
const multiCopy: LibraryWorkingCopy = {
  ...copy,
  rootPath: "/projects/my-project",
  repositories: multiProject.resources.map((resource) => ({
    resourceId: resource.id,
    path: `/projects/my-project/${resource.relativePath}`,
    localProjectId: ProjectId.make(resource.id),
    head: null,
    branch: null,
  })),
};

describe("retained launch files", () => {
  it("restores managed files only on the selected computer with the requested repository layout", () => {
    const scoped = { ...multiCopy, repositories: [multiCopy.repositories[0]!] };
    const args = { ...input, project: multiProject, copies: [scoped] };
    expect(libraryLaunchRetainedCopy(args)).toBeNull();
    expect(libraryLaunchRetainedCopy({ ...args, resourceId: "app" })).toEqual(scoped);
    expect(libraryLaunchRetainedCopy({ ...args, resourceId: "docs" })).toBeNull();
    expect(
      libraryLaunchRetainedCopy({
        ...args,
        resourceId: "app",
        environmentId: EnvironmentId.make("other"),
      }),
    ).toBeNull();
    expect(
      libraryLaunchRetainedCopy({ ...args, copies: [{ ...multiCopy, registered: false }] }),
    ).toBeNull();
    expect(
      libraryLaunchRetainedCopy({ ...args, copies: [{ ...multiCopy, ownership: "borrowed" }] }),
    ).toBeNull();
    expect(
      libraryLaunchRetainedCopy({ ...args, copies: [{ ...multiCopy, state: "missing" }] }),
    ).toBeNull();
  });
  it("reuses kept managed files but does not revive a temporary active workspace as retained files", () => {
    expect(libraryLaunchRetainedCopy({ ...input, copies: [{ ...copy, state: "ready" }] })?.id).toBe(
      copy.id,
    );
    expect(
      libraryLaunchRetainedCopy({
        ...input,
        copies: [{ ...copy, state: "ready", keepOnComputer: false }],
      }),
    ).toBeNull();
  });
  it("honors a selected retained identity instead of silently changing to newer files", () => {
    const newer = {
      ...copy,
      id: "newer",
      rootPath: "/newer",
      updatedAt: "2026-10-16T12:00:00.000Z",
    };
    expect(
      libraryLaunchRetainedCopy({ ...input, copies: [copy, newer], copyId: copy.id })?.id,
    ).toBe(copy.id);
  });
  it("keeps compatible files through metadata edits and ignores resources outside component scope", () => {
    const revised = {
      ...multiProject,
      revision: 3,
      title: "Renamed",
      brief: "New brief",
      resources: [repository("app"), repository("docs", "moved-docs")],
    };
    expect(
      libraryLaunchRetainedCopy({
        ...input,
        project: revised,
        copies: [multiCopy],
        resourceId: "app",
      })?.id,
    ).toBe(multiCopy.id);
    expect(
      libraryLaunchRetainedCopy({ ...input, project: revised, copies: [multiCopy] }),
    ).toBeNull();
  });
});

describe("changed project launch locations", () => {
  it("uses a fresh versioned root when repositories are added, removed or moved", () => {
    for (const resources of [
      [repository("app")],
      [...multiProject.resources, repository("api")],
      [repository("app", "src"), repository("docs")],
    ]) {
      expect(
        libraryLaunchRootPath({
          ...input,
          project: { ...multiProject, resources },
          copies: [multiCopy],
        }),
      ).toBe("/projects/my-project-v2");
    }
  });
  it("does not reuse a managed active root missing a requested repository", () => {
    const incomplete = {
      ...multiCopy,
      state: "ready" as const,
      repositories: [multiCopy.repositories[0]!],
    };
    expect(libraryLaunchRootPath({ ...input, project: multiProject, copies: [incomplete] })).toBe(
      "/projects/my-project-v2",
    );
  });
  it("avoids ancestors and descendants of existing roots on the same computer", () => {
    const args = {
      ...input,
      project: multiProject,
      copies: [
        { ...multiCopy, repositories: [] },
        {
          ...copy,
          id: "other-project",
          projectId: "other",
          state: "ready" as const,
          rootPath: "/projects/my-project-v2/active",
        },
        { ...copy, id: "versioned", rootPath: "/projects/my-project-v2-2" },
      ],
    };
    expect(libraryLaunchRootPath(args)).toBe("/projects/my-project-v2-3");
    expect(libraryLaunchRootPath({ ...args, newProjectsRoot: "/projects/my-project/nested" })).toBe(
      "/projects/my-project-v2-3",
    );
  });
  it("preserves Windows separators and avoids roots that differ only by case", () => {
    expect(
      libraryLaunchRootPath({
        ...input,
        project: multiProject,
        newProjectsRoot: "C:\\Projects",
        copies: [{ ...multiCopy, repositories: [], rootPath: "c:\\projects\\my-project" }],
      }),
    ).toBe("C:\\Projects\\my-project-v2");
  });
  it("versions the previous root when this computer has no configured projects folder", () => {
    expect(
      libraryLaunchRootPath({
        ...input,
        project: multiProject,
        newProjectsRoot: undefined,
        copies: [{ ...multiCopy, repositories: [] }],
      }),
    ).toBe("/projects/my-project-v2");
  });
  it("does not prepare fresh files over a released root when recovery is unsupported", () => {
    expect(libraryLaunchRootPath({ ...input, copies: [copy], allowReopen: false })).toBe(
      "/projects/my-project",
    );
    expect(
      libraryLaunchRootPath({
        ...input,
        copies: [{ ...copy, rootPath: "/projects/my-project" }],
        allowReopen: false,
      }),
    ).toBe("/projects/my-project-v1");
  });
});

describe("protected launch roots", () => {
  it("recognizes parent segments, repeated separators and Windows aliases before preparation", () => {
    expect(
      libraryLaunchPathOverlaps("/projects/retained", "/projects/elsewhere/../retained/"),
    ).toBe(true);
    expect(libraryLaunchPathOverlaps("/projects/retained", "/projects//retained/new")).toBe(true);
    expect(
      libraryLaunchPathOverlaps("C:\\Projects\\Retained", "c:/projects/elsewhere/../retained"),
    ).toBe(true);
    expect(libraryLaunchPathOverlaps("/projects/retained", "/projects/retained-v2")).toBe(false);
  });
  it("requires a different projects folder when no sibling can avoid a copy at a device root", () => {
    expect(
      libraryLaunchRootPath({
        ...input,
        project: multiProject,
        newProjectsRoot: "/",
        copies: [{ ...multiCopy, repositories: [], rootPath: "/" }],
      }),
    ).toBe("");
    expect(
      libraryLaunchRootPath({
        ...input,
        project: multiProject,
        newProjectsRoot: "C:\\",
        copies: [{ ...multiCopy, repositories: [], rootPath: "C:\\" }],
      }),
    ).toBe("");
  });
});
