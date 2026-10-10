import { isMacPlatform } from "~/lib/utils";
import { shortcutKeyFromEvent, type ShortcutEventLike } from "~/keybindings";

/** `mod+shift+'`, matched on the physical key so Shift turning `'` into `"` still counts. */
export function isPanelPickerDefaultShortcut(event: ShortcutEventLike, platform: string): boolean {
  if (shortcutKeyFromEvent(event) !== "'" || !event.shiftKey || event.altKey) return false;
  return isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export interface DefaultShortcutInput {
  readonly enabled: boolean;
  readonly matches: boolean;
  readonly defaultPrevented: boolean;
  readonly repeat: boolean;
  readonly paletteOpen: boolean;
  /** What the user's keybindings resolve this key to, if anything. */
  readonly boundCommand: string | null;
  readonly hasThread: boolean;
}

/** A user binding on the same key always wins, so the default never fires twice. */
export const shouldOpenFromDefaultShortcut = (input: DefaultShortcutInput): boolean =>
  input.enabled &&
  input.matches &&
  !input.defaultPrevented &&
  !input.repeat &&
  !input.paletteOpen &&
  input.boundCommand === null &&
  input.hasThread;
