// @vitest-environment jsdom
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  start: vi.fn(),
  inspect: vi.fn(),
  create: vi.fn(),
  review: vi.fn(),
  save: vi.fn(),
  navigate: vi.fn(),
  pickedFolder: "/Users/kyle/Code/corbelo",
}));
const computer = (environmentId: string, label: string) => ({
  environmentId,
  label,
  entry: { enabled: true },
  connection: { phase: "connected" },
});
vi.mock("@t3tools/client-runtime/fork", async (original) => ({
  ...(await original<object>()),
  createProjectCheckoutAtoms: () => ({ preview: {} }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate, goBack: vi.fn() }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../../components/ui/AppBar", () => ({ AppBar: () => null }));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock("../../components/ui/ListChoiceRow", () => ({
  ListChoiceRow: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button aria-label={label} onClick={onPress}>
      {label}
    </button>
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
    <button aria-label={label} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../library/LibraryFolderPicker", () => ({
  LibraryFolderPicker: (props: { onChoose: (path: string) => void }) => (
    <button aria-label="Pick folder" onClick={() => props.onChoose(state.pickedFolder)}>
      Pick folder
    </button>
  ),
}));
vi.mock("./useProjectPreparationReceipt", () => ({
  useProjectPreparationReceipt: () => ({
    receipt: null,
    loaded: true,
    invalid: false,
    save: state.save,
    settle: async () => undefined,
  }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "new-project" }));
vi.mock("../../state/entities", () => ({
  useProject: () => ({ environmentId: "dorothy", id: "corbelo", title: "corbelo" }),
  useProjects: () => [],
  useServerConfigs: () =>
    new Map([
      [
        "dorothy",
        { environment: { capabilities: { loomFeatures: ["project-checkout-management"] } } },
      ],
      [
        "mini",
        {
          serverChosenFolders: true,
          newProjectsRoot: "/Users/kyle/Projects",
          environment: { capabilities: { projectCloneTracking: true } },
        },
      ],
    ]),
  waitForProject: async () => ({ id: "new-project" }),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [computer("dorothy", "Dorothy"), computer("mini", "Mini")],
  }),
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: { get: () => computer("any", "Any") },
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationAtom: (id: string) => id },
}));
vi.mock("../../state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(["dorothy", "mini"]),
}));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: { startProjectClone: "startProjectClone" },
}));
vi.mock("../library/libraryState", () => ({ library: { inspectFolder: "inspectFolder" } }));
vi.mock("../library/workspacePageBack", () => ({ useWorkspacePageBack: () => undefined }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { create: "create" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "inspectFolder" ? state.inspect : command === "create" ? state.create : state.start,
}));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.review }));

import { ProjectPreparationRouteScreen } from "./ProjectPreparationRouteScreen";

let root: Root, container: HTMLDivElement;
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`Missing button: ${label}`);
  await act(() => target.click());
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.save.mockResolvedValue(undefined);
  state.review.mockResolvedValue(
    AsyncResult.success({
      projectId: "corbelo",
      state: "ready",
      repositoryIdentity: {
        locator: { remoteName: "origin", remoteUrl: "https://github.com/kyle/corbelo" },
      },
    }),
  );
  state.start.mockResolvedValue(
    AsyncResult.success({ projectId: "new-project", cwd: state.pickedFolder }),
  );
  state.inspect.mockResolvedValue(
    AsyncResult.success({ rootPath: state.pickedFolder, exists: false, repositories: [] }),
  );
  state.create.mockResolvedValue(AsyncResult.success({ sequence: 1 }));
  container = document.createElement("div");
  root = createRoot(container);
  await act(() =>
    root.render(
      <ProjectPreparationRouteScreen
        route={{
          params: {
            environmentId: "dorothy",
            projectId: "corbelo",
            destinationEnvironmentId: "mini",
          },
        }}
      />,
    ),
  );
  await click("Review source origin");
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("sends a folder picked on a computer that chooses folders, and none after letting it choose", async () => {
  await click("Choose another folder");
  await click("Pick folder");
  expect(container.textContent).toContain(`Download into this folder: ${state.pickedFolder}`);
  await click("Prepare this computer");
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({ destinationPath: state.pickedFolder }),
  );
  expect(state.start).toHaveBeenCalledWith({
    environmentId: "mini",
    input: expect.objectContaining({ destinationPath: state.pickedFolder }),
  });
});

it("leaves the folder to the computer again after a picked one is cleared", async () => {
  await click("Choose another folder");
  await click("Pick folder");
  await click("Let Loom choose the folder");
  await click("Prepare this computer");
  expect(state.start).toHaveBeenCalledOnce();
  expect(state.start.mock.calls[0]![0].input.destinationPath ?? null).toBeNull();
});

const repository = (relativePath: string, remoteUrl: string | null) => ({
  path: relativePath === "." ? state.pickedFolder : `${state.pickedFolder}/${relativePath}`,
  relativePath,
  remoteUrl,
  head: null,
  branch: null,
});

it("refuses a folder holding other files before anything is sent", async () => {
  state.inspect.mockResolvedValue(
    AsyncResult.success({
      rootPath: state.pickedFolder,
      exists: true,
      repositories: [repository("other", "https://github.com/kyle/other")],
    }),
  );
  await click("Choose another folder");
  await click("Pick folder");
  expect(container.textContent).toContain(
    "This folder holds other files. Choose an empty folder, or one that already has this project.",
  );
  expect(container.textContent).not.toContain(state.pickedFolder);
  await click("Prepare this computer");
  expect(state.start.mock.calls[0]![0].input.destinationPath ?? null).toBeNull();
});

it("adds a picked folder that already holds this repository instead of cloning into it", async () => {
  state.inspect.mockResolvedValue(
    AsyncResult.success({
      rootPath: state.pickedFolder,
      exists: true,
      repositories: [repository(".", "git@github.com:kyle/corbelo.git")],
    }),
  );
  await click("Choose another folder");
  await click("Pick folder");
  expect(container.textContent).toContain(`Use files in this folder: ${state.pickedFolder}`);
  await click("Prepare this computer");
  expect(state.start).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.create).toHaveBeenCalledWith({
    environmentId: "mini",
    input: expect.objectContaining({
      type: "project.create",
      projectId: "new-project",
      title: "corbelo",
      workspaceRoot: state.pickedFolder,
      createWorkspaceRootIfMissing: false,
    }),
  });
  expect(state.navigate).toHaveBeenCalledWith("ProjectHome", {
    environmentId: "mini",
    projectId: "new-project",
  });
});
