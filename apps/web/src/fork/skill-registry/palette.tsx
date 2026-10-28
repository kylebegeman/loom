import { BookOpenIcon } from "lucide-react";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { FEATURE, openSkills } from "./state";
export const skillsPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ activeThreadRef, loomFeatures }) =>
    !activeThreadRef || !loomFeatures.includes(FEATURE)
      ? []
      : [
          { tab: "skills" as const, title: "Open skills" },
          { tab: "sources" as const, title: "Install skills from git" },
          { tab: "lab" as const, title: "Create a skill" },
        ].map(({ tab, title }) => ({
          kind: "action" as const,
          value: `action:loom:skill-registry:${tab}`,
          title,
          description: "Skills manager",
          searchTerms: ["skills", "sources", "lab", "install", "provider", "account"],
          icon: <BookOpenIcon className="size-4" />,
          ...(tab === "skills" ? { shortcutCommand: "loom.skill-registry.toggle" as const } : {}),
          run: async () => openSkills(activeThreadRef, tab),
        })),
};
