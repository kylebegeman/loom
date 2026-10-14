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
const atlas = {
  projectKey: "github.com/example/atlas",
  displayName: "Atlas",
  memberProjects: [a, b],
};

describe("known project file locations", () => {
  it("shows computers under the same logical project without combining their file choices", () => {
    const inventory = buildProjectStorageInventory({
      projects: [a, b, a],
      groups: [atlas],
      query: "",
      environmentLabels: labels,
    });
    expect(inventory).toHaveLength(1);
    expect(inventory[0]?.projectKey).toBe(atlas.projectKey);
    expect(inventory[0]?.locations.map(({ computerLabel }) => computerLabel)).toEqual([
      "Mac Studio",
      "Orange Pi",
    ]);
    expect(inventory[0]?.locations[0]?.key).not.toBe(inventory[0]?.locations[1]?.key);
  });
  it("keeps separate working locations on one computer independently selectable", () => {
    const secondRoot = { ...a, workspaceRoot: "/work/atlas-second" };
    const secondRecord = { ...a, id: ProjectId.make("second-id") };
    const inventory = buildProjectStorageInventory({
      projects: [a, secondRoot, secondRecord],
      groups: [{ ...atlas, memberProjects: [a, secondRoot] }],
      query: "",
      environmentLabels: labels,
    });
    expect(inventory[0]?.locations).toHaveLength(3);
    expect(new Set(inventory[0]?.locations.map(({ key }) => key)).size).toBe(3);
  });
  it("retains exact target roots when the library normalizes equivalent physical paths", () => {
    const alternateRoot = { ...a, id: ProjectId.make("alternate"), workspaceRoot: "/work/atlas/" };
    const inventory = buildProjectStorageInventory({
      projects: [a, alternateRoot],
      groups: [{ ...atlas, memberProjects: [a] }],
      query: "",
      environmentLabels: labels,
    });
    expect(inventory[0]?.locations.map(({ project }) => project.workspaceRoot)).toEqual([
      "/work/atlas",
      "/work/atlas/",
    ]);
    expect(new Set(inventory[0]?.locations.map(({ key }) => key)).size).toBe(2);
  });
  it("identifies separate saved records that share a physical file location", () => {
    const distinctTitle = { ...a, id: ProjectId.make("different-title"), title: "Atlas tools" };
    const duplicateTitle = {
      ...a,
      id: ProjectId.make("another-atlas"),
      workspaceRoot: "/work/atlas/",
    };
    const inventory = buildProjectStorageInventory({
      projects: [a, distinctTitle, duplicateTitle, b],
      groups: [atlas],
      query: "",
      environmentLabels: labels,
    });
    expect(
      inventory[0]?.locations.map(({ project, recordLabel }) => [project.id, recordLabel]),
    ).toEqual([
      ["different-title", "Atlas tools"],
      ["same-id", "Atlas (record same-id)"],
      ["another-atlas", "Atlas (record another-atlas)"],
      ["same-id", null],
    ]);
    const filtered = buildProjectStorageInventory({
      projects: [a, distinctTitle, duplicateTitle, b],
      groups: [atlas],
      query: "tools",
      environmentLabels: labels,
    });
    expect(filtered[0]?.locations[0]?.recordLabel).toBe("Atlas tools");
  });
  it("keeps ordinary locations uncluttered even with duplicate input records", () => {
    const inventory = buildProjectStorageInventory({
      projects: [a, b, a],
      groups: [atlas],
      query: "",
      environmentLabels: labels,
    });
    expect(inventory[0]?.locations.map(({ recordLabel }) => recordLabel)).toEqual([null, null]);
  });
  it("preserves library grouping rather than merging projects with the same display name", () => {
    const inventory = buildProjectStorageInventory({
      projects: [a, b],
      groups: [
        { ...atlas, projectKey: "physical-mac", memberProjects: [a] },
        { ...atlas, projectKey: "physical-pi", memberProjects: [b] },
      ],
      query: "",
      environmentLabels: labels,
    });
    expect(inventory.map(({ projectKey }) => projectKey)).toEqual(["physical-mac", "physical-pi"]);
  });
  it("uses the library name in review targets while keeping rare saved-record identities", () => {
    const alias = { ...a, title: "Archive tools" };
    const duplicate = { ...alias, id: ProjectId.make("second-alias") };
    const inventory = buildProjectStorageInventory({
      projects: [alias, duplicate, b],
      groups: [{ ...atlas, displayName: "octocat/hello-world" }],
      query: "orange pi",
      environmentLabels: labels,
    });
    expect(inventory[0]?.locations[0]?.projectName).toBe("octocat/hello-world");
    const unfiltered = buildProjectStorageInventory({
      projects: [alias, duplicate, b],
      groups: [{ ...atlas, displayName: "octocat/hello-world" }],
      query: "",
      environmentLabels: labels,
    });
    expect(unfiltered[0]?.locations.map(({ projectName }) => projectName)).toEqual([
      "octocat/hello-world, saved project Archive tools (record same-id)",
      "octocat/hello-world, saved project Archive tools (record second-alias)",
      "octocat/hello-world",
    ]);
  });
  it("finds saved locations by logical project, path or computer without claiming files are present", () => {
    for (const query of ["renamed atlas", " orange pi ", "/ssd/"]) {
      const inventory = buildProjectStorageInventory({
        projects: [a, b],
        groups: [{ ...atlas, displayName: "Renamed Atlas" }],
        query,
        environmentLabels: labels,
      });
      expect(
        inventory.flatMap((group) => group.locations).some(({ project }) => project === b),
      ).toBe(true);
    }
    expect(
      buildProjectStorageInventory({
        projects: [a, b],
        groups: [atlas],
        query: "missing",
        environmentLabels: labels,
      }),
    ).toEqual([]);
  });
  it("filters individual locations while retaining their project context", () => {
    const inventory = buildProjectStorageInventory({
      projects: [a, b],
      groups: [atlas],
      query: "orange pi",
      environmentLabels: labels,
    });
    expect(inventory[0]?.label).toBe("Atlas");
    expect(inventory[0]?.locations.map(({ project }) => project)).toEqual([b]);
  });
  it("retains a location on a disconnected computer whose display catalog is unavailable", () => {
    const inventory = buildProjectStorageInventory({
      projects: [b],
      groups: [{ ...atlas, memberProjects: [b] }],
      query: "/ssd",
      environmentLabels: new Map(),
    });
    expect(inventory[0]?.locations[0]?.computerLabel).toBe("Saved computer");
    expect(inventory[0]?.locations[0]?.project.workspaceRoot).toBe("/ssd/atlas");
  });
});
