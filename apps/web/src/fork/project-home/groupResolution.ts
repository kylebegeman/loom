import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { derivePhysicalProjectKey } from "~/logicalProject";

type Member = {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly workspaceRoot: string;
};
type Group = { readonly projectKey: string; readonly memberProjects: readonly Member[] };

/** Group keys follow repository metadata; registered checkout references stay durable. */
export function resolveProjectHomeGroup<TGroup extends Group>(input: {
  readonly groups: readonly TGroup[];
  readonly projectKey: string;
  readonly projectRef?: ScopedProjectRef | null;
}): { group: TGroup | null; projectRef: ScopedProjectRef | null } {
  const exact = input.groups.find((group) => group.projectKey === input.projectKey) ?? null;
  if (input.projectRef) {
    const ref = input.projectRef;
    const group = input.groups.find((candidate) =>
      candidate.memberProjects.some(
        (member) => member.environmentId === ref.environmentId && member.id === ref.projectId,
      ),
    );
    // Keep an explicitly unavailable computer choice, even if the logical project still exists.
    // A removed ID must never bind to a different record that reused its old folder path.
    return { group: group ?? exact, projectRef: ref };
  }
  if (exact) return { group: exact, projectRef: null };

  const matches = new Map<string, { group: TGroup; projectRef: ScopedProjectRef }>();
  for (const group of input.groups) {
    for (const member of group.memberProjects) {
      if (derivePhysicalProjectKey(member) !== input.projectKey) continue;
      const ref = scopeProjectRef(member.environmentId, member.id);
      matches.set(JSON.stringify([ref.environmentId, ref.projectId]), { group, projectRef: ref });
    }
  }
  // Legacy env:path links can be resolved solely from saved records, without touching files.
  return matches.size === 1 ? matches.values().next().value! : { group: null, projectRef: null };
}
