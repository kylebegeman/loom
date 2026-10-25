import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryCopyStatus, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  connected: true,
  hostConnected: true,
  canRemove: true,
  canRegister: true,
  pending: false,
  status: null as LibraryCopyStatus | null,
  commands: { remove: {}, register: {} },
  run: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("./state", () => ({
  projectLibrary: {
    releaseCopy: state.commands.remove,
    unregisterCopy: state.commands.remove,
    registerCopy: state.commands.register,
    copyStatus: () => ({}),
  },
  useLibraryAuthority: () => ({
    authorityId: "library",
    connected: state.connected,
    environments: [
      {
        environmentId: "host",
        label: "Dorothy",
        connection: { phase: state.hostConnected ? "connected" : "disconnected" },
      },
    ],
  }),
  useLibraryPermission: (command: unknown) =>
    command === state.commands.remove ? state.canRemove : state.canRegister,
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.status,
    isPending: state.pending,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.run }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));

import { ReleaseCopyDialog } from "./ReleaseCopyDialog";

const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("host"),
  rootPath: "/work/project",
  rootLocalProjectId: null,
  repositories: [],
  ownership: "managed",
  state: "ready",
  registered: true,
  createdAt: "2026-10-25T12:00:00.000Z",
  updatedAt: "2026-10-25T12:00:00.000Z",
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(state, {
    connected: true,
    hostConnected: true,
    canRemove: true,
    canRegister: true,
    pending: false,
    status: {
      copy,
      blockers: [],
      releaseBlockers: [],
      reviewToken: "review",
      contentsDigest: null,
    },
  });
  state.run.mockReset();
  state.navigate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});
const render = () =>
  act(() => root.render(<ReleaseCopyDialog copy={copy} onClose={vi.fn()} onReleased={vi.fn()} />));
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((entry) => entry.textContent === name)!;

it.each([
  ["canRemove", "You do not have permission to remove files on this computer."],
  ["canRegister", "You do not have permission to register copies in the Library."],
  ["connected", "Connect to your Library to remove these files."],
  ["hostConnected", "Dorothy is offline."],
] as const)("explains the disabled removal when %s is false", async (field, reason) => {
  state[field] = false;
  await render();
  expect(button("Remove files").disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe(reason);
  await act(() => button("Remove files").click());
  expect(state.run).not.toHaveBeenCalled();
});

it("opens the conversation holding a linked worktree while removal stays blocked", async () => {
  state.status = {
    ...state.status!,
    releaseBlockers: ["Land or remove /work/feature first."],
    releaseBlockerThreads: [
      { threadId: "conversation" as never, title: "Finish feature", worktreePath: "/work/feature" },
    ],
  };
  await render();
  expect(button("Remove files").disabled).toBe(true);
  await act(() => button("Open conversation: Finish feature").click());
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: "host", threadId: "conversation" },
  });
  expect(state.run).not.toHaveBeenCalled();
});

it("opens the project's files for a dirty copy", async () => {
  state.status = { ...state.status!, blockers: ["Uncommitted changes"] };
  await render();
  await act(() => button("Open project files").click());
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/library/$projectId",
    params: { projectId: "project" },
    search: { view: "computers" },
  });
  expect(state.run).not.toHaveBeenCalled();
});
