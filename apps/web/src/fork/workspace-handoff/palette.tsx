import { ArrowRightLeftIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { FEATURE, openWorkspaceHandoff } from "./state";
export const workspaceHandoffPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ activeThreadRef, loomFeatures }) =>
    activeThreadRef !== null && loomFeatures.includes(FEATURE)
      ? [
          {
            kind: "action",
            value: "action:loom:workspace-handoff:open",
            title: "Move work",
            description: "Continue this conversation on another computer",
            icon: <ArrowRightLeftIcon className="size-4" />,
            searchTerms: [
              "handoff",
              "move",
              "machine",
              "computer",
              "host",
              "workspace",
              "continue",
            ],
            run: async () => openWorkspaceHandoff(activeThreadRef),
          },
        ]
      : [],
};
