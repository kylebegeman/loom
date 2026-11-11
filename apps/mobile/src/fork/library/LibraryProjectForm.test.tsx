// @vitest-environment jsdom
import { AsyncResult } from "effect/reactivity";
import { LibraryError, type LibraryProject } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  dispatch: vi.fn(),
  online: true,
  ecosystem: false,
  focused: true,
  authorityId: "library",
  outcome: Object.assign(vi.fn(), { permissionAtom: () => true }),
  create: Object.assign(vi.fn(), { permissionAtom: () => true }),
  update: Object.assign(vi.fn(), { permissionAtom: () => true }),
  queries: {} as Record<string, unknown>,
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
  useNavigation: () => ({
    dispatch: state.dispatch,
    navigate: vi.fn(),
    goBack: vi.fn(),
    isFocused: () => state.focused,
  }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));
vi.mock("./libraryState", () => ({
  useLibraryAuthority: () => ({
    environmentId: state.authorityId,
    ready: state.online,
    connected: state.online,
    keepsProfile: false,
    computers: [],
  }),
  useLoomFeature: () => state.ecosystem,
  refreshLibraryProject: vi.fn(),
  library: {
    operationOutcome: state.outcome,
    createProject: state.create,
    updateProject: state.update,
    inspectFolder: Object.assign(vi.fn(), { permissionAtom: () => true }),
    project: () => "project",
    projects: () => "projects",
    copies: () => "copies",
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: string | null) => ({
    data: (atom && state.queries[atom]) ?? null,
    error: null,
    isPending: false,
    isSuccess: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => null,
  readEnvironmentSessionState: () => null,
}));
vi.mock("../../state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("../../state/entities", () => ({ useProjects: () => [] }));
vi.mock("../../lib/uuid", () => {
  let next = 0;
  return { uuidv4: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}` };
});
vi.mock("./libraryProjectColors", () => ({ useLibraryProjectColorValue: () => () => "#000" }));
vi.mock("./LibraryProfileSection", () => ({ LibraryProfileSection: () => null }));
vi.mock("../../features/settings/components/SettingsSwitchRow", () => ({
  SettingsSwitchRow: ({
    label,
    value,
    disabled,
    onValueChange,
  }: {
    label: string;
    value: boolean;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.checked)}
    />
  ),
}));
vi.mock("./LibraryFolderPicker", () => ({ LibraryFolderPicker: () => null }));
vi.mock("./LibraryBriefSuggestions", () => ({ LibraryBriefSuggestionsSetting: () => null }));
vi.mock("./LibraryPage", () => ({
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

import { LibraryCreateRouteScreen, LibraryEditRouteScreen } from "./LibraryProjectForm";

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
  await act(async () => {
    button(label)!.click();
  });
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
  state.queries = {};
  state.online = true;
  state.ecosystem = false;
  state.focused = true;
  state.authorityId = "library";
  state.preferences = {};
  state.outcome.mockReset().mockRejectedValue(new Error("Could not check the saved result"));
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
  state.create.mockImplementation(async ({ input }) =>
    AsyncResult.success({
      id: "created",
      title: input.title,
      brief: input.brief ?? "",
      resources: input.resources ?? [],
      archived: false,
      revision: 1,
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
    }),
  );
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
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      name: "LibraryPrepare",
      params: { projectId: "created", authorityEnvironmentId: "library" },
    });
  });

  it("keeps the submitted request after access repair until an explicit retry", async () => {
    state.create.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked" }))),
    );
    await render({ start: "repository", initialInput: "github.com/acme/rocket" });
    await click("Create project");
    const submitted = state.create.mock.calls[0]![0];
    state.online = false;
    await render({ start: "repository", initialInput: "github.com/acme/rocket" });
    state.online = true;
    state.ecosystem = false;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ start: "repository", initialInput: "github.com/acme/changed" });
    expect(field("Project name")!.value).toBe("rocket");
    expect(state.create).toHaveBeenCalledTimes(1);
    await click("Retry save");
    expect(state.create).toHaveBeenLastCalledWith(submitted);
  });

  it("keeps an unknown create outcome paused instead of replaying the write", async () => {
    state.create.mockRejectedValueOnce(new Error("Reply lost"));
    await render({ start: "repository", initialInput: "github.com/acme/rocket" });
    await click("Create project");
    state.authorityId = "another-library";
    await render({ start: "repository", initialInput: "github.com/acme/rocket" });
    expect(button("Check save result")!.disabled).toBe(true);
    state.authorityId = "library";
    await render({ start: "repository", initialInput: "github.com/acme/rocket" });
    await click("Check save result");
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("saved result");
    const submitted = state.create.mock.calls[0]![0].input;
    state.outcome.mockResolvedValueOnce(
      AsyncResult.success({
        kind: "create",
        environmentId: "library",
        state: "succeeded",
        result: {
          id: "created",
          title: submitted.title,
          brief: submitted.brief,
          resources: submitted.resources,
          archived: false,
          revision: 1,
          createdAt: "2026-11-11T00:00:00Z",
          updatedAt: "2026-11-11T00:00:00Z",
        },
      }),
    );
    await click("Check save result");
    expect(state.outcome).toHaveBeenLastCalledWith({
      environmentId: "library",
      input: { requestId: submitted.requestId, kind: "create" },
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      name: "LibraryPrepare",
      params: { projectId: "created", authorityEnvironmentId: "library" },
    });
  });

  it("keeps an accepted result after the form closes without replacing another screen", async () => {
    const response = Promise.withResolvers<AsyncResult.AsyncResult<LibraryProject>>();
    state.create.mockReturnValueOnce(response.promise);
    await render({ start: "repository", initialInput: "github.com/acme/rocket" });
    await click("Create project");
    await act(async () => root.unmount());
    state.focused = false;
    const submitted = state.create.mock.calls[0]![0].input;
    await act(async () =>
      response.resolve(
        AsyncResult.success({
          id: "created",
          title: submitted.title,
          brief: submitted.brief,
          resources: submitted.resources,
          archived: false,
          revision: 1,
          createdAt: "2026-11-11T00:00:00Z",
          updatedAt: "2026-11-11T00:00:00Z",
        }),
      ),
    );
    expect(state.dispatch).not.toHaveBeenCalled();
    expect(Object.values(state.preferences)).toHaveLength(1);
    state.focused = true;
    root = createRoot(container);
    await render({ start: "repository" });
    expect(field("Project name")!.value).toBe("rocket");
    await click("Retry save");
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.dispatch).toHaveBeenCalledWith({
      name: "LibraryPrepare",
      params: { projectId: "created", authorityEnvironmentId: "library" },
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

describe("Edit project", () => {
  it("asks again before a second repository moves the root repository a computer holds", async () => {
    state.update.mockResolvedValue(AsyncResult.success({ id: "project" }));
    state.queries = {
      project: {
        id: "project",
        title: "corbelo",
        brief: "",
        revision: 1,
        archived: false,
        resources: [
          {
            id: "corbelo",
            kind: "repository",
            title: "corbelo",
            url: null,
            remoteUrl: "https://github.com/kyle/corbelo",
            relativePath: ".",
            defaultBranch: null,
          },
        ],
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
      },
      copies: [
        {
          id: "copy",
          projectId: "project",
          projectRevision: 1,
          environmentId: "dorothy",
          rootPath: "/work/corbelo",
          repositories: [
            {
              resourceId: "corbelo",
              path: "/work/corbelo",
              localProjectId: null,
              branch: null,
              head: null,
            },
          ],
          ownership: "managed",
          state: "ready",
          createdAt: "2026-10-10T00:00:00.000Z",
          updatedAt: "2026-10-10T00:00:00.000Z",
        },
      ],
    };
    await act(() =>
      root.render(<LibraryEditRouteScreen route={{ params: { projectId: "project" } }} />),
    );
    await input("Repository or link URL", "github.com/kyle/web");
    await click("Add");
    expect(container.textContent).toContain(
      "This moves corbelo into corbelo/. The copy on Saved computer keeps it at its folder root, so Loom prepares a new copy for work on this project there.",
    );
    expect(button("Add anyway")).not.toBeNull();
    expect(field("Repository or link URL")!.value).toBe("github.com/kyle/web");

    await click("Add anyway");
    expect(field("Repository or link URL")!.value).toBe("");
    expect(button("Add anyway")).toBeNull();
  });
});

it("keeps unavailable dependencies removable and stops adding at the wire limit", async () => {
  state.ecosystem = true;
  const dependencies = Array.from({ length: 32 }, (_, index) => `dependency-${index}`);
  const existing: LibraryProject = {
    id: "existing",
    title: "Existing project",
    brief: "",
    revision: 1,
    resources: [],
    archived: false,
    dependencies,
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
  };
  state.queries.project = existing;
  state.queries.projects = [{ ...existing, id: "candidate", title: "Candidate" }];
  await act(() =>
    root.render(<LibraryEditRouteScreen route={{ params: { projectId: "existing" } }} />),
  );
  const candidate = container.querySelector<HTMLInputElement>('[aria-label="Candidate"]')!;
  expect(candidate.disabled).toBe(true);
  const unavailable = container.querySelector<HTMLInputElement>(
    '[aria-label="Unavailable project (dependency-0)"]',
  )!;
  expect(unavailable.checked).toBe(true);
  await act(() => unavailable.click());
  expect(candidate.disabled).toBe(false);
  await act(() => candidate.click());
  await click("Save project");
  expect(state.update.mock.calls[0]?.[0].input.dependencies).toEqual([
    ...dependencies.slice(1),
    "candidate",
  ]);
});
