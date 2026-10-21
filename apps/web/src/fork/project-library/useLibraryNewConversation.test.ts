import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";

vi.mock("./state", () => ({}));
vi.mock("~/state/environments", () => ({}));
vi.mock("~/state/entities", () => ({}));
vi.mock("~/uiStateStore", () => ({}));
import { libraryContextForLocalProject } from "./useLibraryNewConversation";

const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("host"),
  rootPath: "/project",
  rootLocalProjectId: ProjectId.make("root"),
  repositories: [
    {
      resourceId: "web",
      path: "/project/web",
      localProjectId: ProjectId.make("web"),
      head: null,
      branch: null,
    },
  ],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};

describe("new conversations from old local threads", () => {
  it("recovers the project and scope from registered local identities without binding the old thread", () => {
    expect(
      libraryContextForLocalProject({ environmentId: "host", projectId: "root" }, [copy]),
    ).toEqual({ projectId: "project", workingCopyId: "files" });
    expect(
      libraryContextForLocalProject({ environmentId: "host", projectId: "web" }, [copy]),
    ).toEqual({ projectId: "project", workingCopyId: "files", resourceId: "web" });
  });
  it("keeps whole-project scope when a repository is also the project's root folder", () => {
    const rootRepository = {
      ...copy,
      repositories: [{ ...copy.repositories[0]!, localProjectId: copy.rootLocalProjectId! }],
    };
    expect(
      libraryContextForLocalProject({ environmentId: "host", projectId: "root" }, [rootRepository]),
    ).toEqual({ projectId: "project", workingCopyId: "files" });
  });
  it("does not infer a project from another computer, removed files or an unregistered folder", () => {
    const ref = { environmentId: "host", projectId: "root" };
    expect(
      libraryContextForLocalProject({ ...ref, environmentId: "elsewhere" }, [copy]),
    ).toBeNull();
    expect(libraryContextForLocalProject(ref, [{ ...copy, state: "released" }])).toBeNull();
    expect(libraryContextForLocalProject(ref, [{ ...copy, registered: false }])).toBeNull();
  });
  it("does not choose between two projects that share a local identity", () => {
    expect(
      libraryContextForLocalProject({ environmentId: "host", projectId: "root" }, [
        copy,
        { ...copy, id: "other-files", projectId: "other" },
      ]),
    ).toBeNull();
  });
});
