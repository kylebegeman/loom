import { BellIcon, DownloadIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openSettingsAction } from "../settings/action-navigation";

export const connectionsPaletteSource: ForkCommandPaletteSource = {
  id: "fleet-connections",
  items: ({ loomFeatures, libraryPush }) =>
    !loomFeatures.includes("core")
      ? []
      : [
          {
            kind: "action",
            value: "action:loom:fleet-connections:review-updates",
            title: "Review updates",
            description: "Review available updates for your computers",
            searchTerms: ["fleet", "updates", "computers", "versions"],
            icon: <DownloadIcon className="size-4" />,
            run: async () => openSettingsAction("fleet-updates"),
          },
          ...(libraryPush
            ? [
                {
                  kind: "action" as const,
                  value: "action:loom:push:test",
                  title: "Send test notification",
                  description: "Choose an iPhone registered with your Library",
                  searchTerms: ["push", "notifications", "phone", "test", "library"],
                  icon: <BellIcon className="size-4" />,
                  run: async () => openSettingsAction("library-push"),
                },
              ]
            : []),
        ],
};
