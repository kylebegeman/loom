// @vitest-environment jsdom
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ThreadConversationSettingsSession } from "./threadConversationSettingsRoute";

const state = vi.hoisted(() => ({
  session: null as ThreadConversationSettingsSession | null,
  present: vi.fn((session: ThreadConversationSettingsSession) => {
    state.session = session;
  }),
  clear: vi.fn((ownerId: string) => {
    if (state.session?.ownerId === ownerId) state.session = null;
  }),
  navigation: { dispatch: vi.fn() },
  remember: vi.fn(),
  drafts: {} as Record<string, string>,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => state.navigation,
  StackActions: {
    replace: (route: string, params: unknown) => ({ route, params }),
    push: (route: string) => ({ route }),
  },
}));
vi.mock("./threadConversationSettingsRoute", () => ({
  useThreadConversationSettingsRoute: () => ({
    session: state.session,
    present: state.present,
    clear: state.clear,
  }),
}));
vi.mock("./ThreadConversationDetails", () => ({
  ThreadConversationDetails: () => null,
}));
vi.mock("../../lib/modelOptions", () => ({
  buildModelOptions: (_config: unknown, selection: unknown) => [
    { label: "Model", selection, capabilities: null },
  ],
  groupByProvider: () => [],
}));
vi.mock("../../lib/providerOptions", () => ({ resolveProviderOptionDescriptors: () => [] }));
vi.mock("../../state/use-composer-drafts", () => ({
  useComposerDraft: (key: string | null) => ({ text: key ? (state.drafts[key] ?? "") : "" }),
  getComposerDraftSnapshot: (key: string) => ({ text: state.drafts[key] ?? "" }),
  setComposerDraftText: (key: string, text: string) => {
    state.drafts[key] = text;
  },
}));
vi.mock("../../state/use-model-option-memory", () => ({
  rememberModelOptions: state.remember,
  withRememberedModelOptions: (selection: unknown) => selection,
}));

import { useThreadConversationDetails } from "../../features/threads/useThreadConversationDetails";
type Props = NonNullable<Parameters<typeof useThreadConversationDetails>[0]>;
let root: Root;
let container: HTMLDivElement;
let props: Props;
function Probe() {
  const open = useThreadConversationDetails(props);
  return <button onClick={open}>Details</button>;
}
async function render(overrides: Partial<Props> = {}) {
  props = { ...props, ...overrides };
  await act(() => root.render(<Probe />));
}
async function open() {
  await act(() => container.querySelector("button")!.click());
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.session = null;
  state.present.mockClear();
  state.clear.mockClear();
  state.remember.mockClear();
  state.navigation.dispatch.mockClear();
  state.drafts = {};
  props = {
    thread: {
      environmentId: EnvironmentId.make("computer"),
      projectId: ProjectId.make("project"),
      id: ThreadId.make("thread"),
      modelSelection: { instanceId: ProviderInstanceId.make("provider"), model: "model-1" },
    },
    projectTitle: "Project",
    computerLabel: "Mac",
    connected: true,
    cwd: "/project",
    runtimeMode: "full-access",
    serverConfig: null,
    draftKey: "computer:thread",
    canSwitchProvider: true,
    canOperate: true,
    onUpdateModelSelection: vi.fn(),
    onUpdateRuntimeMode: vi.fn(),
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
});

describe("conversation details settings session", () => {
  it("keeps the open settings session current and applies options through the existing command", async () => {
    await render();
    await open();
    expect(state.navigation.dispatch).toHaveBeenCalledWith({ route: "ThreadConversationSettingsSheet" });
    await render({
      thread: {
        ...props.thread,
        modelSelection: { ...props.thread.modelSelection, model: "model-2" },
      },
    });
    expect(state.session?.selectedModel?.model).toBe("model-2");
    state.session!.onUpdateOptionSelections([{ id: "reasoningEffort", value: "high" }]);
    expect(props.onUpdateModelSelection).toHaveBeenCalledWith({
      ...props.thread.modelSelection,
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    const applied = state.present.mock.calls.length;
    for (let index = 0; index < 5; index++) await render();
    expect(state.present).toHaveBeenCalledTimes(applied);
  });
  it("never applies old conversation controls to another conversation", async () => {
    await render();
    await open();
    const previous = state.session!;
    await render({ thread: { ...props.thread, id: ThreadId.make("another-thread") } });
    previous.onUpdateOptionSelections([{ id: "reasoningEffort", value: "high" }]);
    previous.onUpdateRuntimeMode("approval-required");
    expect(props.onUpdateModelSelection).not.toHaveBeenCalled();
    expect(props.onUpdateRuntimeMode).not.toHaveBeenCalled();
    expect(state.session).toBeNull();
  });
  it("reads and writes prompt-controlled reasoning through the conversation's composer draft", async () => {
    state.drafts["computer:thread"] = "ultrathink about the plan";
    await render();
    await open();
    expect(state.session?.prompt).toBe("ultrathink about the plan");
    state.session!.onPromptChange("Ultrathink:\nPlan it");
    expect(state.drafts["computer:thread"]).toBe("Ultrathink:\nPlan it");
    await render();
    expect(state.session?.prompt).toBe("Ultrathink:\nPlan it");
    const previous = state.session!;
    await render({ thread: { ...props.thread, id: ThreadId.make("another-thread") } });
    previous.onPromptChange("stale");
    expect(state.drafts["computer:thread"]).toBe("Ultrathink:\nPlan it");
  });
  it("stops edits if the computer disconnects while the model page is open", async () => {
    await render();
    await open();
    const previous = state.session!;
    await render({ connected: false });
    previous.onUpdateOptionSelections([{ id: "reasoningEffort", value: "high" }]);
    previous.onUpdateRuntimeMode("approval-required");
    expect(props.onUpdateModelSelection).not.toHaveBeenCalled();
    expect(props.onUpdateRuntimeMode).not.toHaveBeenCalled();
  });
});
