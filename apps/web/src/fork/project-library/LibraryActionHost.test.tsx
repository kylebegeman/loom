// @vitest-environment jsdom
import { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { LibraryFlowNavigation } from "./LibraryFlow";

const state = vi.hoisted(() => ({
  authorityId: "library" as string | null,
  projects: [] as LibraryProject[],
  copies: [] as LibraryWorkingCopy[],
  pending: false,
  navigate: vi.fn(),
  select: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: () => ({}),
}));
vi.mock("./state", () => ({
  useSelectedLibraryProject: () => [null, state.select],
  useLibraryProject: (id: string) => ({
    authorityId: state.authorityId,
    project: {
      data: state.projects.find((project) => project.id === id) ?? null,
      isPending: state.pending,
    },
    threads: { data: [] },
    copies: { data: state.copies },
    refresh: state.refresh,
  }),
  useLibraryProjects: () => ({
    query: { data: state.projects, isPending: false, refresh: state.refresh },
  }),
}));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("./LibraryControls", () => ({
  LibraryDialog: ({
    open,
    children,
    actions,
  }: {
    open: boolean;
    children: ReactNode;
    actions: ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        {children}
        {actions}
      </div>
    ) : null,
  LibrarySearch: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Search projects"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  LibraryErrorNotice: () => null,
}));
vi.mock("./LibrarySetup", () => ({ LibrarySetup: () => <p>Connect Library</p> }));
vi.mock("./ProjectEditorDialog", () => ({
  ProjectEditorDialog: (
    props: ComponentProps<typeof import("./ProjectEditorDialog").ProjectEditorDialog>,
  ) => (
    <DraftStep
      open={props.open ?? true}
      flow={props.flow}
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
      flow={props.flow}
      label="Folder"
      save={() => props.onSaved(state.projects[0]!, state.copies[0])}
    />
  ),
}));
vi.mock("./NewConversationDialog", () => ({
  NewConversationDialog: (
    props: ComponentProps<typeof import("./NewConversationDialog").NewConversationDialog>,
  ) => (
    <DraftStep
      open={props.open ?? true}
      label="Conversation title"
      flow={{ steps: [], current: 0, onBack: props.onChooseProject }}
      details={JSON.stringify(props, (key, value) => (key === "copiesQuery" ? undefined : value))}
    />
  ),
}));

function DraftStep({
  open,
  label,
  flow,
  save,
  details,
}: {
  open: boolean;
  label: string;
  flow?: LibraryFlowNavigation | undefined;
  save?: () => void;
  details?: string;
}) {
  const [value, setValue] = useState("");
  return open ? (
    <div role="dialog">
      <input aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />
      <button onClick={flow?.onBack}>Back</button>
      {save ? <button onClick={save}>Save</button> : null}
      <output>{details}</output>
    </div>
  ) : null;
}

import { LibraryActionHost } from "./LibraryActionHost";
import { openLibraryAction, type LibraryConversationDefaults } from "./actions";
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
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.authorityId = "library";
  state.projects = [project, second, { ...project, id: "old", title: "Archived", archived: true }];
  state.copies = [copy];
  state.pending = false;
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<LibraryActionHost />));
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
    initialStep: "agent",
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
    initialStep: "files",
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
});
it("continues with the imported folder's computer and exact registered copy", async () => {
  await act(() => openLibraryAction("new-conversation"));
  await click("Add existing folder");
  await click("Save");
  expect(launch()).toMatchObject({
    initialStep: "agent",
    initialHostId: copy.environmentId,
    initialCopyId: copy.id,
    copies: [copy],
  });
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
  state.authorityId = "library";
  await act(() => root.render(<LibraryActionHost />));
  expect(input("Project name")).not.toBeNull();
});
it("waits for a requested project instead of flashing the project chooser", async () => {
  state.pending = true;
  state.projects = [];
  await act(() => openLibraryAction("new-conversation", project.id, defaults));
  expect(container.textContent).toContain("Loading project...");
  expect(input("Search projects")).toBeNull();
  state.pending = false;
  state.projects = [project];
  await act(() => root.render(<LibraryActionHost />));
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
