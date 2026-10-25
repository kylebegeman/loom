import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";

vi.mock("./LibraryModelPalette", () => ({}));
vi.mock("./LibraryTextPalette", () => ({}));
vi.mock("./LibraryPalette", () => ({}));
vi.mock("./ProfileReadiness", () => ({}));
vi.mock("./LibraryFolderPalette", () => ({}));
vi.mock("./NewConversationDialog", () => ({}));
import { conversationAutoStart } from "./ConversationPalette";

const dorothy = EnvironmentId.make("dorothy");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId: dorothy,
  rootPath: "/work/app",
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const launch = {
  environmentId: dorothy,
  workingCopyId: copy.id,
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "full-access" as const,
};
const ready: Parameters<typeof conversationAutoStart>[0] = {
  busy: false,
  checking: false,
  locked: false,
  error: null,
  existingFolder: null,
  hostId: dorothy,
  canCreate: true,
  blocker: null,
  warning: null,
  copy,
  scope: [],
  needsReopen: false,
  needsPortable: false,
  interactionMode: "default",
  runtimeMode: "full-access",
  modelSelection: launch.modelSelection,
};

describe("starting from the project list", () => {
  it("starts only when every setting matches what the row promised", () => {
    expect(conversationAutoStart(ready, launch)).toBe("start");
    for (const changed of [
      { hostId: EnvironmentId.make("book") },
      { copy: { ...copy, id: "other-files" } },
      { scope: ["api"] },
      { runtimeMode: "approval-required" as const },
      { modelSelection: { ...launch.modelSelection, model: "gpt-5" } },
      { modelSelection: { ...launch.modelSelection, options: [] } },
      { interactionMode: "plan" as const },
      // The row promised ready files, so files that need restoring are a change worth seeing.
      { copy: { ...copy, state: "preparing" as const } },
      { copy: null },
      { needsReopen: true },
      { needsPortable: true },
    ])
      expect(conversationAutoStart({ ...ready, ...changed }, launch)).toBe("changed");
  });

  it("leaves the settings to explain anything they already show", () => {
    for (const shown of [
      { canCreate: false },
      { blocker: "Update this computer." },
      { warning: { message: "These files are 3 commits behind.", pullPaths: null } },
      { locked: true },
      { error: "Could not start." },
      { existingFolder: "/work/other" },
    ])
      expect(conversationAutoStart({ ...ready, ...shown, hostId: null }, launch)).toBe("settings");
  });

  it("waits while files are checked, but never for a held attempt", () => {
    expect(conversationAutoStart({ ...ready, checking: true }, launch)).toBe("wait");
    expect(conversationAutoStart({ ...ready, busy: true }, launch)).toBe("wait");
    expect(conversationAutoStart({ ...ready, checking: true, locked: true }, launch)).toBe(
      "settings",
    );
    expect(conversationAutoStart({ ...ready, checking: true, error: "Failed." }, launch)).toBe(
      "settings",
    );
  });
});
