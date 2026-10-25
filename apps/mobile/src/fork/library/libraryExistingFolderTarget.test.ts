import type { LibraryProject } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryExistingFolderTarget,
  rememberLibraryFolderProject,
  rememberedLibraryFolderProject,
} from "./libraryExistingFolderTarget";

const project = (id: string, title: string, archived = false): LibraryProject => ({
  id,
  title,
  brief: "",
  revision: 1,
  archived,
  createdAt: "2026-10-24T00:00:00Z",
  updatedAt: "2026-10-24T00:00:00Z",
  resources: [],
});
const projects = [project("current", "Current app"), project("old", "Old app", true)];
const registration = (projectId: string, ownership: "borrowed" | "managed" = "borrowed") => ({
  workingCopyId: "copy-1",
  projectId,
  projectTitle: "Recorded title",
  ownership,
});

describe("adding an existing folder from New project", () => {
  it("adds a folder its current project holds to that project instead of creating one", () => {
    expect(
      libraryExistingFolderTarget({
        registration: registration("current"),
        projects,
        loading: false,
        created: null,
      }),
    ).toEqual({
      canCreate: false,
      project: projects[0],
      copyId: null,
      error: null,
      detail: "This folder already belongs to Current app. Add it to that project instead.",
    });
    // Files Loom created reopen as their saved copy rather than as an overlapping folder.
    expect(
      libraryExistingFolderTarget({
        registration: registration("current", "managed"),
        projects,
        loading: false,
        created: null,
      }).copyId,
    ).toBe("copy-1");
  });

  it("creates a project that takes a folder over from an archived owner and says so", () => {
    expect(
      libraryExistingFolderTarget({
        registration: registration("old"),
        projects,
        loading: false,
        created: null,
      }),
    ).toMatchObject({
      canCreate: true,
      project: null,
      error: null,
      detail:
        "Takes this folder over from archived Old app. Its conversations stay in the archive.",
    });
  });

  it("creates right away for a folder with no owner, including from computers that do not report one", () => {
    // Older computers omit the registration; the Library catalog has nothing to decide then.
    expect(
      libraryExistingFolderTarget({
        registration: undefined,
        projects: null,
        loading: true,
        created: null,
      }),
    ).toEqual({ canCreate: true, project: null, copyId: null, error: null, detail: null });
  });

  it("creates nothing while the owner is unchecked or holds files Loom created", () => {
    expect(
      libraryExistingFolderTarget({
        registration: registration("current"),
        projects: null,
        loading: true,
        created: null,
      }),
    ).toMatchObject({ canCreate: false, project: null, error: null });
    expect(
      libraryExistingFolderTarget({
        registration: registration("current"),
        projects: null,
        loading: false,
        created: null,
      }),
    ).toMatchObject({ canCreate: false, error: expect.stringContaining("could not check") });
    expect(
      libraryExistingFolderTarget({
        registration: registration("old", "managed"),
        projects,
        loading: false,
        created: project("retry", "Retry"),
      }),
    ).toMatchObject({
      canCreate: false,
      project: null,
      error: expect.stringContaining("Restore that project"),
    });
  });

  it("retries into the project an earlier attempt created, on the same computer only", () => {
    const created = project("retry", "Example");
    rememberLibraryFolderProject(
      "library",
      { environmentId: "mac", rootPath: "/Projects/Example" },
      created,
    );
    expect(
      rememberedLibraryFolderProject("library", {
        environmentId: "mac",
        rootPath: "/Projects/Example",
      }),
    ).toBe(created);
    expect(
      rememberedLibraryFolderProject("library", {
        environmentId: "linux",
        rootPath: "/Projects/Example",
      }),
    ).toBeNull();

    const retry = libraryExistingFolderTarget({
      registration: registration("old"),
      projects: [...projects, created],
      loading: false,
      created,
    });
    expect(retry).toMatchObject({ canCreate: false, project: created, error: null });
    expect(retry.detail).toContain("Takes this folder over from archived Old app.");
    // Archiving the created project frees the folder for a new one again.
    expect(
      libraryExistingFolderTarget({
        registration: undefined,
        projects: [...projects, { ...created, archived: true }],
        loading: false,
        created,
      }),
    ).toMatchObject({ canCreate: true, project: null, detail: null });
  });
});
