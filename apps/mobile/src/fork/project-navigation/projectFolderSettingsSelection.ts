import type { ScopedProjectRef } from "@t3tools/contracts";

type ProjectGroup = {
  readonly key: string;
  readonly memberProjectRefs: readonly ScopedProjectRef[];
};

export function projectFolderSettingsSuccessor(
  groups: readonly ProjectGroup[],
  selectedKey: string | null,
  previous: ProjectGroup | null,
): string | null {
  if (
    selectedKey === null ||
    previous?.key !== selectedKey ||
    groups.some((group) => group.key === selectedKey)
  )
    return null;
  for (const ref of previous.memberProjectRefs) {
    const successor = groups.find((group) =>
      group.memberProjectRefs.some(
        (member) =>
          member.environmentId === ref.environmentId && member.projectId === ref.projectId,
      ),
    );
    if (successor) return successor.key;
  }
  return null;
}
