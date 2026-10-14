import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { projectStorageInventory } from "./projectStorageInventory";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
function project(environmentId: EnvironmentId, title: string): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make("same"),
    title,
    workspaceRoot: `/work/${environmentId}`,
    defaultModelSelection: null,
    repositoryIdentity: null,
    scripts: [],
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
  };
}
const computers = new Map([
  [local, "Mac"],
  [remote, "Pi"],
]);

describe("known project storage inventory", () => {
  it("retains separate ownership targets across computers and deduplicates repeated records", () => {
    const projects = [project(local, "Loom"), project(remote, "Loom")];
    const rows = projectStorageInventory([...projects, projects[0]!], computers, "");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.project.environmentId)).toEqual([local, remote]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });
  it("searches project names, remembered locations and computer names without losing target identity", () => {
    const projects = [project(local, "Atlas"), project(remote, "Loom")];
    expect(projectStorageInventory(projects, computers, "  pi ")[0]?.project.environmentId).toBe(
      remote,
    );
    expect(
      projectStorageInventory(projects, computers, "/work/local")[0]?.project.environmentId,
    ).toBe(local);
    expect(projectStorageInventory(projects, computers, "atlas")).toHaveLength(1);
    expect(projectStorageInventory(projects, computers, "missing")).toHaveLength(0);
  });
});
