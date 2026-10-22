import {
  VaultGrantDefinition,
  vaultGitHubDestination,
  type VaultAccessCatalog,
  type VaultGitHubInfo,
  type VaultGrant,
  type VaultGrantMutation,
  type VaultPolicySnapshot,
  type VaultMigrationProject,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

type Change = VaultGrantMutation["change"];
type Project = VaultAccessCatalog["subjects"][number];
export interface VaultGitHubProjectSelection {
  readonly projectId: string;
  readonly repositories: readonly string[];
}
export interface VaultGitHubProjectAccess {
  readonly projectId: string;
  readonly label: string;
  readonly repositories: readonly string[];
  readonly grantIds: readonly string[];
  readonly expiresAt: number | null;
}
const MAX_GRANTS = 128;
const isDefinition = Schema.is(VaultGrantDefinition);
const projectGrant = (grant: VaultGrant, projectId: string, itemId: string) =>
  grant.definition.principal.kind === "project" &&
  grant.definition.principal.id === projectId &&
  (grant.definition.projectId === null || grant.definition.projectId === projectId) &&
  grant.definition.itemIds.includes(itemId);
const active = (grant: VaultGrant, now: number) =>
  grant.state === "active" &&
  grant.definition.notBefore <= now &&
  (grant.definition.expiresAt === null || grant.definition.expiresAt > now);
const covers = (
  grant: VaultGrant,
  action: "inspect" | "use",
  destination: string | null,
  now: number,
  expiresAt?: number | null,
) =>
  active(grant, now) &&
  // Inherited grants can depend on narrower or changed ancestors. Add an explicit grant instead.
  grant.definition.parentId === null &&
  grant.definition.actions.includes(action) &&
  (grant.definition.destination === null || grant.definition.destination === destination) &&
  (expiresAt === undefined ||
    grant.definition.expiresAt === null ||
    (expiresAt !== null && grant.definition.expiresAt >= expiresAt));
const checkTime = (now: number, expiresAt: number | null = null) => {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now))
  )
    throw new Error("Choose an access expiry after the start time.");
};
const identifier = (snapshot: VaultPolicySnapshot, newId: () => string) => {
  const used = new Set(snapshot.grants.map((grant) => grant.definition.id));
  return () => {
    const id = newId();
    if (!/^[0-9a-f]{32}$/.test(id) || used.has(id)) {
      throw new Error("Could not prepare unique access records. Start a new review.");
    }
    used.add(id);
    return id;
  };
};
export const vaultGitHubProjects = (catalog: VaultAccessCatalog): Project[] =>
  [
    ...new Map(
      catalog.subjects
        .filter(
          (subject) =>
            subject.principal.kind === "project" && subject.projectId === subject.principal.id,
        )
        .map((subject) => [subject.principal.id, subject]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));

export const suggestVaultGitHubRepositories = (
  projectLabel: string,
  repositories: readonly string[],
): string[] => {
  const matches = repositories.filter(
    (repository) => repository.split("/")[1]?.toLowerCase() === projectLabel.trim().toLowerCase(),
  );
  return matches.length === 1 ? [...matches] : [];
};

export function makeVaultGitHubAccessPlan(input: {
  readonly connection: VaultGitHubInfo;
  readonly catalog: VaultAccessCatalog;
  readonly snapshot: VaultPolicySnapshot;
  readonly selections: readonly VaultGitHubProjectSelection[];
  readonly now: number;
  readonly newId: () => string;
  readonly expiresAt?: number | null;
}) {
  const { connection, catalog, snapshot, selections, now } = input;
  const expiresAt = input.expiresAt ?? null;
  checkTime(now, expiresAt);
  if (connection.item.state !== "active")
    throw new Error("Restore this GitHub connection before approving project access.");
  if (!selections.length) throw new Error("Choose at least one project and repository.");
  const projects = new Map(
    vaultGitHubProjects(catalog).map((project) => [project.principal.id, project]),
  );
  const allowlist = new Set(connection.repositories.map((repository) => repository.toLowerCase()));
  const id = identifier(snapshot, input.newId);
  const changes: Change[] = [];
  const selected = new Set<string>();
  const summary: Array<
    VaultGitHubProjectSelection & { label: string; alreadyAllowed: readonly string[] }
  > = [];
  const save = (
    project: Project,
    actions: VaultGrantDefinition["actions"],
    destination: string | null,
    label: string,
  ) => {
    const definition: VaultGrantDefinition = {
      id: id(),
      label: label.slice(0, 200),
      principal: { kind: "project", id: project.principal.id },
      projectId: project.projectId,
      itemIds: [connection.item.id],
      actions,
      destination,
      notBefore: now,
      expiresAt,
      parentId: null,
    };
    if (!isDefinition(definition))
      throw new Error("Could not prepare project access. Refresh projects and try again.");
    changes.push({ type: "save", grant: definition });
  };
  for (const selection of selections) {
    const project = projects.get(selection.projectId);
    if (!project || selected.has(selection.projectId))
      throw new Error("Choose each project once from the project list.");
    selected.add(selection.projectId);
    const repositories = [
      ...new Set(selection.repositories.map((repository) => repository.trim().toLowerCase())),
    ];
    if (!repositories.length || repositories.some((repository) => !allowlist.has(repository))) {
      throw new Error(`Choose allowed repositories for ${project.label}.`);
    }
    const grants = snapshot.grants.filter((grant) =>
      projectGrant(grant, selection.projectId, connection.item.id),
    );
    // Metadata tools request no destination. Combining this action with a repo scope hides the connection.
    if (!grants.some((grant) => covers(grant, "inspect", null, now, expiresAt))) {
      save(project, ["inspect"], null, `${project.label}: GitHub connection details`);
    }
    const alreadyAllowed: string[] = [];
    for (const repository of repositories) {
      const destination = vaultGitHubDestination(repository);
      if (grants.some((grant) => covers(grant, "use", destination, now, expiresAt))) {
        alreadyAllowed.push(repository);
      } else {
        save(project, ["use"], destination, `${project.label}: ${repository}`);
      }
    }
    summary.push({
      projectId: selection.projectId,
      label: project.label,
      repositories,
      alreadyAllowed,
    });
  }
  if (snapshot.grants.length + changes.length > MAX_GRANTS) {
    throw new Error(
      "This selection exceeds the access policy limit. Review existing grants before adding more projects.",
    );
  }
  return { changes, projects: summary, newGrantCount: changes.length };
}

export function vaultGitHubProjectAccess(input: {
  readonly connection: VaultGitHubInfo;
  readonly catalog: VaultAccessCatalog;
  readonly snapshot: VaultPolicySnapshot;
  readonly now: number;
}): VaultGitHubProjectAccess[] {
  return vaultGitHubProjects(input.catalog).flatMap((project) => {
    const grants = input.snapshot.grants.filter(
      (grant) =>
        projectGrant(grant, project.principal.id, input.connection.item.id) &&
        active(grant, input.now),
    );
    const repositories = input.connection.repositories.filter((repository) =>
      grants.some((grant) => covers(grant, "use", vaultGitHubDestination(repository), input.now)),
    );
    if (!repositories.length) return [];
    const expiries = repositories
      .map((repository) => {
        const covering = grants.filter((grant) =>
          covers(grant, "use", vaultGitHubDestination(repository), input.now),
        );
        return covering.some((grant) => grant.definition.expiresAt === null)
          ? null
          : Math.max(...covering.map((grant) => grant.definition.expiresAt ?? 0));
      })
      .filter((expiry): expiry is number => expiry !== null);
    return [
      {
        projectId: project.principal.id,
        label: project.label,
        repositories,
        expiresAt: expiries.length ? Math.min(...expiries) : null,
        grantIds: grants
          .filter((grant) =>
            grant.definition.actions.some((action) => action === "use" || action === "inspect"),
          )
          .map((grant) => grant.definition.id),
      },
    ];
  });
}

export function makeVaultGitHubAccessRevocation(input: {
  readonly connection: VaultGitHubInfo;
  readonly snapshot: VaultPolicySnapshot;
  readonly projectId: string;
  readonly now: number;
  readonly newId: () => string;
}): Change[] {
  checkTime(input.now);
  const candidates = input.snapshot.grants.filter(
    (grant) =>
      projectGrant(grant, input.projectId, input.connection.item.id) &&
      grant.state !== "revoked" &&
      grant.definition.actions.some((action) => action === "use" || action === "inspect"),
  );
  if (
    candidates.some(
      (grant) =>
        grant.definition.parentId !== null ||
        input.snapshot.grants.some(
          (child) => child.state !== "revoked" && child.definition.parentId === grant.definition.id,
        ),
    )
  ) {
    throw new Error(
      "This project has delegated access. Review its grants in Advanced access before removing them.",
    );
  }
  const id = identifier(input.snapshot, input.newId);
  const changes: Change[] = [];
  let extra = 0;
  for (const grant of candidates) {
    const definition = grant.definition;
    const otherItems = definition.itemIds.filter((item) => item !== input.connection.item.id);
    const otherActions = definition.actions.filter(
      (action) => action !== "use" && action !== "inspect",
    );
    // A new split record starts active. Preserve suspended custom rights through manual review.
    if (grant.state === "suspended" && otherItems.length && otherActions.length) {
      throw new Error(
        "This project has suspended shared permissions. Review its grants in Advanced access before removing them.",
      );
    }
    if (otherItems.length) {
      changes.push({ type: "save", grant: { ...definition, itemIds: otherItems } });
      if (otherActions.length) {
        changes.push({
          type: "save",
          grant: {
            ...definition,
            id: id(),
            itemIds: [input.connection.item.id],
            actions: otherActions,
          },
        });
        extra++;
      }
    } else if (otherActions.length) {
      changes.push({ type: "save", grant: { ...definition, actions: otherActions } });
    } else {
      changes.push({ type: "state", id: definition.id, state: "revoked" });
    }
  }
  if (input.snapshot.grants.length + extra > MAX_GRANTS || changes.length > MAX_GRANTS) {
    throw new Error(
      "This change exceeds the access policy limit. Review its grants in Advanced access.",
    );
  }
  return changes;
}

export function matchVaultGitHubProjects(
  connection: VaultGitHubInfo,
  catalog: VaultAccessCatalog,
  inspected: readonly VaultMigrationProject[],
): VaultGitHubProjectSelection[] {
  const available = new Set(vaultGitHubProjects(catalog).map((project) => project.principal.id));
  const allowed = new Set(connection.repositories.map((repository) => repository.toLowerCase()));
  const matches = new Map<string, Set<string>>();
  for (const project of inspected) {
    if (!available.has(project.projectId) || project.state !== "inspected") continue;
    for (const dependency of project.dependencies) {
      if (
        dependency.hostname?.toLowerCase() !== "github.com" ||
        dependency.embeddedAuthentication ||
        (dependency.transport !== "ssh" && dependency.transport !== "https") ||
        (dependency.port !== null &&
          dependency.port !== (dependency.transport === "ssh" ? 22 : 443))
      )
        continue;
      const repository = dependency.repository?.toLowerCase();
      if (!repository || !allowed.has(repository)) continue;
      const repositories = matches.get(project.projectId) ?? new Set<string>();
      repositories.add(repository);
      matches.set(project.projectId, repositories);
    }
  }
  return vaultGitHubProjects(catalog).flatMap((project) => {
    const repositories = matches.get(project.principal.id);
    return repositories
      ? [{ projectId: project.principal.id, repositories: [...repositories].sort() }]
      : [];
  });
}
