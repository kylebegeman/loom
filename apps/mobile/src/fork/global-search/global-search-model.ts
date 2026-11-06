import type { EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { foldSearchQuery, scoreSearchTerms } from "@t3tools/shared/paletteSearch";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import type { SettingsPageTarget } from "../../features/settings/components/settings-page-targets";

export const GLOBAL_SEARCH_PAGE_SIZE = 6;

export function searchSourceIsLoading(result: AsyncResult.AsyncResult<unknown, unknown> | null) {
  return result !== null && result.waiting && Option.isNone(AsyncResult.value(result));
}
export type GlobalSearchCategory =
  | "threads"
  | "projects"
  | "sites"
  | "previews"
  | "bots"
  | "settings";
export type GlobalSearchDestination =
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly messageId?: MessageId;
    }
  | {
      readonly kind: "project";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  | { readonly kind: "library-project"; readonly projectId: string }
  | {
      readonly kind: "library-history";
      readonly projectId: string;
      readonly archiveId: string;
      readonly itemId: string;
      readonly position: number;
    }
  | { readonly kind: "site"; readonly siteId: string }
  | { readonly kind: "preview"; readonly environmentId: EnvironmentId; readonly linkId: string }
  | { readonly kind: "bot"; readonly environmentId: EnvironmentId; readonly botId: string }
  | { readonly kind: "settings"; readonly page: SettingsPageTarget };

export interface GlobalSearchItem {
  readonly key: string;
  readonly category: GlobalSearchCategory;
  readonly title: string;
  readonly description?: string;
  readonly snippet?: string;
  readonly terms?: readonly string[];
  readonly updatedAt?: string;
  readonly serverQuality?: number;
  readonly disabled?: boolean;
  readonly liveAvailable?: boolean;
  readonly destination: GlobalSearchDestination;
}

export function rankGlobalSearchItems(items: readonly GlobalSearchItem[], query: string) {
  const normalized = foldSearchQuery(query);
  const unique = new Map<string, GlobalSearchItem>();
  for (const item of items) {
    const previous = unique.get(item.key);
    if (!previous) unique.set(item.key, item);
    else {
      const candidates = [previous, item];
      const live = candidates.filter(
        (entry) => entry.destination.kind === "thread" && entry.liveAvailable,
      );
      const preferred =
        live.find((entry) => entry.destination.kind === "thread" && entry.destination.messageId) ??
        live[0] ??
        candidates.find((entry) => entry.destination.kind === "library-history") ??
        candidates.find(
          (entry) => entry.destination.kind === "thread" && entry.destination.messageId,
        ) ??
        item;
      unique.set(item.key, {
        ...previous,
        ...item,
        title: previous.title === "Conversation" ? item.title : previous.title,
        description: preferred.serverQuality
          ? preferred.description
          : (item.description ?? previous.description),
        snippet: preferred.serverQuality ? preferred.snippet : (item.snippet ?? previous.snippet),
        terms: [...(previous.terms ?? []), ...(item.terms ?? [])],
        destination: preferred.destination,
        serverQuality: Math.max(previous.serverQuality ?? 0, item.serverQuality ?? 0) || undefined,
      });
    }
  }
  return [...unique.values()]
    .map((item) => ({
      item,
      score:
        normalized === ""
          ? 1
          : Math.max(
              scoreSearchTerms(normalized, [
                item.title,
                ...(item.terms ?? []),
                item.description ?? "",
                item.snippet ?? "",
              ])?.score ?? 0,
              item.serverQuality ?? 0,
            ),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.item.updatedAt ?? "").localeCompare(left.item.updatedAt ?? "") ||
        left.item.key.localeCompare(right.item.key),
    )
    .map(({ item }) => item);
}

export function serverResultsMatchQuery(typed: string, returned: string | undefined) {
  return (
    typed.trim() !== "" &&
    returned !== undefined &&
    foldSearchQuery(typed) === foldSearchQuery(returned)
  );
}

export function unavailableSearchComputerLabels(computers: readonly { readonly label: string }[]) {
  return [...new Set(computers.map((computer) => computer.label))].join(", ");
}

export function globalSearchQueryComputers<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly connection: { readonly phase: string };
  },
>(computers: readonly T[], readable: ReadonlySet<EnvironmentId>) {
  return computers.filter(
    (computer) => computer.connection.phase === "connected" && readable.has(computer.environmentId),
  );
}

const SETTINGS_ENTRIES = [
  ["Usage & limits", "SettingsUsage", "usage quota quotas tokens subscriptions rate limits"],
  ["Appearance", "SettingsAppearance", "theme dark light font text size"],
  ["Notifications", "SettingsNotifications", "push alerts sound"],
  ["Providers", "SettingsProviderAccounts", "models accounts codex claude cursor"],
  ["Computers", "SettingsEnvironments", "connections servers remote devices"],
  ["Scheduled tasks", "SettingsScheduledTasks", "automation schedules recurring"],
  ["Previews", "SettingsPreviewLinks", "private links live apps ports"],
  ["Chat", "SettingsFollowUp", "messages follow up composer"],
  ["Archive", "SettingsArchive", "archived threads restore history"],
  ["Source control", "SettingsEnvironmentSourceControl", "git github gitlab pull requests"],
  ["Microphone", "SettingsMicrophone", "voice dictation audio"],
  ["About Loom", "SettingsAbout", "version updates licenses"],
] as const satisfies readonly (readonly [string, SettingsPageTarget, string])[];

export const GLOBAL_SEARCH_SETTINGS: readonly GlobalSearchItem[] = SETTINGS_ENTRIES.map(
  ([title, page, keywords]) => ({
    key: `settings:${page}`,
    category: "settings",
    title,
    description: "Settings",
    terms: [keywords],
    destination: { kind: "settings", page },
  }),
);
