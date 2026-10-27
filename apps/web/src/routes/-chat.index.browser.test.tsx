import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ComponentType } from "react";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  handleNewThread: vi.fn(),
  authorityId: null as string | null,
  primaryConfigAtom: {},
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useRouteContext: () => ({ authGateState: { status: "authenticated" } }),
  }),
}));
vi.mock("@effect/atom-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@effect/atom-react")>();
  return {
    ...actual,
    useAtomValue: (atom: never) =>
      atom === state.primaryConfigAtom
        ? { environment: { capabilities: { libraryAuthority: false, supportsExecution: true } } }
        : actual.useAtomValue(atom),
  };
});
vi.mock("~/state/server", () => ({ primaryServerConfigAtom: state.primaryConfigAtom }));
vi.mock("../hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => state.handleNewThread,
}));
vi.mock("../state/entities", () => ({
  readProject: () => ({}),
  useAllEnvironmentShellsBootstrapped: () => true,
  useProjects: () => [{}],
  useThreadShells: () => [],
}));
vi.mock("../state/environments", () => ({
  useConnectedEnvironmentIds: () => ["dorothy"],
  useEnvironments: () => ({ environments: [], isReady: true }),
}));
vi.mock("../lib/indexDraftLanding", () => ({
  resolveIndexDraftProject: () => ({
    environmentId: EnvironmentId.make("dorothy"),
    id: ProjectId.make("loom"),
  }),
}));
vi.mock("~/fork/project-library/state", () => ({
  useLibraryAuthority: () => ({ authorityId: state.authorityId }),
}));
vi.mock("../components/NoProjectsHero", () => ({
  NoProjectsHero: ({ savedProjectsUnavailable }: { savedProjectsUnavailable: boolean }) => (
    <p>{savedProjectsUnavailable ? "Reconnect to your projects" : "What should we work on?"}</p>
  ),
}));
vi.mock("~/fork/project-library/LibraryThreadHome", () => ({
  LibraryThreadHome: () => <p>Conversations</p>,
}));
vi.mock("../components/WorkspacePageHeader", () => ({ WorkspacePageHeader: () => null }));
vi.mock("../components/HostedEmptyState", () => ({ HostedEmptyState: () => null }));

import { Route } from "./_chat.index";

const ChatIndex = (Route as unknown as { options: { component: ComponentType } }).options.component;

function setup(authorityId: string | null = null) {
  state.authorityId = authorityId;
  state.handleNewThread.mockReset();
}

it("lands on the home screen, without retrying, when the Library holds the latest project", async () => {
  setup();
  // What the real handler does for a Library folder: the Library takes the start, and the result
  // is the same null as a lost race.
  state.handleNewThread.mockImplementation(
    async (_ref: unknown, options?: { onLibraryStart?: () => void }) => {
      options?.onLibraryStart?.();
      return null;
    },
  );
  await using screen = await render(<ChatIndex />);

  await expect.element(screen.getByText("What should we work on?")).toBeVisible();
  expect(state.handleNewThread).toHaveBeenCalledOnce();
});

it("shows the Library's conversations instead when a Library is connected", async () => {
  setup("library");
  state.handleNewThread.mockImplementation(
    async (_ref: unknown, options?: { onLibraryStart?: () => void }) => {
      options?.onLibraryStart?.();
      return null;
    },
  );
  await using screen = await render(<ChatIndex />);

  await expect.element(screen.getByText("Conversations")).toBeVisible();
  expect(state.handleNewThread).toHaveBeenCalledOnce();
});

it("still retries a start that lost a race, and opens the draft", async () => {
  setup();
  state.handleNewThread
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ draftId: "draft", threadId: "thread" });
  await using _screen = await render(<ChatIndex />);

  await vi.waitFor(() => expect(state.handleNewThread).toHaveBeenCalledTimes(2));
});
