/** Loom publications use their own repository and unprefixed immutable tags. */
export const LOOM_CLI_RELEASE_REPOSITORY = "kylebegeman/loom";
const LOOM_RELEASE_BASE_URL = `https://github.com/${LOOM_CLI_RELEASE_REPOSITORY}/releases/download`;

/** Explicit mirrors retain upstream's established v-prefixed archive layout. */
export function loomCliReleaseDownloadUrl(version: string, baseUrl: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  return `${origin}/${origin === LOOM_RELEASE_BASE_URL ? "" : "v"}${version}`;
}

/** Integration tags and upstream tags cannot select a different runtime. */
export function loomCliReleaseVersion(tag: string): string | undefined {
  return /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1];
}

/** Release-body metadata is pinned to the same immutable tag as the update target. */
export function loomReleaseDatabaseMigration(
  notes: string | null | undefined,
  version: string,
): number | undefined {
  if (typeof notes !== "string") return undefined;
  const records = [...notes.matchAll(/^<!-- loom-release-metadata: (.+) -->\r?$/gm)];
  if (records.length !== 1) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(records[0]![1]!);
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("version" in value) ||
    value.version !== version ||
    !("sourceCommit" in value) ||
    typeof value.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
    !("databaseMigration" in value) ||
    typeof value.databaseMigration !== "number" ||
    !Number.isSafeInteger(value.databaseMigration) ||
    value.databaseMigration < 0
  )
    return undefined;
  return value.databaseMigration;
}
