import { NetworkIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { FEATURE, buildGraph, openImpact, openPanel, projectIdOf } from "./state";

export const codeGraphPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ activeThreadRef, loomFeatures }) => {
    if (!activeThreadRef || !loomFeatures.includes(FEATURE) || !projectIdOf(activeThreadRef))
      return [];
    const base = {
      kind: "action" as const,
      icon: <NetworkIcon className="size-4" />,
      description: "Code map",
      searchTerms: ["code graph", "graphify", "symbols", "dependencies", "impact", "callers"],
    };
    return [
      {
        ...base,
        value: "action:loom:code-graph:open",
        title: "Code map: Open",
        run: async () => openPanel(activeThreadRef),
      },
      {
        ...base,
        value: "action:loom:code-graph:impact",
        title: "Code map: Impact of uncommitted changes",
        run: async () => openImpact(activeThreadRef),
      },
      {
        ...base,
        value: "action:loom:code-graph:update",
        title: "Code map: Build or update graph",
        run: () => buildGraph(activeThreadRef, "update"),
      },
    ];
  },
};
