import type { EnvironmentId, RepositoryIdentity } from "@t3tools/contracts";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { sourceControlClients } from "../sourceControlClients.ts";
import type { EnvironmentProject } from "../state/models.ts";
import type { WorkspaceHandoffPhase } from "./workspace-handoff-flow.ts";

export const WORKSPACE_HANDOFF_LABELS = {
  checking: "Checking work…",
  preparing: "Preparing computer…",
  settling: "Finishing move…",
  continuing: "Starting conversation…",
  done: "Ready on new computer",
} satisfies Record<WorkspaceHandoffPhase, string>;

export interface WorkspaceHandoffComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly supportsHandoff: boolean;
}

export type WorkspaceHandoffDestinationProject = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "workspaceRoot" | "repositoryIdentity"
>;

export interface WorkspaceHandoffDestination {
  readonly project: WorkspaceHandoffDestinationProject;
  readonly key: string;
  readonly repositoryVerified: boolean;
}

export interface WorkspaceHandoffDestinationGroup extends WorkspaceHandoffComputer {
  readonly projects: ReadonlyArray<WorkspaceHandoffDestination>;
  readonly blockedReason: string | null;
}

function normalizeRepositoryKey(value: string): string {
  return sourceControlClients.canonicalRepositoryKey(normalizeGitRemoteUrl(value));
}

function repositoryKeys(identity: RepositoryIdentity): ReadonlySet<string> {
  // Canonical identity can name a fork's parent. Destination preparation checks the checkout's
  // actual origin, which the resolver records separately when it differs from that parent.
  const keys = identity.origin
    ? [identity.origin.canonicalKey]
    : [identity.canonicalKey, identity.locator.remoteUrl];
  return new Set(keys.map(normalizeRepositoryKey).filter(Boolean));
}

/** Known unrelated repositories are hidden; unknown identities stay available for server checking. */
export function buildWorkspaceHandoffDestinations(input: {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly sourceRepository: RepositoryIdentity | null | undefined;
  readonly offeredRepositoryKey?: string | null;
  readonly projects: ReadonlyArray<WorkspaceHandoffDestinationProject>;
  readonly computers: ReadonlyArray<WorkspaceHandoffComputer>;
}): WorkspaceHandoffDestinationGroup[] {
  const offeredKey = input.offeredRepositoryKey?.trim();
  const verifiedSourceKeys = offeredKey
    ? new Set([normalizeRepositoryKey(offeredKey)])
    : input.sourceRepository
      ? repositoryKeys(input.sourceRepository)
      : null;
  // A source branch may track its parent rather than its own origin. Until the offer confirms
  // that tracking remote, parent checkouts remain manual choices rather than verified defaults.
  const sourceKeys =
    !offeredKey && input.sourceRepository?.origin
      ? new Set([
          ...(verifiedSourceKeys ?? []),
          normalizeRepositoryKey(input.sourceRepository.canonicalKey),
          normalizeRepositoryKey(input.sourceRepository.locator.remoteUrl),
        ])
      : verifiedSourceKeys;
  const projectsByEnvironment = new Map<EnvironmentId, WorkspaceHandoffDestination[]>();
  for (const project of input.projects) {
    if (project.environmentId === input.sourceEnvironmentId) continue;
    const destinationKeys = project.repositoryIdentity
      ? repositoryKeys(project.repositoryIdentity)
      : null;
    const repositoryVerified =
      verifiedSourceKeys !== null &&
      destinationKeys !== null &&
      [...destinationKeys].some((key) => verifiedSourceKeys.has(key));
    if (
      sourceKeys !== null &&
      destinationKeys !== null &&
      ![...destinationKeys].some((key) => sourceKeys.has(key))
    )
      continue;
    const candidate = {
      project,
      key: `${project.environmentId}/${project.id}`,
      repositoryVerified,
    };
    const projects = projectsByEnvironment.get(project.environmentId);
    if (projects) projects.push(candidate);
    else projectsByEnvironment.set(project.environmentId, [candidate]);
  }

  return input.computers
    .filter((computer) => computer.environmentId !== input.sourceEnvironmentId)
    .map((computer) => {
      const projects = projectsByEnvironment.get(computer.environmentId) ?? [];
      return {
        ...computer,
        projects,
        blockedReason: !computer.connected
          ? "Computer is offline."
          : !computer.supportsHandoff
            ? "Update Loom on this computer."
            : projects.length === 0
              ? "Add this repository on this computer."
              : null,
      };
    });
}

/** Explicit choices never switch computers silently when a destination disappears. */
export function selectWorkspaceHandoffDestination(
  groups: ReadonlyArray<WorkspaceHandoffDestinationGroup>,
  destinationKey: string | null | undefined,
): WorkspaceHandoffDestination | null {
  const available = groups
    .filter((group) => group.connected && group.supportsHandoff && group.blockedReason === null)
    .flatMap((group) => group.projects);
  if (destinationKey != null) {
    return available.find((candidate) => candidate.key === destinationKey) ?? null;
  }
  const verified = available.filter((candidate) => candidate.repositoryVerified);
  return verified.length === 1 ? (verified[0] ?? null) : null;
}
