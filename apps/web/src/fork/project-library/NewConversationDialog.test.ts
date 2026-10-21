import { describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";

vi.mock("./state", () => ({}));
vi.mock("~/state/server", () => ({}));
vi.mock("~/state/entities", () => ({}));
vi.mock("~/state/threads", () => ({}));
vi.mock("~/state/vcs", () => ({}));
vi.mock("~/state/environments", () => ({}));
vi.mock("~/state/query", () => ({}));
vi.mock("~/state/use-orchestration-command", () => ({}));
vi.mock("~/state/use-atom-command", () => ({}));
vi.mock("~/state/use-atom-query-runner", () => ({}));
vi.mock("~/rpc/atomRegistry", () => ({}));
vi.mock("~/hooks/useSettings", () => ({}));
vi.mock("~/composerDraftStore", () => ({}));
vi.mock("~/components/chat/ProviderModelPicker", () => ({}));
vi.mock("~/components/chat/TraitsPicker", () => ({}));
vi.mock("~/modelSelection", () => ({}));
vi.mock("./ProfileReadiness", () => ({}));
vi.mock("./ReleaseCopyDialog", () => ({}));
vi.mock("./useLibraryLaunchRanking", () => ({}));
import { libraryConversationDefaults, reopenLibraryLaunchCopy } from "./NewConversationDialog";

const instanceId = ProviderInstanceId.make("codex");
const selection = (model: string): ModelSelection => ({ instanceId, model });
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-15T12:00:00.000Z",
  models: [
    {
      slug: "computer-model",
      name: "Computer model",
      capabilities: {},
      isCustom: false,
      isDefault: true,
    },
  ],
  slashCommands: [],
  skills: [],
};
const project: LibraryProject = {
  id: "library-project",
  title: "Project",
  revision: 1,
  brief: "",
  resources: [],
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const localProject = {
  id: ProjectId.make("local-project"),
  defaultModelSelection: selection("legacy-project-model"),
};
const settings = { ...DEFAULT_SERVER_SETTINGS, defaultModelSelection: selection("computer-model") };
const defaults = (overrides: Partial<Parameters<typeof libraryConversationDefaults>[0]> = {}) =>
  libraryConversationDefaults({
    settings,
    localProject: null,
    project,
    providers: [provider],
    ...overrides,
  });

describe("Library conversation defaults", () => {
  it("uses the shared project profile before the computer default", () => {
    const chosen = selection("profile-model");
    expect(
      defaults({ project: { ...project, profile: { defaultModelSelection: chosen } } })
        .modelSelection,
    ).toEqual(chosen);
  });
  it("resolves the actual local project's overrides before the shared profile and computer", () => {
    const chosen = {
      ...selection("local-model"),
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const resolved = defaults({
      localProject,
      project: {
        ...project,
        profile: { defaultModelSelection: selection("profile-model") },
      },
      settings: {
        ...settings,
        projectSettingsOverrides: {
          [localProject.id]: { defaultModelSelection: chosen, defaultRuntimeMode: "full-access" },
        },
      },
    });
    expect(resolved.modelSelection).toEqual(chosen);
    expect(resolved.runtimeMode).toBe("full-access");
  });
  it("preserves legacy local defaults while respecting the settings fold", () => {
    expect(
      defaults({ localProject, settings: { ...settings, projectSettingsFolded: false } })
        .modelSelection,
    ).toEqual(localProject.defaultModelSelection);
    expect(
      defaults({ localProject, settings: { ...settings, projectSettingsFolded: true } })
        .modelSelection,
    ).toEqual(settings.defaultModelSelection);
  });
  it("honors a cleared local default instead of restoring the shared model", () => {
    expect(
      defaults({
        localProject,
        project: { ...project, profile: { defaultModelSelection: selection("profile-model") } },
        settings: {
          ...settings,
          projectSettingsOverrides: { [localProject.id]: { defaultModelSelection: null } },
        },
      }).modelSelection,
    ).toEqual(selection("computer-model"));
  });
  it("keeps a model the user deliberately chooses for this launch", () => {
    const chosen = {
      ...selection("picked-model"),
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const resolved = defaults({
      localProject,
      selection: chosen,
      runtimeMode: "approval-required",
      project: { ...project, profile: { defaultModelSelection: selection("profile-model") } },
      settings: {
        ...settings,
        projectSettingsOverrides: {
          [localProject.id]: {
            defaultModelSelection: selection("local-model"),
            defaultRuntimeMode: "full-access",
          },
        },
      },
    });
    expect(resolved.modelSelection).toEqual(chosen);
    expect(resolved.runtimeMode).toBe("approval-required");
  });
  it("uses the provider default when no launch, project, Library or computer model is set", () => {
    expect(
      defaults({ settings: { ...settings, defaultModelSelection: null } }).modelSelection,
    ).toEqual(selection("computer-model"));
  });
  it("falls back when the Library preference uses an unavailable provider", () => {
    expect(
      defaults({
        project: {
          ...project,
          profile: {
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("unavailable"),
              model: "profile-model",
            },
          },
        },
      }).modelSelection,
    ).toEqual(selection("computer-model"));
  });
  it("applies local provider enablement before resolving a default", () => {
    const disabled = {
      ...settings,
      projectSettingsOverrides: {
        [localProject.id]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    expect(defaults({ localProject, settings: disabled }).modelSelection).toBeNull();
  });
});

const archivedCopy: LibraryWorkingCopy = {
  id: "archived-files",
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("host"),
  rootPath: "/projects/retained",
  repositories: [],
  ownership: "managed",
  state: "released",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const restoredCopy = { ...archivedCopy, state: "ready" as const, keepOnComputer: true };
const reopenAttempt = {
  environmentId: archivedCopy.environmentId,
  input: { requestId: "stable-reopen", workingCopyId: archivedCopy.id },
  project,
  resourceIds: [],
  rootPath: archivedCopy.rootPath,
  registerRequestId: "stable-authority-registration",
  copy: null,
};

describe("restoring launch files", () => {
  it("registers the restored same-ID copy with the authority after saving its receipt", async () => {
    const order: string[] = [];
    const reopen = vi.fn(async () => {
      order.push("reopen");
      return restoredCopy;
    });
    const save = vi.fn(() => {
      order.push("save");
    });
    const register = vi.fn(async () => {
      order.push("register");
      return restoredCopy;
    });
    expect(await reopenLibraryLaunchCopy(reopenAttempt, { reopen, register, save })).toEqual(
      restoredCopy,
    );
    expect(order).toEqual(["reopen", "save", "register"]);
    expect(reopen).toHaveBeenCalledWith({
      environmentId: archivedCopy.environmentId,
      input: reopenAttempt.input,
    });
    expect(register).toHaveBeenCalledWith({
      requestId: reopenAttempt.registerRequestId,
      copy: restoredCopy,
    });
  });
  it("retries a lost reopen response with the exact original request instead of preparing new files", async () => {
    const reopen = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue(restoredCopy);
    const register = vi.fn(async () => restoredCopy);
    const save = vi.fn();
    await expect(
      reopenLibraryLaunchCopy(reopenAttempt, { reopen, register, save }),
    ).rejects.toThrow("connection lost");
    expect(register).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await expect(
      reopenLibraryLaunchCopy(reopenAttempt, { reopen, register, save }),
    ).resolves.toEqual(restoredCopy);
    expect(reopen.mock.calls[0]).toEqual(reopen.mock.calls[1]);
  });
  it("retries authority registration without restoring files again or changing registration identity", async () => {
    let saved: Parameters<typeof reopenLibraryLaunchCopy>[0] = reopenAttempt;
    const save = vi.fn((next: typeof saved) => {
      saved = next;
    });
    const reopen = vi.fn(async () => restoredCopy);
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error("authority offline"))
      .mockResolvedValue(restoredCopy);
    await expect(reopenLibraryLaunchCopy(saved, { reopen, register, save })).rejects.toThrow(
      "authority offline",
    );
    expect(saved.copy).toEqual(restoredCopy);
    await expect(reopenLibraryLaunchCopy(saved, { reopen, register, save })).resolves.toEqual(
      restoredCopy,
    );
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]).toEqual(register.mock.calls[1]);
  });
  it("refuses an unrelated or unready restoration before registering it", async () => {
    for (const copy of [
      archivedCopy,
      { ...restoredCopy, id: "new-copy" },
      { ...restoredCopy, rootPath: "/elsewhere" },
      { ...restoredCopy, environmentId: EnvironmentId.make("other") },
    ]) {
      const register = vi.fn(async () => restoredCopy);
      const save = vi.fn();
      await expect(
        reopenLibraryLaunchCopy(reopenAttempt, { reopen: async () => copy, register, save }),
      ).rejects.toThrow("restored files");
      expect(register).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    }
  });
});
