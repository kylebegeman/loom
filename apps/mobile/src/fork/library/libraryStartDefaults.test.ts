import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ServerConfig,
} from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { libraryStartDefaults } from "./libraryStartDefaults";

const dorothy = EnvironmentId.make("dorothy");
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
  hosts: [
    {
      environmentId: dorothy,
      label: "Dorothy",
      online: true,
      supportsExecution: true,
      capabilities: undefined,
    },
  ],
  remembered: [],
  workingThreads: new Map(),
  configs: new Map([[dorothy, config]]),
  localProject: () => null,
  ...overrides,
});

describe("New task Library project defaults", () => {
  it("names the computer, model and permissions a tap starts with, on the files already there", () => {
    expect(libraryStartDefaults(input())).toEqual({
      environmentId: dorothy,
      copyId: "files",
      summary: "Dorothy · GPT 6.0 Astra · Full access",
    });
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
});
