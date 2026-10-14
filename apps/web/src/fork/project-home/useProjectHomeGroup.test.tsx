import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useProjectHomeGroup } from "./useProjectHomeGroup";
const state = vi.hoisted(() => ({
  groups: [] as Array<{
    projectKey: string;
    memberProjects: Array<{ environmentId: string; id: string; workspaceRoot: string }>;
  }>,
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: () => ({
    sidebarProjectGroupingMode: "repository",
    sidebarProjectGroupingOverrides: {},
  }),
}));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: [] }),
  usePrimaryEnvironmentId: () => "mac",
}));
vi.mock("~/state/entities", () => ({
  useProjects: () => [],
  useAllEnvironmentProjectSnapshotsReady: () => true,
}));
vi.mock("~/sidebarProjectGrouping", () => ({
  buildSidebarProjectSnapshots: () => state.groups,
  getSidebarProjectSettingsKey: (group: { projectKey: string }) => group.projectKey,
}));
let renderer: ReactTestRenderer | null = null;
let home: ReturnType<typeof useProjectHomeGroup>;
const pi = {
  environmentId: EnvironmentId.make("pi"),
  id: ProjectId.make("prepared-id"),
  workspaceRoot: "/ssd/clone",
};
const oldKey = "pi:/ssd/clone";
const ref = { environmentId: pi.environmentId, projectId: pi.id };
function Home() {
  const value = useProjectHomeGroup(oldKey, ref);
  useLayoutEffect(() => {
    home = value;
  });
  return null;
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it("keeps an already-open prepared project available when clone metadata changes its logical key", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.groups = [{ projectKey: oldKey, memberProjects: [pi] }];
  await act(async () => {
    renderer = create(<Home />);
  });
  expect(home.group?.projectKey).toBe(oldKey);
  state.groups = [{ projectKey: "github.com/example/project", memberProjects: [pi] }];
  await act(async () => renderer?.update(<Home />));
  expect(home.group?.projectKey).toBe("github.com/example/project");
  expect(home.resolvedProjectRef).toEqual(ref);
  state.groups = [];
  await act(async () => renderer?.update(<Home />));
  expect(home.group).toBeNull();
});
