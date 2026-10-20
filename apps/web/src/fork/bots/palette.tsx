import { useNavigate } from "@tanstack/react-router";
import { BotIcon, InboxIcon, LayersIcon, PlayIcon, ZapIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
} from "~/components/CommandPalette.logic";
import { useLibraryPermission } from "../project-library/state";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { canSaveAsBot } from "./fromThread/logic";
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
  /** Null while the server has no inbox. */
  readonly openInbox: (() => Promise<void>) | null;
  readonly runBot: (botId: string) => Promise<void>;
  /** Null while the server cannot run batches. */
  readonly runBotOnMany: ((botId: string) => Promise<void>) | null;
  /** Null while the server has no triggers or this connection cannot change them. */
  readonly newTrigger: ((botId: string) => Promise<void>) | null;
  /** Null while the server cannot draft bots from threads or this connection cannot save. */
  readonly saveAsBot: {
    readonly allowed: (thread: ScopedThreadRef) => boolean;
    readonly open: (thread: ScopedThreadRef) => Promise<void>;
  } | null;
}

const icon = (Icon: typeof BotIcon, className = ITEM_ICON_CLASS): ReactNode => (
  <Icon className={className} />
);

export const botsPaletteSource: ForkCommandPaletteSource = {
  id: "bots",
  items: ({ bots: context, activeThreadRef }) => {
    if (!context) return [];
    const saveAsBot = context.saveAsBot;
    const saveItems: CommandPaletteActionItem[] =
      saveAsBot !== null && activeThreadRef !== null && saveAsBot.allowed(activeThreadRef)
        ? [
            {
              kind: "action",
              value: "action:loom:bots:save-thread",
              title: "Save this thread as a bot",
              searchTerms: ["bots", "save", "thread", "reuse", "template", "brief"],
              icon: icon(BotIcon),
              run: () => saveAsBot.open(activeThreadRef),
            },
          ]
        : [];
    const runItems: CommandPaletteActionItem[] = context.runnable.map((bot) => ({
      kind: "action",
      value: `action:loom:bots:run:${bot.id}`,
      title: bot.name,
      ...(bot.description ? { description: bot.description } : {}),
      searchTerms: [bot.name, bot.id],
      icon: icon(BotIcon),
      run: () => context.runBot(bot.id),
    }));
    const runOnMany = context.runBotOnMany;
    const manyItems: CommandPaletteActionItem[] =
      runOnMany === null
        ? []
        : context.runnable.map((bot) => ({
            kind: "action",
            value: `action:loom:bots:run-many:${bot.id}`,
            title: bot.name,
            ...(bot.description ? { description: bot.description } : {}),
            searchTerms: [bot.name, bot.id],
            icon: icon(BotIcon),
            run: () => runOnMany(bot.id),
          }));
    const newTrigger = context.newTrigger;
    const triggerItems: CommandPaletteActionItem[] =
      newTrigger === null
        ? []
        : context.runnable.map((bot) => ({
            kind: "action",
            value: `action:loom:bots:new-trigger:${bot.id}`,
            title: bot.name,
            ...(bot.description ? { description: bot.description } : {}),
            searchTerms: [bot.name, bot.id],
            icon: icon(BotIcon),
            run: () => newTrigger(bot.id),
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
      ...(context.openInbox === null
        ? []
        : [
            {
              kind: "action" as const,
              value: "action:loom:bots:inbox",
              title: "Open bots inbox",
              searchTerms: ["bots", "inbox", "failed", "attention", "retry"],
              icon: icon(InboxIcon),
              run: context.openInbox,
            },
          ]),
      ...saveItems,
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
      ...(manyItems.length === 0
        ? []
        : [
            {
              kind: "submenu" as const,
              value: "action:loom:bots:run-many",
              title: "Run bot on many...",
              searchTerms: ["bots", "batch", "many", "files", "conflicts", "each"],
              icon: icon(LayersIcon),
              addonIcon: icon(LayersIcon, ADDON_ICON_CLASS),
              groups: [{ value: "bots-run-many", label: "Bots", items: manyItems }],
            },
          ]),
      ...(triggerItems.length === 0
        ? []
        : [
            {
              kind: "submenu" as const,
              value: "action:loom:bots:new-trigger",
              title: "New bot trigger...",
              searchTerms: ["bots", "trigger", "webhook", "schedule", "automate", "checks", "when"],
              icon: icon(ZapIcon),
              addonIcon: icon(ZapIcon, ADDON_ICON_CLASS),
              groups: [{ value: "bots-new-trigger", label: "Bots", items: triggerItems }],
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
  const canSave = useLibraryPermission(bots.save, host.environmentId) && host.connected;
  const canTrigger = useLibraryPermission(bots.saveTrigger, host.environmentId) && host.connected;
  if (!live) return null;
  const capabilities = host.environment?.serverConfig?.environment.capabilities;
  return {
    runnable: canRun ? listed.filter((bot) => bot.archivedAt === null) : [],
    openBots: () => navigate({ to: "/loom/bots" }),
    openInbox: host.inboxSupported
      ? () => navigate({ to: "/loom/bots", search: { tab: "inbox" } })
      : null,
    runBot: (botId) => navigate({ to: "/loom/bots", search: { bot: botId, run: botId } }),
    runBotOnMany: host.batchesSupported
      ? (botId) => navigate({ to: "/loom/bots", search: { bot: botId, many: botId } })
      : null,
    newTrigger:
      host.triggersSupported && canTrigger
        ? (botId) =>
            navigate({
              to: "/loom/bots",
              search: { bot: botId, tab: "triggers", newTrigger: botId },
            })
        : null,
    saveAsBot:
      host.fromThreadSupported && canSave
        ? {
            allowed: (thread) => canSaveAsBot(thread, capabilities, host.environmentId),
            open: (thread) =>
              navigate({ to: "/loom/bots", search: { fromThread: thread.threadId } }),
          }
        : null,
  };
}
