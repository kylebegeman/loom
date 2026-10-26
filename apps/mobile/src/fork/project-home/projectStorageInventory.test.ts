import { projectStorageRolloutComputerLabels } from "@t3tools/client-runtime/fork";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { buildHomeProjectScopes } from "../../features/home/homeThreadList";
import { filterProjectStorageInventory, projectStorageInventory } from "./projectStorageInventory";

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

const repositoryIdentity = {
  canonicalKey: "github.com/kylebegeman/atlas",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/kylebegeman/atlas.git",
  },
  provider: SourceControlProviderKind.make("github"),
  owner: "kylebegeman",
  name: "atlas",
  displayName: "Atlas",
};

describe("working-file locations within Projects library groups", () => {
  it("groups one project across computers while preserving separately selectable locations", () => {
    const projects = [
      { ...project(local, "Atlas on Mac"), repositoryIdentity },
      { ...project(remote, "Atlas on Pi"), repositoryIdentity },
      {
        ...project(local, "Atlas worktree"),
        id: ProjectId.make("worktree"),
        workspaceRoot: "/work/atlas-worktree",
        repositoryIdentity,
      },
    ];
    const rows = projectStorageInventory(projects, computers, "");
    const library = buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: "repository",
    });
    expect(library).toHaveLength(1);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.groupKey))).toEqual(new Set([library[0]!.key]));
    expect(rows.every((row) => row.groupTitle === library[0]!.title)).toBe(true);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(rows.map((row) => row.computerLabel)).toEqual(["Mac", "Mac", "Pi"]);
    const matching = projectStorageInventory(projects, computers, " Pi ");
    expect(matching).toHaveLength(1);
    expect(matching[0]!.groupKey).toBe(rows[0]!.groupKey);
    expect(matching[0]!.project.environmentId).toBe(remote);
    expect(matching[0]!.key).toBe(rows[2]!.key);
  });

  it("keeps separately owned project records at the same location instead of collapsing save targets", () => {
    const projects = [
      { ...project(local, "Atlas"), repositoryIdentity },
      { ...project(local, "Atlas"), id: ProjectId.make("alias"), repositoryIdentity },
    ];
    const rows = projectStorageInventory(projects, computers, "");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.groupKey).toBe(rows[1]!.groupKey);
    expect(rows[0]!.key).not.toBe(rows[1]!.key);
  });

  it("identifies duplicate records using saved names at the same normalized physical location", () => {
    const projects = [
      { ...project(local, "Atlas checkout"), repositoryIdentity },
      {
        ...project(local, "Atlas legacy"),
        id: ProjectId.make("alias"),
        workspaceRoot: "/work/local/",
        repositoryIdentity,
      },
      { ...project(remote, "Atlas checkout"), repositoryIdentity },
    ];
    const rows = projectStorageInventory(projects, computers, "");
    expect(rows.find((row) => row.project.id === ProjectId.make("alias"))?.recordLabel).toBe(
      "Project record: Atlas legacy",
    );
    expect(
      rows.find(
        (row) => row.project.environmentId === local && row.project.id === ProjectId.make("same"),
      )?.recordLabel,
    ).toBe("Project record: Atlas checkout");
    expect(rows.find((row) => row.project.environmentId === remote)?.recordLabel).toBeNull();
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it("disambiguates identical saved names without changing labels when filtering or losing exact save keys", () => {
    const projects = [
      { ...project(local, "Atlas"), repositoryIdentity },
      {
        ...project(local, "Atlas"),
        id: ProjectId.make("alias"),
        workspaceRoot: "/work/local/",
        repositoryIdentity,
      },
    ];
    const rows = projectStorageInventory(projects, computers, "");
    expect(new Set(rows.map((row) => row.recordLabel))).toEqual(
      new Set(["Project record: Atlas (same)", "Project record: Atlas (alias)"]),
    );
    const matching = projectStorageInventory(projects, computers, "alias");
    expect(matching).toHaveLength(1);
    expect(matching[0]!.recordLabel).toBe("Project record: Atlas (alias)");
    expect(matching[0]!.key).toBe(
      rows.find((row) => row.project.id === ProjectId.make("alias"))!.key,
    );
    expect(matching[0]!.project.workspaceRoot).toBe("/work/local/");
  });

  it("does not add record labels for unique locations or repeated versions of the same record", () => {
    const original = { ...project(local, "Atlas"), repositoryIdentity };
    const updated = { ...original, workspaceRoot: "/work/new", updatedAt: "2026-10-14T00:00:00Z" };
    const other = {
      ...original,
      id: ProjectId.make("other"),
      workspaceRoot: "/work/other",
    };
    const rows = projectStorageInventory([original, original, updated, other], computers, "");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.recordLabel === null)).toBe(true);
    expect(rows.find((row) => row.project.id === original.id)!.project.workspaceRoot).toBe(
      "/work/new",
    );
  });

  it("honors the library grouping mode without confusing same-named unrelated projects", () => {
    const projects = [
      { ...project(local, "Atlas"), repositoryIdentity },
      { ...project(remote, "Atlas"), repositoryIdentity },
    ];
    const separate = projectStorageInventory(projects, computers, "", "separate");
    expect(new Set(separate.map((row) => row.groupKey)).size).toBe(2);
    const unrelated = projectStorageInventory(
      [project(local, "Same name"), project(remote, "Same name")],
      computers,
      "",
    );
    expect(new Set(unrelated.map((row) => row.groupKey)).size).toBe(2);
  });

  it("searches a logical project label while retaining all of its matching locations", () => {
    const projects = [
      { ...project(local, "Mac checkout"), repositoryIdentity },
      { ...project(remote, "Pi checkout"), repositoryIdentity },
    ];
    const known = projectStorageInventory(projects, computers, "");
    const rows = filterProjectStorageInventory(known, "atlas");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.groupTitle === "Atlas")).toBe(true);
    const narrowed = filterProjectStorageInventory(known, "pi checkout");
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]!.groupTitle).toBe("Atlas");
    expect(narrowed[0]).toBe(known.find((row) => row.project.environmentId === remote));
    expect(known).toHaveLength(2);
  });
});
