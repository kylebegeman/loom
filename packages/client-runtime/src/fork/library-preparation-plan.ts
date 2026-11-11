import type { ProjectScript } from "@t3tools/contracts";
import type {
  LibraryPreparationPlan,
  LibraryPreparationPlanRequest,
  LibraryResource,
} from "@t3tools/contracts/fork";
import { libraryPlacementLine } from "./library-placement.ts";

const resourceIdentity = (resource: LibraryResource) => [
  resource.id,
  resource.title,
  resource.kind ?? "repository",
  resource.url ?? null,
  resource.remoteUrl,
  resource.relativePath,
  resource.defaultBranch,
];

/** Do not show a cached response as the review for another selection or changed setup. */
export function libraryPreparationPlanMatches(
  plan: LibraryPreparationPlan,
  input: LibraryPreparationPlanRequest,
): boolean {
  const { project, environmentId, resourceIds } = input;
  const repositories = project.resources.filter(
    (resource) =>
      resource.kind !== "link" && (resourceIds === undefined || resourceIds.includes(resource.id)),
  );
  const scripts = (values: LibraryPreparationPlan["scripts"]) =>
    values.map((script) => [
      script.id,
      script.name,
      script.command,
      script.icon,
      script.runOnWorktreeCreate,
      script.runOnSettle ?? false,
      script.stopOnSettle ?? false,
      script.async ?? false,
      script.autoOpenPreview ?? false,
      script.previewUrl ?? null,
    ]);
  return (
    plan.projectId === project.id &&
    plan.projectRevision === project.revision &&
    plan.environmentId === environmentId &&
    plan.projectTitle === project.title &&
    (resourceIds === undefined ||
      (new Set(resourceIds).size === resourceIds.length &&
        resourceIds.every((id) => repositories.some((resource) => resource.id === id)))) &&
    JSON.stringify(plan.repositories.map(({ resource }) => resourceIdentity(resource))) ===
      JSON.stringify(repositories.map(resourceIdentity)) &&
    JSON.stringify(plan.links.map(resourceIdentity)) ===
      JSON.stringify(
        project.resources.filter((resource) => resource.kind === "link").map(resourceIdentity),
      ) &&
    JSON.stringify(plan.checks.map((check) => [check.id, check.minimumVersion ?? null])) ===
      JSON.stringify(
        (project.profile?.requiredTools ?? []).map((tool) => [
          tool.id,
          tool.minimumVersion ?? null,
        ]),
      ) &&
    JSON.stringify(plan.secrets.map(({ name }) => name)) ===
      JSON.stringify(project.profile?.secretNames ?? []) &&
    JSON.stringify(plan.connections.map(({ name }) => name)) ===
      JSON.stringify(project.profile?.connectionNames ?? []) &&
    JSON.stringify(scripts(plan.scripts)) ===
      JSON.stringify(scripts(project.profile?.scripts ?? []))
  );
}

export function libraryPreparationScriptPolicy(script: ProjectScript): string {
  const triggers = [
    ...(script.runOnWorktreeCreate ? ["Runs when a worktree is created"] : []),
    ...(script.runOnSettle ? ["Runs when a turn settles"] : []),
    ...(script.stopOnSettle ? ["Stops when a turn settles"] : []),
    ...(script.async ? ["Runs in the background"] : []),
  ];
  return triggers.length ? triggers.join(" · ") : "Run manually";
}

export function libraryPreparationPlanSummary(plan: LibraryPreparationPlan): string {
  if (plan.checks.some((check) => check.status === "missing" || check.status === "outdated"))
    return "Tools need attention";
  if (
    plan.checks.some((check) => check.status !== "ok") ||
    plan.connections.length ||
    plan.secrets.length
  )
    return "Readiness unverified";
  return "Review preparation steps";
}

/** Existing preparation flows remain separate, permission-guarded actions. */
export function libraryPreparationPlanSteps(plan: LibraryPreparationPlan): readonly string[] {
  return [
    ...(plan.checks.some((check) => check.status !== "ok")
      ? [
          "Resolve missing, outdated or unverified tools on this computer, then check again. Loom does not install them.",
        ]
      : []),
    ...(plan.connections.length
      ? [
          "Verify the named connections in Vault on this computer. A name does not prove access or an upstream login.",
        ]
      : []),
    ...(plan.secrets.length
      ? [
          "Configure the named secrets on this computer through its existing secret settings. This plan does not check or retrieve values.",
        ]
      : []),
    `${libraryPlacementLine(plan.placement)}. Use the project's existing Get files or New conversation action to review and prepare files; the location is checked again there.`,
    ...(plan.scripts.length
      ? [
          "After files are prepared, compare the copy's settings and choose Use the project setup if needed. Review each command before running it through the existing project script actions. Saved automation can run scripts for new worktrees or when turns settle.",
        ]
      : []),
  ];
}
