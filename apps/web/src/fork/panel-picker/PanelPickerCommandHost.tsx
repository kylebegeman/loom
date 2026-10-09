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
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { isPanelPickerDefaultShortcut, shouldOpenFromDefaultShortcut } from "./defaultShortcut";
import { readPanelPickerPreferences, usePanelPickerPreferences } from "./preferences";
import { requestPanelPicker } from "./requests";

// A hidden panel mounts a frame or two after `show`; give the request that long to land.
const REQUEST_FRAMES = 3;

function requestWhenMounted(frames = REQUEST_FRAMES) {
  requestAnimationFrame(() => {
    if (!requestPanelPicker() && frames > 1) requestWhenMounted(frames - 1);
  });
}

/**
 * Handles `loom.panel-picker.open` and the default `mod+shift+'`. The default is a listener,
 * not a keybindings.json entry, so a rollback to upstream never sees an unknown command.
 */
export function PanelPickerCommandHost() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const { shortcut } = usePanelPickerPreferences();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const terminalOpen = useTerminalUiStateStore((state) =>
    threadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef).terminalOpen
      : false,
  );
  const previewOpen = useRightPanelStore((state) =>
    threadRef ? selectActiveRightPanel(state.byThreadKey, threadRef) === "preview" : false,
  );

  useEffect(() => {
    if (!threadRef) return;
    const open = () => {
      useRightPanelStore.getState().show(threadRef);
      // With the picker off, upstream's launcher focuses itself when the panel is empty.
      if (readPanelPickerPreferences().enabled) requestWhenMounted();
    };
    const unsubscribe = onForkCommand("loom.panel-picker.open", open);
    if (!shortcut) return unsubscribe;
    const onKeyDown = (event: KeyboardEvent) => {
      const matches = isPanelPickerDefaultShortcut(event, navigator.platform);
      if (!matches) return;
      const boundCommand = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const run = shouldOpenFromDefaultShortcut({
        enabled: shortcut,
        matches,
        defaultPrevented: event.defaultPrevented,
        repeat: event.repeat,
        paletteOpen: isCommandPaletteOpen(),
        boundCommand,
        hasThread: true,
      });
      if (!run) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    };
    // Capture phase, like ForkGlobalShortcuts: the terminal stops keys it turns into input.
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [keybindings, previewOpen, shortcut, terminalOpen, threadRef]);

  return null;
}
