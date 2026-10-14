import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveProjectHomeDestination } from "@t3tools/client-runtime/fork";
import { derivePhysicalProjectKey } from "~/logicalProject";
import { resolveProjectHomeGroup } from "./groupResolution";
const mac = {
  environmentId: EnvironmentId.make("mac"),
  id: ProjectId.make("project-mac"),
  workspaceRoot: "/work/repository",
};
const pi = {
  environmentId: EnvironmentId.make("pi"),
  id: ProjectId.make("project-pi"),
  workspaceRoot: "/ssd/repository",
};
const piRef = { environmentId: pi.environmentId, projectId: pi.id };
const oldKey = derivePhysicalProjectKey(pi);
const repositoryKey = "github.com/example/repository";

describe("Project home key transitions", () => {
  it("keeps the same prepared checkout before and after repository metadata arrives", () => {
    const before = { projectKey: oldKey, memberProjects: [pi] };
    const after = { projectKey: repositoryKey, memberProjects: [mac, pi] };
    expect(
      resolveProjectHomeGroup({ groups: [before], projectKey: oldKey, projectRef: piRef }).group,
    ).toBe(before);
    const resolved = resolveProjectHomeGroup({
      groups: [after],
      projectKey: oldKey,
      projectRef: piRef,
    });
    expect(resolved.group).toBe(after);
    expect(resolved.projectRef).toEqual(piRef);
    expect(
      resolveProjectHomeDestination({
        memberProjects: after.memberProjects,
        chosenProjectRef: resolved.projectRef,
        connectedEnvironmentIds: new Set([mac.environmentId]),
        permittedEnvironmentIds: new Set([mac.environmentId, pi.environmentId]),
      }),
    ).toBeNull();
  });
  it("follows the exact checkout when grouping changes and the old group still contains another computer", () => {
    const original = { projectKey: repositoryKey, memberProjects: [mac] };
    const separated = { projectKey: oldKey, memberProjects: [pi] };
    const result = resolveProjectHomeGroup({
      groups: [original, separated],
      projectKey: repositoryKey,
      projectRef: piRef,
    });
    expect(result.group).toBe(separated);
    expect(result.projectRef).toEqual(piRef);
  });
  it("recovers legacy registered-folder links without inferring the filesystem state", () => {
    const after = { projectKey: repositoryKey, memberProjects: [mac, pi] };
    expect(resolveProjectHomeGroup({ groups: [after], projectKey: oldKey })).toEqual({
      group: after,
      projectRef: piRef,
    });
    const windows = { ...pi, workspaceRoot: "C:\\Work\\Repository\\" };
    const windowsGroup = { projectKey: repositoryKey, memberProjects: [windows] };
    expect(
      resolveProjectHomeGroup({
        groups: [windowsGroup],
        projectKey: derivePhysicalProjectKey(windows),
      }).projectRef,
    ).toEqual(piRef);
  });
  it("does not bind a removed explicit checkout ID to a replacement record or another computer", () => {
    const replacement = { ...pi, id: ProjectId.make("replacement-id") };
    const after = { projectKey: repositoryKey, memberProjects: [mac, replacement] };
    expect(
      resolveProjectHomeGroup({ groups: [after], projectKey: oldKey, projectRef: piRef }).group,
    ).toBeNull();
    expect(
      resolveProjectHomeGroup({ groups: [after], projectKey: oldKey }).projectRef?.projectId,
    ).toBe(replacement.id);
    const stillKnown = resolveProjectHomeGroup({
      groups: [after],
      projectKey: repositoryKey,
      projectRef: piRef,
    });
    expect(stillKnown.projectRef).toEqual(piRef);
    expect(
      resolveProjectHomeDestination({
        memberProjects: after.memberProjects,
        chosenProjectRef: stillKnown.projectRef,
        connectedEnvironmentIds: new Set([mac.environmentId, pi.environmentId]),
        permittedEnvironmentIds: new Set([mac.environmentId, pi.environmentId]),
      }),
    ).toBeNull();
  });
  it("leaves genuinely missing or ambiguously reused legacy locations unavailable", () => {
    expect(resolveProjectHomeGroup({ groups: [], projectKey: oldKey }).group).toBeNull();
    const duplicate = { ...pi, id: ProjectId.make("duplicate") };
    expect(
      resolveProjectHomeGroup({
        groups: [{ projectKey: repositoryKey, memberProjects: [pi, duplicate] }],
        projectKey: oldKey,
      }).group,
    ).toBeNull();
  });
});
