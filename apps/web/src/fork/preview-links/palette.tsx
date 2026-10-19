import { Link2Icon, SettingsIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { FEATURE, openPreviewLinksSettings, openPreviewLinksSheet } from "./state";

export const previewLinksPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ loomFeatures }) =>
    loomFeatures.includes(FEATURE)
      ? [
          {
            kind: "action",
            value: `action:loom:${FEATURE}:links`,
            title: "Preview links",
            description: "Open, copy, extend or end shared ports",
            searchTerms: ["preview", "share", "port", "tunnel", "link", "localhost"],
            icon: <Link2Icon className="size-4" />,
            run: async () => {
              openPreviewLinksSheet();
            },
          },
          {
            kind: "action",
            value: `action:loom:${FEATURE}:settings`,
            title: "Preview link settings",
            description: "Domain, tunnel token and lifetime",
            searchTerms: ["preview", "tunnel", "cloudflare", "domain", "token", "settings"],
            icon: <SettingsIcon className="size-4" />,
            run: async () => {
              openPreviewLinksSettings();
            },
          },
        ]
      : [],
};
