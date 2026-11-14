/**
 * Loom releases served by the Library, laid out as an upstream update mirror: the desktop feed
 * files, installers and `index.json` at the root, each version's runtime archives and
 * `SHA256SUMS` under `v<version>/`.
 */
export const LOOM_RELEASES_ROUTE = "/api/loom/releases";
export const LOOM_RELEASE_INDEX_FILE = "index.json";
/** The reason a Loom server gives when it serves no releases, so a client uses the public feed. */
export const LOOM_RELEASES_NOT_HOSTED = "not-hosted";

const FILE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/;
const VERSION_DIRECTORY =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.[1-9]\d{7}\.\d+)?$/;

/** The mirror path a request names, or `null` for anything outside the layout. */
export function loomReleaseMirrorPath(requested: string): string | null {
  let pieces: ReadonlyArray<string>;
  try {
    pieces = requested.split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (pieces.length === 1 && FILE.test(pieces[0]!)) return pieces[0]!;
  if (pieces.length === 2 && VERSION_DIRECTORY.test(pieces[0]!) && FILE.test(pieces[1]!))
    return `${pieces[0]}/${pieces[1]}`;
  return null;
}
