import {
  ArrowLeftRightIcon,
  BinaryIcon,
  ChevronRightIcon,
  DicesIcon,
  GlobeIcon,
  HashIcon,
  TypeIcon,
  WrenchIcon,
} from "lucide-react";

import { ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { openUtilities } from "./open";
// Metadata only: the palette must not load the tool implementations.
import {
  findUtilityToolMeta,
  UTILITY_CATEGORIES,
  UTILITY_QUICK_ACTIONS,
  UTILITY_TOOL_META,
} from "./registry-meta";
import type { UtilityCategory } from "./types";

const CATEGORY_ICONS = {
  encode: BinaryIcon,
  hash: HashIcon,
  generate: DicesIcon,
  convert: ArrowLeftRightIcon,
  text: TypeIcon,
  web: GlobeIcon,
} satisfies Record<UtilityCategory, typeof WrenchIcon>;

const categoryIcon = (category: UtilityCategory) => {
  const Icon = CATEGORY_ICONS[category];
  return <Icon className={ITEM_ICON_CLASS} />;
};

export const utilitiesPaletteSource: ForkCommandPaletteSource = {
  id: "utilities",
  items: ({ activeThreadRef }) => [
    {
      kind: "submenu",
      value: "action:loom:utilities:open",
      title: "Utilities...",
      // Tool names too: the palette's search does not look inside submenus.
      searchTerms: [
        "utilities",
        "tools",
        ...UTILITY_CATEGORIES.map((category) => category.label),
        ...UTILITY_TOOL_META.map((tool) => tool.label),
      ],
      icon: <WrenchIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "loom.utilities.open",
      addonIcon: <ChevronRightIcon className={ITEM_ICON_CLASS} />,
      groups: [
        {
          value: "loom-utilities",
          label: "Utilities",
          items: UTILITY_TOOL_META.map((tool) => ({
            kind: "action",
            value: `action:loom:utilities:${tool.id}`,
            title: tool.label,
            description: tool.description,
            searchTerms: [tool.label, ...tool.keywords],
            icon: categoryIcon(tool.category),
            run: async () => openUtilities(tool.id, activeThreadRef),
          })),
        },
      ],
    },
    ...UTILITY_QUICK_ACTIONS.flatMap((action) => {
      const tool = findUtilityToolMeta(action.id);
      if (!tool) return [];
      return [
        {
          kind: "action" as const,
          value: `action:loom:utilities:quick:${tool.id}`,
          title: action.title,
          description: tool.description,
          searchTerms: [action.title, tool.label, ...tool.keywords],
          icon: categoryIcon(tool.category),
          run: async () => openUtilities(tool.id, activeThreadRef),
        },
      ];
    }),
  ],
};
