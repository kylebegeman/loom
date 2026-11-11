import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryProjectHomeLocation,
  libraryProjectHomeHealthDeadline,
  selectLibraryProjectHomeCopies,
  libraryProjectRequestHosts,
} from "./library-project-home-status.ts";

const computer = EnvironmentId.make("computer");
const elsewhere = EnvironmentId.make("elsewhere");
const at = "2026-11-11T12:00:00.000Z";
const project: LibraryProject = {
  id: "project",
  title: "Project",
  brief: "",
  revision: 2,
  archived: false,
  createdAt: at,
  updatedAt: at,
  resources: [
    {
      id: "web",
      title: "Web",
      kind: "repository",
      relativePath: ".",
      remoteUrl: "https://github.com/example/web",
      defaultBranch: null,
    },
  ],
};
const copy = (patch: Partial<LibraryWorkingCopy> = {}): LibraryWorkingCopy => ({
  id: "copy",
  projectId: project.id,
  projectRevision: 2,
  environmentId: computer,
  rootPath: "/work/web",
  ownership: "managed",
  state: "ready",
  createdAt: at,
  updatedAt: at,
  repositories: [
    {
      resourceId: "web",
      path: "/work/web",
      localProjectId: ProjectId.make("web"),
      head: null,
      branch: "main",
    },
  ],
  ...patch,
});
const health = (patch: Partial<LibraryCopyHealth> = {}): LibraryCopyHealth => ({
  copyId: "copy",
  environmentId: computer,
  checkedAt: at,
  repositories: [
    { resourceId: "web", branch: "main", uncommittedFiles: 2, unpushedCommits: 0, checkedAt: at },
  ],
  ...patch,
});
const location = (patch: Partial<Parameters<typeof libraryProjectHomeLocation>[0]> = {}) =>
  libraryProjectHomeLocation({
    project,
    copy: copy(),
    connected: true,
    liveHealth: null,
    readFailed: false,
    readPending: false,
    now: Date.parse(at),
    ...patch,
  });

describe("Library project home location evidence", () => {
  it("requires a recent matching live check and complete current scope before saying files are available", () => {
    expect(location().status).toBe("needs-check");
    expect(location({ copy: copy({ health: health() }) }).status).toBe("needs-check");
    expect(location({ liveHealth: health() })).toMatchObject({
      status: "available",
      checkedAt: at,
    });
    expect(location({ liveHealth: health({ copyId: "another" }) }).status).toBe("needs-check");
    expect(location({ liveHealth: health({ environmentId: elsewhere }) }).status).toBe(
      "needs-check",
    );
    expect(location({ liveHealth: health({ repositories: [] }) }).status).toBe("needs-check");
    expect(location({ liveHealth: health(), now: Date.parse(at) + 600_000 }).status).toBe(
      "needs-check",
    );
    expect(location({ liveHealth: health(), readFailed: true }).status).toBe("needs-check");
    expect(location({ liveHealth: health(), readPending: true }).status).toBe("needs-check");
    const earlier = "2026-11-11T11:59:00.000Z";
    const staggered = health({
      repositories: [
        { ...health().repositories[0]!, checkedAt: earlier },
        {
          ...health().repositories[0]!,
          resourceId: "removed",
          checkedAt: "2026-11-11T10:00:00.000Z",
        },
      ],
    });
    const deadline = libraryProjectHomeHealthDeadline(project, staggered);
    expect(deadline).toBe(Date.parse(earlier) + 300_000);
    expect(location({ liveHealth: staggered, now: deadline! - 1 }).status).toBe("available");
    expect(location({ liveHealth: staggered, now: deadline! }).status).toBe("needs-check");
    expect(libraryProjectHomeHealthDeadline(project, null)).toBeNull();
    expect(location({ liveHealth: health(), now: Date.parse(at) + 300_000 }).status).toBe(
      "needs-check",
    );
    expect(
      location({
        liveHealth: health({
          repositories: [{ ...health().repositories[0]!, checkedAt: "2026-11-11T11:00:00.000Z" }],
        }),
      }).status,
    ).toBe("needs-check");
    expect(location({ liveHealth: health(), connected: false }).status).toBe("offline");
    expect(location({ liveHealth: health(), copy: copy({ repositories: [] }) })).toMatchObject({
      status: "attention",
      missingComponents: ["Web"],
    });
    expect(
      location({
        liveHealth: health(),
        copy: copy({
          repositories: [
            { ...copy().repositories[0]!, path: "/wrong/location" },
            { ...copy().repositories[0]!, resourceId: "other" },
          ],
        }),
      }).status,
    ).toBe("attention");
  });

  it("keeps local changes usable while surfacing broken repositories and uncertain remote counts", () => {
    expect(location({ liveHealth: health() }).status).toBe("available");
    const repository = health().repositories[0]!;
    expect(
      location({ liveHealth: health({ repositories: [{ ...repository, error: "missing" }] }) })
        .status,
    ).toBe("attention");
    expect(
      location({
        liveHealth: health({ repositories: [{ ...repository, behind: 3, fetchFailed: true }] }),
      }),
    ).toMatchObject({ status: "available", attention: ["Web: remote check needed"] });
    expect(location({ copy: copy({ state: "failed" }) }).status).toBe("attention");
    expect(location({ copy: copy({ state: "preparing" }) }).status).toBe("preparing");
    expect(
      location({
        project: { ...project, resources: [] },
        copy: copy({ repositories: [] }),
        liveHealth: health({ repositories: [] }),
      }).status,
    ).toBe("needs-check");
  });

  it("selects only this project's registered locations and keeps request hosts without files discoverable", () => {
    const copies = [
      copy({ id: "offline", environmentId: elsewhere }),
      copy({ id: "removed", state: "released" }),
      copy({ id: "forgotten", registered: false }),
      copy({ id: "foreign", projectId: "other" }),
      copy({ id: "online" }),
    ];
    expect(
      selectLibraryProjectHomeCopies(project.id, copies, new Set([computer])).map(
        (entry) => entry.id,
      ),
    ).toEqual(["online", "offline"]);
    expect(libraryProjectRequestHosts(computer, copies, [computer, elsewhere, computer])).toEqual([
      computer,
      elsewhere,
    ]);
  });
});
