const STORAGE_KEY = "loom:sign-in-return-to";
const AUTH_PAGES = new Set(["/pair", "/connect", "/connect-agent"]);
const path = (url: URL) => url.pathname + url.search + url.hash;

/** Retain the app page before its auth guard redirects this tab to pairing. */
export function rememberLoomSignInDestination(currentUrl: string) {
  const current = new URL(currentUrl);
  if (AUTH_PAGES.has(current.pathname)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path(current));
  } catch {
    // Browser storage can be unavailable; sign-in still works with its home default.
  }
}

export function clearLoomSignInDestination() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Authentication must not depend on browser storage availability.
  }
}

export function loomSignInDestination(currentUrl: string) {
  const current = new URL(currentUrl);
  if (!AUTH_PAGES.has(current.pathname)) return path(current);
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (saved?.startsWith("/") && !saved.startsWith("//")) {
      const target = new URL(saved, current.origin);
      if (target.origin === current.origin && !AUTH_PAGES.has(target.pathname)) return path(target);
    }
  } catch {
    // Fall back to the home page for a direct pairing entry.
  }
  return "/";
}
