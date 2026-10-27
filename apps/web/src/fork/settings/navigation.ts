export const LOOM_SETTINGS_GROUPS = [
  { id: "work", title: "Files & work" },
  { id: "tools", title: "Tools & previews" },
  { id: "connections", title: "Connections & access" },
  { id: "maintenance", title: "Maintenance" },
] as const;

export type LoomSettingsGroupId = (typeof LOOM_SETTINGS_GROUPS)[number]["id"];

const DEFAULT_LOOM_SETTINGS_SECTION = "project-lifecycle";

type SearchableSection = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: string;
};

export function filterLoomSettingsSections<T extends SearchableSection>(
  sections: readonly T[],
  query: string,
): readonly T[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return sections;
  return sections.filter((section) => {
    const text = `${section.title} ${section.description} ${section.keywords}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function loomSettingsSectionForHash(
  sections: readonly { readonly id: string }[],
  hash: string,
): string | null {
  const target = hash.replace(/^#/, "");
  return sections.find((section) => target === `loom-${section.id}`)?.id ?? null;
}

export function resolveLoomSettingsSection<T extends { readonly id: string }>(
  sections: readonly T[],
  sectionId: string | undefined,
): T {
  const section = sections.find((section) => section.id === sectionId);
  const fallback = sections.find((section) => section.id === DEFAULT_LOOM_SETTINGS_SECTION);
  const resolved = section ?? fallback ?? sections[0];
  if (!resolved) throw new Error("Loom settings must register at least one section.");
  return resolved;
}
