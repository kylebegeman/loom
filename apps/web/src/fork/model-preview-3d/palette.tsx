import { BoxIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { dispatchModelAction, modelOverhangsShown, modelOrientationActive } from "./actions";
import { modelSurface, openLastAgentModels } from "./agentModels";
export const modelPreview3dPaletteSource: ForkCommandPaletteSource = {
  id: "model-preview-3d",
  items: ({ activeThreadRef, loomFeatures, modelFiles }) => {
    if (!activeThreadRef || !loomFeatures.includes("model-preview-3d")) return [];
    const base = {
      icon: <BoxIcon className="size-4" />,
      description: "3D model",
      searchTerms: ["3D", "mesh", "SCAD"],
    };
    return [
      {
        ...base,
        kind: "submenu",
        value: "action:loom:model-preview-3d:open",
        title: "3D model: Open file...",
        addonIcon: <BoxIcon className="size-4" />,
        groups: [
          {
            value: "models",
            label: "Model files",
            items: [
              {
                ...base,
                kind: "action",
                value: "action:loom:model-preview-3d:picker",
                title: "Browse model files...",
                run: async () => {
                  useRightPanelStore
                    .getState()
                    .openSurface(activeThreadRef, forkPanelSurface("model-preview-3d"));
                },
              },
              ...(modelFiles ?? []).map((path) => ({
                ...base,
                kind: "action" as const,
                value: `action:loom:model-preview-3d:file:${path}`,
                title: path,
                run: async () => {
                  useRightPanelStore.getState().openSurface(activeThreadRef, modelSurface(path));
                },
              })),
            ],
          },
        ],
      },
      ...(loomFeatures.includes("model-follow-agent")
        ? [
            {
              ...base,
              kind: "action" as const,
              value: "action:loom:model-preview-3d:last-agent-turn",
              title: "3D model: Open models from the last turn",
              run: () => openLastAgentModels(activeThreadRef),
            },
          ]
        : []),
      ...(
        [
          "capture",
          "capture-four",
          "rerender",
          "toggle-units",
          "copy-view",
          "save-view",
          "toggle-overhangs",
          "toggle-previous",
          ...(loomFeatures.includes("model-lay-flat")
            ? [
                "auto-lay-flat" as const,
                ...(modelOrientationActive(activeThreadRef) ? ["reset-orientation" as const] : []),
              ]
            : []),
          ...(loomFeatures.includes("model-history")
            ? ["toggle-history" as const, "history-earlier" as const, "history-later" as const]
            : []),
          ...(loomFeatures.includes("model-slicer-bridge")
            ? ["estimate-print" as const, "toggle-layers" as const]
            : []),
          ...(loomFeatures.includes("model-assemblies") ? ["toggle-explode" as const] : []),
          ...(loomFeatures.includes("model-print-check") ? ["print-check" as const] : []),
        ] as const
      ).map((action) => ({
        ...base,
        kind: "action" as const,
        value: `action:loom:model-preview-3d:${action}`,
        title: `3D model: ${{ "toggle-history": "Toggle history", "history-earlier": "Previous version", "history-later": "Next version", "toggle-layers": "Show or hide sliced layers", "estimate-print": "Estimate print", "toggle-explode": "Toggle exploded view", "auto-lay-flat": "Auto lay flat", "reset-orientation": "Reset orientation", "print-check": "Check part for printing", capture: "Capture view", "capture-four": "Capture four views", rerender: "Re-render", "toggle-units": "Switch units", "copy-view": "Copy view image", "save-view": "Save view as PNG", "toggle-overhangs": modelOverhangsShown(activeThreadRef) ? "Hide overhangs" : "Show overhangs", "toggle-previous": "Show or hide previous version" }[action]}`,
        run: async () => {
          dispatchModelAction(activeThreadRef, action);
        },
      })),
    ];
  },
};
