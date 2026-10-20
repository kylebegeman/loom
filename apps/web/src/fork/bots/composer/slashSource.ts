import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { applyBotChanges } from "@t3tools/client-runtime/fork";
import type { ProjectId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";
import { useEnvironmentQuery } from "~/state/query";
import type { ForkComposerCommandItem, ForkSlashSource } from "../../composer/menu";
import type { ForkComposerContext } from "../../composer/registry";
import { useLibraryPermission } from "../../project-library/state";
import { bots, useBotDefinitionChanges, useBotsHost } from "../state";
import { useBotRunDrawerStore } from "./drawerStore";

const SOURCE_ID = "bots";

/** The bots a thread in `projectId` can run: not archived, and shared or scoped to it. */
export function botSlashItems(
  definitions: ReadonlyArray<BotDefinition>,
  projectId: ProjectId | null,
): ForkComposerCommandItem[] {
  return definitions
    .filter(
      (bot) =>
        bot.archivedAt === null &&
        (bot.scopeProjectId === null || bot.scopeProjectId === projectId),
    )
    .map((bot) => ({
      id: `bot:${bot.id}`,
      type: "loom",
      source: SOURCE_ID,
      label: `/bot:${bot.id}`,
      description: bot.description === "" ? bot.name : `${bot.name} · ${bot.description}`,
      value: bot.id,
    }));
}

/**
 * Whether this composer can start bot runs: a saved thread on the environment that runs bots,
 * whose server supports runs started from a thread. A draft has no thread to report back to.
 */
export function useComposerBotsAccess(context: ForkComposerContext) {
  const host = useBotsHost();
  const canRun = useLibraryPermission(bots.run, host.environmentId);
  const available =
    context.threadRef !== null &&
    host.environmentId === context.environmentId &&
    host.supported &&
    host.invocationSupported;
  return { host, available, canRun: available && canRun && host.connected };
}

/** Bots offered under `/`. The list is fetched only once a slash menu is open. */
export function useBotSlashItems(
  context: ForkComposerContext,
  active: boolean,
): ReadonlyArray<ForkComposerCommandItem> {
  const { host, canRun } = useComposerBotsAccess(context);
  const enabled = active && canRun;
  const list = useEnvironmentQuery(
    enabled && host.environmentId
      ? bots.list({ environmentId: host.environmentId, input: {} })
      : null,
  );
  const changes = useBotDefinitionChanges(host.environmentId, enabled);
  if (!enabled) return [];
  return botSlashItems(applyBotChanges(list.data?.bots ?? [], changes), context.projectId);
}

export const BOT_SLASH_SOURCE: ForkSlashSource = {
  id: SOURCE_ID,
  select: (item, context) => {
    if (context.threadRef === null) return;
    useBotRunDrawerStore.getState().show(scopedThreadKey(context.threadRef), item.value);
  },
};
