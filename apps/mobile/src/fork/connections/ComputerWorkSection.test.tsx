// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  projects: [] as { environmentId: string; id: string; title: string; workspaceRoot: string }[],
  scratchRoot: null as string | null,
  canOperate: true,
  navigate: vi.fn(),
  openScratch: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    providers: [],
    scratchWorkspaceRoot: harness.scratchRoot,
    environment: { capabilities: {} },
  }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: harness.navigate }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => harness.projects,
  useNavigationThreadShells: () => [],
}));
vi.mock("../../state/projects", () => ({ projectEnvironment: { openScratch: "scratch" } }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    configValueAtom: () => "config",
    refreshProviders: { permissionAtom: () => "permission" },
  },
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => harness.canOperate }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => harness.openScratch,
}));
vi.mock("./presentation", () => ({
  readyAgentCount: () => 1,
  recentConversationForComputer: () => null,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("../../features/settings/components/SettingsActionRow", () => ({
  SettingsActionRow: ({
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

import { ComputerWorkSection } from "./ComputerWorkSection";

const environmentId = EnvironmentId.make("computer");
let root: Root;
let container: HTMLDivElement;

function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!result) throw new Error(`Missing action: ${label}`);
  return result;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  harness.projects = [];
  harness.scratchRoot = null;
  harness.canOperate = true;
  harness.navigate.mockReset();
  harness.openScratch.mockReset();
});

afterEach(() => act(() => root.unmount()));

describe("starting work from computer details", () => {
  it("goes directly to adding a project when there is no available workspace", () => {
    act(() => root.render(<ComputerWorkSection environmentId={environmentId} connected />));
    act(() => button("New conversation").click());

    expect(harness.navigate).toHaveBeenCalledWith("NewTaskSheet", {
      screen: "AddProject",
      params: { environmentId },
    });
    expect(container.textContent).not.toContain("Add a project to start a conversation");
  });

  it("uses the sole project directly when starting without a project is unavailable", () => {
    harness.projects = [
      { environmentId, id: "project", title: "My project", workspaceRoot: "/code/project" },
      { environmentId: "other-computer", id: "other", title: "Other", workspaceRoot: "/other" },
    ];
    act(() => root.render(<ComputerWorkSection environmentId={environmentId} connected />));
    act(() => button("New conversation").click());

    expect(harness.navigate).toHaveBeenCalledWith("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: { environmentId, projectId: "project", title: "My project" },
    });
  });

  it("keeps workspace choices when both a project and scratch workspace are available", () => {
    harness.projects = [
      { environmentId, id: "project", title: "My project", workspaceRoot: "/code/project" },
    ];
    harness.scratchRoot = "/scratch";
    act(() => root.render(<ComputerWorkSection environmentId={environmentId} connected />));
    act(() => button("New conversation").click());

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(button("Start without a project").disabled).toBe(false);
    act(() => button("My project").click());
    expect(harness.navigate).toHaveBeenCalledWith("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: { environmentId, projectId: "project", title: "My project" },
    });
  });

  it("reports a scratch workspace failure and lets the user try again", async () => {
    harness.scratchRoot = "/scratch";
    harness.openScratch.mockRejectedValueOnce(new Error("The folder is not writable."));
    act(() => root.render(<ComputerWorkSection environmentId={environmentId} connected />));
    await act(async () => button("New conversation").click());
    expect(container.textContent).toContain("The folder is not writable.");
    expect(button("New conversation").disabled).toBe(false);
    expect(harness.navigate).not.toHaveBeenCalled();

    harness.openScratch.mockResolvedValueOnce(
      AsyncResult.success({ id: "scratch", title: "Quick conversation" }),
    );
    await act(async () => button("New conversation").click());
    expect(harness.navigate).toHaveBeenCalledWith("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: { environmentId, projectId: "scratch", title: "Quick conversation" },
    });
  });
});
