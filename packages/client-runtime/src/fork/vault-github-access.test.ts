import { expect, it } from "@effect/vitest";
import type {
  VaultAccessCatalog,
  VaultGitHubInfo,
  VaultGrant,
  VaultPolicySnapshot,
  VaultMigrationProject,
} from "@t3tools/contracts/fork";
import {
  makeVaultGitHubAccessPlan,
  matchVaultGitHubProjects,
  makeVaultGitHubAccessRevocation,
  suggestVaultGitHubRepositories,
  vaultGitHubProjectAccess,
  vaultGitHubProjects,
} from "./vault-github-access.ts";

const now = 10_000;
const itemId = "a".repeat(32);
const connection: VaultGitHubInfo = {
  item: {
    id: itemId,
    label: "Development",
    kind: "service-connection",
    state: "active",
    version: 1,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
  },
  account: "owner",
  mechanism: "token",
  repositories: ["owner/website", "owner/platform", "owner/office"],
};
const catalog: VaultAccessCatalog = {
  truncated: false,
  subjects: [
    { principal: { kind: "project", id: "web" }, projectId: "web", label: "Website" },
    { principal: { kind: "project", id: "platform" }, projectId: "platform", label: "Platform" },
    { principal: { kind: "thread", id: "thread" }, projectId: "web", label: "Website thread" },
  ],
};
const snapshot: VaultPolicySnapshot = {
  environmentId: "environment",
  revision: 7,
  grants: [],
  audit: [],
  omittedAuditEvents: 0,
};
const ids = () => {
  let n = 1;
  return () => (n++).toString(16).padStart(32, "0");
};
const base = () => ({ connection, catalog, snapshot, now, newId: ids() });
const grant = (
  change: Partial<VaultGrant["definition"]> = {},
  state: VaultGrant["state"] = "active",
): VaultGrant => ({
  definition: {
    id: "b".repeat(32),
    label: "Existing",
    principal: { kind: "project", id: "web" },
    projectId: "web",
    itemIds: [itemId],
    actions: ["use"],
    destination: "https://github.com/owner/website",
    notBefore: 0,
    expiresAt: null,
    parentId: null,
    ...change,
  },
  state,
  revision: 1,
  createdBy: "human",
  updatedBy: "human",
});

it("approves many projects at once with narrow use and separate discoverable metadata", () => {
  const plan = makeVaultGitHubAccessPlan({
    ...base(),
    selections: [
      { projectId: "web", repositories: ["owner/website"] },
      { projectId: "platform", repositories: ["owner/platform", "owner/office"] },
    ],
  });
  expect(plan.changes).toHaveLength(5);
  expect(plan.newGrantCount).toBe(5);
  const definitions = plan.changes.flatMap((c) => (c.type === "save" ? [c.grant] : []));
  expect(definitions.filter((d) => d.actions.includes("inspect"))).toHaveLength(2);
  expect(
    definitions
      .filter((d) => d.actions.includes("inspect"))
      .every((d) => d.destination === null && d.actions.length === 1),
  ).toBe(true);
  expect(definitions.filter((d) => d.actions.includes("use")).map((d) => d.destination)).toEqual([
    "https://github.com/owner/website",
    "https://github.com/owner/platform",
    "https://github.com/owner/office",
  ]);
  expect(
    definitions.every(
      (d) =>
        d.principal.kind === "project" &&
        d.itemIds.length === 1 &&
        d.itemIds[0] === itemId &&
        d.expiresAt === null &&
        d.notBefore === now,
    ),
  ).toBe(true);
  expect(
    definitions.every((d) => d.actions.every((action) => action === "inspect" || action === "use")),
  ).toBe(true);
});
it("does not treat destination-bound inspection as discoverable metadata", () => {
  const existing = grant({ actions: ["inspect", "use"] });
  const plan = makeVaultGitHubAccessPlan({
    ...base(),
    snapshot: { ...snapshot, grants: [existing] },
    selections: [{ projectId: "web", repositories: ["owner/website"] }],
  });
  expect(plan.changes).toHaveLength(1);
  expect(plan.changes[0]).toMatchObject({
    type: "save",
    grant: { actions: ["inspect"], destination: null },
  });
  expect(plan.projects[0]?.alreadyAllowed).toEqual(["owner/website"]);
});
it("is idempotent for an already configured recurring project", () => {
  const initial = makeVaultGitHubAccessPlan({
    ...base(),
    selections: [{ projectId: "web", repositories: ["owner/website"] }],
  });
  const grants = initial.changes.flatMap((c) => (c.type === "save" ? [grant(c.grant)] : []));
  const plan = makeVaultGitHubAccessPlan({
    ...base(),
    snapshot: { ...snapshot, grants },
    selections: [{ projectId: "web", repositories: ["owner/website"] }],
  });
  expect(plan.changes).toEqual([]);
});
it.each(["suspended", "revoked"] as const)("does not reuse %s access", (state) => {
  const plan = makeVaultGitHubAccessPlan({
    ...base(),
    snapshot: { ...snapshot, grants: [grant({}, state)] },
    selections: [{ projectId: "web", repositories: ["owner/website"] }],
  });
  expect(plan.changes).toHaveLength(2);
});
it("renews coverage that is expired, future, or shorter than the chosen window", () => {
  for (const existing of [
    grant({ expiresAt: now }),
    grant({ notBefore: now + 1 }),
    grant({ expiresAt: now + 60_000 }),
  ]) {
    const plan = makeVaultGitHubAccessPlan({
      ...base(),
      snapshot: { ...snapshot, grants: [existing] },
      selections: [{ projectId: "web", repositories: ["owner/website"] }],
    });
    expect(plan.changes).toHaveLength(2);
  }
});
it("reuses sufficient finite coverage and keeps the explicit expiry", () => {
  const plan = makeVaultGitHubAccessPlan({
    ...base(),
    snapshot: { ...snapshot, grants: [grant({ expiresAt: now + 120_000 })] },
    expiresAt: now + 60_000,
    selections: [{ projectId: "web", repositories: ["owner/website"] }],
  });
  expect(plan.changes).toHaveLength(1);
  expect(plan.changes[0]).toMatchObject({ type: "save", grant: { expiresAt: now + 60_000 } });
});
it("refuses unknown projects, nonallowlisted repositories and empty selections", () => {
  for (const selections of [
    [],
    [{ projectId: "thread", repositories: ["owner/website"] }],
    [{ projectId: "missing", repositories: ["owner/website"] }],
    [{ projectId: "web", repositories: [] }],
    [{ projectId: "web", repositories: ["owner/private"] }],
    [{ projectId: "web", repositories: ["https://github.com/owner/website"] }],
  ]) {
    expect(() => makeVaultGitHubAccessPlan({ ...base(), selections })).toThrow();
  }
});
it("refuses archived connections and invalid access windows", () => {
  expect(() =>
    makeVaultGitHubAccessPlan({
      ...base(),
      connection: { ...connection, item: { ...connection.item, state: "archived" } },
      selections: [{ projectId: "web", repositories: ["owner/website"] }],
    }),
  ).toThrow();
  expect(() =>
    makeVaultGitHubAccessPlan({
      ...base(),
      expiresAt: now,
      selections: [{ projectId: "web", repositories: ["owner/website"] }],
    }),
  ).toThrow();
});
it("refuses ID collisions and policy capacity overflow", () => {
  expect(() =>
    makeVaultGitHubAccessPlan({
      ...base(),
      newId: () => "c".repeat(32),
      selections: [{ projectId: "web", repositories: ["owner/website"] }],
    }),
  ).toThrow();
  const full = Array.from({ length: 128 }, (_, n) =>
    grant({
      id: (1000 + n).toString(16).padStart(32, "0"),
      principal: { kind: "project", id: "unrelated" },
      projectId: "unrelated",
    }),
  );
  expect(() =>
    makeVaultGitHubAccessPlan({
      ...base(),
      snapshot: { ...snapshot, grants: full },
      selections: [{ projectId: "web", repositories: ["owner/website"] }],
    }),
  ).toThrow();
});
it("suggests only unambiguous name matches, never all repositories", () => {
  expect(suggestVaultGitHubRepositories("Website", connection.repositories)).toEqual([
    "owner/website",
  ]);
  expect(suggestVaultGitHubRepositories("Desk", connection.repositories)).toEqual([]);
  expect(suggestVaultGitHubRepositories("website", ["a/website", "b/website"])).toEqual([]);
  expect(vaultGitHubProjects(catalog).map((p) => p.principal.id)).toEqual(["platform", "web"]);
});
it("summarizes active project grants independently from transient thread approvals", () => {
  const view = vaultGitHubProjectAccess({
    connection,
    catalog,
    snapshot: {
      ...snapshot,
      grants: [
        grant(),
        grant({
          id: "c".repeat(32),
          principal: { kind: "thread", id: "thread" },
          expiresAt: now + 1000,
        }),
        grant(
          { id: "d".repeat(32), destination: "https://github.com/owner/platform" },
          "suspended",
        ),
      ],
    },
    now,
  });
  expect(view).toEqual([
    {
      projectId: "web",
      label: "Website",
      repositories: ["owner/website"],
      grantIds: ["b".repeat(32)],
      expiresAt: null,
    },
  ]);
});
it("removes use and metadata together without touching another project", () => {
  const use = grant();
  const inspect = grant({ id: "c".repeat(32), actions: ["inspect"], destination: null });
  const other = grant({
    id: "d".repeat(32),
    principal: { kind: "project", id: "platform" },
    projectId: "platform",
  });
  const changes = makeVaultGitHubAccessRevocation({
    connection,
    snapshot: { ...snapshot, grants: [use, inspect, other] },
    projectId: "web",
    now,
    newId: ids(),
  });
  expect(changes).toEqual([
    { type: "state", id: use.definition.id, state: "revoked" },
    { type: "state", id: inspect.definition.id, state: "revoked" },
  ]);
});
it("preserves unrelated items and actions when removing custom shared access", () => {
  const existing = grant({
    itemIds: [itemId, "e".repeat(32)],
    actions: ["inspect", "use", "manage"],
  });
  const changes = makeVaultGitHubAccessRevocation({
    connection,
    snapshot: { ...snapshot, grants: [existing] },
    projectId: "web",
    now,
    newId: ids(),
  });
  expect(changes).toHaveLength(2);
  expect(changes[0]).toMatchObject({
    type: "save",
    grant: {
      id: existing.definition.id,
      itemIds: ["e".repeat(32)],
      actions: ["inspect", "use", "manage"],
    },
  });
  expect(changes[1]).toMatchObject({
    type: "save",
    grant: { itemIds: [itemId], actions: ["manage"] },
  });
});
it("does not activate suspended custom permissions while splitting shared access", () => {
  const suspended = grant(
    { itemIds: [itemId, "e".repeat(32)], actions: ["inspect", "use", "manage"] },
    "suspended",
  );
  expect(() =>
    makeVaultGitHubAccessRevocation({
      connection,
      snapshot: { ...snapshot, grants: [suspended] },
      projectId: "web",
      now,
      newId: ids(),
    }),
  ).toThrow(/suspended.*Advanced access/);
});
it("refuses a delegated custom grant rather than silently leaving access in place", () => {
  expect(() =>
    makeVaultGitHubAccessRevocation({
      connection,
      snapshot: { ...snapshot, grants: [grant({ parentId: "c".repeat(32) })] },
      projectId: "web",
      now,
      newId: ids(),
    }),
  ).toThrow(/delegated|advanced/i);
});

it("matches renamed projects from sanitized remotes and never selects another account's repository", () => {
  const project: VaultMigrationProject = {
    projectId: "web" as VaultMigrationProject["projectId"],
    title: "Renamed project",
    state: "inspected",
    dependencies: [
      {
        remote: "origin",
        direction: "fetch",
        position: 0,
        transport: "ssh",
        hostname: "github.com",
        port: 22,
        repository: "owner/website",
        gitPath: "owner/website.git",
        embeddedAuthentication: false,
      },
    ],
    omittedDependencies: 0,
    localSshCommand: false,
    localCredentialHelper: false,
    localUrlRewrite: false,
  };
  expect(matchVaultGitHubProjects(connection, catalog, [project])).toEqual([
    { projectId: "web", repositories: ["owner/website"] },
  ]);
  for (const change of [
    { hostname: "github.example.com" },
    { repository: "different/website" },
    { embeddedAuthentication: true },
    { port: 2222 },
  ]) {
    expect(
      matchVaultGitHubProjects(connection, catalog, [
        { ...project, dependencies: [{ ...project.dependencies[0]!, ...change }] },
      ]),
    ).toEqual([]);
  }
  expect(
    matchVaultGitHubProjects(connection, catalog, [{ ...project, state: "unavailable" }]),
  ).toEqual([]);
});

it("summarizes the next actual expiry without hiding finite project access", () => {
  const view = vaultGitHubProjectAccess({
    connection,
    catalog,
    snapshot: {
      ...snapshot,
      grants: [
        grant({ expiresAt: now + 1000 }),
        grant({ id: "c".repeat(32), expiresAt: now + 2000 }),
        grant({
          id: "d".repeat(32),
          destination: "https://github.com/owner/platform",
          expiresAt: now + 3000,
        }),
      ],
    },
    now,
  });
  expect(view[0]?.expiresAt).toBe(now + 2000);
  expect(view[0]?.repositories).toEqual(["owner/website", "owner/platform"]);
});
