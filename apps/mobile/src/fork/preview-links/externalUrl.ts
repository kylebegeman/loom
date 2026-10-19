import { needsPreviewLinkEntry } from "@t3tools/contracts/fork";

/**
 * A preview link leaving the app is swapped for a fresh entry link from the computer that serves
 * it. The lookup loads lazily so `openExternalUrl` gains no connection dependencies.
 */
export async function previewLinkOpenUrl(url: string): Promise<string> {
  if (!needsPreviewLinkEntry(url)) return url;
  const { requestPreviewEntryUrl } = await import("./entryUrl");
  return (await requestPreviewEntryUrl(url)) ?? url;
}
