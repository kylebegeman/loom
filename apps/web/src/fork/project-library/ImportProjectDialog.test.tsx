// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  projects: [] as LibraryProject[],
  inspect: vi.fn(),
  readCopies: vi.fn(),
  create: vi.fn(),
  prepare: vi.fn(),
  register: vi.fn(),
  recover: vi.fn(),
  browse: vi.fn(),
  refresh: vi.fn(),
  allowed: true,
  online: true,
  browseError: null as string | null,
  pending: false,
  block: null as { label: string; message: string; repair: "sign-in" | null } | null,
}));
vi.mock("./state", () => ({
  projectLibrary: {
    inspectFolder: "inspect",
    createProject: "create",
    prepareCopy: "prepare",
    registerCopy: "register",
    preparation: "preparation",
    copies: "copies",
  },
  useLibraryPermission: () => state.allowed,
  useAccessBlock: () => state.block,
  useLibraryAccessBlock: () => state.block,
  useLibraryProjects: () => ({
    authorityId: "library",
    connected: true,
    query: { data: state.projects, isPending: false },
    environments: ["dorothy", "remote"].map((id) => ({
      environmentId: id,
      label: id,
      entry: { enabled: true },
      connection: { phase: state.online ? "connected" : "disconnected" },
      serverConfig: { environment: { capabilities: { supportsExecution: true } } },
    })),
  }),
}));
vi.mock("./LibraryAccessNotice", () => ({
  LibraryAccessNotice: ({
    block,
    onLeave,
  }: {
    block: { message: string } | null;
    onLeave?: () => void;
  }) => (block ? <button onClick={onLeave}>{`Repair: ${block.message}`}</button> : null),
}));
vi.mock("./attempts", async () => {
  const { useState } = await import("react");
  return { useLibraryAttempt: () => useState<unknown>(null) };
});
vi.mock("./ReleaseCopyDialog", () => ({ ReleaseCopyDialog: () => null }));
vi.mock("~/state/environments", () => ({ usePrimaryEnvironmentId: () => "dorothy" }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: "inspect" | "create" | "prepare" | "register") => state[command],
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (query: string) =>
    query === "copies" ? state.readCopies : query === "preparation" ? state.recover : vi.fn(),
}));
vi.mock("~/state/filesystem", () => ({
  filesystemEnvironment: {
    browse: (input: unknown) => {
      state.browse(input);
      return input;
    },
  },
  useFilesystemReadAccess: () => ({ canReadFiles: state.allowed, isPending: false, error: null }),
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (request: { input: { partialPath: string } } | null) => {
    const nested = request?.input.partialPath === "/Users/kyle/Developer/";
    return {
      data:
        request && !state.browseError
          ? {
              parentPath: nested ? "/Users/kyle/Developer" : "/Users/kyle",
              entries: nested
                ? []
                : [
                    { name: "Developer", fullPath: "/Users/kyle/Developer" },
                    { name: ".config", fullPath: "/Users/kyle/.config" },
                  ],
            }
          : null,
      isSuccess: request !== null && !state.browseError,
      isPending: state.pending,
      error: state.browseError,
      refresh: state.refresh,
    };
  },
}));
vi.mock("./LibraryPalette", () => ({
  LibraryPaletteDialog: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  LibraryPaletteView: (
    props: ComponentProps<typeof import("./LibraryPalette").LibraryPaletteView>,
  ) => (
    <div>
      <input
        aria-label={props.placeholder}
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
      />
      {props.onBack ? <button onClick={props.onBack}>Back</button> : null}
      {props.message}
      <p role="alert">{props.error}</p>
      {props.children}
      {props.items.map((item) => (
        <div key={item.id}>
          <button disabled={props.busy || item.disabled} onClick={item.select}>
            {item.title}
          </button>
          <span>{item.description}</span>
        </div>
      ))}
    </div>
  ),
}));
import { ImportProjectDialog } from "./ImportProjectDialog";

let root: Root;
let container: HTMLDivElement;
const button = (name: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === name,
  )!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.readCopies.mockResolvedValue(AsyncResult.success([]));
  state.projects = [];
  state.allowed = true;
  state.online = true;
  state.browseError = null;
  state.pending = false;
  state.block = null;
  state.inspect.mockImplementation(async ({ input }: { input: { rootPath: string } }) =>
    AsyncResult.success({
      rootPath: input.rootPath,
      exists: true,
      repositories: [],
      truncated: false,
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(props: Partial<ComponentProps<typeof ImportProjectDialog>> = {}) {
  await act(async () =>
    root.render(<ImportProjectDialog onSaved={vi.fn()} onClose={vi.fn()} {...props} />),
  );
}

it("browses folders on the selected computer and checks the selected folder without importing it", async () => {
  await mount({ initialHostId: EnvironmentId.make("remote") });
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "~/" },
  });
  await act(async () => button("Developer").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "/Users/kyle/Developer/" },
  });
  await act(async () => button("Use this folder").click());
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { rootPath: "/Users/kyle/Developer" },
  });
  expect(state.create).not.toHaveBeenCalled();
  expect(container.textContent).toContain("/Users/kyle/Developer");
  expect(button("Add folder to Developer")).toBeDefined();
});

it("retraces folder navigation with Back and leaves without changing the chosen folder", async () => {
  await mount();
  await act(async () => button("Developer").click());
  await act(async () => button("Back").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "dorothy",
    input: { partialPath: "~/" },
  });
  await act(async () => button("Back").click());
  expect(button("remote")).toBeDefined();
  expect(state.inspect).not.toHaveBeenCalled();
});

it("does not allow a stale or failed listing to select a folder", async () => {
  await mount();
  state.pending = true;
  await mount();
  expect(button("Use this folder").disabled).toBe(true);
  state.pending = false;
  state.browseError = "Permission denied on this computer.";
  await mount();
  expect(container.textContent).toContain(state.browseError);
  expect(button("Use this folder").disabled).toBe(true);
  await act(async () => button("Try again").click());
  expect(state.refresh).toHaveBeenCalled();
});

it("keeps selection unavailable when access is denied or the selected computer is offline", async () => {
  state.allowed = false;
  await mount();
  expect(button("Use this folder").disabled).toBe(true);
  expect(state.browse).not.toHaveBeenCalled();
  state.allowed = true;
  state.online = false;
  await mount();
  expect(button("Use this folder")).toBeUndefined();
  expect(state.inspect).not.toHaveBeenCalled();
});

it("reports an inspection failure after selection without importing", async () => {
  state.inspect.mockResolvedValue(
    AsyncResult.failure(Cause.fail(new Error("Folder is unreadable."))),
  );
  await mount();
  await act(async () => button("Use this folder").click());
  expect(container.textContent).toContain("Folder is unreadable.");
  expect(button("Use this folder").disabled).toBe(false);
  expect(state.create).not.toHaveBeenCalled();
});

it("browses the new computer after returning to the computer list", async () => {
  await mount();
  await act(async () => button("Back").click());
  await act(async () => button("remote").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "~/" },
  });
  await act(async () => button("Use this folder").click());
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { rootPath: "/Users/kyle" },
  });
});

it("preserves folder and project choices on Back without starting an import", async () => {
  await mount();
  await act(async () => button("Use this folder").click());
  expect(button("Add folder to kyle")).toBeDefined();
  await act(async () => button("Project name").click());
  await act(async () => button("Back").click());
  expect(button("Add folder to kyle")).toBeDefined();
  expect(state.inspect).toHaveBeenCalledOnce();
  expect(state.create).not.toHaveBeenCalled();
});

it("returns from the project brief to the folder confirmation without losing the draft", async () => {
  const onBack = vi.fn();
  await mount({ onBack });
  await act(async () => button("Use this folder").click());
  await act(async () => button("Project brief").click());
  await act(async () => button("Back").click());
  expect(button("Add folder to kyle")).toBeDefined();
  expect(onBack).not.toHaveBeenCalled();
  expect(state.inspect).toHaveBeenCalledOnce();
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps hidden folders out of ordinary browsing and finds them when explicitly searched", async () => {
  await mount();
  expect(button("Developer")).toBeDefined();
  expect(button(".config")).toBeUndefined();
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, ".");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button(".config")).toBeDefined();
  expect(button("Developer")).toBeUndefined();
  expect(state.inspect).not.toHaveBeenCalled();
});

it("uses an existing non-Git project association on the inspected computer", async () => {
  const project: LibraryProject = {
    id: "existing",
    title: "Existing app",
    brief: "",
    revision: 1,
    resources: [],
    archived: false,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
  };
  state.projects = [project];
  state.readCopies.mockResolvedValue(
    AsyncResult.success([
      {
        id: "copy",
        projectId: project.id,
        projectRevision: 1,
        environmentId: EnvironmentId.make("dorothy"),
        rootPath: "/Users/kyle",
        repositories: [],
        ownership: "borrowed",
        state: "ready",
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ]),
  );
  await mount();
  await act(async () => button("Use this folder").click());
  expect(button("Add folder to Existing app")).toBeDefined();
  expect(state.create).not.toHaveBeenCalled();
});
it("does not silently create a project when existing folder associations cannot be checked", async () => {
  state.readCopies.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("offline"))));
  await mount();
  await act(async () => button("Use this folder").click());
  expect(container.textContent).toContain("existing folder associations");
  state.readCopies.mockResolvedValue(AsyncResult.success([]));
  await act(async () => button("Use this folder").click());
  expect(button("Add folder to kyle")).toBeDefined();
  expect(state.create).not.toHaveBeenCalled();
});
it("offers the repair in place when an expired Library sign-in blocks the import", async () => {
  const onClose = vi.fn();
  await mount({ onClose });
  await act(async () => button("Use this folder").click());
  expect(button("Add folder to kyle").disabled).toBe(false);
  state.allowed = false;
  state.block = {
    label: "Library",
    message: "Your sign-in to Library expired.",
    repair: "sign-in",
  };
  await mount({ onClose });
  expect(button("Add folder to kyle").disabled).toBe(true);
  await act(async () => button("Repair: Your sign-in to Library expired.").click());
  expect(onClose).toHaveBeenCalled();
});

const libraryProject = (id: string, title: string, archived = false): LibraryProject => ({
  id,
  title,
  brief: "",
  revision: 1,
  resources: [],
  archived,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
});
const registeredTo = (project: LibraryProject, ownership: "borrowed" | "managed" = "borrowed") =>
  state.inspect.mockImplementation(async ({ input }: { input: { rootPath: string } }) =>
    AsyncResult.success({
      rootPath: input.rootPath,
      exists: true,
      repositories: [],
      truncated: false,
      registration: {
        workingCopyId: "old-copy",
        projectId: project.id,
        projectTitle: project.title,
        ownership,
      },
    }),
  );
const copyOf = (project: LibraryProject): LibraryWorkingCopy => ({
  id: "copy",
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("dorothy"),
  rootPath: "/Users/kyle",
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

it("keeps the project it created when a later step fails, so a retry adds the folder to it", async () => {
  const created = libraryProject("created", "kyle");
  const onSaved = vi.fn();
  const detail =
    "Loom could not check which project owns this folder. Reconnect your Library and try again.";
  state.create.mockResolvedValue(AsyncResult.success(created));
  state.prepare
    .mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked", detail }))),
    )
    .mockResolvedValueOnce(AsyncResult.success(copyOf(created)));
  state.recover.mockResolvedValue(AsyncResult.success(null));
  state.register.mockResolvedValue(AsyncResult.success(copyOf(created)));
  await mount({ onSaved });
  await act(async () => button("Use this folder").click());
  await act(async () => button("Add folder to kyle").click());
  expect(container.textContent).toContain(detail);
  await act(async () => button("Add folder to kyle").click());
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.prepare).toHaveBeenCalledTimes(2);
  expect(state.prepare.mock.calls[1]![0].input.project.id).toBe("created");
  expect(onSaved).toHaveBeenCalledWith(created, copyOf(created));
});

it("still adds the folder to the project it created after the folder is checked again", async () => {
  const created = libraryProject("created", "kyle");
  state.create.mockResolvedValue(AsyncResult.success(created));
  state.prepare
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked" }))))
    .mockResolvedValueOnce(AsyncResult.success(copyOf(created)));
  state.recover.mockResolvedValue(AsyncResult.success(null));
  state.register.mockResolvedValue(AsyncResult.success(copyOf(created)));
  await mount();
  await act(async () => button("Use this folder").click());
  await act(async () => button("Add folder to kyle").click());
  await act(async () => button("Choose another folder").click());
  await act(async () => button("Use this folder").click());
  expect(state.inspect).toHaveBeenCalledTimes(2);
  await act(async () => button("Add folder to kyle").click());
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.prepare.mock.calls[1]![0].input.project.id).toBe("created");
});

it("adds a folder to the current project that holds it and refuses a new one", async () => {
  const owner = libraryProject("owner", "Owner app");
  state.projects = [owner];
  registeredTo(owner);
  await mount();
  await act(async () => button("Use this folder").click());
  expect(button("Add folder to Owner app").disabled).toBe(false);
  await act(async () => button("Project").click());
  await act(async () => button("Create a new project").click());
  await act(async () => button("Keep this name").click());
  expect(button("Add folder to kyle").disabled).toBe(true);
  expect(container.textContent).toContain(
    "This folder already belongs to Owner app. Add it to that project instead.",
  );
  expect(state.create).not.toHaveBeenCalled();
});

it("takes a folder over from an archived project with a new one", async () => {
  state.projects = [libraryProject("old", "Old app", true)];
  registeredTo(state.projects[0]!);
  state.create.mockResolvedValue(AsyncResult.success(libraryProject("created", "kyle")));
  state.prepare.mockResolvedValue(AsyncResult.success(copyOf(libraryProject("created", "kyle"))));
  state.register.mockResolvedValue(AsyncResult.success(copyOf(libraryProject("created", "kyle"))));
  await mount();
  await act(async () => button("Use this folder").click());
  expect(container.textContent).toContain(
    "Takes this folder over from archived Old app. Its conversations stay in the archive.",
  );
  await act(async () => button("Add folder to kyle").click());
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.prepare.mock.calls[0]![0].input.strategy).toBe("reuse");
});

it("does not create a project for a folder holding files Loom made for an archived one", async () => {
  state.projects = [libraryProject("old", "Old app", true)];
  registeredTo(state.projects[0]!, "managed");
  await mount();
  await act(async () => button("Use this folder").click());
  expect(button("Add folder to kyle").disabled).toBe(true);
  expect(container.textContent).toContain(
    "This folder holds files Loom created for archived Old app. Restore that project",
  );
});
