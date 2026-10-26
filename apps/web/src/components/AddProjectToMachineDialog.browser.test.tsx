import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../test/render";

const state = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("../state/entities", async (original) => ({
  ...(await original<object>()),
  useProject: () => ({
    environmentId: "dorothy",
    id: "corbelo",
    title: "corbelo",
    workspaceRoot: "/Users/kyle/Projects/corbelo",
    repositoryIdentity: {
      rootPath: "/Users/kyle/Projects/corbelo",
      locator: { remoteName: "origin", remoteUrl: "https://github.com/kyle/corbelo" },
    },
  }),
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<object>()),
  useEnvironments: () => ({
    environments: [
      { environmentId: "dorothy", label: "Dorothy", serverConfig: null },
      {
        environmentId: "mini",
        label: "Mini",
        serverConfig: {
          serverChosenFolders: true,
          settings: { addProjectBaseDirectory: "~/Code" },
        },
      },
    ],
  }),
}));
vi.mock("../hooks/useAddProjectTargets", () => ({
  useAddProjectTargets: () => [{ environmentId: "mini", label: "Mini", machine: "laptop" }],
}));
vi.mock("../hooks/useLogicalProjectEnvironments", () => ({
  useLogicalProjectEnvironments: () => [],
}));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock("../lib/addProjectToMachine", async (original) => ({
  ...(await original<object>()),
  addProjectToMachine: state.add,
}));

import {
  AddProjectToMachineDialogHost,
  openAddProjectToMachine,
} from "./AddProjectToMachineDialog";

const request = {
  projectRef: {
    environmentId: EnvironmentId.make("dorothy"),
    projectId: ProjectId.make("corbelo"),
  },
  targetEnvironmentId: EnvironmentId.make("mini"),
};

it("leaves the folder to a computer that chooses one", async () => {
  state.add.mockResolvedValue(undefined);
  openAddProjectToMachine(request);
  await using _screen = await render(<AddProjectToMachineDialogHost />);
  await expect.element(page.getByPlaceholder("Projects folder")).toHaveValue("");
  const clone = page.getByRole("button", { name: "Clone to Mini" }).element() as HTMLElement;
  await act(() => clone.click());
  await vi.waitFor(() => expect(state.add).toHaveBeenCalledOnce());
  expect(state.add.mock.calls[0]![0].destinationPath).toBe("");
});
