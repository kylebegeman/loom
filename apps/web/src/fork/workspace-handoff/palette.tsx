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
            title: "Continue on another machine",
            description: "Prepare a linked continuation before settling this work",
            icon: <ArrowRightLeftIcon className="size-4" />,
            searchTerms: ["handoff", "move", "machine", "host", "workspace", "continue"],
            run: async () => openWorkspaceHandoff(activeThreadRef),
          },
        ]
      : [],
};
