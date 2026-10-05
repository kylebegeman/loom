import { ChevronRightIcon, ListTreeIcon } from "lucide-react";
import { ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import { useRightPanelStore } from "~/rightPanelStore";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { activeOutlineSource } from "./commands";
import { OutlineSymbolIcon } from "./FileOutlineList";
import { outlineFor } from "./outlineCache";
import { useFileOutlineStore } from "./store";

export const fileOutlinePaletteSource: ForkCommandPaletteSource = {
  id: "file-outline",
  items: ({ activeThreadRef }) => {
    const source = activeOutlineSource(activeThreadRef);
    if (!source) return [];
    const result = outlineFor(source.path, source.contents);
    return [
      {
        kind: "action",
        value: "action:loom:file-outline:toggle",
        title: "Toggle file outline",
        searchTerms: ["Toggle file outline", "symbols", "navigation"],
        icon: <ListTreeIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "loom.file-outline.toggle",
        run: async () => {
          if (activeOutlineSource(activeThreadRef)) useFileOutlineStore.getState().toggle();
        },
      },
      {
        kind: "submenu",
        value: "action:loom:file-outline:go-to-symbol",
        title: "Go to symbol in file",
        searchTerms: [
          "Go to symbol in file",
          "outline",
          "function",
          "class",
          "heading",
          source.path,
        ],
        icon: <ListTreeIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <ChevronRightIcon className={ITEM_ICON_CLASS} />,
        groups: [
          {
            value: "loom-file-symbols",
            label: "Symbols in " + source.path.split(/[/\\]/).at(-1),
            items: (result?.symbols ?? []).map((symbol) => ({
              kind: "action",
              value: "action:loom:file-outline:symbol:" + symbol.id,
              title: symbol.name,
              description: symbol.kind + ", line " + symbol.line,
              searchTerms: [symbol.name, symbol.kind, symbol.detail ?? ""],
              icon: <OutlineSymbolIcon kind={symbol.kind} />,
              run: async () => {
                if (activeOutlineSource(activeThreadRef)?.path === source.path)
                  useRightPanelStore
                    .getState()
                    .openFile(source.threadRef, source.path, symbol.line);
              },
            })),
          },
        ],
      },
    ];
  },
};
