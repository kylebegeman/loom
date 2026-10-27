import { act, render } from "../../../test/render";
import { RegistryProvider } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS, type StorageCleanupReport } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_SERVER_SETTINGS,
  run: vi.fn(),
  report: null as StorageCleanupReport | null,
}));

// fork: project-lifecycle -- row actions use navigation and live thread state.
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({ settleThread: vi.fn() }),
}));
vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useThreadShells: () => [],
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const report = Atom.make(() => ({ _tag: "Success", value: state.report, waiting: false }));
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      storageCleanupReport: (() => report) as never,
      runStorageCleanup: {
        ...actual.serverEnvironment.runStorageCleanup,
        permissionAtom: () => allowed,
      },
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.run) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environment = {
      environmentId: "env",
      label: "Build workstation",
      serverConfig: {
        settings: state.settings,
        environment: {
          capabilities: {
            storageCleanup: true,
            storageCleanupRun: true,
            settledWorktreeCleanup: true,
          },
        },
      },
    };
    return {
      scope: { kind: "environment" },
      environments: [environment],
      connectedEnvironments: [environment],
      targets: [],
      target: null,
    };
  }) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => vi.fn(),
  useClearScopedSettings: () => vi.fn(),
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: (({ children }: { children: ReactNode }) => children) as never,
  SettingsRow: ({ title, description, control, children }) => (
    <div>
      <h3>{title}</h3>
      {description}
      {control}
      {children}
    </div>
  ),
  SettingResetButton: (() => null) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: vi.fn() } };
});

import { StorageCleanupSections } from "./StorageSettings";

function setup() {
  state.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    storageCleanup: {
      worktreeKeepWhen: "uncommitted-changes",
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
      worktreeOnMerge: false,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      // fork: project-lifecycle. Loom's settle, land, project and Scratch rules stay off here.
      worktreeOnSettle: false,
      worktreeOnLand: false,
      projectAfterDays: null,
      projectOnSettle: false,
      scratchAfterDays: null,
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
    },
    projectSettingsOverrides: {},
  };
  state.report = null;
  state.run.mockReset();
}

const panel = () => (
  <RegistryProvider>
    <StorageCleanupSections />
  </RegistryProvider>
);
const deleteButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Delete now",
  )!;

it("keeps cleanup disabled when settled retention and all other rules are off", async () => {
  setup();
  await using screen = await render(panel());
  const button = deleteButton(screen.container);

  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(state.run).not.toHaveBeenCalled();
});

// fork: project-lifecycle
it("removes only an orphan the server marked safe, using that row's path", async () => {
  setup();
  const row = {
    kind: "worktree" as const,
    outcome: "kept" as const,
    path: "/worktrees/repo/clean",
    projectPath: null,
    threadId: null,
    threadTitle: null,
    reason: "No thread uses this worktree",
    bytes: 1024,
    files: null,
    canRemove: true,
  };
  state.report = {
    trigger: "manual",
    startedAt: "2026-10-25T12:00:00.000Z",
    finishedAt: "2026-10-25T12:00:01.000Z",
    entries: [row, { ...row, path: "/worktrees/repo/dirty", canRemove: false }],
    counts: { removed: 0, kept: 2, failed: 0 },
    omittedCount: 0,
    bytesFreed: 0,
  };
  state.run.mockResolvedValue({
    _tag: "Success",
    value: { ...state.report, entries: [{ ...row, outcome: "removed" }] },
  });
  await using screen = await render(panel());
  await act(() =>
    [...screen.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Last run"))
      ?.click(),
  );
  const removes = [...screen.container.querySelectorAll("button")].filter(
    (button) => button.textContent === "Remove",
  );
  expect(removes).toHaveLength(1);
  await act(async () => removes[0]!.click());
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: "env",
    input: { removeOrphanPath: row.path },
  });
});
