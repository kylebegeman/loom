// @vitest-environment jsdom
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  dispatch: vi.fn(),
  create: Object.assign(vi.fn(), { permissionAtom: () => true }),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (atom: unknown) => atom }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ dispatch: state.dispatch, navigate: vi.fn(), goBack: vi.fn() }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));
vi.mock("./libraryState", () => ({
  useLibraryAuthority: () => ({
    environmentId: "library",
    ready: true,
    connected: true,
    keepsProfile: false,
    computers: [],
  }),
  useLoomFeature: () => false,
  refreshLibraryProject: vi.fn(),
  library: {
    createProject: state.create,
    updateProject: Object.assign(vi.fn(), { permissionAtom: () => true }),
    inspectFolder: Object.assign(vi.fn(), { permissionAtom: () => true }),
    project: () => "project",
    projects: () => "projects",
    copies: () => "copies",
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: null,
    error: null,
    isPending: false,
    isSuccess: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("../../state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => crypto.randomUUID() }));
vi.mock("./libraryProjectColors", () => ({ useLibraryProjectColorValue: () => () => "#000" }));
vi.mock("./LibraryProfileSection", () => ({ LibraryProfileSection: () => null }));
vi.mock("./LibraryBriefSuggestions", () => ({ LibraryBriefSuggestionsSetting: () => null }));
vi.mock("./LibraryScreens", () => ({
  LibraryPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  LibraryNotice: ({ error, detail }: { error?: string | null; detail?: string | null }) => (
    <div>{error ?? detail}</div>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (text: string) => void;
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      onInput={(event) => onChangeText(event.currentTarget.value)}
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
    <button aria-label={label} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/ListRow", () => ({
  ListRow: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button aria-label={label} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

import { LibraryCreateRouteScreen } from "./LibraryProjectForm";

type Params = Parameters<typeof LibraryCreateRouteScreen>[0]["route"]["params"];
let root: Root, container: HTMLDivElement;
async function render(params: Params) {
  await act(() => root.render(<LibraryCreateRouteScreen route={{ params }} />));
}
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const field = (label: string) =>
  container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
async function click(label: string) {
  await act(() => button(label)!.click());
}
async function input(label: string, text: string) {
  await act(() => {
    field(label)!.value = text;
    field(label)!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const fieldLabels = () =>
  [...container.querySelectorAll("textarea")].map((node) => node.getAttribute("aria-label"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.create.mockResolvedValue(AsyncResult.success({ id: "created" }));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("New project", () => {
  it("asks how the project starts and opens the form for that choice", async () => {
    await render(undefined);
    expect(field("Project name")).toBeNull();
    for (const label of ["Empty project", "Existing folder", "Git repository"])
      expect(button(label)).not.toBeNull();

    await click("Git repository");
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      name: "LibraryCreate",
      params: { start: "repository" },
    });
  });

  it("starts from a Git repository by its link and names the project after it", async () => {
    await render({ start: "repository" });
    expect(fieldLabels()[0]).toBe("Repository or link URL");

    await input("Repository or link URL", "github.com/acme/rocket");
    await click("Add");
    expect(field("Project name")!.value).toBe("rocket");

    await click("Create project");
    expect(state.create).toHaveBeenCalledExactlyOnceWith({
      environmentId: "library",
      input: expect.objectContaining({
        title: "rocket",
        resources: [
          expect.objectContaining({
            kind: "repository",
            remoteUrl: "https://github.com/acme/rocket",
          }),
        ],
      }),
    });
  });

  it("keeps a name typed before the repository is added", async () => {
    await render({ start: "repository" });
    await input("Project name", "Launch");
    await input("Repository or link URL", "github.com/acme/rocket");
    await click("Add");
    expect(field("Project name")!.value).toBe("Launch");
  });

  it("starts from an existing folder with the folder list open ahead of the name", async () => {
    await render({ start: "folder" });
    expect(button("Hide folders")).not.toBeNull();
    expect(fieldLabels().slice(0, 2)).toEqual(["Find an existing folder", "Project name"]);
  });
});
