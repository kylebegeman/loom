import { libraryLaunchInputs, libraryQuickLaunch } from "@t3tools/client-runtime/fork";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerConfig,
} from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { libraryStartDefaults } from "./libraryStartDefaults";

const dorothy = EnvironmentId.make("dorothy");
const mini = EnvironmentId.make("mini");
const instanceId = ProviderInstanceId.make("codex");
const config = {
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    defaultModelSelection: { instanceId, model: "astra" },
    defaultRuntimeMode: "full-access",
  },
  providers: [
    {
      instanceId,
      driver: "codex",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [{ slug: "astra", name: "GPT 6.0 Astra", isDefault: true, capabilities: null }],
    },
  ],
} as unknown as ServerConfig;
const project: LibraryProject = {
  id: "project",
  title: "Loom",
  brief: "",
  revision: 1,
  archived: false,
  resources: [
    {
      id: "app",
      title: "app",
      relativePath: "app",
      kind: "repository",
      remoteUrl: "https://github.com/team/app",
      defaultBranch: null,
    },
  ],
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const copy = (id: string, environmentId = dorothy): LibraryWorkingCopy => ({
  id,
  projectId: project.id,
  projectRevision: 1,
  environmentId,
  rootPath: `/Projects/${id}`,
  ownership: "managed",
  state: "ready",
  repositories: [
    {
      resourceId: "app",
      path: `/Projects/${id}/app`,
      localProjectId: ProjectId.make(`${id}-local`),
      head: null,
      branch: null,
    },
  ],
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
const input = (overrides: Partial<Parameters<typeof libraryStartDefaults>[0]> = {}) => ({
  project,
  copies: [copy("files")],
  threads: [],
  hosts: [dorothy, mini].map((environmentId) => ({
    environmentId,
    label: environmentId === dorothy ? "Dorothy" : "Mini",
    online: true,
    supportsExecution: true,
    capabilities: undefined,
  })),
  remembered: [],
  operable: new Set([dorothy, mini]),
  terminal: new Set([dorothy, mini]),
  libraryOperable: true,
  configs: new Map([
    [dorothy, config],
    [mini, config],
  ]),
  localProject: () => null,
  ...overrides,
});
/** The computer web's project list promises for the same inputs. */
const webPromise = (value: ReturnType<typeof input>) =>
  libraryQuickLaunch({
    project: value.project,
    copies: value.copies,
    computers: libraryLaunchInputs({
      project: value.project,
      copies: [],
      hosts: value.hosts,
      remembered: value.remembered,
      workingThreads: new Map(),
    }).computers,
    threads: value.threads,
  });
const usedOn = (environmentId: EnvironmentId): LibraryThreadSummary => ({
  id: "recent",
  projectId: project.id,
  environmentId,
  threadId: ThreadId.make("recent"),
  localProjectId: ProjectId.make("recent-local"),
  workingCopyId: null,
  resourceIds: ["app"],
  title: "Recent work",
  status: "idle",
  archived: false,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
  syncedAt: "2026-10-22T00:00:00Z",
  sequence: 1,
});

describe("New task Library project defaults", () => {
  it("names the computer, model and permissions a tap starts with, on the files already there", () => {
    expect(libraryStartDefaults(input())).toEqual({
      environmentId: dorothy,
      copyId: "files",
      summary: "Dorothy · GPT 6.0 Astra · Full access",
    });
  });

  it("promises the computer and files web promises for the same project", () => {
    const value = input({
      copies: [copy("dorothy-files"), copy("mini-files", mini)],
      threads: [usedOn(mini)],
    });
    expect(webPromise(value)?.copy.id).toBe("mini-files");
    expect(libraryStartDefaults(value)).toMatchObject({
      environmentId: mini,
      copyId: "mini-files",
    });
  });

  it("names no other computer where web's choice cannot start from this device", () => {
    // A folder you added that still holds a repository the project no longer lists.
    const folder: LibraryWorkingCopy = {
      ...copy("folder", mini),
      ownership: "borrowed",
      repositories: [
        ...copy("folder", mini).repositories,
        {
          resourceId: "removed",
          path: "/Projects/folder/removed",
          localProjectId: ProjectId.make("removed-local"),
          head: null,
          branch: null,
        },
      ],
    };
    const value = input({ copies: [copy("files"), folder], threads: [usedOn(mini)] });
    expect(webPromise(value)?.copy.id).toBe("folder");
    expect(libraryStartDefaults(value)).toBeNull();
    const elsewhere = input({ copies: [copy("files"), copy("mini-files", mini)] });
    expect(webPromise(elsewhere)?.environmentId).toBe(dorothy);
    expect(libraryStartDefaults({ ...elsewhere, operable: new Set([mini]) })).toBeNull();
  });

  it("promises no start the start screen would refuse for a missing grant", () => {
    expect(libraryStartDefaults(input({ libraryOperable: false }))).toBeNull();
    const workflows = input().hosts.map((host) => ({
      ...host,
      capabilities: {
        repositoryIdentity: false,
        loomFeatures: ["project-library", "project-workflows"],
      },
    }));
    expect(libraryStartDefaults(input({ hosts: workflows, terminal: new Set() }))).toBeNull();
    expect(libraryStartDefaults(input({ hosts: workflows }))).not.toBeNull();
    const borrowed = { ...copy("files"), ownership: "borrowed" as const };
    expect(libraryStartDefaults(input({ copies: [borrowed], terminal: new Set() }))).toBeNull();
    expect(libraryStartDefaults(input({ terminal: new Set() }))).not.toBeNull();
  });

  it("says a tap starts in a new worktree while another conversation works in the files", () => {
    const worktrees = input().hosts.map((host) => ({
      ...host,
      capabilities: {
        repositoryIdentity: false,
        loomFeatures: ["project-library", "library-worktree-starts"],
      },
    }));
    const working = {
      environmentId: dorothy,
      worktreePath: "/Projects/files/app",
      archivedAt: null,
      runtime: {
        status: "running" as const,
        activeRunId: null,
        providerInstanceId: instanceId,
        providerName: null,
        lastError: null,
        updatedAt: project.updatedAt,
      },
    };
    expect(libraryStartDefaults(input({ hosts: worktrees, shells: [working] }))?.summary).toBe(
      "Dorothy · GPT 6.0 Astra · Full access · New worktree",
    );
    expect(libraryStartDefaults(input({ hosts: worktrees }))?.summary).toBe(
      "Dorothy · GPT 6.0 Astra · Full access",
    );
    // A computer that cannot start one keeps the shared folder, and the row says nothing more.
    expect(libraryStartDefaults(input({ shells: [working] }))?.summary).toBe(
      "Dorothy · GPT 6.0 Astra · Full access",
    );
  });

  it("leaves the start to the settings screen when it needs a decision first", () => {
    const offline = input().hosts.map((host) => ({ ...host, online: false }));
    expect(libraryStartDefaults(input({ hosts: offline }))).toBeNull();
    expect(libraryStartDefaults(input({ copies: [] }))).toBeNull();
    expect(libraryStartDefaults(input({ copies: [copy("one"), copy("two")] }))).toBeNull();
    expect(libraryStartDefaults(input({ configs: new Map() }))).toBeNull();
    expect(
      libraryStartDefaults(
        input({ project: { ...project, profile: { requiredTools: [{ id: "node" }] } } }),
      ),
    ).toBeNull();
  });
  it("can start from registered files during a Library outage using a durable host operation", () => {
    const hosts = input().hosts.map((host) => ({
      ...host,
      capabilities: {
        repositoryIdentity: false,
        loomFeatures: ["project-library", "project-workflows"],
      },
    }));
    const offline = input({ hosts, offline: true, libraryOperable: false });
    expect(libraryStartDefaults(offline)).toMatchObject({
      environmentId: dorothy,
      copyId: "files",
    });
    expect(
      libraryStartDefaults({ ...offline, copies: [{ ...copy("files"), ownership: "borrowed" }] }),
    ).not.toBeNull();
    expect(libraryStartDefaults({ ...offline, terminal: new Set() })).toBeNull();
    expect(libraryStartDefaults({ ...offline, hosts: input().hosts })).toBeNull();
    expect(libraryStartDefaults({ ...offline, copies: [] })).toBeNull();
    expect(
      libraryStartDefaults({ ...offline, copies: [{ ...copy("files"), registered: false }] }),
    ).toBeNull();
    expect(
      libraryStartDefaults({ ...offline, copies: [{ ...copy("files"), state: "released" }] }),
    ).toBeNull();
  });
});
