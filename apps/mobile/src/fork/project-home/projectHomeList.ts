import type { ProjectHomeSectionId, ProjectHomeThreadRow } from "@t3tools/client-runtime/fork";
import { buildProjectHome } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

export const PROJECT_HOME_PAGE_SIZE = 20;
export type ProjectHomeModel = ReturnType<typeof buildProjectHome<EnvironmentThreadShell>>;
export type ProjectHomeListItem =
  | { readonly type: "overview"; readonly key: "overview" }
  | {
      readonly type: "section";
      readonly key: string;
      readonly id: ProjectHomeSectionId;
      readonly title: string;
      readonly count: number;
    }
  | {
      readonly type: "thread";
      readonly key: string;
      readonly row: ProjectHomeThreadRow<EnvironmentThreadShell>;
    }
  | {
      readonly type: "more";
      readonly key: string;
      readonly id: ProjectHomeSectionId;
      readonly hiddenCount: number;
    }
  | { readonly type: "computers"; readonly key: "computers" };

/** Bound rendered shells per section without losing full history or cross-computer identity. */
export function projectHomeListItems(
  model: ProjectHomeModel,
  visible: Partial<Record<ProjectHomeSectionId, number>>,
): ReadonlyArray<ProjectHomeListItem> {
  const items: ProjectHomeListItem[] = [{ type: "overview", key: "overview" }];
  for (const section of model.sections) {
    if (section.rows.length === 0) continue;
    const count = visible[section.id] ?? PROJECT_HOME_PAGE_SIZE;
    items.push({
      type: "section",
      key: `section:${section.id}`,
      id: section.id,
      title: section.title,
      count: section.rows.length,
    });
    for (const row of section.rows.slice(0, count))
      items.push({
        type: "thread",
        key: `thread:${JSON.stringify([row.thread.environmentId, row.thread.id])}`,
        row,
      });
    if (count < section.rows.length)
      items.push({
        type: "more",
        key: `more:${section.id}`,
        id: section.id,
        hiddenCount: section.rows.length - count,
      });
  }
  items.push({ type: "computers", key: "computers" });
  return items;
}
