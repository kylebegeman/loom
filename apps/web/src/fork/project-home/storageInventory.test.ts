import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { buildProjectStorageInventory } from "./storageInventory";
const mac = EnvironmentId.make("mac");
const pi = EnvironmentId.make("pi");
const a = {
  environmentId: mac,
  id: ProjectId.make("same-id"),
  title: "Atlas",
  workspaceRoot: "/work/atlas",
};
const b = { ...a, environmentId: pi, workspaceRoot: "/ssd/atlas" };
const labels = new Map([
  [mac, "Mac Studio"],
  [pi, "Orange Pi"],
]);

describe("known project storage inventory", () => {
  it("keeps identical project IDs on different computers as independent folder choices", () => {
    const inventory = buildProjectStorageInventory({
      projects: [a, b, a],
      query: "",
      environmentLabels: labels,
    });
    expect(inventory).toHaveLength(2);
    expect(inventory.map((group) => group.projects.length)).toEqual([1, 1]);
    expect(inventory[0]!.projects[0]!.key).not.toBe(inventory[1]!.projects[0]!.key);
  });
  it("finds saved folders by project, path or computer without requiring a present checkout", () => {
    for (const query of ["atlas", " orange pi ", "/ssd/"]) {
      const inventory = buildProjectStorageInventory({
        projects: [a, b],
        query,
        environmentLabels: labels,
      });
      expect(
        inventory.flatMap((group) => group.projects).some(({ project }) => project === b),
      ).toBe(true);
    }
    expect(
      buildProjectStorageInventory({
        projects: [a, b],
        query: "missing",
        environmentLabels: labels,
      }),
    ).toEqual([]);
  });
  it("retains a folder on a disconnected computer whose display catalog is unavailable", () => {
    const inventory = buildProjectStorageInventory({
      projects: [b],
      query: "/ssd",
      environmentLabels: new Map(),
    });
    expect(inventory[0]?.label).toBe("Saved computer");
    expect(inventory[0]?.projects[0]?.project.workspaceRoot).toBe("/ssd/atlas");
  });
});
