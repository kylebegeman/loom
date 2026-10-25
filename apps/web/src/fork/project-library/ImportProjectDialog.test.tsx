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
  files: true,
  online: true,
  repository: false,
  libraryCopies: [] as LibraryWorkingCopy[],
  copiesLoading: false,
  projectsError: null as string | null,
  projectsRefreshing: false,
  copiesFamily: (target: unknown) => ({ copies: target }),
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
    copies: state.copiesFamily,
  },
  useLibraryPermission: () => state.allowed,
  useAccessBlock: () => state.block,
  useLibraryAccessBlock: () => state.block,
  useLibraryProjects: () => ({
    authorityId: "library",
    connected: true,
    query: {
      data: state.projectsError ? null : state.projects,
      isPending: state.projectsRefreshing,
      error: state.projectsError,
    },
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
  useAtomQueryRunner: (query: unknown) =>
    query === state.copiesFamily
      ? state.readCopies
      : query === "preparation"
        ? state.recover
        : vi.fn(),
}));
vi.mock("~/state/filesystem", () => ({
  filesystemEnvironment: {
    browse: (input: unknown) => {
      state.browse(input);
      return input;
    },
  },
  useFilesystemReadAccess: () => ({ canReadFiles: state.files, isPending: false, error: null }),
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (
    request: { input: { partialPath: string } } | { copies: unknown } | null,
  ) => {
    if (request && "copies" in request)
      return {
        data: state.copiesLoading ? null : state.libraryCopies,
        isSuccess: !state.copiesLoading,
        isPending: state.copiesLoading,
        error: null,
      };
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
                    ...(state.repository ? [{ name: ".git", fullPath: "/Users/kyle/.git" }] : []),
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
const copyOf = (project: LibraryProject, rootPath = "/Users/kyle"): LibraryWorkingCopy => ({
  id: `${project.id}-copy`,
  projectId: project.id,
  projectRevision: 1,
  environmentId: EnvironmentId.make("dorothy"),
  rootPath,
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
const registrationFor = (
  project: LibraryProject,
  ownership: "borrowed" | "managed" = "borrowed",
) => ({
  workingCopyId: `${project.id}-copy`,
  projectId: project.id,
  projectTitle: project.title,
  ownership,
});
// The single holder a computer that predates reporting every holder names.
const registeredTo = (project: LibraryProject, ownership: "borrowed" | "managed" = "borrowed") =>
  state.inspect.mockImplementation(async ({ input }: { input: { rootPath: string } }) =>
    AsyncResult.success({
      rootPath: input.rootPath,
      exists: true,
      repositories: [],
      truncated: false,
      registration: registrationFor(project, ownership),
    }),
  );
const created = libraryProject("created", "kyle");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.readCopies.mockResolvedValue(AsyncResult.success([]));
  state.create.mockResolvedValue(AsyncResult.success(created));
  state.prepare.mockImplementation(async ({ input }: { input: { project: LibraryProject } }) =>
    AsyncResult.success(copyOf(input.project)),
  );
  state.register.mockImplementation(async ({ input }: { input: { copy: LibraryWorkingCopy } }) =>
    AsyncResult.success(input.copy),
  );
  state.recover.mockResolvedValue(AsyncResult.success(null));
  state.projects = [];
  state.libraryCopies = [];
  state.copiesLoading = false;
  state.projectsError = null;
  state.projectsRefreshing = false;
  state.allowed = true;
  state.files = true;
  state.online = true;
  state.repository = false;
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

it("creates a project for the browsed folder in one step", async () => {
  const onSaved = vi.fn();
  await mount({ initialHostId: EnvironmentId.make("remote"), onSaved });
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "~/" },
  });
  await act(async () => button("Developer").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "/Users/kyle/Developer/" },
  });
  expect(container.textContent).toContain("A new Library project for these files.");
  expect(state.inspect).not.toHaveBeenCalled();
  await act(async () => button("Create project Developer").click());
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { rootPath: "/Users/kyle/Developer" },
  });
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.create.mock.calls[0]![0].input.title).toBe("Developer");
  expect(state.prepare.mock.calls[0]![0].input).toMatchObject({
    rootPath: "/Users/kyle/Developer",
    strategy: "reuse",
  });
  expect(onSaved).toHaveBeenCalledWith(created, copyOf(created));
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

it("does not allow a stale or failed listing to add a folder", async () => {
  await mount();
  state.pending = true;
  await mount();
  expect(button("Add this folder").disabled).toBe(true);
  state.pending = false;
  state.browseError = "Permission denied on this computer.";
  await mount();
  expect(container.textContent).toContain(state.browseError);
  expect(button("Add this folder").disabled).toBe(true);
  await act(async () => button("Try again").click());
  expect(state.refresh).toHaveBeenCalled();
});

it("keeps adding unavailable when file access is denied or the selected computer is offline", async () => {
  state.files = false;
  await mount();
  expect(button("Add this folder").disabled).toBe(true);
  expect(state.browse).not.toHaveBeenCalled();
  state.files = true;
  state.online = false;
  await mount();
  expect(button("Add this folder")).toBeUndefined();
  expect(state.inspect).not.toHaveBeenCalled();
});

it("reports an inspection failure without importing", async () => {
  state.inspect.mockResolvedValue(
    AsyncResult.failure(Cause.fail(new Error("Folder is unreadable."))),
  );
  await mount();
  await act(async () => button("Create project kyle").click());
  expect(container.textContent).toContain("Folder is unreadable.");
  expect(button("Create project kyle").disabled).toBe(false);
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
  await act(async () => button("Create project kyle").click());
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { rootPath: "/Users/kyle" },
  });
  expect(state.prepare.mock.calls[0]![0].environmentId).toBe("remote");
});

it("keeps a typed folder's confirmation and its drafts on Back", async () => {
  const onBack = vi.fn();
  await mount({ initialRootPath: "/Users/kyle", onBack });
  expect(button("Add folder to kyle")).toBeDefined();
  await act(async () => button("Project name").click());
  await act(async () => button("Back").click());
  expect(button("Add folder to kyle")).toBeDefined();
  await act(async () => button("Project brief").click());
  await act(async () => button("Back").click());
  expect(button("Add folder to kyle")).toBeDefined();
  expect(button("Choose another folder")).toBeUndefined();
  await act(async () => button("Back").click());
  expect(button("Create project kyle")).toBeDefined();
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
  expect(button("Create project kyle")).toBeUndefined();
  expect(state.inspect).not.toHaveBeenCalled();
});

it("names a folder's existing project association before checking it, then adds it there", async () => {
  const project = libraryProject("existing", "Existing app");
  const onSaved = vi.fn();
  state.projects = [project];
  state.libraryCopies = [copyOf(project)];
  state.readCopies.mockResolvedValue(AsyncResult.success([copyOf(project)]));
  await mount({ onSaved });
  expect(container.textContent).toContain("Uses your Library project Existing app.");
  expect(state.inspect).not.toHaveBeenCalled();
  await act(async () => button("Add to Existing app").click());
  expect(state.create).not.toHaveBeenCalled();
  expect(state.prepare.mock.calls[0]![0].input.project.id).toBe("existing");
  expect(onSaved).toHaveBeenCalledWith(project, copyOf(project));
});

it("checks a repository folder while browsing so its row names the project that holds it", async () => {
  const owner = libraryProject("owner", "Owner app");
  state.projects = [owner, libraryProject("other", "Other app")];
  state.repository = true;
  registeredTo(owner);
  await mount();
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "dorothy",
    input: { rootPath: "/Users/kyle" },
  });
  expect(button("Add to Owner app").disabled).toBe(false);
  // A current holder keeps the folder, so no other project is offered.
  expect(button("Add to another project...")).toBeUndefined();
  await act(async () => button("Add to Owner app").click());
  expect(state.inspect).toHaveBeenCalledTimes(2);
  expect(state.prepare.mock.calls[0]![0].input.project.id).toBe("owner");
});

it("shows a different result instead of acting when the check disagrees with the row", async () => {
  const owner = libraryProject("owner", "Owner app");
  state.projects = [owner];
  registeredTo(owner);
  await mount();
  await act(async () => button("Create project kyle").click());
  expect(state.create).not.toHaveBeenCalled();
  expect(state.prepare).not.toHaveBeenCalled();
  expect(button("Add to Owner app").disabled).toBe(false);
});

it("adds a folder to another project chosen from the browser and returns there on Back", async () => {
  const onSaved = vi.fn();
  const alpha = libraryProject("alpha", "Alpha");
  state.projects = [alpha, libraryProject("beta", "Beta")];
  await mount({ onSaved });
  await act(async () => button("Add to another project...").click());
  expect(button("Create a new project")).toBeDefined();
  await act(async () => button("Back").click());
  expect(button("Create project kyle")).toBeDefined();
  await act(async () => button("Add to another project...").click());
  await act(async () => button("Alpha").click());
  expect(state.create).not.toHaveBeenCalled();
  expect(state.prepare.mock.calls[0]![0].input.project.id).toBe("alpha");
  expect(onSaved).toHaveBeenCalledWith(alpha, copyOf(alpha));
});

it("opens the project choice when several projects match a folder", async () => {
  const alpha = libraryProject("alpha", "Alpha");
  const beta = libraryProject("beta", "Beta");
  state.projects = [alpha, beta];
  state.libraryCopies = [copyOf(alpha), { ...copyOf(beta), id: "beta-copy" }];
  state.readCopies.mockResolvedValue(AsyncResult.success(state.libraryCopies));
  await mount();
  expect(button("Add to another project...")).toBeUndefined();
  await act(async () => button("Choose a project for this folder").click());
  expect(button("Create a new project")).toBeDefined();
  expect(state.prepare).not.toHaveBeenCalled();
});

it("does not silently create a project when existing folder associations cannot be checked", async () => {
  state.readCopies.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("offline"))));
  await mount();
  await act(async () => button("Create project kyle").click());
  expect(container.textContent).toContain("existing folder associations");
  expect(state.create).not.toHaveBeenCalled();
  state.readCopies.mockResolvedValue(AsyncResult.success([]));
  await act(async () => button("Create project kyle").click());
  expect(state.create).toHaveBeenCalledOnce();
});

it("offers the repair in place when an expired Library sign-in blocks adding", async () => {
  const onClose = vi.fn();
  await mount({ onClose });
  expect(button("Create project kyle").disabled).toBe(false);
  state.allowed = false;
  state.block = {
    label: "Library",
    message: "Your sign-in to Library expired.",
    repair: "sign-in",
  };
  await mount({ onClose });
  expect(button("Create project kyle").disabled).toBe(true);
  expect(container.textContent).toContain("Restore access above to add this folder.");
  await act(async () => button("Repair: Your sign-in to Library expired.").click());
  expect(onClose).toHaveBeenCalled();
});

it("keeps the project it created when a later step fails, so a retry adds the folder to it", async () => {
  const onSaved = vi.fn();
  const detail =
    "Loom could not check which project owns this folder. Reconnect your Library and try again.";
  state.prepare
    .mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked", detail }))),
    )
    .mockResolvedValueOnce(AsyncResult.success(copyOf(created)));
  await mount({ onSaved });
  await act(async () => button("Create project kyle").click());
  expect(container.textContent).toContain(detail);
  await act(async () => button("Add folder to kyle").click());
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.prepare).toHaveBeenCalledTimes(2);
  expect(state.prepare.mock.calls[1]![0].input.project.id).toBe("created");
  expect(onSaved).toHaveBeenCalledWith(created, copyOf(created));
});

it("still adds the folder to the project it created after returning to the browser", async () => {
  state.prepare.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked" }))),
  );
  await mount();
  await act(async () => button("Create project kyle").click());
  await act(async () => button("Back").click());
  await act(async () => button("Add to kyle").click());
  expect(state.inspect).toHaveBeenCalledTimes(2);
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.prepare.mock.calls[1]![0].input.project.id).toBe("created");
});

it("refuses a new project for a typed folder a current project holds", async () => {
  const owner = libraryProject("owner", "Owner app");
  state.projects = [owner];
  registeredTo(owner);
  await mount({ initialRootPath: "/Users/kyle" });
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

it("keeps a folder a current project also holds when an older build left an archived one newer", async () => {
  const old = libraryProject("old", "Old app", true);
  const owner = libraryProject("owner", "Owner app");
  state.projects = [old, owner];
  state.inspect.mockImplementation(async ({ input }: { input: { rootPath: string } }) =>
    AsyncResult.success({
      rootPath: input.rootPath,
      exists: true,
      repositories: [],
      registration: registrationFor(old),
      registrations: [registrationFor(old), registrationFor(owner)],
    }),
  );
  await mount({ initialRootPath: "/Users/kyle" });
  expect(button("Add folder to Owner app").disabled).toBe(false);
  expect(container.textContent).not.toContain("Takes this folder over");
  await act(async () => button("Project").click());
  await act(async () => button("Create a new project").click());
  await act(async () => button("Keep this name").click());
  expect(button("Add folder to kyle").disabled).toBe(true);
  expect(container.textContent).toContain(
    "This folder already belongs to Owner app. Add it to that project instead.",
  );
  expect(state.create).not.toHaveBeenCalled();
});

it("shows a takeover from an archived project before making a new one", async () => {
  state.projects = [libraryProject("old", "Old app", true)];
  registeredTo(state.projects[0]!);
  await mount();
  await act(async () => button("Create project kyle").click());
  expect(state.create).not.toHaveBeenCalled();
  expect(container.textContent).toContain(
    "Takes this folder over from archived Old app. Its conversations stay in the archive.",
  );
  await act(async () => button("Create project kyle").click());
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.prepare.mock.calls[0]![0].input.strategy).toBe("reuse");
});

it("does not create a project for a folder holding files Loom made for an archived one", async () => {
  state.projects = [libraryProject("old", "Old app", true)];
  registeredTo(state.projects[0]!, "managed");
  await mount();
  await act(async () => button("Create project kyle").click());
  expect(button("Create project kyle").disabled).toBe(true);
  expect(button("Add to another project...")).toBeUndefined();
  expect(container.textContent).toContain(
    "This folder holds files Loom created for archived Old app. Restore that project",
  );
  expect(state.create).not.toHaveBeenCalled();
});

it("names the Library's failure instead of guessing a new project, and stays usable while it refreshes", async () => {
  state.projectsError = "Your Library is offline.";
  await mount();
  expect(button("Add this folder").disabled).toBe(true);
  expect(container.textContent).toContain("Your Library is offline.");
  expect(button("Create project kyle")).toBeUndefined();
  state.projectsError = null;
  state.projectsRefreshing = true;
  await mount();
  expect(button("Create project kyle").disabled).toBe(false);
});

it("waits for the Library's folder associations before naming what a folder joins", async () => {
  const project = libraryProject("existing", "Existing app");
  state.projects = [project];
  state.libraryCopies = [copyOf(project)];
  state.copiesLoading = true;
  await mount();
  expect(button("Add this folder").disabled).toBe(true);
  expect(button("Create project kyle")).toBeUndefined();
  state.copiesLoading = false;
  await mount();
  expect(button("Add to Existing app").disabled).toBe(false);
});

it("confirms a takeover from an archived project before adding the folder to a chosen one", async () => {
  const alpha = libraryProject("alpha", "Alpha");
  state.projects = [libraryProject("old", "Old app", true), alpha];
  registeredTo(state.projects[0]!);
  await mount();
  await act(async () => button("Add to another project...").click());
  await act(async () => button("Alpha").click());
  expect(state.prepare).not.toHaveBeenCalled();
  expect(container.textContent).toContain(
    "Takes this folder over from archived Old app. Its conversations stay in the archive.",
  );
  await act(async () => button("Add folder to Alpha").click());
  expect(state.prepare.mock.calls[0]![0].input.project.id).toBe("alpha");
});

it("does not offer other projects once a check shows a current project holds the folder", async () => {
  const owner = libraryProject("owner", "Owner app");
  state.projects = [owner, libraryProject("other", "Other app")];
  registeredTo(owner);
  await mount();
  await act(async () => button("Add to another project...").click());
  expect(button("Create a new project")).toBeUndefined();
  expect(button("Add to another project...")).toBeUndefined();
  expect(button("Add to Owner app").disabled).toBe(false);
  expect(state.prepare).not.toHaveBeenCalled();
});
