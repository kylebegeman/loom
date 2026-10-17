import type { SitesSnapshot } from "@t3tools/contracts/fork";

/** A previously healthy observation must not stay green while a client is offline. */
export function siteCheckState(
  check: SitesSnapshot["checks"][number],
  staleAfterSeconds: number,
  now: number,
) {
  if (check.state === "disabled") return "disabled";
  if (!check.last) return "unknown";
  const checkedAt = Date.parse(check.last.checked_at);
  if (!Number.isFinite(checkedAt) || now - checkedAt > staleAfterSeconds * 1000) return "stale";
  return check.state;
}
