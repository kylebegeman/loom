import { EyeIcon, PanelTopIcon } from "lucide-react";

import { ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { useInspectorCardStore } from "./cardStore";
import { openThreadInspectorPanel } from "./commands";

/** "Show" always opens; the keybindings are the toggles. */
export const threadInspectorPaletteSource: ForkCommandPaletteSource = {
  id: "thread-inspector",
  items: ({ activeThreadRef }) =>
    activeThreadRef === null
      ? []
      : [
          {
            kind: "action",
            value: "action:loom:thread-inspector:toggle",
            searchTerms: ["inspector", "thread status", "panel", "overview"],
            title: "Show thread inspector",
            icon: <PanelTopIcon className={ITEM_ICON_CLASS} />,
            shortcutCommand: "loom.thread-inspector.toggle",
            run: async () => {
              openThreadInspectorPanel(activeThreadRef);
            },
          },
          {
            kind: "action",
            value: "action:loom:thread-inspector:card",
            searchTerms: ["inspector", "thread status", "card", "glance"],
            title: "Show thread inspector card",
            icon: <EyeIcon className={ITEM_ICON_CLASS} />,
            shortcutCommand: "loom.thread-inspector.card",
            run: async () => {
              useInspectorCardStore.getState().setOpen(true);
            },
          },
        ],
};
