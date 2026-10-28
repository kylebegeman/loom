import { TerminalIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openMini } from "./state";
export const miniOffloadPaletteSource: ForkCommandPaletteSource = {
  id: "mini-offload",
  items: ({ activeThreadRef, loomFeatures }) =>
    !activeThreadRef || !loomFeatures.includes("mini-offload")
      ? []
      : [
          {
            kind: "action",
            value: "action:loom:mini-offload:open",
            title: "Open command jobs",
            shortcutCommand: "loom.mini-offload.open",
            icon: <TerminalIcon className="size-4" />,
            description: "Run builds, tests and scripts on a worker",
            searchTerms: [
              "runner",
              "queue",
              "offload",
              "Orange Pi",
              "Mini",
              "computer",
              "environment",
              "agent",
            ],
            run: async () => openMini(activeThreadRef),
          },
        ],
};
