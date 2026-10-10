/** A project is reported again only after this long. */
export const REPORT_INTERVAL_MS = 10 * 60_000;
/** Projects remembered; the least recently reported is forgotten first. */
export const REMEMBERED_PROJECTS = 20;

/**
 * Whether opening `key` (an environment and project) should be reported now. Records the report
 * in `reported`, whose insertion order is recency.
 */
export function shouldReportProjectOpen(
  reported: Map<string, number>,
  key: string,
  now: number,
): boolean {
  const last = reported.get(key);
  if (last !== undefined && now - last < REPORT_INTERVAL_MS) return false;
  reported.delete(key);
  reported.set(key, now);
  while (reported.size > REMEMBERED_PROJECTS) reported.delete(reported.keys().next().value!);
  return true;
}
