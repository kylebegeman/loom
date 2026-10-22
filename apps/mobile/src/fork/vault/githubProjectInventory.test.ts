import { expect, it } from "vite-plus/test";
import { ProjectId } from "@t3tools/contracts";
import type { VaultMigrationInventoryPage, VaultMigrationProject } from "@t3tools/contracts/fork";
import { scanGitHubProjectInventory } from "./githubProjectInventory";

const project = (
  id: string,
  changes: Partial<VaultMigrationProject> = {},
): VaultMigrationProject => ({
  projectId: ProjectId.make(id),
  title: id,
  state: "inspected",
  dependencies: [],
  omittedDependencies: 0,
  localSshCommand: false,
  localCredentialHelper: false,
  localUrlRewrite: false,
  ...changes,
});
const page = (
  projects: VaultMigrationProject[],
  nextCursor: string | null = null,
): VaultMigrationInventoryPage => ({
  checkedAt: 1000,
  projects,
  nextCursor: nextCursor === null ? null : ProjectId.make(nextCursor),
  coverage: "registered-project-local-config-only",
  credentialIdentity: "unknown",
  externalConsumers: "not-discovered",
  accessVerification: "not-performed",
});

it("keeps projects from every inventory page for matching", async () => {
  const pages = [page([project("first")], "first"), page([project("second")])];
  const result = await scanGitHubProjectInventory(
    async () => pages.shift()!,
    () => {},
  );
  expect(result.projects.map((value) => value.projectId)).toEqual(["first", "second"]);
  expect(result.incompleteReason).toBeNull();
});

it("keeps completed pages when a later page fails and reports incomplete coverage", async () => {
  const result = await scanGitHubProjectInventory(
    async (cursor) => {
      if (cursor === null) return page([project("first")], "first");
      throw new Error("Computer disconnected");
    },
    () => {},
  );
  expect(result.projects.map((value) => value.projectId)).toEqual(["first"]);
  expect(result.incompleteReason).toMatch(/incomplete.*Computer disconnected.*manually/);
});

it("stops a repeated cursor rather than looping through inventory forever", async () => {
  const result = await scanGitHubProjectInventory(
    async () => page([project("first")], "first"),
    () => {},
  );
  expect(result.incompleteReason).toContain("repeated a page");
  expect(result.projects.length).toBeLessThan(3);
});

it("bounds a long inventory and reports that more projects remain", async () => {
  let index = 0;
  const result = await scanGitHubProjectInventory(
    async () => {
      const id = `project-${index++}`;
      return page([project(id)], id);
    },
    () => {},
  );
  expect(result.projects.length).toBe(25);
  expect(result.incompleteReason).toContain("More registered projects remain");
});

it("does not imply complete matching when registered metadata is missing or partial", async () => {
  const result = await scanGitHubProjectInventory(
    async () =>
      page([
        project("missing", { state: "unavailable" }),
        project("omitted", { omittedDependencies: 2 }),
        project("rewritten", { localUrlRewrite: true }),
      ]),
    () => {},
  );
  expect(result.projects).toHaveLength(3);
  expect(result.incompleteReason).toMatch(/3 projects.*manually/);
});
