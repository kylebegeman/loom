import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { resolveShortcutCommand } from "~/keybindings";
import { isEditableFocused } from "~/lib/editableFocus";
import { isPreviewFocused } from "~/lib/previewFocus";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "~/state/server";

/** Project home lives outside the chat layout, so its own action owns these shortcuts. */
export function useProjectHomeNewThreadShortcuts(startNewThread: () => void | Promise<void>) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        isCommandPaletteOpen() ||
        isModelPickerOpen() ||
        document.querySelector(
          '[role="dialog"]:not([data-closed]), [role="alertdialog"]:not([data-closed])',
        ) !== null
      )
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
          previewFocus: isPreviewFocused(),
          previewOpen: false,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: false,
        },
      });
      if (command !== "chat.new" && command !== "chat.newLocal") return;
      event.preventDefault();
      event.stopPropagation();
      void startNewThread();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, startNewThread]);
}
