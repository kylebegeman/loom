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
  location: { hash: string; search: { section?: unknown } };
}) {
  const target = loomSettingsSectionForHash(FORK_SETTINGS_SECTIONS, location.hash);
  // Legacy hashes select a topic. Preloads can reuse stale match search after
  // redirects, so compare the requested location to stop redirect loops.
  if (target !== null && location.search.section !== target) {
    throw redirect({
      to: "/settings/loom",
      search: { ...search, section: target },
      hash: location.hash.replace(/^#/, ""),
      replace: true,
    });
  }
}

export const Route = createFileRoute("/_chat/settings/loom")({
  validateSearch: validateLoomSettingsSearch,
  search: { middlewares: [retainSearchParams(["section"])] },
  beforeLoad: beforeLoomSettingsLoad,
  component: LoomSettingsPage,
});
