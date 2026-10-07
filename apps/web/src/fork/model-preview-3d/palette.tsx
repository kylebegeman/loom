import { BoxIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { dispatchModelAction } from "./actions";
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
                  useRightPanelStore.getState().openSurface(activeThreadRef, {
                    ...forkPanelSurface("model-preview-3d", path),
                    title: path.split("/").at(-1) ?? path,
                  });
                },
              })),
            ],
          },
        ],
      },
      ...(["capture", "capture-four", "rerender"] as const).map((action) => ({
        ...base,
        kind: "action" as const,
        value: `action:loom:model-preview-3d:${action}`,
        title: `3D model: ${{ capture: "Capture view", "capture-four": "Capture four views", rerender: "Re-render" }[action]}`,
        run: async () => {
          dispatchModelAction(activeThreadRef, action);
        },
      })),
    ];
  },
};
