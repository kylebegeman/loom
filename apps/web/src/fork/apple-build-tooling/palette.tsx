import { HammerIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import {
  FEATURE,
  activeRunOf,
  cancelActiveRun,
  hasRememberedSelection,
  openPanel,
  startRemembered,
} from "./state";

const RUN_ITEMS = [
  { action: "build", title: "Apple: Build" },
  { action: "test", title: "Apple: Test" },
  { action: "run", title: "Apple: Build and run" },
] as const;

export const appleBuildToolingPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ activeThreadRef, loomFeatures }) => {
    if (!activeThreadRef || !loomFeatures.includes(FEATURE)) return [];
    const base = {
      kind: "action" as const,
      icon: <HammerIcon className="size-4" />,
      description: "Apple build",
      searchTerms: ["Xcode", "Swift", "xcodebuild", "simulator", "iOS"],
    };
    return [
      {
        ...base,
        value: "action:loom:apple-build-tooling:open",
        title: "Apple: Open build panel",
        run: async () => openPanel(activeThreadRef),
      },
      ...(hasRememberedSelection(activeThreadRef)
        ? RUN_ITEMS.map(({ action, title }) => ({
            ...base,
            value: `action:loom:apple-build-tooling:${action}`,
            title,
            run: () => startRemembered(activeThreadRef, action),
          }))
        : []),
      ...(activeRunOf(activeThreadRef) === null
        ? []
        : [
            {
              ...base,
              value: "action:loom:apple-build-tooling:cancel",
              title: "Apple: Cancel run",
              run: () => cancelActiveRun(activeThreadRef),
            },
          ]),
    ];
  },
};
