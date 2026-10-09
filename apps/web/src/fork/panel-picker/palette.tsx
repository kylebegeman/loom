import { PanelRightIcon } from "lucide-react";

import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { dispatchForkCommand } from "../keybindings/forkCommandBus";

export const panelPickerPaletteSource: ForkCommandPaletteSource = {
  id: "panel-picker",
  items: ({ activeThreadRef }) =>
    activeThreadRef
      ? [
          {
            kind: "action",
            value: "action:loom:panel-picker:open",
            title: "Open panel picker",
            description: "Right panel",
            icon: <PanelRightIcon className="size-4" />,
            searchTerms: ["panel", "surface", "right panel", "launcher"],
            shortcutCommand: "loom.panel-picker.open",
            run: async () => {
              dispatchForkCommand("loom.panel-picker.open");
            },
          },
        ]
      : [],
};
