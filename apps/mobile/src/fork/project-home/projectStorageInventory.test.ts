import { projectStorageRolloutComputerLabels } from "@t3tools/client-runtime/fork";
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
  it("distinguishes same-named computers even when project names and folders match", () => {
    const projects = [
      project(local, "Atlas"),
      { ...project(remote, "Atlas"), workspaceRoot: "/work/local" },
    ];
    const qualified = projectStorageRolloutComputerLabels(
      new Map([
        [local, "Mac"],
        [remote, "Mac"],
      ]),
    );
    const rows = projectStorageInventory(projects, qualified, "");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((entry) => entry.computerLabel)).size).toBe(2);
    expect(new Set(rows.map((entry) => entry.key)).size).toBe(2);
    const matching = projectStorageInventory(projects, qualified, qualified.get(remote)!);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.project.environmentId).toBe(remote);
  });
  it("changes selection identity when a known project folder is replaced", () => {
    const original = project(local, "Atlas");
    const moved = { ...original, workspaceRoot: "/other/atlas", updatedAt: "2026-10-14T00:00:00Z" };
    const first = projectStorageInventory([original], computers, "")[0]!;
    const latest = projectStorageInventory([original, moved], computers, "");
    expect(latest).toHaveLength(1);
    expect(latest[0]!.key).not.toBe(first.key);
    expect(latest[0]!.project.workspaceRoot).toBe("/other/atlas");
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
