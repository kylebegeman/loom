import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";

import { projectSettingsLocationSuccessor } from "./ProjectSettingsPanel.logic"; // fork: project-home

describe("project removal confirmation", () => {
  const local = {
    id: ProjectId.make("shared-id"),
    environmentId: EnvironmentId.make("local"),
    title: "Repo",
    workspaceRoot: "/work/repo",
    environmentLabel: "Local",
  };
  const remote = {
    ...local,
    environmentId: EnvironmentId.make("remote"),
    environmentLabel: "Remote",
  };

  it("limits a checkout's thread count to its environment and project", () => {
    const plan = planProjectRemoval({
      members: [local],
      groupMemberCount: 2,
      hasOtherMembers: false,
      displayName: "Repo",
      threads: [
        { environmentId: local.environmentId, projectId: local.id },
        { environmentId: remote.environmentId, projectId: remote.id },
      ],
    });
    expect(plan.projectThreads).toHaveLength(1);
    expect(plan.confirmationMessage).toBe(
      'Remove checkout "Repo" and delete its 1 thread?\nPath: /work/repo\nEnvironment: Local\nThose threads and any archived threads are deleted from T3 Code. Provider sessions are kept.\nOther entries in this grouped project are unaffected.\nThis action cannot be undone.',
    );
  });

  it("keeps an environment-filtered group scoped to its selected checkout", () => {
    const plan = planProjectRemoval({
      members: [remote],
      groupMemberCount: 1,
      hasOtherMembers: true,
      displayName: "Repo",
      threads: [],
    });
    expect(plan.targetKind).toBe("checkout");
    expect(plan.confirmationMessage).toContain("Environment: Remote");
    expect(plan.confirmationMessage).toContain(
      "Other entries in this grouped project are unaffected.",
    );
    expect(plan.confirmationMessage).toContain(
      "Any archived threads are deleted from T3 Code. Provider sessions are kept.",
    );
  });

  // regression: #21409 project-wide removal must count every checkout's threads and keep files
  it("states the full group count and preserves files when removing a project everywhere", () => {
    const plan = planProjectRemoval({
      members: [local, remote],
      groupMemberCount: 2,
      hasOtherMembers: false,
      displayName: "Repo",
      threads: [],
    });
    expect(plan.targetKind).toBe("project");
    expect(plan.confirmationMessage).toContain("This removes 2 grouped project entries.");
    expect(plan.confirmationMessage).toContain(
      "This removes only the project entries, not the files on disk.",
    );
  });
});

// fork: project-home
describe("projectSettingsLocationSuccessor", () => {
  const moved = {
    projectKey: "new-group",
    memberProjects: [
      { environmentId: "remote", id: "existing-project", physicalProjectKey: "remote:/work/desk" },
    ],
  };

  it("follows the same project after its folder and grouping key change", () => {
    expect(
      projectSettingsLocationSuccessor([moved], ["remote:existing-project"], "remote:/work/office"),
    ).toEqual({ project: "new-group", checkout: "remote:/work/desk" });
  });

  it("keeps an unscoped group selection unscoped", () => {
    expect(projectSettingsLocationSuccessor([moved], ["remote:existing-project"], null)).toEqual({
      project: "new-group",
      checkout: undefined,
    });
  });

  it("does not follow another record or another computer at the old path", () => {
    const unrelated = {
      projectKey: "other-group",
      memberProjects: [
        {
          environmentId: "local",
          id: "existing-project",
          physicalProjectKey: "local:/work/office",
        },
        {
          environmentId: "remote",
          id: "different-project",
          physicalProjectKey: "remote:/work/office",
        },
      ],
    };
    expect(
      projectSettingsLocationSuccessor(
        [unrelated],
        ["remote:existing-project"],
        "remote:/work/office",
      ),
    ).toBeNull();
    expect(
      projectSettingsLocationSuccessor(
        [unrelated, moved],
        ["remote:existing-project"],
        "remote:/work/office",
      ),
    ).toEqual({ project: "new-group", checkout: "remote:/work/desk" });
  });
});
