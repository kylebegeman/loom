const TERMS: Readonly<Record<string, readonly string[]>> = {
  SettingsEnvironments: ["library", "computers", "directory", "connect"],
  SettingsNotifications: ["library", "push", "test notification", "iPhone"],
  SettingsPreviewLinks: ["published pages", "preview links", "share", "library", "dossier"],
};

export const forkSettingsSearchTerms = (page: string): readonly string[] => TERMS[page] ?? [];
