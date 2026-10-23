// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  inspect: vi.fn(),
  create: vi.fn(),
  browse: vi.fn(),
  refresh: vi.fn(),
  allowed: true,
  online: true,
  browseError: null as string | null,
  pending: false,
}));
vi.mock("./state", () => ({
  projectLibrary: { inspectFolder: "inspect", createProject: "create" },
  useLibraryPermission: () => state.allowed,
  useLibraryProjects: () => ({
    authorityId: "library",
    connected: true,
    query: { data: [], isPending: false },
    environments: ["dorothy", "remote"].map((id) => ({
      environmentId: id,
      label: id,
      entry: { enabled: true },
      connection: { phase: state.online ? "connected" : "disconnected" },
      serverConfig: { environment: { capabilities: { supportsExecution: true } } },
    })),
  }),
}));
vi.mock("./attempts", () => ({ useLibraryAttempt: () => [null, vi.fn()] }));
vi.mock("./ReleaseCopyDialog", () => ({ ReleaseCopyDialog: () => null }));
vi.mock("~/state/environments", () => ({ usePrimaryEnvironmentId: () => "dorothy" }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "inspect" ? state.inspect : state.create),
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
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
        <button key={item.id} disabled={props.busy || item.disabled} onClick={item.select}>
          {item.title}
        </button>
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
  state.allowed = true;
  state.online = true;
  state.browseError = null;
  state.pending = false;
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
