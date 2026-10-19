import { isElectron } from "~/env";
import { ensureLocalApi } from "~/localApi";

/**
 * Opens a URL that is only known after a request, such as a single-use entry. On the web the
 * window opens before the await, while the click still counts as a user gesture, or pop-up
 * blockers drop it. Electron routes window.open to the system browser and denies it, so the
 * desktop app hands the finished URL to the shell instead. A null URL, whose failure has
 * already been shown, opens nothing.
 */
export async function openInSystemBrowser(resolveUrl: () => Promise<string | null>): Promise<void> {
  if (isElectron) {
    const url = await resolveUrl();
    if (url !== null) await ensureLocalApi().shell.openExternal(url);
    return;
  }
  const target = window.open("about:blank", "_blank");
  if (target) target.opener = null;
  let url: string | null;
  try {
    url = await resolveUrl();
  } catch (error) {
    target?.close();
    throw error;
  }
  if (url === null) {
    target?.close();
    return;
  }
  if (!target) throw new Error("Allow this site's pop-ups, then try again.");
  target.location.replace(url);
}

/**
 * Opens a page a link serves outside Loom through a fresh entry from the computer serving it.
 * Navigation loads on demand so `localApi`, which calls this, gains no connection dependencies.
 */
export function openPreviewLinkExternally(link: string): Promise<void> {
  return openInSystemBrowser(async () => (await import("./navigation")).previewLinkEntryUrl(link));
}
