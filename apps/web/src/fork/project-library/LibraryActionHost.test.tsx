// @vitest-environment jsdom
import { act, use, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  authorityId: "library" as string | null,
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
vi.mock("~/state/entities", () => ({ useProjects: () => [] }));
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
    useLibraryProject: (id: string) => {
      useRevision();
      return {
        authorityId: state.authorityId,
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
      return {
        authorityId: state.authorityId,
        environments: [
          {
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
          },
        ],
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
        .filter((item) =>
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
vi.mock("./LibrarySetup", () => ({ LibrarySetup: () => <p>Connect Library</p> }));
vi.mock("./ProjectEditorDialog", () => ({
  ProjectEditorDialog: (
    props: ComponentProps<typeof import("./ProjectEditorDialog").ProjectEditorDialog>,
  ) => (
    <DraftStep
      open={props.open ?? true}
      onBack={props.onBack}
      label="Project name"
      save={() => props.onSaved(state.projects[0]!)}
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
import { openLibraryAction, type LibraryConversationDefaults } from "./actions";

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
it.each(["create-project", "import-folder"] as const)(
  "standalone %s opens project home without launching a conversation",
  async (action) => {
    await act(() => openLibraryAction(action));
    await click("Save");
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/library/$projectId",
      params: { projectId: project.id },
    });
    expect(container.querySelector('[aria-label="Conversation title"]')).toBeNull();
  },
);
it("resumes the requested action after connecting the Library", async () => {
  state.authorityId = null;
  await act(() => openLibraryAction("create-project"));
  expect(container.textContent).toContain("Connect Library");
  await update(() => {
    state.authorityId = "library";
  });
  expect(input("Project name")).not.toBeNull();
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
it("keeps No project during Library setup and leaves it out when no computer can run it", async () => {
  state.authorityId = null;
  await act(() => openLibraryAction("new-conversation"));
  expect(container.textContent).toContain("Connect Library");
  expect(button("No project")).toBeDefined();
  state.noProject = null;
  state.authorityId = "library";
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
it("offers No project only when the chooser starts a conversation", async () => {
  await act(() => openLibraryAction("create-project"));
  await click("Back");
  expect(button("Alpha")).toBeDefined();
  expect(button("No project")).toBeUndefined();
  // Here Enter opens the project, so neither start nor options are named.
  expect(button("Alpha").dataset.enter).toBeUndefined();
  expect(button("Options Alpha")).toBeUndefined();
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
