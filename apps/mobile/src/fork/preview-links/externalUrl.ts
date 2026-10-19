import { looksLikePreviewLinkUrl } from "@t3tools/contracts/fork";

/** The gateway's own paths, entry links included, open as they are. */
const GATEWAY_PATH_PREFIX = "/__loom/";

/**
 * A preview's canonical link opens nowhere until the browser has entered from Loom, so a link
 * leaving the app is swapped for a fresh entry link from the computer that serves it. The lookup
 * loads lazily so `openExternalUrl` gains no connection dependencies.
 */
export async function previewLinkOpenUrl(url: string): Promise<string> {
  if (!looksLikePreviewLinkUrl(url) || new URL(url).pathname.startsWith(GATEWAY_PATH_PREFIX)) {
    return url;
  }
  const { requestPreviewEntryUrl } = await import("./entryUrl");
  return (await requestPreviewEntryUrl(url)) ?? url;
}
