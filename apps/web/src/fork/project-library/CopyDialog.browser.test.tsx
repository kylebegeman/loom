import { LIBRARY_FOLDER_OCCUPIED_MESSAGE } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryPlacement, LibraryProject } from "@t3tools/contracts/fork";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({
  vaultFeature: false,
  writeAllowed: true,
  commands: { prepare: {}, register: {}, inspect: {}, outcome: {} },
  outcome: vi.fn(),
  attempt: null as unknown,
  prepare: vi.fn(),
  register: vi.fn(),
  inspect: vi.fn(),
  placementTargets: [] as unknown[],
  browsed: null as null | { path: string; repository: boolean; entries: string[] },
}));
const placement: LibraryPlacement = {
  action: "clone",
  rootPath: "/Users/kyle/Developer/active/corbelo",
  ownership: "managed",
  reason: "A new folder in the Projects folder",
};
const computer = (environmentId: string, label: string) => ({
  environmentId,
  label,
  entry: { enabled: true, target: { _tag: "BearerConnectionTarget", connectionId: "remote" } },
  connection: { phase: "connected" },
  serverConfig: {
    serverChosenFolders: true,
    newProjectsRoot: "/Users/kyle/Developer/active",
    folders: { projects: "/Users/kyle/Developer/active", worktrees: "/Users/kyle/.t3/worktrees" },
    environment: {
      capabilities: {
        supportsExecution: true,
        loomFeatures: [
          "project-library",
          ...(state.vaultFeature ? ["library-repository-access"] : []),
        ],
      },
    },
  },
});
vi.mock("./state", () => ({
  projectLibrary: {
    operationOutcome: state.commands.outcome,
    prepareCopy: state.commands.prepare,
    registerCopy: state.commands.register,
    inspectFolder: state.commands.inspect,
    preparation: {},
    placement: {
      resultAtom: (target: unknown) => {
        state.placementTargets.push(target);
        return "placement";
      },
    },
  },
  libraryGitHub: { readiness: {} },
  useLibraryAuthority: () => ({
    authorityId: "library",
    connected: true,
    environments: [computer("dorothy", "Dorothy"), computer("air", "Air")],
  }),
  useLibraryPermission: (command: unknown) =>
    command === state.commands.outcome || state.writeAllowed,
  useAccessBlock: () => null,
}));
vi.mock("../vault/GitHubConnectionPicker", () => ({
  VaultGitHubConnectionPicker: ({
    onSelect,
  }: {
    onSelect: (id: string, repo: string, info: { item: { version: number } }) => void;
  }) => (
    <button onClick={() => onSelect("1".repeat(32), "kyle/corbelo", { item: { version: 7 } })}>
      Fixture Vault connection
    </button>
  ),
}));
vi.mock("./LibraryAccessNotice", () => ({
  LibraryAccessRepairNotice: () => null,
  LibraryAccessNotice: () => null,
}));
vi.mock("./attempts", () => ({ useLibraryAttempt: () => [state.attempt, vi.fn()] }));
vi.mock("~/state/environments", async (original) => ({
  ...(await original<typeof import("~/state/environments")>()),
  usePrimaryEnvironmentId: () => "phone",
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: unknown) =>
    atom === "placement"
      ? { data: placement, error: null, isPending: false }
      : { data: undefined, error: null, isPending: false },
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => vi.fn(async () => ({ _tag: "Success", value: null })),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === state.commands.outcome
      ? state.outcome
      : command === state.commands.prepare
        ? state.prepare
        : command === state.commands.register
          ? state.register
          : command === state.commands.inspect
            ? state.inspect
            : vi.fn(),
}));
vi.mock("./LibraryFolderPalette", async (original) => ({
  ...(await original<typeof import("./LibraryFolderPalette")>()),
  LibraryFolderPalette: (props: {
    actions: (folder: typeof state.browsed) => { id: string; title: string; select: () => void }[];
  }) => (
    <>
      {props.actions(state.browsed).map((item) => (
        <button key={item.id} type="button" onClick={item.select}>
          {item.title}
        </button>
      ))}
    </>
  ),
}));

import { CopyDialog } from "./CopyDialog";

const project = {
  id: "corbelo",
  title: "Corbelo",
  revision: 1,
  resources: [
    {
      id: "repo",
      kind: "repository",
      title: "corbelo",
      url: null,
      remoteUrl: "https://github.com/kyle/corbelo",
      relativePath: ".",
      defaultBranch: null,
    },
  ],
} as unknown as LibraryProject;

it("shows where the chosen computer puts the files and prepares them without a typed folder", async () => {
  state.prepare.mockResolvedValue({ _tag: "Success", value: { id: "copy", state: "ready" } });
  state.register.mockResolvedValue({ _tag: "Success", value: { id: "copy", state: "ready" } });
  const onSaved = vi.fn();
  await using _screen = await render(
    <CopyDialog project={project} strategy="clone" onSaved={onSaved} onClose={vi.fn()} />,
  );
  await expect.element(page.getByText("Loom will put the files in")).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("combobox"));
  await userEvent.click(page.getByRole("option", { name: "Air" }));
  await expect
    .element(page.getByText("Loom will put the files in /Users/kyle/Developer/active/corbelo"))
    .toBeVisible();
  expect(state.placementTargets).toContainEqual({
    environmentId: "air",
    input: { projectId: "corbelo" },
  });
  expect(page.getByRole("textbox").elements()).toHaveLength(0);
  // The closing select leaves an inert layer over the dialog until its exit animation ends.
  const prepare = page.getByRole("button", { name: "Prepare files" }).element() as HTMLElement;
  await act(() => prepare.click());
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  const [{ environmentId, input }] = state.prepare.mock.calls[0]!;
  expect(environmentId).toBe("air");
  expect(input).not.toHaveProperty("rootPath");
  expect(input).toMatchObject({ strategy: "clone", project: { id: "corbelo" } });
});

// A closing dialog leaves an inert layer over the next one until its exit animation ends.
const press = async (name: string) => {
  const button = page.getByRole("button", { name });
  await expect.element(button).toBeInTheDocument();
  await act(() => (button.element() as HTMLElement).click());
};

it("uses a browsed folder only when it holds the project, and downloads into a new folder inside it", async () => {
  state.prepare.mockReset();
  state.browsed = {
    path: "/Users/kyle/Developer/active",
    repository: false,
    entries: ["corbelo", "other"],
  };
  state.inspect.mockResolvedValueOnce({
    _tag: "Success",
    value: {
      rootPath: "/Users/kyle/Developer/active",
      exists: true,
      repositories: [
        {
          path: "/Users/kyle/Developer/active/other",
          relativePath: "other",
          remoteUrl: "https://github.com/kyle/other",
          head: null,
          branch: null,
        },
      ],
    },
  });
  await using _screen = await render(
    <CopyDialog
      project={project}
      strategy="clone"
      initialHostId={"air" as never}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await press("Choose another folder");
  await press("Use files in this folder");
  await expect.element(page.getByText(LIBRARY_FOLDER_OCCUPIED_MESSAGE)).toBeVisible();

  state.inspect.mockResolvedValueOnce({
    _tag: "Success",
    value: { rootPath: "/Users/kyle/Developer/active/corbelo-2", exists: false, repositories: [] },
  });
  await press("Choose another folder");
  await press("Download into a new folder here");
  await expect
    .element(page.getByText("Loom will put the files in /Users/kyle/Developer/active/corbelo-2"))
    .toBeVisible();
  expect(state.inspect).toHaveBeenLastCalledWith({
    environmentId: "air",
    input: { rootPath: "/Users/kyle/Developer/active/corbelo-2" },
  });
});

it("checks a persisted preparation before retrying and leaves running work alone", async () => {
  state.prepare.mockReset();
  state.register.mockReset();
  state.outcome.mockReset().mockResolvedValue({
    _tag: "Success",
    value: {
      kind: "prepare",
      environmentId: "air",
      projectId: project.id,
      state: "running",
      result: null,
    },
  });
  state.attempt = {
    environmentId: "air",
    input: { requestId: "original", project, strategy: "clone" },
    registerRequestId: "original-register",
    copy: null,
  };
  try {
    await using _screen = await render(
      <CopyDialog project={project} strategy="clone" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await press("Retry preparation");
    await expect
      .element(
        page.getByText(
          "This preparation is already in progress. Check its result before retrying.",
        ),
      )
      .toBeVisible();
    expect(state.outcome).toHaveBeenCalledExactlyOnceWith({
      environmentId: "air",
      input: { requestId: "original", kind: "prepare" },
    });
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  } finally {
    state.attempt = null;
  }
});

it("pins the reviewed Vault route and blocks hosts that cannot honor it", async () => {
  state.vaultFeature = true;
  state.prepare
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { id: "copy", state: "ready" } });
  state.register
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { id: "copy", state: "ready" } });
  const onSaved = vi.fn(),
    onClose = vi.fn();
  try {
    await using screen = await render(
      <CopyDialog
        project={project}
        strategy="clone"
        initialHostId={EnvironmentId.make("air")}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    await press("Choose Vault GitHub connection");
    await press("Fixture Vault connection");
    await expect.element(page.getByText("Vault GitHub for kyle/corbelo, version 7")).toBeVisible();
    state.vaultFeature = false;
    await screen.rerender(
      <CopyDialog
        project={project}
        strategy="clone"
        initialHostId={EnvironmentId.make("air")}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: "Prepare files", exact: true }))
      .toBeDisabled();
    expect(state.prepare).not.toHaveBeenCalled();
    state.vaultFeature = true;
    await screen.rerender(
      <CopyDialog
        project={project}
        strategy="clone"
        initialHostId={EnvironmentId.make("air")}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    await press("Prepare files");
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(state.prepare.mock.calls[0]?.[0].input.repositoryAccess).toEqual([
      {
        resourceId: "repo",
        access: {
          kind: "vault-github",
          id: "1".repeat(32),
          expectedVersion: 7,
          repository: "kyle/corbelo",
        },
      },
    ]);
  } finally {
    state.vaultFeature = false;
  }
});

it("checks a saved preparation without issuing a prepare or registration write", async () => {
  state.writeAllowed = false;
  state.attempt = {
    environmentId: "air",
    input: { requestId: "original-prepare", project, strategy: "clone" },
    registerRequestId: "original-registration",
    copy: null,
  };
  state.outcome.mockReset().mockResolvedValue({ _tag: "Success", value: null });
  state.prepare.mockClear();
  state.register.mockClear();
  try {
    await using _screen = await render(
      <CopyDialog project={project} strategy="clone" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await press("Retry preparation");
    await vi.waitFor(() => expect(state.outcome).toHaveBeenCalledOnce());
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  } finally {
    state.attempt = null;
    state.writeAllowed = true;
  }
});
