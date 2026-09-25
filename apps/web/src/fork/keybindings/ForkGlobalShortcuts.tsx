import { isForkKeybindingCommand } from "@t3tools/contracts/fork";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { resolveShortcutCommand } from "~/keybindings";
import { isEditableFocused } from "~/lib/editableFocus";
import { isPreviewFocused } from "~/lib/previewFocus";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import { useRouteThread } from "../routeThread";
import { dispatchForkCommand } from "./forkCommandBus";

/**
 * Resolves fork commands with the same `when` context as upstream's chat shortcuts
 * (routes/_chat.tsx). Listens in the capture phase, like ChatView's shortcuts, because the
 * terminal stops every key it turns into input.
 */
export function ForkGlobalShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const threadRef = useRouteThread()?.threadRef ?? null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    threadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef).terminalOpen
      : false,
  );
  const previewOpen = useRightPanelStore((state) =>
    threadRef ? selectActiveRightPanel(state.byThreadKey, threadRef) === "preview" : false,
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (!command || !isForkKeybindingCommand(command)) return;
      if (dispatchForkCommand(command)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, previewOpen, terminalOpen]);
  return null;
}
