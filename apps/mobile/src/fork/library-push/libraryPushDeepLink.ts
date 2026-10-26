/**
 * A Library's Vault approval alert opens the computer's settings, whose Vault access section lists
 * the request (the link is built in apps/server/src/fork/library-push/apnsPayloads.ts). Only that
 * one in-app route is accepted from a payload.
 */
export function computerSettingsDeepLink(value: string): string | null {
  if (value.trim() !== value || value.includes("?") || value.includes("#")) return null;
  const parts = value.split("/");
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== "settings") return null;
  if (parts[2] !== "environments") return null;
  try {
    const environmentId = decodeURIComponent(parts[3] ?? "");
    return environmentId.length === 0
      ? null
      : `/settings/environments/${encodeURIComponent(environmentId)}`;
  } catch {
    return null;
  }
}
