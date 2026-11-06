import { forkSettingsSearchTerms } from "../../fork/connections/settingsSearch"; // fork: ext-settings
import { foldSearchQuery, rankSearchItems, scoreSearchTerms } from "@t3tools/shared/paletteSearch";
import { BRAND_NAME } from "@t3tools/shared/brand";

import { SETTINGS_PAGE_TARGETS, type SettingsPageTarget } from "./components/settings-page-targets";

/** What each page holds besides its row's label, so search finds a setting by its own name. */
// fork: mobile-navigation
const SETTINGS_SEARCH_TERMS = {
  account: ["sign in", "sign out", "login", "clerk", "connect"],
  SettingsEnvironments: [
    "servers",
    "connections",
    "pair",
    "add environment",
    "remote",
    "tailscale",
    "devices",
  ],
  SettingsNotifications: ["push", "alerts", "sound", "live activity", "agent activity"],
  SettingsAppearance: [
    "theme",
    "dark mode",
    "light mode",
    "colors",
    "font size",
    "text size",
    "code",
    "diffs",
    "terminal",
    "word break",
    "math",
  ],
  SettingsNavigation: ["tabs", "tab order", "reorder", "hide tabs"],
  SettingsKeyboard: ["return key", "send message", "new line", "hardware keyboard"],
  SettingsMicrophone: ["voice", "dictation", "audio input", "bluetooth"],
  SettingsScheduledTasks: ["automation", "automations", "schedule", "cron", "recurring", "webhook"],
  SettingsProjectOverview: ["project", "overview", "checkouts", "delete project"],
  SettingsOrganization: [
    "project grouping",
    "group projects",
    "organization",
    "sidebar",
    "working section",
    "new threads",
    "last project",
  ],
  SettingsThreads: [
    "new threads",
    "default workspace",
    "default permissions",
    "access",
    "response streaming",
    "preview browser",
    "browser access",
    "auto-settle",
    "settle",
    "snooze",
    "usage limits",
    "auto-resume",
    "thread behavior",
  ],
  SettingsFollowUp: [
    "follow-ups",
    "queue",
    "steer",
    "while the agent is running",
    "messages",
    "composer",
  ],
  SettingsArchive: ["archive", "archived", "restore", "unarchive", "history"],
  SettingsProviderAccounts: [
    "provider accounts",
    "codex",
    "claude",
    "cursor",
    "opencode",
    "sign in",
    "login",
    "auth",
    "models",
  ],
  SettingsEnvironmentSourceControl: [
    "git",
    "pull requests",
    "co-authors",
    "agent credits",
    "default branch",
    "automatically pull",
    "github",
    "gitlab",
  ],
  SettingsWorktrees: [
    "worktree",
    "branch naming",
    "branch prefix",
    "submodules",
    "start from remote",
  ],
  SettingsLabs: ["legacy", "plan mode", "beta", "linked environments", "link machine"],
  SettingsEnvironmentMaintenance: ["updates", "provider updates", "restart", "manage environments"],
  SettingsAbout: [
    "version",
    "updates",
    "diagnostics",
    "client storage",
    "cache",
    "legal",
    "privacy",
    "terms",
    "open source licenses",
  ],
  SettingsProjectGrouping: ["project grouping", "group projects", "organization"],
  SettingsClientStorage: ["cache", "local data", "storage", "saved data"],
  SettingsDiagnostics: ["diagnostics", "logs", "connection health", "errors"],
  SettingsOpenSourceLicenses: ["licenses", "attributions", "acknowledgements"],
  SettingsUsage: ["usage", "limits", "quota", "quotas", "tokens", "subscriptions", "rate limits"],
  SettingsPreviewLinks: ["private links", "live apps", "ports"],
} satisfies Partial<Record<SettingsPageTarget | "account", readonly string[]>>;
const termsById: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(SETTINGS_SEARCH_TERMS),
);

const SETTINGS_PAGE_LABELS: Record<SettingsPageTarget, string> = {
  SettingsEnvironments: "Computers",
  SettingsNotifications: "Notifications",
  SettingsThreads: "Threads",
  SettingsAbout: `About ${BRAND_NAME}`,
  SettingsArchive: "Archive",
  SettingsAppearance: "Appearance",
  SettingsNavigation: "Navigation tabs",
  SettingsOrganization: "General",
  SettingsProjectOverview: "Computer folders",
  SettingsEnvironmentSourceControl: "Source control",
  SettingsWorktrees: "Worktrees",
  SettingsLabs: "Labs",
  SettingsEnvironmentMaintenance: "Maintenance",
  SettingsProviderAccounts: "Providers",
  SettingsKeyboard: "Keyboard",
  SettingsMicrophone: "Microphone",
  SettingsFollowUp: "Chat",
  SettingsScheduledTasks: "Scheduled tasks",
  SettingsProjectGrouping: "Project grouping",
  SettingsClientStorage: "Client storage",
  SettingsDiagnostics: "Diagnostics",
  SettingsOpenSourceLicenses: "Open source licenses",
  SettingsUsage: "Usage & limits",
  SettingsPreviewLinks: "Previews",
};

// fork: ext-settings
function settingsSearchTerms(id: string): readonly string[] {
  return [...forkSettingsSearchTerms(id), ...(termsById.get(id) ?? [])];
}

export const SETTINGS_SEARCH_PAGES = SETTINGS_PAGE_TARGETS.map((page) => ({
  page,
  label: SETTINGS_PAGE_LABELS[page],
  terms: settingsSearchTerms(page),
}));

export interface SettingsSearchRow {
  readonly id: string;
  readonly label: string;
}

export interface SettingsSearchSection<Row extends SettingsSearchRow> {
  readonly title?: string;
  readonly rows: readonly Row[];
}

/**
 * Keeps the rows whose label, section, or page contents match `query`, in list order, and drops
 * sections left empty. Matching is the command palette's, so both searches agree.
 */
export function filterSettingsSections<
  Row extends SettingsSearchRow,
  Section extends SettingsSearchSection<Row>,
>(sections: readonly Section[], query: string): Section[] {
  const normalizedQuery = foldSearchQuery(query);
  const rows = sections.flatMap((section) =>
    section.rows.map((row) => ({ row, section: section.title })),
  );
  const matched = normalizedQuery
    ? new Set(
        rankSearchItems(rows, ({ row, section }, options) =>
          scoreSearchTerms(
            normalizedQuery,
            [...settingsSearchTerms(row.id), row.label, ...(section ? [section] : [])],
            options,
          ),
        ).map(({ item }) => item.row),
      )
    : null;
  return sections.flatMap((section) => {
    const kept = matched ? section.rows.filter((row) => matched.has(row)) : section.rows;
    return kept.length ? [{ ...section, rows: kept }] : [];
  });
}
