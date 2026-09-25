import { EyeIcon, PanelTopIcon } from "lucide-react";

import { ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { dispatchForkCommand } from "../keybindings/forkCommandBus";

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
              dispatchForkCommand("loom.thread-inspector.toggle");
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
              dispatchForkCommand("loom.thread-inspector.card");
            },
          },
        ],
};
