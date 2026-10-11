import { dispatchPcbAction, type PcbAction } from "./actions";
import { requestPcbChange } from "./requestCommands";
import { CircuitBoardIcon } from "lucide-react";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openLastAgentDesigns } from "./agentDesigns";
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
      ...(open
        ? [
            ...(
              [
                ["history", "Toggle history"],
                ["history-previous", "Previous version"],
                ["history-next", "Next version"],
              ] satisfies Array<[PcbAction, string]>
            ).map(([action, label]) => ({
              kind: "action" as const,
              value: `action:loom:pcb-preview:${action}`,
              title: `PCB: ${label}`,
              description: "View this design across the thread's turns",
              icon: <CircuitBoardIcon className="size-4" />,
              searchTerms: ["pcb", "history", "turn"],
              run: async () => dispatchPcbAction(activeThreadRef, action),
            })),
            {
              kind: "action" as const,
              value: "action:loom:pcb-preview:request",
              title: "PCB preview: Request a change",
              description: "Ask for a change to the selected component, net or area",
              icon: <CircuitBoardIcon className="size-4" />,
              searchTerms: ["pcb", "request", "change"],
              run: async () => requestPcbChange(activeThreadRef),
            },
          ]
        : []),
      {
        kind: "action",
        value: "action:loom:pcb-preview:last-turn",
        title: "PCB preview: Open designs from the last turn",
        description: "Designs the agent wrote or changed",
        icon: <CircuitBoardIcon className="size-4" />,
        searchTerms: ["pcb", "agent", "turn", "changed"],
        run: async () => openLastAgentDesigns(activeThreadRef),
      },
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
