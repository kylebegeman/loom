import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  type ProjectCloneSnapshot,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import {
  buildProjectPreparationPlan,
  getProjectPreparationDestination,
  getProjectPreparationRecovery,
  matchingProjectPreparationCopies,
  projectPreparationSource,
  type ProjectPreparationProject,
} from "./project-preparation.ts";

const sourceHost = EnvironmentId.make("source-host");
const destinationHost = EnvironmentId.make("selected-host");
const projectId = ProjectId.make("stable-clone-request");
const fork: RepositoryIdentity = {
  rootPath: "/source/fork",
  canonicalKey: "github.com/maintainers/upstream",
  origin: { canonicalKey: "github.com/kyle/fork" },
  locator: {
    source: "git-remote",
    remoteName: "upstream",
    remoteUrl: "https://github.com/maintainers/upstream.git",
  },
};
const origin: RepositoryIdentity = {
  rootPath: "/source/fork",
  canonicalKey: "github.com/kyle/fork",
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "https://github.com/kyle/fork.git",
  },
};
const source = projectPreparationSource({
  checkout: { state: "managed", repositoryIdentity: origin },
});
const host = {
  environmentId: destinationHost,
  connected: true,
  canClone: true,
  newProjectsRoot: "/home/loom/projects",
};
const project = (
  overrides: Partial<ProjectPreparationProject> = {},
): ProjectPreparationProject => ({
  environmentId: destinationHost,
  id: ProjectId.make("existing-project"),
  workspaceRoot: "/home/loom/projects/existing",
  repositoryIdentity: null,
  ...overrides,
});
const plan = (overrides: Partial<Parameters<typeof buildProjectPreparationPlan>[0]> = {}) =>
  buildProjectPreparationPlan({
    source,
    host,
    projectId,
    title: "My project",
    createdAt: "2026-10-13T12:00:00.000Z",
    projects: [],
    ...overrides,
  });
const clone = (phase: ProjectCloneSnapshot["phase"]): ProjectCloneSnapshot => ({
  projectId,
  remoteUrl: origin.locator.remoteUrl,
  destinationPath: "/home/loom/projects/fork",
  repository: null,
  phase,
  stage: "receiving",
  percent: 50,
  detail: null,
  error: null,
  startedAt: "2026-10-13T12:00:00.000Z",
  endedAt: null,
  sequence: 1,
});

describe("project preparation source", () => {
  it("uses reviewed actual origin and refuses a cached upstream locator for a fork", () => {
    expect(
      projectPreparationSource({ checkout: { state: "managed", repositoryIdentity: fork } }),
    ).toMatchObject({ ready: false });
    expect(source).toEqual({
      ready: true,
      source: "checkout",
      remoteUrl: origin.locator.remoteUrl,
      repositoryKey: "github.com/kyle/fork",
    });
  });
  it("uses the authoritative published offer ahead of a stale checkout identity", () => {
    expect(
      projectPreparationSource({
        offer: {
          remoteUrl: "https://git.example.test/team/repo.git",
          repositoryKey: "git.example.test/team/repo",
        },
        checkout: { state: "managed", repositoryIdentity: fork },
      }),
    ).toMatchObject({
      ready: true,
      source: "handoff",
      remoteUrl: "https://git.example.test/team/repo.git",
    });
  });
  it("requires a fresh review after a blocked checkout despite its cached identity", () => {
    expect(
      projectPreparationSource({ checkout: { state: "blocked", repositoryIdentity: origin } }),
    ).toMatchObject({ ready: false });
    expect(
      projectPreparationSource({
        offer: { remoteUrl: origin.locator.remoteUrl, repositoryKey: origin.canonicalKey },
        checkout: { state: "blocked", repositoryIdentity: origin },
      }),
    ).toMatchObject({ ready: true, source: "handoff" });
  });
  it("rejects a mismatched offer key", () => {
    expect(
      projectPreparationSource({
        offer: { remoteUrl: origin.locator.remoteUrl, repositoryKey: "github.com/another/repo" },
      }),
    ).toMatchObject({ ready: false });
  });
  it.each([
    "https://user:password@github.com/team/repo.git",
    "https://token@github.com/team/repo.git",
    "https://github.com/team/repo.git?key=private",
    "https://github.com/team/repo.git#private",
    "file:///home/kyle/repo",
    "/home/kyle/repo",
    "C:\\repo",
    "../repo",
    "https://github.com",
    "https://github.com/team/repo.git\n",
    "git://token@git.example.test/team/repo",
    "ssh://git:private@git.example.test/team/repo",
    "ftp://git.example.test/team/repo",
    "git@host:folder/repo?secret=yes",
  ])("rejects unsafe or machine-local remote %s", (remoteUrl) => {
    expect(
      projectPreparationSource({
        checkout: {
          state: "managed",
          repositoryIdentity: { ...origin, locator: { ...origin.locator, remoteUrl } },
        },
      }),
    ).toMatchObject({ ready: false });
  });
  it.each([
    "http://127.0.0.1:9000/team/repo.git",
    "https://127.1/team/repo.git",
    "ssh://git@127.1/team/repo.git",
    "https://2130706433/team/repo.git",
    "ssh://git@0x7f000001/team/repo.git",
    "ssh://git@localhost/repo",
    "git@localhost:repo",
    "git@LOCALHOST.:repo",
    "https://code.localhost/team/repo.git",
    "git@127.0.0.2:repo",
    "git@127.1:repo",
    "http://0.0.0.0/team/repo.git",
    "git://0/team/repo.git",
    "http://[::1]/team/repo.git",
    "ssh://git@[0:0:0:0:0:0:0:1]/team/repo.git",
    "http://[::]/team/repo.git",
    "http://[::ffff:127.0.0.1]/team/repo.git",
  ])("rejects a cross-computer remote that resolves to the local host %s", (remoteUrl) => {
    expect(
      projectPreparationSource({
        checkout: {
          state: "managed",
          repositoryIdentity: { ...origin, locator: { ...origin.locator, remoteUrl } },
        },
      }),
    ).toMatchObject({ ready: false });
  });
  it.each([
    "ssh://git@code.example.test/team/repo.git",
    "git@code.example.test:team/repo.git",
    "git://code.example.test/team/repo.git",
    "https://code.example.test/team/repo.git",
    "http://192.168.4.27/team/repo.git",
    "git@192.168.4.27:team/repo.git",
    "ssh://git@[fd00::27]/team/repo.git",
    "https://127.code.example.test/team/repo.git",
  ])("accepts supported network transport without a domain whitelist %s", (remoteUrl) => {
    expect(
      projectPreparationSource({
        checkout: {
          state: "released",
          repositoryIdentity: { ...origin, locator: { ...origin.locator, remoteUrl } },
        },
      }),
    ).toMatchObject({ ready: true, remoteUrl });
  });
});

describe("explicit computer and destination preparation", () => {
  it("builds one stable clone request for the chosen computer and allows a reviewed destination override", () => {
    expect(plan({ destinationPath: "/srv/workspaces/my-fork" })).toEqual({
      kind: "create",
      environmentId: destinationHost,
      input: {
        projectId,
        title: "My project",
        createdAt: "2026-10-13T12:00:00.000Z",
        remoteUrl: origin.locator.remoteUrl,
        destinationPath: "/srv/workspaces/my-fork",
      },
    });
  });
  it("never changes an offline or read-only destination to another connected computer", () => {
    expect(
      plan({
        host: { ...host, connected: false },
        projects: [project({ environmentId: sourceHost, repositoryIdentity: origin })],
      }),
    ).toMatchObject({ kind: "blocked", reason: expect.stringContaining("selected computer") });
    expect(plan({ host: { ...host, canClone: false } })).toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("permission"),
    });
  });
  it("lists every matching physical copy on only the explicitly selected computer", () => {
    const first = { ...project({ repositoryIdentity: fork }), title: "First copy" };
    const second = {
      ...project({ id: ProjectId.make("second-copy"), repositoryIdentity: origin }),
      title: "Second copy",
    };
    expect(
      matchingProjectPreparationCopies({
        source,
        environmentId: destinationHost,
        projects: [first, second, { ...first, environmentId: sourceHost }],
      }),
    ).toEqual([first, second]);
    expect(
      matchingProjectPreparationCopies({
        source: { ready: false, reason: "Needs review" },
        environmentId: destinationHost,
        projects: [first],
      }),
    ).toEqual([]);
  });
  it("selects an existing physical fork copy using origin instead of parent grouping", () => {
    const existing = project({ repositoryIdentity: fork });
    expect(plan({ projects: [existing] })).toEqual({ kind: "existing", project: existing });
    expect(
      plan({
        projects: [
          project({
            repositoryIdentity: { canonicalKey: fork.canonicalKey, locator: fork.locator },
          }),
        ],
      }),
    ).toMatchObject({ kind: "create" });
  });
  it("requires an explicit choice between multiple matching copies", () => {
    expect(
      plan({
        projects: [
          project({ repositoryIdentity: origin }),
          project({
            id: ProjectId.make("second"),
            workspaceRoot: "/other/fork",
            repositoryIdentity: fork,
          }),
        ],
      }),
    ).toMatchObject({ kind: "blocked", reason: expect.stringContaining("several") });
  });
  it("blocks a destination collision rather than silently suffixing the folder", () => {
    expect(
      plan({ projects: [project({ workspaceRoot: "/home/loom/projects/fork" })] }),
    ).toMatchObject({ kind: "blocked", reason: expect.stringContaining("different folder") });
    expect(
      plan({
        projects: [
          project({ environmentId: sourceHost, workspaceRoot: "/home/loom/projects/fork" }),
        ],
      }),
    ).toMatchObject({ kind: "create" });
  });
  it("handles case-insensitive Windows path collisions", () => {
    expect(
      plan({
        destinationPath: "C:\\Projects\\Fork",
        projects: [project({ workspaceRoot: "c:/projects/fork/" })],
      }),
    ).toMatchObject({ kind: "blocked" });
  });
  it.each([
    "relative/folder",
    "/",
    "C:\\",
    "\\\\server",
    "/safe/../other",
    "/safe/./folder",
    "/safe/folder\n",
  ])("rejects unsafe destination %s", (destinationPath) =>
    expect(plan({ destinationPath })).toMatchObject({ kind: "blocked" }),
  );
  it("requires a destination when the host does not publish its managed projects root", () => {
    expect(plan({ host: { ...host, newProjectsRoot: null } })).toMatchObject({ kind: "blocked" });
    expect(
      plan({ host: { ...host, newProjectsRoot: null }, destinationPath: "/reviewed/folder" }),
    ).toMatchObject({ kind: "create" });
  });
  it("never issues a duplicate clone after a durable project claim or tracked clone", () => {
    expect(plan({ projects: [project({ id: projectId })] })).toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("already created"),
    });
    expect(plan({ clones: [clone("running")] })).toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("already owns"),
    });
  });
  it("proposes portable destinations including Windows roots", () => {
    expect(
      getProjectPreparationDestination({
        newProjectsRoot: "/projects",
        remoteUrl: origin.locator.remoteUrl,
      }),
    ).toBe("/projects/fork");
    expect(
      getProjectPreparationDestination({
        newProjectsRoot: "C:\\Projects",
        remoteUrl: origin.locator.remoteUrl,
      }),
    ).toBe("C:\\Projects\\fork");
  });
});

describe("interrupted preparation recovery", () => {
  const recover = (
    projects: ReadonlyArray<ProjectPreparationProject>,
    clones: ReadonlyArray<ProjectCloneSnapshot>,
    expectedDestinationPath?: string,
  ) =>
    getProjectPreparationRecovery({
      environmentId: destinationHost,
      projectId,
      repositoryKey: "github.com/kyle/fork",
      ...(expectedDestinationPath === undefined ? {} : { expectedDestinationPath }),
      projects,
      clones,
    });
  it.each(["running", "done", "failed", "cancelled"] as const)(
    "uses live tracked clone %s without a second start",
    (phase) => {
      const result = recover([], [clone(phase)]);
      expect(result.state).toBe(
        ({ running: "running", done: "ready", failed: "retry", cancelled: "cancelled" } as const)[
          phase
        ],
      );
      expect(result.canRetryTrackedClone).toBe(phase === "failed" || phase === "cancelled");
    },
  );
  it("recognizes a matched durable project after the clone progress expires", () => {
    expect(recover([project({ id: projectId, repositoryIdentity: fork })], [])).toMatchObject({
      state: "ready",
      canRetryTrackedClone: false,
    });
  });
  it("preserves a project with unknown or unrelated identity after restart for explicit inspection", () => {
    expect(recover([project({ id: projectId })], [])).toMatchObject({
      state: "inspect",
      canRetryTrackedClone: false,
    });
    expect(
      recover(
        [
          project({
            id: projectId,
            repositoryIdentity: { ...origin, canonicalKey: "github.com/unrelated/repo" },
          }),
        ],
        [],
      ),
    ).toMatchObject({ state: "inspect", canRetryTrackedClone: false });
  });
  it("does not reuse a clone completion that names a different repository", () => {
    expect(
      recover([], [{ ...clone("done"), remoteUrl: "https://github.com/unrelated/repo.git" }]),
    ).toMatchObject({ state: "inspect", canRetryTrackedClone: false });
  });
  it.each(["running", "done", "failed", "cancelled"] as const)(
    "requires inspection when the saved actual origin changed despite a %s clone",
    (phase) => {
      expect(
        recover(
          [
            project({
              id: projectId,
              workspaceRoot: clone(phase).destinationPath,
              repositoryIdentity: {
                ...fork,
                canonicalKey: "github.com/kyle/fork",
                origin: { canonicalKey: "github.com/unrelated/repo" },
              },
            }),
          ],
          [clone(phase)],
        ),
      ).toMatchObject({ state: "inspect", canRetryTrackedClone: false });
    },
  );
  it.each(["done", "failed"] as const)(
    "requires inspection when a %s clone moved away from the saved destination",
    (phase) => {
      expect(
        recover(
          [],
          [{ ...clone(phase), destinationPath: "/changed/folder" }],
          clone(phase).destinationPath,
        ),
      ).toMatchObject({ state: "inspect", canRetryTrackedClone: false });
    },
  );
  it.each(["done", "failed"] as const)(
    "requires inspection when the saved project folder changed despite a %s clone",
    (phase) => {
      expect(
        recover(
          [
            project({
              id: projectId,
              workspaceRoot: "/changed/folder",
              repositoryIdentity: origin,
            }),
          ],
          [clone(phase)],
          clone(phase).destinationPath,
        ),
      ).toMatchObject({ state: "inspect", canRetryTrackedClone: false });
    },
  );
  it("requires inspection of a changed saved folder after clone tracking expires", () => {
    expect(
      recover(
        [project({ id: projectId, repositoryIdentity: fork })],
        [],
        clone("done").destinationPath,
      ),
    ).toMatchObject({ state: "inspect", canRetryTrackedClone: false });
  });
  it("preserves callers without a saved destination", () => {
    expect(
      recover([project({ id: projectId, repositoryIdentity: fork })], [clone("failed")]),
    ).toMatchObject({ state: "retry", canRetryTrackedClone: true });
  });
  it("keeps an in-progress clone when the saved project identity is not known yet", () => {
    expect(
      recover(
        [project({ id: projectId, workspaceRoot: clone("running").destinationPath })],
        [clone("running")],
        clone("running").destinationPath,
      ),
    ).toMatchObject({ state: "running", canRetryTrackedClone: false });
  });
  it("matches Windows destinations by normalized folder spelling", () => {
    expect(
      recover(
        [project({ id: projectId, workspaceRoot: "c:/projects/FORK/", repositoryIdentity: fork })],
        [{ ...clone("done"), destinationPath: "C:\\Projects\\fork" }],
        "C:\\projects\\Fork\\",
      ),
    ).toMatchObject({ state: "ready", canRetryTrackedClone: false });
  });
  it("ignores another computer's project with the same id during recovery", () => {
    expect(
      recover(
        [
          project({
            id: projectId,
            environmentId: sourceHost,
            repositoryIdentity: { ...origin, canonicalKey: "github.com/unrelated/repo" },
          }),
        ],
        [clone("done")],
        clone("done").destinationPath,
      ),
    ).toMatchObject({ state: "ready", canRetryTrackedClone: false });
  });
  it("requires a refresh after a lost response with no visible durable record", () => {
    expect(recover([], [])).toMatchObject({
      state: "idle",
      canRetryTrackedClone: false,
      message: expect.stringContaining("Refresh"),
    });
  });
});
