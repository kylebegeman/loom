import type { ThreadId } from "@t3tools/contracts";
import type { BotId, BotPipelineId } from "@t3tools/contracts/fork";
import type { BotsSearch, BotsTab } from "~/routes/loom.bots";

/** The page a Bots search shows, without the dialog or sheet open over it. */
export type BotsRoute =
  | {
      readonly kind: "fromThread";
      readonly threadId: ThreadId;
      readonly suggestionId: NonNullable<BotsSearch["suggestion"]> | null;
    }
  | { readonly kind: "newBot" }
  | { readonly kind: "editBot"; readonly botId: BotId }
  | { readonly kind: "newPipeline" }
  | { readonly kind: "editPipeline"; readonly pipelineId: BotPipelineId }
  | { readonly kind: "pipelineRun"; readonly runId: string }
  | { readonly kind: "pipeline"; readonly pipelineId: BotPipelineId }
  | { readonly kind: "batch"; readonly batchId: string }
  | { readonly kind: "bot"; readonly botId: BotId }
  | { readonly kind: "index" };

/**
 * A search can name several pages at once, such as a batch opened from a bot's page, so the
 * deepest one wins. A stray flag without what it needs, like `edit` without a bot, is ignored.
 */
export function botsRoute(search: BotsSearch): BotsRoute {
  if (search.fromThread !== undefined)
    return {
      kind: "fromThread",
      threadId: search.fromThread,
      suggestionId: search.suggestion ?? null,
    };
  if (search.newBot) return { kind: "newBot" };
  if (search.edit && search.bot !== undefined) return { kind: "editBot", botId: search.bot };
  if (search.newPipeline) return { kind: "newPipeline" };
  if (search.editPipeline !== undefined)
    return { kind: "editPipeline", pipelineId: search.editPipeline };
  if (search.pipelineRun !== undefined) return { kind: "pipelineRun", runId: search.pipelineRun };
  if (search.pipeline !== undefined) return { kind: "pipeline", pipelineId: search.pipeline };
  if (search.batch !== undefined) return { kind: "batch", batchId: search.batch };
  if (search.bot !== undefined) return { kind: "bot", botId: search.bot };
  return { kind: "index" };
}

export type BotsFeature = "fromThread" | "pipelines" | "batches";

/** The host capability a page needs, so an older server explains itself instead of going blank. */
export function routeFeature(route: BotsRoute): BotsFeature | null {
  switch (route.kind) {
    case "fromThread":
      return "fromThread";
    case "newPipeline":
    case "editPipeline":
    case "pipelineRun":
    case "pipeline":
      return "pipelines";
    case "batch":
      return "batches";
    default:
      return null;
  }
}

type TabCapabilities = {
  readonly pipelinesSupported: boolean;
  readonly triggersSupported: boolean;
  readonly versionsSupported: boolean;
};

export type BotsIndexTab = Extract<BotsTab, "bots" | "runs" | "pipelines" | "triggers">;
export type BotPageTab = Extract<BotsTab, "overview" | "runs" | "versions">;

/** The index's views this host offers, in the order they read. */
export const indexTabs = (host: TabCapabilities): readonly BotsIndexTab[] => [
  "bots",
  "runs",
  ...(host.pipelinesSupported ? (["pipelines"] as const) : []),
  ...(host.triggersSupported ? (["triggers"] as const) : []),
];

/** A bot page's views this host offers. */
export const botPageTabs = (host: TabCapabilities): readonly BotPageTab[] => [
  "overview",
  "runs",
  ...(host.versionsSupported ? (["versions"] as const) : []),
];

/** The view a search names when this page has it, else the page's first view. */
export function selectedTab<T extends BotsTab>(tabs: readonly T[], tab: BotsTab | undefined): T {
  return tabs.find((entry) => entry === tab) ?? tabs[0]!;
}
