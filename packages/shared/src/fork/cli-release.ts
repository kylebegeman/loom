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
