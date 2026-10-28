/**
 * Libraries from before thread approval cards link Vault requests to computer settings.
 * Keep accepting that route while newer notifications open the requesting thread.
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

export function libraryPushDeepLink(value: string): string | null {
  const computer = computerSettingsDeepLink(value);
  if (computer !== null) return computer;
  if (value.trim() !== value || value.includes("#")) return null;
  const bot = /^\/bots\/([^/?]+)\/inbox$/.exec(value);
  if (bot?.[1]) {
    try {
      const environmentId = decodeURIComponent(bot[1]);
      return environmentId.length === 0 ? null : `/bots/${encodeURIComponent(environmentId)}/inbox`;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("/settings/scheduled-tasks?")) return null;
  const query = new URLSearchParams(value.slice(value.indexOf("?") + 1));
  if (query.size !== 2 || !query.has("environmentId") || !query.has("taskId")) return null;
  const environmentId = query.get("environmentId");
  const taskId = query.get("taskId");
  if (!environmentId || !taskId) return null;
  return `/settings/scheduled-tasks?environmentId=${encodeURIComponent(environmentId)}&taskId=${encodeURIComponent(taskId)}`;
}
