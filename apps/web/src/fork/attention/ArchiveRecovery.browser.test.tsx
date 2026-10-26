import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { makeThreadFixture } from "../../test-fixtures";

const archiveThread = makeThreadFixture({ archivedAt: "2026-10-20T00:00:00Z" }).source;
const archiveProject = {
  id: archiveThread.projectId,
  title: "Project",
  workspaceRoot: "/workspace/project",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
};

const state = vi.hoisted(() => ({
  unarchive: vi.fn(),
  refresh: vi.fn(),
}));
const environmentId = EnvironmentId.make("archive-computer");
vi.mock(import("../../components/settings/SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "all", environmentIds: [environmentId] },
    groups: [],
    environments: [],
  })) as never,
}));
vi.mock(import("../../lib/archivedThreadsState"), async (original) => ({
  ...(await original()),
  useArchivedThreadSnapshots: () => ({
    snapshots: [
      {
        environmentId,
        snapshot: {
          schemaVersion: 1,
          snapshotSequence: 0,
          archivedThreads: [],
          projects: [archiveProject],
          threads: ["Fix DNS", "Review docs"].map((title) => ({
            ...archiveThread,
            id: ThreadId.make(title),
            title,
          })),
        },
      },
    ],
    isLoading: false,
    error: null,
    refresh: state.refresh,
  }),
}));
vi.mock(import("../../hooks/useThreadActions"), async (original) => ({
  ...(await original()),
  useThreadActions: (() => ({ unarchiveThread: state.unarchive })) as never,
}));
// The scope header needs a router and connected computers; this test exercises archive recovery.
vi.mock(import("../../components/settings/settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock(import("../../components/ProjectFavicon"), async (original) => ({
  ...(await original()),
  ProjectFavicon: () => null,
}));
import { ArchivedThreadsPanel } from "../../components/settings/ArchivedThreadsPanel";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  state.unarchive.mockResolvedValue({ _tag: "Success", value: undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ArchivedThreadsPanel />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("finds an archived conversation by title and reopens it with navigation", async () => {
  const search = page.getByRole("searchbox", { name: "Search archived thread titles" });
  await userEvent.fill(search, " DNS ");
  expect(container.textContent).toContain("Fix DNS");
  expect(container.textContent).not.toContain("Review docs");
  await userEvent.click(page.getByRole("button", { name: "Unarchive and open" }));
  expect(state.unarchive).toHaveBeenCalledWith(
    { environmentId, threadId: ThreadId.make("Fix DNS") },
    { navigate: true },
  );
  expect(state.refresh).toHaveBeenCalledOnce();
  await userEvent.fill(search, "does not exist");
  expect(container.textContent).toContain("No archived threads match this search");
  await userEvent.fill(search, "");
  expect(container.textContent).toContain("Review docs");
});
