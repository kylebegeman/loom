import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser"; // fork: file-placement

import { act, render } from "../../test/render";

const project = vi.hoisted(() => {
  let value: unknown = null;
  const listeners = new Set<() => void>();
  return {
    // Each test starts from no project and no listeners left by an earlier test.
    setup: (initial: unknown) => {
      value = initial;
      listeners.clear();
    },
    get: () => value,
    set: (next: unknown) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
// fork: file-placement
const machines = vi.hoisted(() => {
  let current = { environments: [] as unknown[], targets: [] as unknown[] };
  const add = vi.fn();
  return {
    add,
    setup: (next: typeof current = { environments: [], targets: [] }) => {
      current = next;
      add.mockReset();
    },
    environments: () => current.environments,
    targets: () => current.targets,
  };
});

vi.mock(import("../state/entities"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original()),
    readProject: (() => project.get()) as never,
    subscribeProject: ((_ref: unknown, listener: (value: unknown) => void) =>
      project.subscribe(() => listener(project.get()))) as never,
    useProject: (() => useSyncExternalStore(project.subscribe, project.get)) as never,
  };
});
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: machines.environments() })) as never, // fork: file-placement
}));
vi.mock(import("../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => () => undefined) as never,
}));
vi.mock(import("../hooks/useAddProjectTargets"), async (original) => ({
  ...(await original()),
  useAddProjectTargets: (() => machines.targets()) as never, // fork: file-placement
}));
vi.mock(import("../hooks/useLogicalProjectEnvironments"), async (original) => ({
  ...(await original()),
  useLogicalProjectEnvironments: (() => []) as never,
}));
// fork: file-placement
vi.mock(import("../lib/addProjectToMachine"), async (original) => ({
  ...(await original()),
  addProjectToMachine: machines.add as never,
}));

import {
  AddProjectToMachineDialogHost,
  openAddProjectToMachine,
} from "./AddProjectToMachineDialog";

const environmentId = EnvironmentId.make("environment-1");
const projectRef = scopeProjectRef(environmentId, ProjectId.make("project-1"));
const PROJECT = {
  environmentId,
  id: projectRef.projectId,
  title: "Repo",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
};

describe("AddProjectToMachineDialog", () => {
  it("closes when its project goes away", async () => {
    project.setup(PROJECT);
    machines.setup(); // fork: file-placement
    await using screen = await render(<AddProjectToMachineDialogHost />);

    await act(() => openAddProjectToMachine({ projectRef, targetEnvironmentId: null }));
    await expect.element(screen.getByText("Add to another machine")).toBeInTheDocument();

    await act(() => project.set(null));
    await act(() => project.set(PROJECT));
    await expect.element(screen.getByText("Add to another machine")).not.toBeInTheDocument();
  });

  it("does not reopen for a project that vanished before the dialog showed", async () => {
    project.setup(PROJECT);
    machines.setup(); // fork: file-placement
    await using screen = await render(<AddProjectToMachineDialogHost />);

    await act(() => {
      openAddProjectToMachine({ projectRef, targetEnvironmentId: null });
      project.set(null);
    });
    await act(() => project.set(PROJECT));

    await expect.element(screen.getByText("Add to another machine")).not.toBeInTheDocument();
  });

  // fork: file-placement
  it("leaves the folder to a computer that chooses one", async () => {
    project.setup({
      ...PROJECT,
      repositoryIdentity: {
        rootPath: "/repo",
        locator: { remoteName: "origin", remoteUrl: "https://github.com/kyle/corbelo" },
      },
    });
    machines.setup({
      environments: [
        { environmentId, label: "Dorothy", serverConfig: null },
        {
          environmentId: "mini",
          label: "Mini",
          serverConfig: {
            serverChosenFolders: true,
            settings: { addProjectBaseDirectory: "~/Code" },
          },
        },
      ],
      targets: [{ environmentId: "mini", label: "Mini", machine: "laptop" }],
    });
    machines.add.mockResolvedValue(undefined);
    await using _screen = await render(<AddProjectToMachineDialogHost />);
    await act(() =>
      openAddProjectToMachine({ projectRef, targetEnvironmentId: EnvironmentId.make("mini") }),
    );
    await expect.element(page.getByPlaceholder("Projects folder")).toHaveValue("");
    const clone = page.getByRole("button", { name: "Clone to Mini" }).element() as HTMLElement;
    await act(() => clone.click());
    await vi.waitFor(() => expect(machines.add).toHaveBeenCalledOnce());
    expect(machines.add.mock.calls[0]![0].destinationPath).toBe("");
  });
});
