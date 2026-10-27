import type { SettingsSearchItem } from "~/components/settings/settingsSearch";
import { FORK_SETTINGS_SECTIONS, type ForkSettingsHome } from "./registry";

const LEGACY_DEFAULT_TOPIC = "project-lifecycle";
const TOPIC_ANCHOR_PREFIX = "loom-";

export const FORK_SINGLE_ENVIRONMENT_SETTINGS_PATHS: ReadonlySet<string> =
  new Set<ForkSettingsHome>(["/settings/vault", "/settings/tools"]);

function findTopic(id: unknown) {
  return FORK_SETTINGS_SECTIONS.find((section) => section.id === id);
}

/** Where a fork settings topic lives. Unknown ids fall back to Lanes, like old Loom links. */
export function forkSettingsTarget(id: string): { to: ForkSettingsHome; hash: string } {
  const topic = findTopic(id) ?? findTopic(LEGACY_DEFAULT_TOPIC)!;
  return { to: topic.home, hash: `${TOPIC_ANCHOR_PREFIX}${topic.id}` };
}

/** One settings search result per topic, so sidebar search and the command palette find them. */
export function forkSettingsSearchItems(): ReadonlyArray<SettingsSearchItem> {
  return FORK_SETTINGS_SECTIONS.map((section) => {
    const { to, hash } = forkSettingsTarget(section.id);
    return {
      id: hash,
      targetId: hash,
      title: section.title,
      to,
      searchTerms: [section.description, section.keywords],
      // Computer topics pick their own computer wherever they render; only a project must be chosen.
      ...(section.scope === "project" ? { scope: "project" as const } : {}),
    };
  });
}

/**
 * Resolves a retired `/settings/loom` link. The topic comes from a `#loom-<id>` hash, then
 * `?section=<id>`. A hash suffix such as Vault GitHub's `?connection=` repair query is kept.
 */
export function legacyLoomSettingsTarget({
  search,
  hash,
}: {
  search: Record<string, unknown>;
  hash: string;
}): { to: ForkSettingsHome; search: Record<string, unknown>; hash: string } {
  const anchor = hash.replace(/^#/, "");
  const hashTopic = anchor.startsWith(TOPIC_ANCHOR_PREFIX)
    ? findTopic(anchor.slice(TOPIC_ANCHOR_PREFIX.length).split("?")[0])
    : undefined;
  const target = forkSettingsTarget(
    (hashTopic ?? findTopic(search.section))?.id ?? LEGACY_DEFAULT_TOPIC,
  );
  return {
    to: target.to,
    search: Object.fromEntries(Object.entries(search).filter(([key]) => key !== "section")),
    hash: hashTopic ? anchor : target.hash,
  };
}
