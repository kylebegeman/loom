import type { LibraryProject } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryExistingFolderTarget,
  libraryFolderActionOutcome,
  libraryFolderRowAction,
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
        registrations: [registration("current")],
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
        registrations: [registration("current", "managed")],
        projects,
        loading: false,
        created: null,
      }).copyId,
    ).toBe("copy-1");
  });

  it("judges every holder an older build left, not just the newest", () => {
    expect(
      libraryExistingFolderTarget({
        registrations: [registration("old"), registration("current")],
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
    // Files Loom created for a project the Library no longer has refuse a new project too.
    expect(
      libraryExistingFolderTarget({
        registrations: [registration("old"), registration("gone", "managed")],
        projects,
        loading: false,
        created: null,
      }),
    ).toEqual({
      canCreate: false,
      project: null,
      copyId: null,
      error:
        "This folder holds files Loom created for Recorded title, which is no longer in your Library. Choose another folder.",
      detail: null,
    });
  });

  it("creates a project that takes a folder over from an archived owner and says so", () => {
    expect(
      libraryExistingFolderTarget({
        registrations: [registration("old")],
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
        registrations: [],
        projects: null,
        loading: true,
        created: null,
      }),
    ).toEqual({ canCreate: true, project: null, copyId: null, error: null, detail: null });
  });

  it("creates nothing while the owner is unchecked or holds files Loom created", () => {
    expect(
      libraryExistingFolderTarget({
        registrations: [registration("current")],
        projects: null,
        loading: true,
        created: null,
      }),
    ).toMatchObject({ canCreate: false, project: null, error: null });
    expect(
      libraryExistingFolderTarget({
        registrations: [registration("current")],
        projects: null,
        loading: false,
        created: null,
      }),
    ).toMatchObject({ canCreate: false, error: expect.stringContaining("could not check") });
    expect(
      libraryExistingFolderTarget({
        registrations: [registration("old", "managed")],
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
      registrations: [registration("old")],
      projects: [...projects, created],
      loading: false,
      created,
    });
    expect(retry).toMatchObject({ canCreate: false, project: created, error: null });
    expect(retry.detail).toContain("Takes this folder over from archived Old app.");
    // Archiving the created project frees the folder for a new one again.
    expect(
      libraryExistingFolderTarget({
        registrations: [],
        projects: [...projects, { ...created, archived: true }],
        loading: false,
        created,
      }),
    ).toMatchObject({ canCreate: true, project: null, detail: null });
  });
});

describe("a folder row that adds the folder in one tap", () => {
  const settled = { projects, loading: false, created: null, matches: [] };

  it("names the project the folder's files are registered to, else a new project", () => {
    expect(
      libraryFolderRowAction({
        registered: [projects[0]!],
        created: null,
        rootPath: "/Projects/app",
        title: null,
      }),
    ).toEqual({ kind: "add", project: projects[0] });
    // A retry adds to the project an earlier attempt created rather than naming another one.
    const created = project("retry", "Retry");
    expect(
      libraryFolderRowAction({ registered: [], created, rootPath: "/Projects/app", title: null }),
    ).toEqual({ kind: "add", project: created });
    expect(
      libraryFolderRowAction({
        registered: [],
        created: null,
        rootPath: "/Projects/app/",
        title: null,
      }),
    ).toEqual({ kind: "create", title: "app" });
    expect(
      libraryFolderRowAction({
        registered: [],
        created: null,
        rootPath: "C:\\Work\\site",
        title: "Typed name",
      }),
    ).toEqual({ kind: "create", title: "Typed name" });
  });

  it("names nothing until the Library answers or when several projects hold the folder", () => {
    expect(
      libraryFolderRowAction({ registered: null, created: null, rootPath: "/a", title: null }),
    ).toBeNull();
    expect(
      libraryFolderRowAction({
        registered: [projects[0]!, project("other", "Other")],
        created: null,
        rootPath: "/a",
        title: null,
      }),
    ).toBeNull();
  });

  it("adds to the named project, reopening files Loom created for it as their saved copy", () => {
    expect(
      libraryFolderActionOutcome({
        ...settled,
        action: { kind: "add", project: projects[0]! },
        registrations: [registration("current", "managed")],
      }),
    ).toEqual({ kind: "add", project: projects[0], copyId: "copy-1" });
    // A chosen project takes a folder over from an archived owner, as a new one would.
    const chosen = project("chosen", "Chosen");
    expect(
      libraryFolderActionOutcome({
        ...settled,
        projects: [...projects, chosen],
        action: { kind: "add", project: chosen },
        registrations: [registration("old")],
      }),
    ).toEqual({ kind: "add", project: chosen, copyId: null });
  });

  it("stops on the form when the folder belongs elsewhere or its owner is unknown", () => {
    const chosen = project("chosen", "Chosen");
    expect(
      libraryFolderActionOutcome({
        ...settled,
        action: { kind: "add", project: chosen },
        registrations: [registration("current")],
      }).kind,
    ).toBe("review");
    expect(
      libraryFolderActionOutcome({
        ...settled,
        projects: null,
        loading: true,
        action: { kind: "add", project: chosen },
        registrations: [registration("current")],
      }).kind,
    ).toBe("wait");
    expect(
      libraryFolderActionOutcome({
        ...settled,
        projects: null,
        action: { kind: "add", project: chosen },
        registrations: [registration("current")],
      }).kind,
    ).toBe("review");
  });

  it("creates only when nothing holds the folder or already uses its repositories", () => {
    const create = { kind: "create", title: "app" } as const;
    expect(libraryFolderActionOutcome({ ...settled, action: create, registrations: [] }).kind).toBe(
      "create",
    );
    expect(
      libraryFolderActionOutcome({
        ...settled,
        action: create,
        registrations: [],
        matches: [projects[0]!],
      }).kind,
    ).toBe("review");
    expect(
      libraryFolderActionOutcome({
        ...settled,
        action: create,
        registrations: [registration("current")],
      }).kind,
    ).toBe("review");
    expect(libraryFolderActionOutcome({ ...settled, action: null, registrations: [] }).kind).toBe(
      "review",
    );
  });
});
