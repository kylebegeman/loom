import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";
import {
  BotId,
  BotPipelineId,
  BotRunId,
  BotSuggestionId,
  BotTriggerId,
} from "@t3tools/contracts/fork";
import { BotsPage } from "~/fork/bots/BotsPage";

/** A search flag: present as `true`, absent otherwise. */
const Flag = Schema.Literal(true);

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
const decodeSearch = Schema.decodeUnknownSync(BotsSearchInput);

/** The views the page has now. A bot's page shows Overview, Runs and Versions; the index the rest. */
export type BotsTab = "bots" | "overview" | "runs" | "versions" | "pipelines" | "triggers";
export type BotsSearch = Omit<typeof BotsSearchInput.Type, "tab"> & {
  readonly tab?: BotsTab | undefined;
};

/**
 * Maps a retired view onto where its content lives now, so every reader of the search sees only
 * current views. Inbox and Batches became scopes of Runs, History became Versions, Usage folded
 * into the bot collection, Computers became a sheet, and a bot's triggers moved to its Overview.
 */
const currentView = (search: typeof BotsSearchInput.Type): BotsSearch => {
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

export const Route = createFileRoute("/loom/bots")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: (input: Record<string, unknown>): BotsSearch => {
    try {
      return currentView(decodeSearch(input));
    } catch {
      return {};
    }
  },
  component: BotsPage,
});
