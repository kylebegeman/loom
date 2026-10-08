import { CircuitBoardIcon } from "lucide-react";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { togglePcbPreview } from "./commands";
export const pcbPreviewPaletteSource: ForkCommandPaletteSource = {
  id: "pcb-preview",
  items: ({ activeThreadRef, loomFeatures }) => {
    if (!activeThreadRef || !loomFeatures.includes("pcb-preview")) return [];
    const active = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    const open = active?.kind === "fork" && active.panelId === "pcb-preview";
    return [
      {
        kind: "action",
        value: "action:loom:pcb-preview:toggle",
        title: open ? "Close PCB preview" : "Open PCB preview",
        description: "Schematics, boards and design checks",
        icon: <CircuitBoardIcon className="size-4" />,
        searchTerms: ["pcb", "KiCad", "tscircuit", "schematic", "erc", "drc"],
        run: async () => togglePcbPreview(activeThreadRef),
      },
    ];
  },
};
