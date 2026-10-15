import { toastManager } from "~/components/ui/toast";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";

/**
 * The text a copy action puts on the clipboard: the shown value without digit grouping, and with
 * an ASCII hyphen for the typographic minus so the number pastes into code and spreadsheets.
 */
export function copyText(shown: string) {
  return shown.replace(/(\d),(?=\d{3}\b)/g, "$1").replaceAll("\u2212", "-");
}

/**
 * Copies a shown value and confirms it. Where the host blocks the clipboard, the value is
 * selected in place so a keyboard copy still works; a value with nothing on screen to select,
 * such as one copied from a menu, is shown in the notice instead.
 */
export async function copyValue(shown: string, target?: HTMLElement | null) {
  const text = copyText(shown);
  try {
    await writeTextToClipboard(text, "value");
    toastManager.add({ type: "success", title: `Copied ${text}` });
  } catch {
    const selection = target ? window.getSelection() : null;
    if (target && selection) {
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    toastManager.add({
      type: "warning",
      title: "This host blocks copying",
      description:
        target && selection
          ? "The value is selected; press Cmd or Ctrl+C."
          : `Copy it by hand: ${text}`,
    });
  }
}
