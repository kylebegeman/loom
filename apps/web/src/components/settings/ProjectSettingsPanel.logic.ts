import type { ProjectIconOverride } from "@t3tools/contracts";

import type { Project } from "../../types";

export const SCRATCH_PROJECT_TITLE = "No project";
const SCRATCH_PROJECT_ICON = {
  kind: "lucide",
  name: "message-square-dashed",
  color: "gray",
} as const satisfies ProjectIconOverride;

export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

export function defaultProjectIcon(project: Pick<Project, "isScratch">) {
  return { faviconPath: null, projectIcon: project.isScratch ? SCRATCH_PROJECT_ICON : null };
}

export function hasDefaultProjectIcon(
  project: Pick<Project, "isScratch" | "faviconPath" | "projectIcon">,
): boolean {
  if (project.faviconPath != null) return false;
  const icon = project.projectIcon ?? null;
  if (!project.isScratch) return icon === null;
  return (
    icon?.kind === "lucide" &&
    icon.name === SCRATCH_PROJECT_ICON.name &&
    icon.color === SCRATCH_PROJECT_ICON.color
  );
}

// fork: project-home
export function projectSettingsLocationSuccessor(
  groups: readonly {
    readonly projectKey: string;
    readonly memberProjects: readonly {
      readonly environmentId: string;
      readonly id: string;
      readonly physicalProjectKey: string;
    }[];
  }[],
  memberKeys: readonly string[],
  checkoutKey: string | null,
) {
  for (const group of groups) {
    const member = group.memberProjects.find((entry) =>
      memberKeys.includes(`${entry.environmentId}:${entry.id}`),
    );
    if (member)
      return {
        project: group.projectKey,
        checkout: checkoutKey === null ? undefined : member.physicalProjectKey,
      };
  }
  return null;
}
