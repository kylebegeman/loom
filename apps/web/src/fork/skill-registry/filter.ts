import type { SkillRegistryEntry } from "@t3tools/contracts/fork";
export function filterSkills(
  entries: readonly SkillRegistryEntry[],
  search: string,
  account: string,
  scope: string,
  state: string,
) {
  const query = search.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!`${entry.name} ${entry.description ?? ""}`.toLowerCase().includes(query)) return false;
    if (state === "problem" && entry.problems.length === 0) return false;
    if (account === "all" && scope === "all" && (state === "all" || state === "problem"))
      return true;
    return entry.visibility.some(
      (visible) =>
        (account === "all" || visible.instanceId === account) &&
        (scope === "all" || visible.scope === scope) &&
        ((state !== "on" && state !== "off") || visible.enabled === (state === "on")),
    );
  });
}
