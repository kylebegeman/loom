// @vitest-environment jsdom
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ServerConfig,
} from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  project: null as LibraryProject | null,
  computer: null as {
    environmentId: EnvironmentId;
    label: string;
    entry: { enabled: boolean };
    connection: { phase: string };
    serverConfig: ServerConfig;
  } | null,
  online: true,
  outcome: vi.fn(),
  prepare: Object.assign(vi.fn(), { permissionAtom: () => true }),
  register: Object.assign(vi.fn(), { permissionAtom: () => true }),
  dispatch: vi.fn(),
  navigate: vi.fn(),
  preferenceAtom: {},
  preferences: {} as Record<string, string>,
  savePreferences: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === state.preferenceAtom
      ? AsyncResult.success({ loomLibraryLaunches: state.preferences })
      : atom,
  useAtomSet: () => state.savePreferences,
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: state.preferenceAtom,
  updateMobilePreferencesAtom: {},
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ dispatch: state.dispatch, navigate: state.navigate }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));
vi.mock("./libraryState", () => ({
  useLibraryAuthority: () => ({ environmentId: "library", ready: state.online }),
  refreshLibraryWork: vi.fn(),
  library: {
    project: () => "project",
    copies: () => "copies",
    placement: { resultAtom: () => "placement" },
    operationOutcome: state.outcome,
    prepareCopy: state.prepare,
    registerCopy: state.register,
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data: atom === "project" ? state.project : null,
    error: null,
    isSuccess: true,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => async () => AsyncResult.success([]),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: state.computer ? [state.computer] : [] }),
}));
vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => null,
  readEnvironmentSessionState: () => null,
  useEnvironmentsWithScope: () => new Set([state.computer?.environmentId]),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "original-request" }));
vi.mock("./LibraryFolderPicker", () => ({ LibraryFolderPicker: () => null }));
vi.mock("./LibraryPage", () => ({
  LibraryPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  LibraryNotice: ({ error, detail }: { error?: string | null; detail?: string | null }) => (
    <div>{error ?? detail}</div>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    editable,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
    editable: boolean;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onInput={(e) => onChangeText(e.currentTarget.value)}
      onChange={() => undefined}
    />
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
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

import { LibraryPrepareRouteScreen } from "./LibraryPrepareScreen";

function setup() {
  vi.clearAllMocks();
  state.outcome.mockReset().mockRejectedValue(new Error("Could not check the saved result"));
  state.preferences = {};
  state.online = true;
  state.project = {
    id: "project",
    title: "Rocket",
    brief: "",
    revision: 1,
    archived: false,
    resources: [
      {
        id: "repo",
        title: "Rocket",
        kind: "repository",
        relativePath: ".",
        remoteUrl: "https://github.com/acme/rocket",
        defaultBranch: null,
      },
    ],
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
  };
  state.computer = {
    environmentId: EnvironmentId.make("computer"),
    label: "Computer",
    entry: { enabled: true },
    connection: { phase: "connected" },
    serverConfig: {
      environment: {
        environmentId: EnvironmentId.make("computer"),
        capabilities: { supportsExecution: true, loomFeatures: ["project-library"] },
      },
      settings: DEFAULT_SERVER_SETTINGS,
      newProjectsRoot: "/Projects",
    } as unknown as ServerConfig,
  };
  state.savePreferences.mockImplementation(
    async ({
      transform,
    }: {
      transform: (current: { loomLibraryLaunches: Record<string, string> }) => {
        loomLibraryLaunches: Record<string, string>;
      };
    }) => {
      state.preferences = transform({ loomLibraryLaunches: state.preferences }).loomLibraryLaunches;
    },
  );
  const copy: LibraryWorkingCopy = {
    id: "files",
    projectId: "project",
    projectRevision: 1,
    environmentId: state.computer.environmentId,
    rootPath: "/Projects/rocket",
    ownership: "managed",
    state: "ready",
    repositories: [
      {
        resourceId: "repo",
        path: "/Projects/rocket",
        localProjectId: ProjectId.make("local"),
        branch: null,
        head: null,
      },
    ],
    createdAt: state.project.createdAt,
    updatedAt: state.project.updatedAt,
  };
  state.prepare.mockResolvedValue(AsyncResult.success(copy));
  state.register.mockResolvedValue(AsyncResult.success(copy));
  return copy;
}
function allowReactUpdates() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return { [Symbol.dispose]: () => vi.unstubAllGlobals() };
}
async function render() {
  const container = document.createElement("div");
  const root = createRoot(container);
  async function rerender() {
    await act(async () =>
      root.render(
        <LibraryPrepareRouteScreen
          route={{
            params: { projectId: "project", authorityEnvironmentId: EnvironmentId.make("library") },
          }}
        />,
      ),
    );
  }
  await rerender();
  return {
    container,
    rerender,
    click: async (label: string) => {
      const button = [...container.querySelectorAll("button")].find(
        (node) => node.textContent === label,
      );
      expect(button).toBeDefined();
      await act(async () => {
        button!.click();
      });
    },
    [Symbol.asyncDispose]: async () => {
      await act(async () => root.unmount());
    },
  };
}

it("prepares and registers files on the reviewed computer without starting a conversation", async () => {
  using _act = allowReactUpdates();
  const copy = setup();
  await using screen = await render();
  expect(state.prepare).not.toHaveBeenCalled();
  await screen.click("Computer");
  await screen.click("Prepare files");
  expect(state.prepare).toHaveBeenCalledExactlyOnceWith({
    environmentId: "computer",
    input: {
      requestId: "original-request",
      project: state.project,
      rootPath: "/Projects/rocket",
      strategy: "clone",
    },
  });
  expect(state.register).toHaveBeenCalledExactlyOnceWith({
    environmentId: "library",
    input: { requestId: "original-request:copy", copy },
  });
  expect(screen.container.textContent).toContain("No conversation has been started");
  expect(state.dispatch).not.toHaveBeenCalled();
  expect(state.navigate).not.toHaveBeenCalled();
  await screen.click("New conversation");
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith("LibraryStart", {
    projectId: "project",
    reuseEnvironmentId: "computer",
    initialCopyId: "files",
    startNow: true,
  });
});

it("preserves the selected computer and destination after a lost reply and refreshes access without replay", async () => {
  using _act = allowReactUpdates();
  const copy = setup();
  state.prepare.mockRejectedValueOnce(new Error("Lost reply"));
  {
    await using screen = await render();
    await screen.click("Computer");
    await screen.click("Prepare files");
    expect(state.prepare).toHaveBeenCalledTimes(1);
  }
  state.online = false;
  await using recovered = await render();
  state.online = true;
  await recovered.rerender();
  expect(state.prepare).toHaveBeenCalledTimes(1);
  expect(recovered.container.querySelector<HTMLInputElement>("input")?.value).toBe(
    "/Projects/rocket",
  );
  await recovered.click("Check preparation result");
  expect(state.prepare).toHaveBeenCalledTimes(1);
  expect(state.register).not.toHaveBeenCalled();
  expect(recovered.container.textContent).toContain("saved result");
  state.outcome.mockResolvedValueOnce(
    AsyncResult.success({
      kind: "prepare",
      environmentId: "computer",
      state: "succeeded",
      result: copy,
    }),
  );
  await recovered.click("Check preparation result");
  expect(state.outcome).toHaveBeenLastCalledWith({
    environmentId: "computer",
    input: { requestId: "original-request", kind: "prepare" },
  });
  expect(state.prepare).toHaveBeenCalledTimes(1);
  expect(state.register).not.toHaveBeenCalled();
  await recovered.click("Save file location");
  expect(state.register).toHaveBeenCalledTimes(1);
  expect(recovered.container.textContent).toContain("No conversation has been started");
});
