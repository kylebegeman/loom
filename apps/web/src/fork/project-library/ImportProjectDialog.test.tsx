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
              entries: nested ? [] : [{ name: "Developer", fullPath: "/Users/kyle/Developer" }],
            }
          : null,
      isSuccess: request !== null && !state.browseError,
      isPending: state.pending,
      error: state.browseError,
      refresh: state.refresh,
    };
  },
}));
vi.mock("./LibraryControls", () => ({
  LibraryDialog: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <div>
      {children}
      {actions}
    </div>
  ),
  LibraryField: ({ label, children }: { label: string; children: ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  LibraryErrorNotice: ({ error, onRetry }: { error: string | null; onRetry?: () => void }) =>
    error ? (
      <div role="alert">
        {error}
        {onRetry ? <button onClick={onRetry}>Try again</button> : null}
      </div>
    ) : null,
}));
vi.mock("~/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectPopup: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
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
  expect(button("Choose folder")).toBeDefined();
  await act(async () => button("Choose folder").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "~/" },
  });
  await act(async () => button("Developer").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "/Users/kyle/Developer/" },
  });
  await act(async () => button("Select this folder").click());
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { rootPath: "/Users/kyle/Developer" },
  });
  expect(state.create).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Existing folder"]')?.value,
  ).toBe("/Users/kyle/Developer");
});

it("can go up or cancel without changing the chosen folder", async () => {
  await mount();
  await act(async () => button("Choose folder").click());
  await act(async () => button("Developer").click());
  await act(async () => button("Up").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "dorothy",
    input: { partialPath: "/Users/kyle/" },
  });
  await act(async () => button("Cancel selection").click());
  expect(state.inspect).not.toHaveBeenCalled();
  expect(button("Select this folder")).toBeUndefined();
});

it("does not allow a stale or failed listing to select a folder", async () => {
  await mount();
  await act(async () => button("Choose folder").click());
  state.pending = true;
  await mount();
  expect(button("Select this folder").disabled).toBe(true);
  state.pending = false;
  state.browseError = "Permission denied on this computer.";
  await mount();
  expect(container.textContent).toContain(state.browseError);
  expect(button("Select this folder").disabled).toBe(true);
  await act(async () => button("Try again").click());
  expect(state.refresh).toHaveBeenCalled();
});

it("keeps browsing unavailable when the selected computer is offline or access is denied", async () => {
  state.allowed = false;
  await mount();
  expect(button("Choose folder").disabled).toBe(true);
  expect(state.browse).not.toHaveBeenCalled();
  state.allowed = true;
  state.online = false;
  await mount();
  expect(button("Choose folder").disabled).toBe(true);
});

it("reports an inspection failure after selection without importing", async () => {
  state.inspect.mockResolvedValue(
    AsyncResult.failure(Cause.fail(new Error("Folder is unreadable."))),
  );
  await mount();
  await act(async () => button("Choose folder").click());
  await act(async () => button("Select this folder").click());
  expect(container.textContent).toContain("Folder is unreadable.");
  expect(button("Check folder").disabled).toBe(false);
  expect(state.create).not.toHaveBeenCalled();
});

it("closes the old computer's listing when the computer changes", async () => {
  await mount();
  await act(async () => button("Choose folder").click());
  const computer = container.querySelector("select")!;
  await act(async () => {
    computer.value = "remote";
    computer.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(button("Select this folder")).toBeUndefined();
  await act(async () => button("Choose folder").click());
  expect(state.browse).toHaveBeenLastCalledWith({
    environmentId: "remote",
    input: { partialPath: "~/" },
  });
  await act(async () => button("Select this folder").click());
  expect(state.inspect).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { rootPath: "/Users/kyle" },
  });
});
