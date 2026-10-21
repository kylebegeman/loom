import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { projectFolderSettingsSuccessor } from "./projectFolderSettingsSelection";

const project: EnvironmentProject = {
  environmentId: EnvironmentId.make("computer"),
  id: ProjectId.make("project-with-history"),
  title: "Office",
  workspaceRoot: "/work/office",
  defaultModelSelection: null,
  repositoryIdentity: null,
  scripts: [],
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
function groups(projects: readonly EnvironmentProject[]) {
  return buildProjectGroups({
    projects,
    settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
  });
}

describe("settings selection after correcting a folder location", () => {
  it("keeps the same project selected when a folder update changes its group key", () => {
    const previous = groups([project])[0]!;
    const updated = groups([{ ...project, workspaceRoot: "/work/desk" }]);
    expect(updated[0]!.key).not.toBe(previous.key);
    expect(projectFolderSettingsSuccessor(updated, previous.key, previous)).toBe(updated[0]!.key);
  });

  it("retains the current selection when its group still exists", () => {
    const current = groups([project]);
    expect(projectFolderSettingsSuccessor(current, current[0]!.key, current[0]!)).toBeNull();
  });

  it("does not override a new selection or restore a selection after selecting all projects", () => {
    const previous = groups([project])[0]!;
    const updated = groups([{ ...project, workspaceRoot: "/work/desk" }]);
    expect(projectFolderSettingsSuccessor(updated, "different-selection", previous)).toBeNull();
    expect(projectFolderSettingsSuccessor(updated, null, previous)).toBeNull();
  });

  it("does not follow the same project ID on another computer or a replacement record", () => {
    const previous = groups([project])[0]!;
    const updated = groups([
      { ...project, environmentId: EnvironmentId.make("other-computer") },
      { ...project, id: ProjectId.make("replacement"), workspaceRoot: "/work/desk" },
    ]);
    expect(projectFolderSettingsSuccessor(updated, previous.key, previous)).toBeNull();
  });
});
