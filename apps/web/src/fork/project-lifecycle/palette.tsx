import { HardDriveIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { FEATURE, openStorageSettings } from "./state";

export const projectLifecyclePaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ loomFeatures }) =>
    loomFeatures.includes(FEATURE)
      ? [
          {
            kind: "action",
            value: `action:loom:${FEATURE}:open`,
            title: "Storage and lanes",
            description: "Lane caps, disk space and cleanup",
            searchTerms: ["disk", "space", "lanes", "tmp", "DerivedData", "cleanup", "storage"],
            icon: <HardDriveIcon className="size-4" />,
            run: async () => {
              openStorageSettings();
            },
          },
        ]
      : [],
};
