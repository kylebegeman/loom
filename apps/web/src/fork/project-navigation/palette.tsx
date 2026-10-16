import { FolderClosedIcon } from "lucide-react";

import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { dispatchForkCommand } from "../keybindings/forkCommandBus";
import { toggleProjectNavigationView } from "./preference";

export const projectNavigationPaletteSource: ForkCommandPaletteSource = {
  id: "project-navigation",
  items: () => [
    {
      kind: "action",
      value: "action:loom:navigation:toggle-view",
      title: "Switch sidebar view",
      description: "Threads or Projects",
      icon: <FolderClosedIcon className="size-4" />,
      searchTerms: ["sidebar", "threads", "projects", "group by project", "toggle view"],
      shortcutCommand: "loom.navigation.toggleView",
      run: async () => {
        // The sidebar handles it so it can keep each view's scroll position.
        if (!dispatchForkCommand("loom.navigation.toggleView")) toggleProjectNavigationView();
      },
    },
  ],
};
