/**
 * How the Sites page frames a live site. A framed site runs its own scripts, so it may only ever
 * load from another origin than the app: there, `allow-same-origin` keeps the site's own storage
 * working without giving it the app's.
 *
 * Never add `allow-top-navigation`, `allow-modals` or `allow-downloads`: a framed site must not
 * navigate the app away, block it with a dialog, or save files.
 */

/** A card thumbnail: rendered, never interactive. */
export const SITE_THUMBNAIL_SANDBOX = "allow-scripts allow-same-origin";

/** The Preview stage, where the site can be used, and links may open in a new tab. */
export const SITE_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

/**
 * The address to frame for `path` on the site at `siteUrl`, or null when it must not be framed:
 * an address that is not http(s), or one on the app's own origin, where the sandbox would no
 * longer hold. `path` stays on the site's origin, whatever it says.
 */
export function siteFrameUrl(
  siteUrl: string,
  path: string | undefined,
  appOrigin: string,
): string | null {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return null;
  }
  if (site.protocol !== "https:" && site.protocol !== "http:") return null;
  if (site.origin === appOrigin) return null;
  if (path === undefined || path === "") return site.href;
  let target: URL;
  try {
    target = new URL(path.startsWith("/") ? path : `/${path}`, site.origin);
  } catch {
    return site.href;
  }
  return target.origin === site.origin ? target.href : site.href;
}
