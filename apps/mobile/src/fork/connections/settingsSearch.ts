const TERMS: Readonly<Record<string, readonly string[]>> = {
  Library: [
    "project brief",
    "repositories",
    "repository default",
    "branch override",
    "follow remote",
    "project blueprint",
    "shared setup",
  ],
  SettingsEnvironments: ["library", "computers", "directory", "connect"],
  SettingsNotifications: ["library", "push", "test notification", "iPhone"],
  SettingsPreviewLinks: ["published pages", "preview links", "share", "library", "dossier"],
};

export const forkSettingsSearchTerms = (page: string): readonly string[] => TERMS[page] ?? [];
