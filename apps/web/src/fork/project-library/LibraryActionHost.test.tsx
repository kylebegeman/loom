// @vitest-environment jsdom
import { act, use, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  authorityId: "library" as string | null,
  offline: false,
  projects: [] as LibraryProject[],
  copies: [] as LibraryWorkingCopy[],
  libraryCopies: [] as LibraryWorkingCopy[],
  pending: false,
  // `command:environment` grants this browser lacks.
  denied: new Set<string>(),
  features: ["project-library"],
  navigate: vi.fn(),
  select: vi.fn(),
  refresh: vi.fn(),
  noProject: { label: "Dorothy", start: vi.fn(async () => {}) } as {
    label: string;
    start: () => Promise<void>;
  } | null,
  revision: 0,
  listeners: new Set<() => void>(),
}));
vi.mock("./useNoProjectStart", () => ({ useNoProjectStart: () => state.noProject }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: () => ({}),
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (request: { kind: string; input: { projectId?: string } } | null) => ({
    data:
      request?.kind === "threadIndex"
        ? { threads: [] }
        : request?.kind === "copies"
          ? request.input.projectId
            ? state.copies
            : state.libraryCopies
          : undefined,
    isPending: false,
  }),
}));
vi.mock("~/state/environments", () => ({ useEnvironmentProviders: () => new Map() }));
vi.mock("~/state/entities", () => ({ useProjects: () => [], useThreadShells: () => [] }));
vi.mock("./ConversationPalette", async () => {
  const { createContext } = await import("react");
  return { ConversationAutoStartContext: createContext(null) };
});
vi.mock("./state", async () => {
  const { useSyncExternalStore } = await import("react");
  const { Atom } = await import("effect/reactivity");
  const guarded = (name: string) => ({
    permissionAtom: (environmentId: string) =>
      Atom.make(!state.denied.has(`${name}:${environmentId}`)),
  });
  // The real hooks read atoms that re-render their reader. Compiled, the harness hands back the
  // same host element when only this state changes, so the mocks must subscribe the same way.
  const useRevision = () =>
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      () => state.revision,
    );
  return {
    LIBRARY_THREAD_INDEX_LIMIT: 200,
    readLibraryAuthorityId: () => state.authorityId,
    projectLibrary: {
      threadIndex: (target: object) => ({ kind: "threadIndex", ...target }),
      copies: (target: object) => ({ kind: "copies", ...target }),
      bindThread: guarded("bindThread"),
      executeOperation: guarded("executeOperation"),
      prepareCopy: guarded("prepareCopy"),
      registerThread: guarded("registerThread"),
      registerCopy: guarded("registerCopy"),
    },
    useSelectedLibraryProject: () => [null, state.select],
    useLibraryLocalCatalog: () => ({
      data: { projects: state.projects, copies: state.libraryCopies },
    }),
    useLibraryProject: (id: string) => {
      useRevision();
      return {
        authorityId: state.authorityId,
        offline: state.offline,
        project: {
          data: state.projects.find((project) => project.id === id) ?? null,
          isPending: state.pending,
          error:
            id && !state.pending && !state.projects.some((project) => project.id === id)
              ? "Project not found"
              : null,
        },
        threads: { data: [] },
        copies: { data: state.copies },
        refresh: state.refresh,
      };
    },
    useLibraryProjects: () => {
      useRevision();
      const dorothy = {
        environmentId: "dorothy",
        label: "Dorothy",
        entry: { enabled: true },
        connection: { phase: "connected" },
        serverConfig: {
          settings: {},
          environment: {
            capabilities: { supportsExecution: true, loomFeatures: state.features },
          },
        },
      };
      return {
        authorityId: state.authorityId,
        offline: state.offline,
        environment: dorothy,
        environments: [dorothy],
        computers: [],
        query: { data: state.projects, isPending: false, refresh: state.refresh },
      };
    },
  };
});
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("./LibraryPalette", () => ({
  LibraryPaletteView: (
    props: ComponentProps<typeof import("./LibraryPalette").LibraryPaletteView>,
  ) => (
    <div role="dialog">
      <input
        aria-label="Search projects"
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
      />
      {props.message}
      <p role="alert">{props.error}</p>
      {props.children}
      {props.items
        .filter(
          (item) =>
            props.filter === false ||
            [item.title, item.description ?? "", ...(item.terms ?? [])].some((value) =>
              value.toLowerCase().includes(props.query.toLowerCase()),
            ),
        )
        .map((item) => (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={item.select}
            data-enter={item.enterLabel}
          >
            {item.title}
          </button>
        ))}
      {props.items.map((item) => (
        <p key={item.id}>{item.summary ?? item.description}</p>
      ))}
      {props.items.map((item) =>
        item.options ? (
          <button key={item.id} onClick={item.options}>{`Options ${item.title}`}</button>
        ) : null,
      )}
    </div>
  ),
}));
vi.mock("./LibrarySetup", () => ({
  LIBRARY_SETUP_DESCRIPTION: "",
  LibrarySetup: (props: { onSelected?: () => void }) => (
    <button onClick={props.onSelected}>Use this Library</button>
  ),
}));
vi.mock("./ProjectEditorDialog", () => ({
  ProjectEditorDialog: (
    props: ComponentProps<typeof import("./ProjectEditorDialog").ProjectEditorDialog>,
  ) => (
    <DraftStep
      open={props.open ?? true}
      onBack={props.onBack}
      label="Project name"
      save={() => props.onSaved(state.projects[0]!)}
      details={JSON.stringify({
        initialTitle: props.initialTitle,
        initialResource: props.initialResource,
        initialPage: props.initialPage,
        continueTo: props.continueTo,
      })}
    />
  ),
}));
vi.mock("./ImportProjectDialog", () => ({
  ImportProjectDialog: (
    props: ComponentProps<typeof import("./ImportProjectDialog").ImportProjectDialog>,
  ) => (
    <DraftStep
      open={props.open ?? true}
      onBack={props.onBack}
      label="Folder"
      save={() => props.onSaved(state.projects[0]!, state.copies[0])}
      details={JSON.stringify({ initialRootPath: props.initialRootPath })}
    />
  ),
}));
vi.mock("./NewConversationDialog", async () => {
  const { ConversationAutoStartContext } = await import("./ConversationPalette");
  return {
    selectLastUsedModel: () => null,
    libraryConversationDefaults: () => ({
      entries: [{ instanceId: "codex", models: [{ slug: "gpt-6", name: "GPT 6.0 Astra" }] }],
      providers: [],
      modelSelection: { instanceId: "codex", model: "gpt-6" },
      runtimeMode: "full-access",
    }),
    NewConversationDialog: (
      props: ComponentProps<typeof import("./NewConversationDialog").NewConversationDialog>,
    ) => {
      const autoStart = use(ConversationAutoStartContext);
      return (
        <DraftStep
          open={props.open ?? true}
          label="Conversation title"
          onBack={props.onChooseProject}
          details={JSON.stringify({ ...props, autoStart }, (key, value) =>
            key === "copiesQuery" ? undefined : value,
          )}
        />
      );
    },
  };
});

function DraftStep({
  open,
  label,
  onBack,
  save,
  details,
}: {
  open: boolean;
  label: string;
  onBack?: (() => void) | undefined;
  save?: () => void;
  details?: string;
}) {
  const [value, setValue] = useState("");
  return open ? (
    <div role="dialog">
      <input aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />
      <button onClick={onBack}>Back</button>
      {save ? <button onClick={save}>Save</button> : null}
      <output>{details}</output>
    </div>
  ) : null;
}

import { LibraryActionHost, useLibraryPaletteSession } from "./LibraryActionHost";
import { LibraryConnectHost } from "./LibraryConnectDialog";
import { openLibraryAction, takeLibraryClone, type LibraryConversationDefaults } from "./actions";

function HostHarness() {
  const palette = useLibraryPaletteSession();
  return palette.isOpen && palette.session ? (
    <LibraryActionHost key={palette.session.id} session={palette.session} onClose={palette.close} />
  ) : null;
}
const project: LibraryProject = {
  id: "alpha",
  title: "Alpha",
  brief: "Map the coast",
  resources: [
    {
      id: "api",
      kind: "repository",
      relativePath: "service",
      title: "Service",
      remoteUrl: "https://github.com/example/harbor.git",
      defaultBranch: "main",
    },
  ],
  revision: 1,
  archived: false,
  createdAt: "2026-10-23T00:00:00Z",
  updatedAt: "2026-10-23T00:00:00Z",
};
const second = { ...project, id: "beta", title: "Beta", brief: "", resources: [] };
const copy: LibraryWorkingCopy = {
  id: "alpha-copy",
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("dorothy"),
  rootPath: "/work/alpha",
  rootLocalProjectId: null,
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const defaults: LibraryConversationDefaults = {
  environmentId: copy.environmentId,
  workingCopyId: copy.id,
  resourceIds: ["api"],
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "test",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "approval-required",
  interactionMode: "plan",
};
let root: Root;
let container: HTMLDivElement;
const button = (name: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === name,
  )!;
const input = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
async function click(name: string) {
  await act(() => button(name).click());
}
async function type(label: string, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(label),
      value,
    );
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const launch = () => JSON.parse(container.querySelector("output")!.textContent!);
async function update(change: () => void) {
  await act(() => {
    change();
    state.revision += 1;
    for (const listener of state.listeners) listener();
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.authorityId = "library";
  state.offline = false;
  state.projects = [project, second, { ...project, id: "old", title: "Archived", archived: true }];
  state.copies = [copy];
  state.libraryCopies = [];
  state.pending = false;
  state.denied = new Set();
  state.features = ["project-library"];
  state.noProject = { label: "Dorothy", start: vi.fn(async () => {}) };
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<HostHarness />));
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("searches project briefs and repositories and excludes archived projects", async () => {
  await act(() => openLibraryAction("new-conversation"));
  expect(button("Archived")).toBeUndefined();
  await type("Search projects", "harbor");
  expect(button("Alpha")).toBeDefined();
  expect(button("Beta")).toBeUndefined();
  await click("Alpha");
  expect(launch().project.id).toBe(project.id);
});
it("keeps the conversation draft and all source + settings when returning to the same project", async () => {
  await act(() => openLibraryAction("new-conversation", project.id, defaults));
  await type("Conversation title", "My draft");
  expect(launch()).toMatchObject({
    initialHostId: defaults.environmentId,
    initialCopyId: defaults.workingCopyId,
    initialResourceIds: defaults.resourceIds,
    initialModelSelection: defaults.modelSelection,
    initialRuntimeMode: defaults.runtimeMode,
    initialInteractionMode: defaults.interactionMode,
  });
  await click("Back");
  await click("Alpha");
  expect(input("Conversation title").value).toBe("My draft");
  expect(launch().initialModelSelection).toEqual(defaults.modelSelection);
});
it("drops the source file binding when choosing a different project but retains agent preferences", async () => {
  await act(() => openLibraryAction("new-conversation", project.id, defaults));
  await click("Back");
  await click("Beta");
  expect(launch()).toMatchObject({
    initialHostId: defaults.environmentId,
    initialModelSelection: defaults.modelSelection,
    initialRuntimeMode: defaults.runtimeMode,
  });
  expect(launch().initialCopyId).toBeUndefined();
  expect(launch().initialResourceIds).toBeUndefined();
});
it("preserves a new project draft across Back and continues into conversation setup", async () => {
  await act(() => openLibraryAction("new-conversation"));
  await click("New project");
  await type("Project name", "Draft project");
  await click("Back");
  await click("New project");
  expect(input("Project name").value).toBe("Draft project");
  await click("Save");
  expect(launch().project.id).toBe(project.id);
  expect(state.navigate).not.toHaveBeenCalled();
  // A saved project leaves no draft to return to.
  await click("Back");
  await click("New project");
  expect(input("Project name").value).toBe("");
});
it("opens Add existing folder on the browser, keeps a folder in progress, and starts fresh after a save", async () => {
  await act(() => openLibraryAction("new-conversation"));
  await type("Search projects", "/work/typed");
  await click("Use folder: typed");
  expect(launch().initialRootPath).toBe("/work/typed");
  await click("Back");
  await type("Search projects", "");
  await click("Add existing folder");
  expect(launch().initialRootPath).toBe("");
  await type("Folder", "/work/browsed");
  await click("Back");
  await click("Add existing folder");
  expect(input("Folder").value).toBe("/work/browsed");
  // The saved folder's checks from before the save must not answer the next pick.
  await click("Save");
  await click("Back");
  await click("Add existing folder");
  expect(input("Folder").value).toBe("");
});
it("starts on the folder just added with the project's defaults", async () => {
  // A project made with the folder is not in the catalog yet.
  state.projects = [second];
  state.copies = [{ ...copy, id: "beta-folder", projectId: second.id }];
  await act(() => openLibraryAction("new-conversation"));
  await click("Add existing folder");
  await click("Save");
  expect(launch()).toMatchObject({
    project: { id: second.id },
    initialHostId: copy.environmentId,
    initialCopyId: "beta-folder",
    copies: state.copies,
    autoStart: {
      launch: {
        environmentId: copy.environmentId,
        workingCopyId: "beta-folder",
        modelSelection: { instanceId: "codex", model: "gpt-6" },
        runtimeMode: "full-access",
      },
    },
  });
});
it("shows the settings for a folder whose project cannot start in one step", async () => {
  // Alpha's folder lacks its repository, so the settings explain what to do.
  await act(() => openLibraryAction("new-conversation"));
  await click("Add existing folder");
  await click("Save");
  expect(launch()).toMatchObject({ initialHostId: copy.environmentId, initialCopyId: copy.id });
  expect(launch().autoStart).toBeNull();
});
it.each([
  { action: "create-project" as const, choice: "Empty project" },
  { action: "import-folder" as const, choice: null },
])("standalone $action opens project home without launching a conversation", async (entry) => {
  await act(() => openLibraryAction(entry.action));
  if (entry.choice) await click(entry.choice);
  await click("Save");
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/library/$projectId",
    params: { projectId: project.id },
  });
  expect(container.querySelector('[aria-label="Conversation title"]')).toBeNull();
  // Only a project started from a Git URL continues into cloning.
  expect(takeLibraryClone(project.id)).toBeNull();
});
it("connects a Library in its own dialog before a new project, then resumes the request", async () => {
  state.authorityId = null;
  await act(() =>
    root.render(
      <>
        <HostHarness />
        <LibraryConnectHost />
      </>,
    ),
  );
  await act(() => openLibraryAction("create-project"));
  expect(button("Empty project")).toBeUndefined();
  const useLibrary = Array.from(document.querySelectorAll("button")).find(
    (entry) => entry.textContent === "Use this Library",
  )!;
  state.authorityId = "library";
  await act(() => useLibrary.click());
  expect(button("Empty project")).toBeDefined();
});
it("asks how a new project starts and returns there from each step with its draft", async () => {
  state.features = ["project-library", "project-workflows"];
  await act(() => openLibraryAction("create-project"));
  // Existing projects and No project belong to starting a conversation, not to this choice.
  const titles = Array.from(container.querySelectorAll("button")).map((entry) => entry.textContent);
  expect(titles).toEqual([
    "Empty project",
    "Existing folder",
    "Git repository",
    "From a blueprint",
  ]);
  await click("Empty project");
  await type("Project name", "Draft project");
  await click("Back");
  expect(container.textContent).toContain("Return to your project draft");
  await click("Empty project");
  expect(input("Project name").value).toBe("Draft project");
  await click("Back");
  await click("Existing folder");
  await type("Folder", "/work/browsed");
  await click("Back");
  await click("Existing folder");
  expect(input("Folder").value).toBe("/work/browsed");
  await click("Back");
  await click("From a blueprint");
  expect(launch()).toMatchObject({ initialPage: "blueprint", continueTo: "project" });
});
it("leads with what was typed: a folder path, a Git URL or a name", async () => {
  await act(() => openLibraryAction("create-project"));
  await type("Search projects", "/work/typed");
  await click("Use folder: typed");
  expect(launch().initialRootPath).toBe("/work/typed");
  await click("Back");
  await type("Search projects", "Harbor notes");
  await click("New project: Harbor notes");
  expect(launch()).toMatchObject({ initialTitle: "Harbor notes", initialResource: "" });
  await click("Back");
  await type("Search projects", "github.com/example/harbor");
  await click("Clone harbor");
  expect(launch()).toMatchObject({
    initialTitle: "harbor",
    initialResource: "https://github.com/example/harbor",
    continueTo: "clone",
  });
});
it("clones a Git URL onto the computer the request named once the project is created", async () => {
  const laptop = EnvironmentId.make("laptop");
  await act(() => openLibraryAction("create-project", undefined, { environmentId: laptop }));
  await click("Git repository");
  expect(button("Paste a Git URL").disabled).toBe(true);
  await type("Search projects", "https://example.com/docs");
  expect(button("Not a Git repository URL").disabled).toBe(true);
  await type("Search projects", "git@github.com:example/harbor.git");
  await click("Clone harbor");
  // Back returns to the chooser, and the Git page keeps the address.
  await click("Back");
  await click("Git repository");
  await click("Clone harbor");
  await click("Save");
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/library/$projectId",
    params: { projectId: project.id },
  });
  expect(takeLibraryClone(project.id)).toEqual({ projectId: project.id, hostId: laptop });
});
it("skips cloning when the saved project holds no Git remote", async () => {
  state.projects = [second];
  await act(() => openLibraryAction("create-project"));
  await type("Search projects", "github.com/example/harbor");
  await click("Clone harbor");
  await click("Save");
  expect(takeLibraryClone(second.id)).toBeNull();
});
it("waits for a requested project instead of flashing the project chooser", async () => {
  state.pending = true;
  state.projects = [];
  await act(() => openLibraryAction("new-conversation", project.id, defaults));
  expect(container.textContent).toContain("Loading project...");
  expect(button("New project")).toBeUndefined();
  await update(() => {
    state.pending = false;
    state.projects = [project];
  });
  expect(launch().initialCopyId).toBe(copy.id);
});

it("replaces the source file selection when another folder for the same project is imported", async () => {
  await act(() => openLibraryAction("new-conversation", project.id, defaults));
  await click("Back");
  state.copies = [{ ...copy, id: "another-folder", rootPath: "/work/another" }];
  await click("Add existing folder");
  await click("Save");
  expect(launch().initialCopyId).toBe("another-folder");
});

it("leads a new conversation with No project and starts it without opening a project", async () => {
  await act(() => openLibraryAction("new-conversation"));
  const titles = Array.from(container.querySelectorAll("button")).map((entry) => entry.textContent);
  expect(titles.slice(0, 3)).toEqual(["No project", "Alpha", "Beta"]);
  await click("No project");
  expect(state.noProject?.start).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(state.select).not.toHaveBeenCalled();
});
it("keeps No project beside the Library connection and leaves it out when no computer can run it", async () => {
  state.authorityId = null;
  await act(() => openLibraryAction("new-conversation"));
  expect(button("Connect your Library")).toBeDefined();
  expect(button("No project")).toBeDefined();
  state.noProject = null;
  state.authorityId = "library";
  state.offline = false;
  await act(() => openLibraryAction("new-conversation"));
  expect(button("No project")).toBeUndefined();
  expect(button("Alpha")).toBeDefined();
});
it("lets a project search beat No project when its computer shares the project's name", async () => {
  state.noProject = { label: "Alpha studio", start: vi.fn(async () => {}) };
  await act(() => openLibraryAction("new-conversation"));
  await type("Search projects", "alpha");
  expect(button("No project")).toBeUndefined();
  expect(button("Alpha")).toBeDefined();
  await type("Search projects", "without");
  expect(button("No project")).toBeDefined();
});

it("starts a ready project from Enter with the defaults its row shows, and offers its settings", async () => {
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  await act(() => openLibraryAction("new-conversation"));
  expect(container.textContent).toContain("Dorothy · GPT 6.0 Astra · Full access");
  // Enter is named for what it does on each row: Alpha cannot start yet, so it opens settings.
  expect(
    ["No project", "Beta", "Alpha", "New project", "Add existing folder"].map(
      (title) => button(title).dataset.enter,
    ),
  ).toEqual(["Start", "Start", "Options", undefined, undefined]);
  await click("Beta");
  expect(launch()).toMatchObject({
    project: { id: second.id },
    initialHostId: "dorothy",
    autoStart: {
      launch: {
        environmentId: "dorothy",
        workingCopyId: "beta-copy",
        modelSelection: { instanceId: "codex", model: "gpt-6" },
        runtimeMode: "full-access",
      },
    },
  });
  await click("Back");
  await click("Options Beta");
  expect(launch()).toMatchObject({ project: { id: second.id }, initialHostId: "dorothy" });
  expect(launch().autoStart).toBeNull();
  // Alpha has no copy holding its repository, so Enter shows the settings that explain it.
  await click("Back");
  expect(container.textContent).toContain("Map the coast");
  await click("Alpha");
  expect(launch().project.id).toBe(project.id);
  expect(launch().autoStart).toBeNull();
});
it("keeps inherited settings on the settings step instead of starting in one step", async () => {
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  await act(() => openLibraryAction("new-conversation", project.id, defaults));
  await click("Back");
  expect(container.textContent).not.toContain("Dorothy · GPT 6.0 Astra");
  await click("Beta");
  expect(launch().autoStart).toBeNull();
});

it("leads with the project where the user is, without opening its settings", async () => {
  await act(() => openLibraryAction("new-conversation", second.id, defaults, { suggest: true }));
  expect(container.querySelector('[aria-label="Conversation title"]')).toBeNull();
  const titles = Array.from(container.querySelectorAll("button")).map((entry) => entry.textContent);
  expect(titles.slice(0, 3)).toEqual(["Beta", "No project", "Alpha"]);
  // Without a start to offer, the suggested project opens its settings with the source's files.
  await click("Beta");
  expect(launch()).toMatchObject({
    project: { id: second.id },
    initialHostId: defaults.environmentId,
    initialCopyId: defaults.workingCopyId,
    initialResourceIds: defaults.resourceIds,
    autoStart: null,
  });
  await click("Back");
  await click("Alpha");
  expect(launch()).toMatchObject({ project: { id: project.id }, initialHostId: "dorothy" });
  expect(launch().initialCopyId).toBeUndefined();
  expect(launch().initialResourceIds).toBeUndefined();
});
it("starts and opens options for a suggested project on only what its row shows", async () => {
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  const source = { environmentId: EnvironmentId.make("laptop"), workingCopyId: "source-copy" };
  await act(() =>
    openLibraryAction(
      "new-conversation",
      second.id,
      { ...source, resourceId: "web" },
      { suggest: true },
    ),
  );
  expect(container.textContent).toContain("Dorothy · GPT 6.0 Astra · Full access");
  // The source thread's computer, copy and repository never replace what the row named.
  await click("Options Beta");
  expect(launch()).toMatchObject({ initialHostId: "dorothy", autoStart: null });
  expect(launch().initialCopyId).toBeUndefined();
  expect(launch().initialResourceId).toBeUndefined();
  await click("Back");
  await click("Beta");
  expect(launch()).toMatchObject({
    initialHostId: "dorothy",
    autoStart: { launch: { environmentId: "dorothy", workingCopyId: "beta-copy" } },
  });
  expect(launch().initialCopyId).toBeUndefined();
  expect(launch().initialResourceId).toBeUndefined();
});
it("opens a promised row's options on the computer it named, and keeps them on return", async () => {
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  await act(() => openLibraryAction("new-conversation"));
  await click("Options Beta");
  expect(launch()).toMatchObject({
    project: { id: second.id },
    initialHostId: "dorothy",
    autoStart: null,
  });
  await type("Conversation title", "My draft");
  await click("Back");
  await click("Options Beta");
  expect(input("Conversation title").value).toBe("My draft");
  // Without a promise the settings choose the computer themselves.
  await click("Back");
  await click("Options Alpha");
  expect(launch().project.id).toBe(project.id);
  expect(launch().initialHostId).toBeUndefined();
});
it.each([
  { denied: "bindThread:dorothy" },
  { denied: "registerThread:library" },
  { denied: "executeOperation:dorothy", features: ["project-workflows"] },
  { denied: "prepareCopy:dorothy" },
  { denied: "registerCopy:library" },
])("promises no start the settings would refuse without $denied", async (grant) => {
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  state.denied = new Set([grant.denied]);
  state.features = ["project-library", ...(grant.features ?? [])];
  await act(() => openLibraryAction("new-conversation"));
  expect(container.textContent).not.toContain("Dorothy · GPT 6.0 Astra");
  expect(button("Beta").dataset.enter).toBe("Options");
  await click("Beta");
  expect(launch().autoStart).toBeNull();
});
it("still promises a start that needs none of the missing grants", async () => {
  // Loom manages this copy, so it is not prepared again, and this computer launches without
  // durable operations.
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id, ownership: "managed" }];
  state.denied = new Set([
    "prepareCopy:dorothy",
    "registerCopy:library",
    "executeOperation:dorothy",
  ]);
  await act(() => openLibraryAction("new-conversation"));
  expect(container.textContent).toContain("Dorothy · GPT 6.0 Astra · Full access");
});
it("hides a suggested project that no longer loads instead of reporting an error", async () => {
  state.projects = [project];
  await act(() => openLibraryAction("new-conversation", "gone", undefined, { suggest: true }));
  expect(container.querySelector('[role="alert"]')!.textContent).toBe("");
  expect(button("Alpha")).toBeDefined();
});
it("opens a folder added after a start on that folder's computer", async () => {
  state.projects = [second];
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  const laptop = EnvironmentId.make("laptop");
  state.copies = [{ ...copy, id: "beta-laptop", projectId: second.id, environmentId: laptop }];
  await act(() => openLibraryAction("new-conversation"));
  await click("Beta");
  expect(launch().initialHostId).toBe("dorothy");
  await click("Back");
  await click("Add existing folder");
  await click("Save");
  expect(launch()).toMatchObject({ initialHostId: laptop, initialCopyId: "beta-laptop" });
});
it("never lets the computer a start runs on decide which project a search finds", async () => {
  const notes = { ...second, id: "notes", title: "Dorothy notes" };
  state.projects = [second, notes];
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  await act(() => openLibraryAction("new-conversation"));
  expect(container.textContent).toContain("Dorothy · GPT 6.0 Astra · Full access");
  await type("Search projects", "dor");
  expect(button("Beta")).toBeUndefined();
  expect(button("Dorothy notes")).toBeDefined();
});

it("offers an offline quick start using the host's files and grants", async () => {
  state.offline = true;
  state.features = ["project-library", "project-workflows"];
  state.libraryCopies = [{ ...copy, id: "beta-copy", projectId: second.id }];
  state.denied.add("registerThread:library");
  state.denied.add("registerCopy:library");
  state.denied.add("prepareCopy:dorothy");
  await act(() => openLibraryAction("new-conversation"));
  expect(button("Beta").dataset.enter).toBe("Start");
  await click("Beta");
  expect(launch().autoStart).toMatchObject({
    launch: { environmentId: "dorothy", workingCopyId: "beta-copy" },
  });
});
