import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  libraryFolderOwner,
  libraryFolderOwnerIssue,
  libraryFolderRegistrations,
  libraryFolderTakeover,
  libraryStartIntent,
  libraryStartFolderProjects,
  libraryStartRepositoryProjects,
  rankLibraryStartProjects,
} from "./library-start-intent.ts";
import { libraryProjectAttention } from "./library-attention.ts";

const now = "2026-10-23T12:00:00.000Z";
const project = (id: string): LibraryProject => ({
  id,
  title: id,
  brief: "",
  revision: 1,
  archived: false,
  createdAt: now,
  updatedAt: now,
  resources: [],
});
const thread = (
  id: string,
  status: LibraryThreadSummary["status"] = "ready",
): LibraryThreadSummary => ({
  id,
  threadId: ThreadId.make(id),
  environmentId: EnvironmentId.make("computer"),
  localProjectId: ProjectId.make("local"),
  projectId: id,
  workingCopyId: null,
  resourceIds: [],
  title: id,
  status,
  archived: false,
  sequence: 1,
  createdAt: now,
  updatedAt: now,
  syncedAt: now,
});
const copy = (id: string): LibraryWorkingCopy => ({
  id,
  projectId: "project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("computer"),
  rootPath: `/work/${id}`,
  ownership: "managed",
  state: "ready",
  repositories: [],
  createdAt: now,
  updatedAt: now,
});

describe("Start intent", () => {
  it.each([
    "/Users/kyle/Aspect Avy",
    "~/Developer/Embrace",
    "C:\\Projects\\App",
    "\\\\server\\share\\App",
  ])("recognizes folder %s without interpreting it as a repository", (path) => {
    expect(libraryStartIntent(path)).toMatchObject({ kind: "folder", path });
  });
  it("accepts repository URLs and SSH aliases, leaving names and reference pages searchable", () => {
    expect(libraryStartIntent("github.com/team/app")).toMatchObject({
      kind: "repository",
      title: "app",
    });
    expect(libraryStartIntent("git@github.com:team/app.git")).toMatchObject({
      kind: "repository",
      title: "app",
    });
    expect(libraryStartIntent("https://github.com/team/app/issues/3").kind).toBe("search");
    expect(libraryStartIntent("AspectAvy")).toEqual({ kind: "search", text: "AspectAvy" });
  });
  it("offers all existing repository associations across transport variants without choosing an ambiguous project", () => {
    const associated = {
      ...project("AspectAvy"),
      resources: [
        {
          id: "app",
          title: "App",
          relativePath: "app",
          remoteUrl: "git@github.com:team/app.git",
          defaultBranch: null,
        },
      ],
    };
    expect(
      libraryStartRepositoryProjects(
        [
          associated,
          { ...associated, id: "another" },
          { ...associated, archived: true, id: "archived" },
          project("app"),
        ],
        "https://github.com/team/app",
      ).map((entry) => entry.id),
    ).toEqual(["AspectAvy", "another"]);
  });
  it("ranks recent active conversations first, ignoring deleted history and archived projects", () => {
    expect(
      rankLibraryStartProjects(
        [project("A"), project("B"), { ...project("C"), archived: true }],
        [thread("B"), { ...thread("A"), deleted: true, updatedAt: "2026-10-24T00:00:00.000Z" }],
      ).map((entry) => entry.id),
    ).toEqual(["B", "A"]);
  });
});

describe("project attention", () => {
  it("ranks decisions and failures before file issues, running work and a recent conversation", () => {
    const dirty = {
      ...copy("dirty"),
      health: {
        copyId: "dirty",
        environmentId: EnvironmentId.make("computer"),
        checkedAt: now,
        repositories: [
          {
            resourceId: "app",
            uncommittedFiles: 2,
            unpushedCommits: 1,
            fetchedAt: now,
            checkedAt: now,
          },
        ],
      },
    };
    const result = libraryProjectAttention(
      [
        thread("running", "running"),
        thread("ready"),
        thread("waiting", "waiting"),
        thread("failed", "failed"),
        { ...thread("settled", "failed"), settled: true },
      ],
      [copy("unknown"), dirty, { ...copy("removed"), state: "released" }],
    );
    expect(result.map((entry) => entry.id)).toEqual([
      "waiting",
      "failed",
      "dirty",
      "running",
      "unknown",
      "ready",
    ]);
    expect(result.find((entry) => entry.id === "dirty")?.detail).toBe(
      "2 changed files; 1 local commit",
    );
    expect(result.find((entry) => entry.id === "unknown")?.detail).toContain("not been checked");
    expect(result.every((entry) => entry.checkedAt === now)).toBe(true);
  });
  it("shows incomplete repository health and singular counts honestly", () => {
    const incomplete = {
      ...copy("partial"),
      repositories: [
        {
          resourceId: "app",
          path: "/work/app",
          head: null,
          branch: null,
          localProjectId: ProjectId.make("local"),
        },
      ],
      health: {
        copyId: "partial",
        environmentId: EnvironmentId.make("computer"),
        checkedAt: now,
        repositories: [],
      },
    };
    expect(libraryProjectAttention([], [incomplete])[0]?.detail).toContain("not been checked");
  });
});

describe("existing Start folder associations", () => {
  it("matches non-Git folders only on their recorded computer, keeping all genuine choices", () => {
    const projects = [
      project("first"),
      project("second"),
      { ...project("archived"), archived: true },
    ];
    const copies = projects.map((entry) => ({
      ...copy(entry.id),
      projectId: entry.id,
      rootPath: "/work/app/",
    }));
    expect(
      libraryStartFolderProjects(projects, copies, "computer", "/work/app").map(
        (entry) => entry.id,
      ),
    ).toEqual(["first", "second"]);
    expect(libraryStartFolderProjects(projects, copies, "other", "/work/app")).toEqual([]);
    expect(
      libraryStartFolderProjects(
        projects,
        copies.map((entry) => ({ ...entry, registered: false })),
        "computer",
        "/work/app",
      ),
    ).toEqual([]);
    expect(
      libraryStartFolderProjects(
        projects,
        copies.map((entry) => ({ ...entry, state: "released" })),
        "computer",
        "/work/app",
      ),
    ).toEqual([]);
    expect(libraryStartFolderProjects(projects, copies, "computer", "/work/application")).toEqual(
      [],
    );
  });
});

describe("a folder's registered owner", () => {
  const registration = (
    projectId: string,
    ownership: "borrowed" | "managed" = "borrowed",
    projectTitle = "Recorded title",
  ) => ({ workingCopyId: `copy-${projectId}`, projectId, projectTitle, ownership });
  const projects = [
    { ...project("current"), title: "Current app" },
    { ...project("other"), title: "Other app" },
    { ...project("old"), title: "Old app", archived: true },
    { ...project("older"), title: "Older app", archived: true },
  ];
  const ownerOf = (...registrations: ReturnType<typeof registration>[]) =>
    libraryFolderOwner(registrations, projects);

  it("keeps a folder with its current project and frees one whose project is archived or gone", () => {
    expect(libraryFolderOwner([], projects)).toBeNull();
    const current = ownerOf(registration("current"));
    expect(libraryFolderOwnerIssue(current, "current")).toBeNull();
    expect(libraryFolderOwnerIssue(current, null)).toBeNull();
    expect(libraryFolderOwnerIssue(current, "new")).toBe(
      "This folder already belongs to Current app. Add it to that project instead.",
    );
    expect(libraryFolderTakeover(current)).toBeNull();

    const archived = ownerOf(registration("old"));
    expect(libraryFolderOwnerIssue(archived, "new")).toBeNull();
    expect(libraryFolderTakeover(archived)).toBe(
      "Takes this folder over from archived Old app. Its conversations stay in the archive.",
    );
    // A project the Library no longer has is named as its computer recorded it.
    const missing = ownerOf(registration("deleted"));
    expect(libraryFolderOwnerIssue(missing, "current")).toBeNull();
    expect(libraryFolderTakeover(missing)).toBe(
      "Takes this folder over from Recorded title, which is no longer in your Library.",
    );
  });

  it("refuses files Loom created and any owner it cannot check yet", () => {
    const archived = ownerOf(registration("old", "managed"));
    expect(libraryFolderOwnerIssue(archived, "new")).toContain("Restore that project");
    expect(libraryFolderTakeover(archived)).toBeNull();
    const missing = ownerOf(registration("deleted", "managed"));
    expect(libraryFolderOwnerIssue(missing, "current")).toContain("Choose another folder.");
    // Its own project still reuses a managed folder.
    expect(libraryFolderOwnerIssue(ownerOf(registration("current", "managed")), "current")).toBe(
      null,
    );
    const unchecked = libraryFolderOwner([registration("current")], undefined);
    expect(libraryFolderOwnerIssue(unchecked, "current")).toBe(
      "Loom could not check which project owns this folder. Reconnect your Library and try again.",
    );
  });

  it("lets a current holder anywhere keep a folder an older build also left with archived ones", () => {
    // The newest holder is archived, which is all an older computer would report.
    const owner = ownerOf(registration("old"), registration("current"), registration("deleted"));
    expect(owner).toMatchObject({ kind: "current", title: "Current app" });
    expect(libraryFolderOwnerIssue(owner, "new")).toBe(
      "This folder already belongs to Current app. Add it to that project instead.",
    );
    expect(libraryFolderOwnerIssue(owner, "current")).toBeNull();
    expect(libraryFolderTakeover(owner)).toBeNull();
    // Two current holders: either one reuses its own folder, and the newest is the one named.
    const both = ownerOf(registration("other"), registration("current"));
    expect(libraryFolderOwnerIssue(both, "current")).toBeNull();
    expect(libraryFolderOwnerIssue(both, "new")).toContain("belongs to Other app");
  });

  it("refuses for files Loom created behind any holder and takes over only when all have gone", () => {
    const managed = ownerOf(registration("old"), registration("older", "managed"));
    expect(managed).toMatchObject({ kind: "archived", title: "Older app", managed: true });
    expect(libraryFolderOwnerIssue(managed, "new")).toContain("archived Older app. Restore");
    expect(libraryFolderOwnerIssue(managed, null)).toContain("archived Older app. Restore");
    expect(libraryFolderTakeover(managed)).toBeNull();
    // The current project still reuses its own folder; another project would be refused.
    const shared = ownerOf(registration("current"), registration("old", "managed"));
    expect(libraryFolderOwnerIssue(shared, "current")).toBeNull();
    expect(libraryFolderOwnerIssue(shared, "new")).toContain("belongs to Current app");

    expect(
      libraryFolderTakeover(
        ownerOf(registration("old"), registration("older"), registration("old")),
      ),
    ).toBe(
      "Takes this folder over from archived Old app and Older app. Their conversations stay in the archive.",
    );
    const gone = ownerOf(registration("old"), registration("deleted", "borrowed", "Gone app"));
    expect(libraryFolderOwnerIssue(gone, "new")).toBeNull();
    expect(libraryFolderTakeover(gone)).toBe(
      "Takes this folder over from archived Old app and from Gone app, which is no longer in your Library. Conversations from Old app stay in the archive.",
    );
  });

  it("judges a computer that names one holder by that holder", () => {
    const older = registration("current");
    expect(libraryFolderRegistrations({ registration: older })).toEqual([older]);
    expect(libraryFolderRegistrations({})).toEqual([]);
    expect(libraryFolderRegistrations(null)).toEqual([]);
    const all = [registration("old"), older];
    expect(libraryFolderRegistrations({ registration: older, registrations: all })).toBe(all);
  });
});
