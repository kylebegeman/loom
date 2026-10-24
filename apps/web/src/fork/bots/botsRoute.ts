import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";
import {
  BotId,
  BotPipelineId,
  BotRunId,
  BotSuggestionId,
  BotTriggerId,
  BotVerdictValue,
  type BotTriggerEventKind,
} from "@t3tools/contracts/fork";

/** A search flag: present as `true`, absent otherwise. */
const Flag = Schema.Literal(true);

const TriggerKind = Schema.Literals([
  "schedule",
  "webhook",
  "pull-request-checks-failing",
  "pull-request-opened",
  "thread-settled",
  "merge-conflict",
] as const satisfies readonly BotTriggerEventKind[]);

const BotsSearchInput = Schema.Struct({
  bot: Schema.optional(BotId),
  /** The open view. Retired views stay valid so old links still open; see `currentView`. */
  tab: Schema.optional(
    Schema.Literals([
      "bots",
      "overview",
      "runs",
      "versions",
      "pipelines",
      "triggers",
      "history",
      "batches",
      "inbox",
      "usage",
      "computers",
    ]),
  ),
  /** Which runs the Runs view lists. */
  scope: Schema.optional(Schema.Literals(["all", "attention", "dismissed", "batches"])),

  // Filters, so a narrowed view can be linked, reloaded and returned to with Back.
  /** The bot the index's Runs list narrows to. */
  runBot: Schema.optional(BotId),
  /** The verdict the Runs list narrows to. */
  verdict: Schema.optional(BotVerdictValue),
  /** The kinds of trigger the Triggers agenda narrows to; none means every kind. */
  triggerKinds: Schema.optional(Schema.Array(TriggerKind)),
  /** Only triggers that are on, or only paused ones. */
  triggerState: Schema.optional(Schema.Literals(["on", "paused"])),
  /** Only running batches, or only batches with items to retry. */
  batchStatus: Schema.optional(Schema.Literals(["running", "retry"])),

  // Pages, each a step deeper than the view it opens from.
  /** With `bot`, that bot's editor. */
  edit: Schema.optional(Flag),
  newBot: Schema.optional(Flag),
  /** A thread to draft a bot from; the editor opens with the draft. */
  fromThread: Schema.optional(ThreadId),
  /** The suggestion the draft came from, dismissed once the bot is saved. */
  suggestion: Schema.optional(BotSuggestionId),
  batch: Schema.optional(Schema.String),
  pipeline: Schema.optional(BotPipelineId),
  editPipeline: Schema.optional(BotPipelineId),
  newPipeline: Schema.optional(Flag),
  pipelineRun: Schema.optional(Schema.String),

  // Dialogs and sheets over the page.
  /** The bot whose Run dialog is open. */
  run: Schema.optional(BotId),
  /** The bot whose "Run on many" dialog is open. */
  many: Schema.optional(BotId),
  /** The run whose sheet is open. */
  runId: Schema.optional(BotRunId),
  /** The replay whose results sheet is open. */
  replay: Schema.optional(Schema.String),
  trigger: Schema.optional(BotTriggerId),
  editTrigger: Schema.optional(BotTriggerId),
  /** The bot whose new trigger editor is open. */
  newTrigger: Schema.optional(BotId),
  /** The pipeline a new trigger starts, for a trigger added from a pipeline. */
  triggerPipeline: Schema.optional(BotPipelineId),
  /** The pipeline whose run form is open. */
  runPipeline: Schema.optional(BotPipelineId),
  computers: Schema.optional(Flag),
});
type BotsSearchInput = typeof BotsSearchInput.Type;

/** The views the page has now. A bot's page shows Overview, Runs and Versions; the index the rest. */
export type BotsTab = "bots" | "overview" | "runs" | "versions" | "pipelines" | "triggers";
export type BotsSearch = Omit<BotsSearchInput, "tab"> & { readonly tab?: BotsTab | undefined };

/**
 * Maps a retired view onto where its content lives now, so every reader of the search sees only
 * current views. Inbox and Batches became scopes of Runs, History became Versions, Usage folded
 * into the bot collection, Computers became a sheet, and a bot's triggers moved to its Overview.
 */
const currentView = (search: BotsSearchInput): BotsSearch => {
  const { tab, ...rest } = search;
  switch (tab) {
    case "inbox":
      return { ...rest, tab: "runs", scope: rest.scope ?? "attention" };
    case "batches":
      return { ...rest, tab: "runs", scope: rest.scope ?? "batches" };
    case "history":
      return { ...rest, tab: "versions" };
    case "usage":
      return rest.bot === undefined ? { ...rest, tab: "bots" } : { ...rest, tab: "overview" };
    case "computers":
      return { ...rest, tab: "bots", computers: true };
    case "triggers":
      return rest.bot === undefined ? { ...rest, tab } : { ...rest, tab: "overview" };
    case undefined:
      return rest;
    default:
      return { ...rest, tab };
  }
};

// One decoder per key, so a stale run id or a hand-edited trigger id drops only itself and the
// bot, batch or pipeline beside it still opens.
const KEY_DECODERS = Object.entries(BotsSearchInput.fields).map(
  ([key, field]) => [key, Schema.decodeUnknownOption(Schema.Struct({ [key]: field }))] as const,
);
const decodeSearch = Schema.decodeUnknownOption(BotsSearchInput);

/** The search a Bots URL names, keeping every key that is valid on its own. */
export function parseBotsSearch(input: Record<string, unknown>): BotsSearch {
  const valid: Record<string, unknown> = {};
  for (const [key, decode] of KEY_DECODERS) {
    const value = input[key];
    if (value !== undefined && Option.isSome(decode({ [key]: value }))) valid[key] = value;
  }
  return Option.match(decodeSearch(valid), { onNone: () => ({}), onSome: currentView });
}

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
