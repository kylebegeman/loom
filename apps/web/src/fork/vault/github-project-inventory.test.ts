import { describe, expect, it } from "vite-plus/test";
import { ProjectId } from "@t3tools/contracts";
import type { VaultMigrationInventoryPage, VaultMigrationProject } from "@t3tools/contracts/fork";
import {
  collectGitHubProjectInventory,
  MAX_GITHUB_PROJECT_INVENTORY_PAGES,
} from "./github-project-inventory";

const project = (id: string): VaultMigrationProject => ({
  projectId: ProjectId.make(id),
  title: id,
  state: "inspected",
  dependencies: [],
  omittedDependencies: 0,
  localSshCommand: false,
  localCredentialHelper: false,
  localUrlRewrite: false,
});
const page = (
  projects: VaultMigrationProject[],
  cursor: string | null,
): VaultMigrationInventoryPage => ({
  projects,
  nextCursor: cursor === null ? null : ProjectId.make(cursor),
  checkedAt: 1,
  coverage: "registered-project-local-config-only",
  credentialIdentity: "unknown",
  externalConsumers: "not-discovered",
  accessVerification: "not-performed",
});

describe("GitHub project metadata scan", () => {
  it("keeps project metadata from every page and follows the returned cursors", async () => {
    const cursors: Array<ProjectId | null> = [];
    const result = await collectGitHubProjectInventory(async (cursor) => {
      cursors.push(cursor);
      return cursor === null ? page([project("desk")], "next") : page([project("loom")], null);
    });
    expect(cursors).toEqual([null, "next"]);
    expect(result.projects.map((entry) => entry.projectId)).toEqual(["desk", "loom"]);
    expect(result.warnings).toEqual([]);
  });

  it("preserves detected metadata and reports an incomplete scan when a later page fails", async () => {
    const result = await collectGitHubProjectInventory(async (cursor) => {
      if (cursor !== null) throw new Error("Metadata access denied.");
      return page([project("desk")], "next");
    });
    expect(result.projects).toEqual([project("desk")]);
    expect(result.warnings).toEqual([
      "Only part of the project list was checked. Retry or select missing projects manually.",
      "Metadata access denied.",
    ]);
  });

  it("bounds a large scan and warns that coverage is partial", async () => {
    let calls = 0;
    const result = await collectGitHubProjectInventory(async () => {
      calls++;
      return page([project(String(calls))], String(calls));
    });
    expect(calls).toBe(MAX_GITHUB_PROJECT_INVENTORY_PAGES);
    expect(result.projects).toHaveLength(calls);
    expect(result.warnings[0]).toContain("Only part");
  });

  it("stops repeated cursors instead of scanning forever", async () => {
    let calls = 0;
    const result = await collectGitHubProjectInventory(async () => {
      calls++;
      return page([], "same");
    });
    expect(calls).toBe(2);
    expect(result.warnings).toContain("The project list repeated a page.");
  });

  it("reports unavailable and truncated metadata without discarding usable projects", async () => {
    const result = await collectGitHubProjectInventory(async () =>
      page(
        [
          project("usable"),
          { ...project("missing"), state: "unavailable" },
          { ...project("truncated"), omittedDependencies: 1 },
        ],
        null,
      ),
    );
    expect(result.projects).toHaveLength(3);
    expect(result.warnings).toEqual([
      "Git metadata was unavailable for 1 project. Select their repositories manually.",
      "Some remotes were omitted for 1 project. Review their repository selections.",
    ]);
  });

  it("stops reading more pages after cancellation and reports partial coverage", async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await collectGitHubProjectInventory(async () => {
      calls++;
      controller.abort();
      return page([project("desk")], "next");
    }, controller.signal);
    expect(calls).toBe(1);
    expect(result.projects).toEqual([project("desk")]);
    expect(result.warnings[0]).toContain("Search cancelled");
  });
});
