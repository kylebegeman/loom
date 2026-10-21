export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

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
