// @vitest-environment jsdom
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryThreadBinding,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  authorityReady: true,
  authorityConnected: true,
  supported: true,
  binding: null as LibraryThreadBinding | null,
  saved: null as LibraryThreadSummary | null,
  copies: [] as readonly LibraryWorkingCopy[],
  error: null as string | null,
  refresh: vi.fn(),
  requests: [] as Array<{ kind: string; environmentId: string; input: Record<string, unknown> }>,
}));
vi.mock("./libraryState", () => {
  const query =
    (kind: string) => (request: { environmentId: string; input: Record<string, unknown> }) => {
      state.requests.push({ kind, ...request });
      return { kind };
    };
  return {
    library: {
      threadBinding: query("binding"),
      lookupThread: query("saved"),
      project: query("project"),
      copies: query("copies"),
    },
    useLibraryAuthority: () => ({
      environmentId: "library",
      supported: true,
      canRead: true,
      ready: state.authorityReady,
      connected: state.authorityConnected,
    }),
    useLoomFeature: () => state.supported,
  };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { kind: string } | null) => ({
    data:
      query?.kind === "binding"
        ? state.binding
        : query?.kind === "saved"
          ? state.saved
          : query?.kind === "copies"
            ? state.copies
            : null,
    error: query?.kind === "copies" ? state.error : null,
    isPending: false,
    isSuccess: true,
    refresh: state.refresh,
  }),
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({
    children,
    title,
    footer,
  }: {
    children: ReactNode;
    title: string;
    footer?: string;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
      <p>{footer}</p>
    </section>
  ),
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/ListRow", () => ({
  ListRow: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("./LibraryFolderStorage", () => ({
  LibraryFolderStorage: () => <span>Existing folder storage controls</span>,
}));
vi.mock("./LibraryManagedFileControls", () => ({
  LibraryManagedFileControls: ({ canAct }: { canAct: boolean }) => (
    <button disabled={!canAct}>Keep files on this computer</button>
  ),
}));

import {
  ThreadConversationDetails,
  type ThreadConversationDetailsProps,
} from "./ThreadConversationDetails";
const environmentId = EnvironmentId.make("computer");
const projectId = ProjectId.make("local");
const threadId = ThreadId.make("current-thread");
const time = "2026-10-21T00:00:00.000Z";
const binding: LibraryThreadBinding = {
  projectId: "project",
  projectRevision: 1,
  environmentId,
  workingCopyId: "copy",
  resourceIds: [],
  continuationOf: {
    environmentId: EnvironmentId.make("original-computer"),
    threadId: ThreadId.make("source-thread"),
    sequence: 4,
  },
};
const saved: LibraryThreadSummary = {
  id: "current-archive",
  projectId: "project",
  environmentId,
  threadId,
  localProjectId: projectId,
  workingCopyId: "copy",
  resourceIds: [],
  title: "Current",
  status: "idle",
  archived: false,
  createdAt: time,
  updatedAt: time,
  syncedAt: time,
  sequence: 2,
};
const copy: LibraryWorkingCopy = {
  id: "copy",
  projectId: "project",
  projectRevision: 1,
  environmentId,
  rootPath: "/project",
  rootLocalProjectId: projectId,
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: time,
  updatedAt: time,
};
let root: Root;
let container: HTMLDivElement;
let props: ThreadConversationDetailsProps;
function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
}
async function render(overrides: Partial<ThreadConversationDetailsProps> = {}) {
  props = { ...props, ...overrides };
  await act(() => root.render(<ThreadConversationDetails {...props} />));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.authorityReady = true;
  state.authorityConnected = true;
  state.supported = true;
  state.binding = binding;
  state.saved = saved;
  state.copies = [copy];
  state.error = null;
  state.requests = [];
  state.refresh.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
  props = {
    thread: { id: threadId, environmentId, projectId },
    projectTitle: "Project",
    computerLabel: "Mac",
    connected: true,
    cwd: "/project",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    modelLabel: "GPT-6",
    optionDescriptors: [],
    runtimeMode: "full-access",
    canEditModel: true,
    onOpenModel: vi.fn(),
    onOpenProject: vi.fn(),
    onContinue: vi.fn(),
  };
});
afterEach(async () => {
  await act(() => root.unmount());
});

describe("conversation details", () => {
  it("opens current settings and explicitly continues the current conversation", async () => {
    await render();
    expect(container.textContent).toContain("reasoningEffort: high");
    await act(() => button("Change model and options")!.click());
    expect(props.onOpenModel).toHaveBeenCalledOnce();
    await act(() => button("Continue on another computer")!.click());
    expect(props.onContinue).toHaveBeenCalledWith("project", "current-archive");
    expect(
      state.requests
        .filter((request) => request.kind === "binding" || request.kind === "saved")
        .every((request) => request.input.threadId === threadId),
    ).toBe(true);
    expect(button("Keep files on this computer")?.disabled).toBe(false);
  });
  it("does not expose file controls for another computer or a worktree with another path", async () => {
    state.copies = [{ ...copy, environmentId: EnvironmentId.make("other") }];
    await render();
    expect(button("Keep files on this computer")).toBeUndefined();
    state.copies = [copy];
    await render({ cwd: "/different-worktree" });
    expect(button("Keep files on this computer")).toBeUndefined();
  });
  it("keeps plain offline conversation context useful without claiming live file state", async () => {
    state.binding = null;
    state.saved = null;
    state.supported = false;
    await render({ connected: false, canEditModel: false });
    expect(container.textContent).toContain("Project");
    expect(container.textContent).toContain("Mac");
    expect(container.textContent).toContain("/project");
    expect(container.textContent).toContain("Offline. Showing saved context.");
    expect(button("Change model and options")?.disabled).toBe(true);
    expect(button("Continue on another computer")).toBeUndefined();
  });
  it("preserves visible errors and retry while disabling file changes", async () => {
    state.error = "Library connection lost";
    await render();
    expect(container.textContent).toContain(state.error);
    expect(button("Keep files on this computer")?.disabled).toBe(true);
    expect(button("Continue on another computer")?.disabled).toBe(true);
    await act(() => button("Retry conversation context")!.click());
    expect(state.refresh).toHaveBeenCalled();
  });
});
