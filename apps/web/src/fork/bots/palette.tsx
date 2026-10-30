import { BOTS_NAVIGATION_VISIBLE } from "@t3tools/client-runtime/fork";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  InboxIcon,
  LayersIcon,
  MonitorIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "~/components/CommandPalette.logic";
import type { BotsSearch } from "./botsRoute";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { canSaveAsBot } from "./fromThread/logic";
import { useBots, useBotsAccess, usePipelines, useWaitingBotRuns } from "./state";

type PaletteTarget = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

/** What the Bots source needs; null leaves the palette without Bots entries. */
export interface BotsPaletteContext {
  /** Opens a Bots page, or a dialog over one; every entry is a place on the Bots page. */
  readonly go: (search: BotsSearch) => Promise<void>;
  /** Current bots, whose pages anyone can open; archived ones stay off the palette. */
  readonly openable: readonly PaletteTarget[];
  /** Current bots this connection may change, empty while it cannot save. */
  readonly editable: readonly PaletteTarget[];
  /** Current bots this connection may run. */
  readonly runnable: readonly PaletteTarget[];
  /** Runnable bots with inputs to vary, empty while the server cannot run batches. */
  readonly batchable: readonly PaletteTarget[];
  /** Every pipeline, whose pages anyone can open; empty while the server has none. */
  readonly pipelinePages: readonly PaletteTarget[];
  /** Pipelines this connection may run; empty while the server has none. */
  readonly pipelines: readonly PaletteTarget[];
  /** Current bots that may gain a trigger, empty while this connection cannot add one. */
  readonly triggerable: readonly PaletteTarget[];
  /** Whether Needs you has anything to show: the inbox, or runs waiting on an answer. */
  readonly needsYou: boolean;
  /** Whether the server has the index's Pipelines and Triggers views. */
  readonly pipelinesView: boolean;
  readonly triggersView: boolean;
  readonly newBot: boolean;
  readonly newPipeline: boolean;
  readonly computers: boolean;
  /** Null while the server cannot draft bots from threads or this connection cannot save. */
  readonly saveAsBot: { readonly allowed: (thread: ScopedThreadRef) => boolean } | null;
}

const icon = (Icon: typeof BotIcon, className = ITEM_ICON_CLASS): ReactNode => (
  <Icon className={className} />
);

const targetItems = (
  targets: readonly PaletteTarget[],
  prefix: string,
  Icon: typeof BotIcon,
  run: (target: PaletteTarget) => Promise<void>,
): CommandPaletteActionItem[] =>
  targets.map((target) => ({
    kind: "action",
    value: `action:loom:bots:${prefix}:${target.id}`,
    title: target.name,
    ...(target.description ? { description: target.description } : {}),
    searchTerms: [target.name, target.id],
    icon: icon(Icon),
    run: () => run(target),
  }));

const submenu = (
  value: string,
  title: string,
  searchTerms: string[],
  Icon: typeof BotIcon,
  group: string,
  items: CommandPaletteActionItem[],
): CommandPaletteSubmenuItem[] =>
  items.length === 0
    ? []
    : [
        {
          kind: "submenu",
          value: `action:loom:bots:${value}`,
          title,
          searchTerms,
          icon: icon(Icon),
          addonIcon: icon(Icon, ADDON_ICON_CLASS),
          groups: [{ value: `bots-${value}`, label: group, items }],
        },
      ];

const action = (
  value: string,
  title: string,
  searchTerms: string[],
  Icon: typeof BotIcon,
  run: () => Promise<void>,
): CommandPaletteActionItem => ({
  kind: "action",
  value: `action:loom:bots:${value}`,
  title,
  searchTerms,
  icon: icon(Icon),
  run,
});

export const botsPaletteSource: ForkCommandPaletteSource = {
  id: "bots",
  items: ({ bots: context, activeThreadRef }) => {
    if (!context) return [];
    const { go } = context;
    const saveAsBot = context.saveAsBot;
    return [
      {
        ...action(
          "open",
          "Go to Bots",
          ["bots", "jobs", "runs", "reusable", "agents"],
          BotIcon,
          () => go({}),
        ),
        shortcutCommand: "loom.bots.open",
      },
      ...(context.needsYou
        ? [
            action(
              "needs-you",
              "Bot runs that need you",
              ["bots", "needs you", "inbox", "failed", "attention", "retry", "review"],
              InboxIcon,
              () => go({ tab: "runs", scope: "attention" }),
            ),
          ]
        : []),
      ...(context.pipelinesView
        ? [
            action(
              "pipelines",
              "Bot pipelines",
              ["bots", "pipelines", "chain", "steps", "review", "fix", "verify"],
              WorkflowIcon,
              () => go({ tab: "pipelines" }),
            ),
          ]
        : []),
      ...(context.triggersView
        ? [
            action(
              "triggers",
              "Bot triggers",
              ["bots", "triggers", "webhook", "schedule", "automate", "when"],
              ZapIcon,
              () => go({ tab: "triggers" }),
            ),
          ]
        : []),
      ...(saveAsBot !== null && activeThreadRef !== null && saveAsBot.allowed(activeThreadRef)
        ? [
            action(
              "save-thread",
              "Save this thread as a bot",
              ["bots", "save", "thread", "reuse", "template", "brief"],
              BotIcon,
              () => go({ fromThread: activeThreadRef.threadId }),
            ),
          ]
        : []),
      ...(context.newBot
        ? [
            action("new", "New bot", ["bots", "new", "create", "job", "brief"], PlusIcon, () =>
              go({ newBot: true }),
            ),
          ]
        : []),
      ...(context.newPipeline
        ? [
            action(
              "new-pipeline",
              "New bot pipeline",
              ["bots", "pipeline", "new", "create", "chain", "steps"],
              WorkflowIcon,
              () => go({ newPipeline: true }),
            ),
          ]
        : []),
      ...submenu(
        "open-bot",
        "Open bot...",
        ["bots", "open", "bot", "page", "go"],
        BotIcon,
        "Bots",
        targetItems(context.openable, "open-bot", BotIcon, (bot) => go({ bot: bot.id })),
      ),
      ...submenu(
        "edit-bot",
        "Edit bot...",
        ["bots", "edit", "change", "brief", "instructions", "settings"],
        PencilIcon,
        "Bots",
        targetItems(context.editable, "edit-bot", BotIcon, (bot) =>
          go({ bot: bot.id, edit: true }),
        ),
      ),
      ...submenu(
        "run",
        "Run bot...",
        ["bots", "run", "job", "start"],
        PlayIcon,
        "Bots",
        targetItems(context.runnable, "run", BotIcon, (bot) => go({ bot: bot.id, run: bot.id })),
      ),
      ...submenu(
        "run-many",
        "Run bot on many...",
        ["bots", "batch", "many", "files", "conflicts", "each"],
        LayersIcon,
        "Bots",
        targetItems(context.batchable, "run-many", BotIcon, (bot) =>
          go({ bot: bot.id, many: bot.id }),
        ),
      ),
      ...submenu(
        "open-pipeline",
        "Open pipeline...",
        ["bots", "pipeline", "open", "page", "runs"],
        WorkflowIcon,
        "Pipelines",
        targetItems(context.pipelinePages, "open-pipeline", WorkflowIcon, (pipeline) =>
          go({ pipeline: pipeline.id }),
        ),
      ),
      ...submenu(
        "run-pipeline",
        "Run pipeline...",
        ["bots", "pipeline", "chain", "steps", "review", "fix", "verify"],
        WorkflowIcon,
        "Pipelines",
        targetItems(context.pipelines, "run-pipeline", WorkflowIcon, (pipeline) =>
          go({ pipeline: pipeline.id, runPipeline: pipeline.id }),
        ),
      ),
      ...submenu(
        "new-trigger",
        "New bot trigger...",
        ["bots", "trigger", "webhook", "schedule", "automate", "checks", "when"],
        ZapIcon,
        "Bots",
        targetItems(context.triggerable, "new-trigger", BotIcon, (bot) =>
          go({ bot: bot.id, newTrigger: bot.id }),
        ),
      ),
      ...(context.computers
        ? [
            action(
              "computers",
              "Bot computers",
              ["bots", "computers", "remote", "anywhere", "share", "machines"],
              MonitorIcon,
              () => go({ computers: true }),
            ),
          ]
        : []),
    ];
  },
};

/** The primary environment's bots, while it supports them. */
export function useBotsPaletteContext(): BotsPaletteContext | null {
  const navigate = useNavigate();
  const { host, live, bots: listed } = useBots();
  const access = useBotsAccess();
  const pipelinesLive = live && host.pipelinesSupported;
  const { pipelines } = usePipelines(host.environmentId, pipelinesLive, host.connected);
  const waiting = useWaitingBotRuns(live ? host.environmentId : null);
  if (!BOTS_NAVIGATION_VISIBLE || !live) return null;
  const capabilities = host.environment?.serverConfig?.environment.capabilities;
  const current = listed.filter((bot) => bot.archivedAt === null);
  const runnable = access.canRun ? current : [];
  return {
    go: (search) => navigate({ to: "/loom/bots", search }),
    openable: current,
    editable: access.canSave ? current : [],
    runnable,
    batchable: host.batchesSupported ? runnable.filter((bot) => bot.parameters.length) : [],
    pipelinePages: pipelinesLive ? pipelines : [],
    pipelines: pipelinesLive && access.canRunPipelines ? pipelines : [],
    triggerable: host.triggersSupported && access.canOperateTriggers ? current : [],
    needsYou: host.inboxSupported || waiting.length > 0,
    pipelinesView: pipelinesLive,
    triggersView: host.triggersSupported,
    newBot: access.canSave,
    newPipeline: pipelinesLive && access.canSavePipelines,
    computers: host.anywhereSupported,
    saveAsBot:
      host.fromThreadSupported && access.canSave
        ? { allowed: (thread) => canSaveAsBot(thread, capabilities, host.environmentId) }
        : null,
  };
}
