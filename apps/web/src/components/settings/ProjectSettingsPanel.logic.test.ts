import { describe, expect, it } from "vite-plus/test";

import {
  projectGroupTitleNeedsUpdate,
  projectSettingsLocationSuccessor,
} from "./ProjectSettingsPanel.logic";

describe("projectGroupTitleNeedsUpdate", () => {
  it("updates divergent member titles even when the next title is the derived group label", () => {
    expect(
      projectGroupTitleNeedsUpdate(["local-title", "remote-title"], "Repository name", true),
    ).toBe(true);
  });

  it("skips an untouched blur when the derived label differs from member titles", () => {
    expect(projectGroupTitleNeedsUpdate(["repo-slug", "repo-slug"], "Repository Name", false)).toBe(
      false,
    );
  });

  it("skips an update when every member already has the next title", () => {
    expect(projectGroupTitleNeedsUpdate(["Shared name", "Shared name"], "Shared name", true)).toBe(
      false,
    );
  });
});

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
