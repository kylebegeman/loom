import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

/**
 * Copies a link that is still being made. Safari lets a click write the clipboard only when the
 * write starts before the click handler first awaits, so the write starts now with the link
 * pending. A browser that refuses that gets the finished link written the usual way. Rejects
 * with the link's own failure when it could not be made.
 */
export async function writePendingLinkToClipboard(url: Promise<string>): Promise<void> {
  if (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.clipboard?.write
  ) {
    const text = url.then((value) => new Blob([value], { type: "text/plain" }));
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
      return;
    } catch {
      // A link that failed rejects again below; any other refusal falls back to plain text.
    }
  }
  await writeTextToClipboard(await url, "link");
}
