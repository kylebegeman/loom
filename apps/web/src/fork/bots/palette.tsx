import { useNavigate } from "@tanstack/react-router";
import { BotIcon, PlayIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "~/components/CommandPalette.logic";
import { useLibraryPermission } from "../project-library/state";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { bots, useBots } from "./state";

/** What the Bots source needs; null leaves the palette without Bots entries. */
export interface BotsPaletteContext {
  /** Live bots the user may run; archived ones stay off the palette. */
  readonly runnable: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }>;
  readonly openBots: () => Promise<void>;
  readonly runBot: (botId: string) => Promise<void>;
}

const icon = (Icon: typeof BotIcon, className = ITEM_ICON_CLASS): ReactNode => (
  <Icon className={className} />
);

export const botsPaletteSource: ForkCommandPaletteSource = {
  id: "bots",
  items: ({ bots: context }) => {
    if (!context) return [];
    const runItems: CommandPaletteActionItem[] = context.runnable.map((bot) => ({
      kind: "action",
      value: `action:loom:bots:run:${bot.id}`,
      title: bot.name,
      ...(bot.description ? { description: bot.description } : {}),
      searchTerms: [bot.name, bot.id],
      icon: icon(BotIcon),
      run: () => context.runBot(bot.id),
    }));
    return [
      {
        kind: "action",
        value: "action:loom:bots:open",
        title: "Go to Bots",
        searchTerms: ["bots", "jobs", "runs", "reusable", "agents"],
        icon: icon(BotIcon),
        run: context.openBots,
      },
      ...(runItems.length === 0
        ? []
        : [
            {
              kind: "submenu" as const,
              value: "action:loom:bots:run",
              title: "Run bot...",
              searchTerms: ["bots", "run", "job", "start"],
              icon: icon(PlayIcon),
              addonIcon: icon(PlayIcon, ADDON_ICON_CLASS),
              groups: [{ value: "bots-run", label: "Bots", items: runItems }],
            },
          ]),
    ];
  },
};

/** The primary environment's bots, while it supports them. */
export function useBotsPaletteContext(): BotsPaletteContext | null {
  const navigate = useNavigate();
  const { host, live, bots: listed } = useBots();
  const canRun = useLibraryPermission(bots.run, host.environmentId) && host.connected;
  if (!live) return null;
  return {
    runnable: canRun ? listed.filter((bot) => bot.archivedAt === null) : [],
    openBots: () => navigate({ to: "/loom/bots" }),
    runBot: (botId) => navigate({ to: "/loom/bots", search: { bot: botId, run: botId } }),
  };
}
