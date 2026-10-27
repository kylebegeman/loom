import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyLoomSettingsTarget } from "../fork/settings/navigation";

// Retired page. Agent-facing contract text still links here, so every old link keeps working.
export function redirectLegacyLoomSettings({
  location,
}: {
  location: { search: Record<string, unknown>; hash: string };
}): never {
  throw redirect({ ...legacyLoomSettingsTarget(location), replace: true });
}

export const Route = createFileRoute("/_chat/settings/loom")({
  beforeLoad: redirectLegacyLoomSettings,
});
