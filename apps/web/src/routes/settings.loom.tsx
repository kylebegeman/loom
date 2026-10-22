import { createFileRoute, redirect, retainSearchParams } from "@tanstack/react-router";
import type { SettingsScopeSearch } from "../components/settings/settingsScope";
import { LoomSettingsPage } from "../fork/settings/LoomSettingsPage";
import { loomSettingsSectionForHash } from "../fork/settings/navigation";
import { FORK_SETTINGS_SECTIONS } from "../fork/settings/registry";

export function validateLoomSettingsSearch(raw: Record<string, unknown>): { section?: string } {
  return typeof raw.section === "string" ? { section: raw.section } : {};
}

export function beforeLoomSettingsLoad({
  search,
  location,
}: {
  search: SettingsScopeSearch & { section?: string };
  location: { hash: string };
}) {
  const target = loomSettingsSectionForHash(FORK_SETTINGS_SECTIONS, location.hash);
  // Existing settings links use hashes. Keep the selected topic after the search target clears.
  if (target !== null && search.section !== target) {
    throw redirect({
      to: "/settings/loom",
      search: { ...search, section: target },
      hash: location.hash.replace(/^#/, ""),
      replace: true,
    });
  }
}

export const Route = createFileRoute("/settings/loom")({
  validateSearch: validateLoomSettingsSearch,
  search: { middlewares: [retainSearchParams(["section"])] },
  beforeLoad: beforeLoomSettingsLoad,
  component: LoomSettingsPage,
});
