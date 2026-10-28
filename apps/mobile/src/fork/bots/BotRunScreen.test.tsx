// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({
  run: vi.fn(),
  navigate: vi.fn(),
  allowed: true,
  checkoutAvailable: true,
  bot: null as BotDefinition | null,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => harness.allowed }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: harness.navigate }),
}));
vi.mock("./state", () => ({
  bots: { run: { permissionAtom: () => null }, targets: () => null },
  useBotsCapabilities: () => ({ connected: true, supported: true, anywhereSupported: true }),
  useBotsCollection: () => ({
    bots: harness.bot ? [harness.bot] : [],
    query: { error: null, isPending: false },
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.run }));
vi.mock("../../state/entities", () => ({
  useProjects: () => [
    { id: "project-a", title: "Project A", environmentId: "first", isScratch: false },
  ],
  useThreadShells: () =>
    harness.checkoutAvailable
      ? [
          {
            id: "thread-a",
            title: "Feature",
            projectId: "project-a",
            environmentId: "first",
            branch: "feature",
            worktreePath: "/work/feature",
            archivedAt: null,
            updatedAt: "2026-10-22T10:00:00Z",
          },
        ]
      : [],
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      library: "available",
      targets: [
        {
          environmentId: "first",
          label: "First",
          isThisComputer: true,
          ready: true,
          freeSlots: 2,
          reasons: [],
        },
        {
          environmentId: "remote",
          label: "Remote computer",
          isThisComputer: false,
          ready: true,
          freeSlots: 2,
          reasons: [],
        },
      ],
    },
  }),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Switch: ({
    accessibilityLabel,
    value,
    onValueChange,
  }: {
    accessibilityLabel: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
      checked={value}
      onChange={(event) => onValueChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    value,
    accessibilityLabel,
    onChangeText,
    editable,
  }: {
    value: string;
    accessibilityLabel: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    loading,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    loading?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled || loading} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/ListChoiceRow", () => ({
  ListChoiceRow: ({
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
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../library/libraryProjectColors", () => ({
  useLibraryProjectColorValue: () => () => "#000000",
}));
vi.mock("./BotControls", () => ({
  BotPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BotNotice: ({ error, detail }: { error?: string; detail?: string }) => (
    <span>
      {error}
      {detail}
    </span>
  ),
}));

import { BotRunRouteScreen } from "./BotRunScreen";

const bot: BotDefinition = {
  id: "review",
  name: "Review",
  description: "Review a file",
  instructions: "Review {{file}}",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: {
    type: "project",
    projectId: ProjectId.make("project-a"),
    worktree: false,
    checkout: "caller",
  },
  timeoutMinutes: 10,
  maxConcurrentRuns: 2,
  scopeProjectId: null,
  version: 1,
  createdBy: "user",
  createdAt: "2026-10-22T10:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z",
  archivedAt: null,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.bot = bot;
  harness.allowed = true;
  harness.checkoutAvailable = true;
  harness.run.mockReset();
  harness.navigate.mockReset();
  harness.run.mockResolvedValue({ _tag: "Success", value: { id: "run-new" } });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
const render = (environmentId = "first", callerThreadId?: string) =>
  act(() =>
    root.render(
      <BotRunRouteScreen
        route={{
          params: { environmentId, botId: "review", ...(callerThreadId ? { callerThreadId } : {}) },
        }}
      />,
    ),
  );
const button = (label: string) => {
  const result = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(result, label).toBeDefined();
  return result!;
};
const click = (label: string) => act(() => button(label).click());
const enter = (label: string, value: string) =>
  act(() => {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("keeps a run form open on invalid required input and submits the chosen checkout", async () => {
  render();
  click("Run Review");
  await act(async () => {});
  expect(harness.run).not.toHaveBeenCalled();
  expect(container.textContent).toContain("File is required.");
  enter("File", "src/app.ts");
  click("Project root");
  click("feature (Feature)");
  click("Run Review");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("first"),
    input: {
      botId: "review",
      inputs: { file: "src/app.ts" },
      projectId: ProjectId.make("project-a"),
      checkoutThreadId: ThreadId.make("thread-a"),
    },
  });
  expect(harness.navigate).toHaveBeenCalledWith("BotsRunDetail", {
    environmentId: "first",
    runId: "run-new",
  });
});

it("drops the local checkout when sending the run to another computer", async () => {
  render();
  enter("File", "src/app.ts");
  click("Project root");
  click("feature (Feature)");
  click("This computer");
  click("Remote computer");
  expect(container.textContent).not.toContain("feature (Feature)");
  click("Run Review");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: "first",
    input: {
      botId: "review",
      inputs: { file: "src/app.ts" },
      projectId: "project-a",
      target: { type: "environment", environmentId: "remote" },
    },
  });
});

it("requires an explicit replacement when the selected checkout disappears", async () => {
  render();
  enter("File", "src/app.ts");
  click("Project root");
  click("feature (Feature)");
  harness.checkoutAvailable = false;
  render();
  expect(container.textContent).toContain("Project: Project A");
  expect(container.textContent).toContain("Choose another checkout or Project root");
  expect(button("Run Review").disabled).toBe(true);
  click("Run Review");
  await act(async () => {});
  expect(harness.run).not.toHaveBeenCalled();
  click("Choose…");
  click("Project root");
  expect(button("Run Review").disabled).toBe(false);
  click("Run Review");
  await act(async () => {});
  expect(harness.run.mock.calls[0]?.[0].input).toEqual({
    botId: "review",
    inputs: { file: "src/app.ts" },
    projectId: "project-a",
  });
});

it("resets a draft when its environment changes and respects run permission", () => {
  render();
  enter("File", "private-first-path");
  render("second");
  expect(container.querySelector<HTMLInputElement>('[aria-label="File"]')?.value).toBe("");
  harness.allowed = false;
  render("second");
  expect(button("Run Review").disabled).toBe(true);
});

it("runs from a thread's project and checkout and can post the result back", async () => {
  render("first", "caller-a");
  enter("File", "src/app.ts");
  act(() =>
    container
      .querySelector<HTMLInputElement>('[aria-label="Post the result to this thread"]')!
      .click(),
  );
  expect(container.textContent).not.toContain("Project root");
  click("Run Review");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: "first",
    input: {
      botId: "review",
      inputs: { file: "src/app.ts" },
      callerThreadId: "caller-a",
      notify: true,
    },
  });
  render("first", "caller-b");
  expect(container.querySelector<HTMLInputElement>('[aria-label="File"]')?.value).toBe("");
});

it("does not navigate a departed form when its run starts after an environment switch", async () => {
  let finish: (value: unknown) => void = () => {};
  harness.run.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render();
  enter("File", "src/app.ts");
  click("Run Review");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledTimes(1);
  render("second");
  await act(async () => {
    finish({ _tag: "Success", value: { id: "old-run" } });
  });
  expect(harness.navigate).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>('[aria-label="File"]')?.value).toBe("");
});
