import { isElectron } from "~/env";
import { ensureLocalApi } from "~/localApi";

/**
 * Opens a URL that is only known after a request, such as a single-use entry. On the web the
 * window opens before the await, while the click still counts as a user gesture, or pop-up
 * blockers drop it. Electron routes window.open to the system browser and denies it, so the
 * desktop app hands the finished URL to the shell instead.
 */
export async function openInSystemBrowser(resolveUrl: () => Promise<string>): Promise<void> {
  if (isElectron) {
    const url = await resolveUrl();
    await ensureLocalApi().shell.openExternal(url);
    return;
  }
  const target = window.open("about:blank", "_blank");
  if (target) target.opener = null;
  let url: string;
  try {
    url = await resolveUrl();
  } catch (error) {
    target?.close();
    throw error;
  }
  if (!target) throw new Error("Allow this site's pop-ups, then try again.");
  target.location.replace(url);
}
