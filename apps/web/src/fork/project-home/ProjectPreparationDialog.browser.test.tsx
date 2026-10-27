import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const { state, command, computers } = vi.hoisted(() => {
  const computer = (serverChosenFolders: boolean) => ({
    environmentId: "mini",
    label: "Mini",
    entry: { enabled: true },
    connection: { phase: "connected" },
    serverConfig: {
      ...(serverChosenFolders ? { serverChosenFolders: true } : {}),
      newProjectsRoot: "/Users/kyle/Projects",
      folders: { projects: "/Users/kyle/Projects" },
      environment: { capabilities: { supportsExecution: true, projectCloneTracking: true } },
    },
  });
  const computers = { choosing: computer(true), legacy: computer(false) };
  return {
    state: {
      start: vi.fn(),
      browsed: null as null | { path: string; repository: boolean; entries: string[] },
      computer: computers.choosing,
    },
    command: (run: unknown) => ({ run, permissionAtom: () => true }),
    computers,
  };
});
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: unknown) => atom,
}));
vi.mock("~/state/environments", async (original) => ({
  ...(await original<object>()),
  useEnvironment: (id: string) => (id === "mini" ? state.computer : null),
  useEnvironments: () => ({ environments: [state.computer] }),
}));
vi.mock("~/state/entities", async (original) => ({
  ...(await original<object>()),
  useProjects: () => [],
}));
vi.mock("~/state/shell", async (original) => {
  const Option = await import("effect/Option");
  return {
    ...(await original<object>()),
    environmentShell: {
      stateValueAtom: () => ({ status: "live", snapshot: Option.some({}) }),
    },
  };
});
vi.mock("~/state/projectClones", async (original) => ({
  ...(await original<object>()),
  useEnvironmentProjectClones: () => [],
}));
vi.mock("~/state/session", async (original) => ({
  ...(await original<object>()),
  useEnvironmentScope: () => true,
}));
vi.mock("~/state/use-atom-command", async (original) => ({
  ...(await original<object>()),
  useAtomCommand: (target: { run: unknown }) => target.run,
}));
vi.mock("~/state/sourceControl", async (original) => {
  const { AsyncResult } = await import("effect/reactivity");
  return {
    ...(await original<object>()),
    sourceControlEnvironment: {
      startProjectClone: command(state.start),
      cancelProjectClone: command(vi.fn()),
      retryProjectClone: command(vi.fn()),
      projectClones: () => AsyncResult.success([]),
    },
  };
});
vi.mock("~/fork/project-checkout/state", async (original) => ({
  ...(await original<object>()),
  projectCheckouts: { preview: () => null },
  PROJECT_CHECKOUT_FEATURE: "project-checkout",
}));
vi.mock("~/hooks/useSettings", async (original) => ({
  ...(await original<object>()),
  useClientSettings: () => ({}),
}));
vi.mock("../project-library/LibraryPalette", async (original) => ({
  ...(await original<object>()),
  LibraryPaletteDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../project-library/LibraryFolderPalette", async (original) => {
  const actual = await original<typeof import("../project-library/LibraryFolderPalette")>();
  return {
    ...actual,
    LibraryFolderPalette: ({
      actions,
      onSelect,
    }: {
      actions?: (
        folder: typeof state.browsed,
      ) => { id: string; title: string; select: () => void }[];
      onSelect?: (path: string) => void;
    }) => (
      <div>
        {actions ? (
          actions(state.browsed).map((action) => (
            <button key={action.id} type="button" onClick={action.select}>
              {action.title}
            </button>
          ))
        ) : (
          <button type="button" onClick={() => onSelect?.(state.browsed!.path)}>
            Use this folder
          </button>
        )}
      </div>
    ),
  };
});

import { ProjectPreparationDialog } from "./ProjectPreparationDialog";

const sourceProject = {
  environmentId: EnvironmentId.make("dorothy"),
  id: ProjectId.make("corbelo"),
  title: "corbelo",
} as EnvironmentProject;
const offer = {
  remoteUrl: "https://github.com/kyle/corbelo",
  repositoryKey: "github.com/kyle/corbelo",
};

function setup({
  browsed,
  destinationPath,
  computer = computers.choosing,
}: {
  browsed: NonNullable<typeof state.browsed>;
  destinationPath: string;
  computer?: typeof state.computer;
}) {
  state.start.mockReset();
  state.start.mockResolvedValue(AsyncResult.success({ projectId: "new-project", destinationPath }));
  state.browsed = browsed;
  state.computer = computer;
}

it("lets a computer that chooses folders take a folder picked without typing", async () => {
  setup({
    browsed: { path: "/Users/kyle/Code", repository: false, entries: ["notes"] },
    destinationPath: "/Users/kyle/Code/corbelo",
  });
  await using _screen = await render(
    <ProjectPreparationDialog
      sourceProject={sourceProject}
      sourceOffer={offer as never}
      initialEnvironmentId={EnvironmentId.make("mini")}
      onClose={() => undefined}
    />,
  );
  await userEvent.click(page.getByRole("button", { name: "Choose another folder" }));
  await expect
    .element(page.getByRole("button", { name: "Use files in this folder" }))
    .not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Download into a new folder here" }));
  await expect
    .element(page.getByText("Loom will put the files in /Users/kyle/Code/corbelo"))
    .toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Prepare on Mini" }));
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  expect(state.start.mock.calls[0]![0].input.destinationPath).toBe("/Users/kyle/Code/corbelo");
});

it("goes back to the computer's own folder after a picked one", async () => {
  setup({
    browsed: { path: "/Users/kyle/Empty", repository: false, entries: [] },
    destinationPath: "",
  });
  await using _screen = await render(
    <ProjectPreparationDialog
      sourceProject={{ ...sourceProject, id: ProjectId.make("other") }}
      sourceOffer={offer as never}
      initialEnvironmentId={EnvironmentId.make("mini")}
      onClose={() => undefined}
    />,
  );
  await userEvent.click(page.getByRole("button", { name: "Choose another folder" }));
  await userEvent.click(page.getByRole("button", { name: "Download into this folder" }));
  await expect
    .element(page.getByText("Loom will put the files in /Users/kyle/Empty"))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Let Loom choose the folder" }));

  await userEvent.click(page.getByRole("button", { name: "Prepare on Mini" }));
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  expect(state.start.mock.calls[0]![0].input.destinationPath ?? null).toBeNull();
});

it("sends the folder chosen by browsing to a computer that needs one", async () => {
  setup({
    browsed: { path: "/Users/kyle/Code/corbelo-next", repository: false, entries: [] },
    destinationPath: "/Users/kyle/Code/corbelo-next",
    computer: computers.legacy,
  });
  await using _screen = await render(
    <ProjectPreparationDialog
      sourceProject={{ ...sourceProject, id: ProjectId.make("legacy") }}
      sourceOffer={offer as never}
      initialEnvironmentId={EnvironmentId.make("mini")}
      onClose={() => undefined}
    />,
  );
  await expect.element(page.getByText("/Users/kyle/Projects/corbelo")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Choose Destination folder" }));
  await userEvent.click(page.getByRole("button", { name: "Use this folder" }));
  await expect.element(page.getByText("/Users/kyle/Code/corbelo-next")).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Prepare on Mini" }));
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce());
  expect(state.start.mock.calls[0]![0].input.destinationPath).toBe("/Users/kyle/Code/corbelo-next");
});
