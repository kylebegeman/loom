import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";
import { BotId, BotPipelineId, BotSuggestionId } from "@t3tools/contracts/fork";
import { BotsPage } from "~/fork/bots/BotsPage";

const BotsSearch = Schema.Struct({
  bot: Schema.optional(BotId),
  run: Schema.optional(BotId),
  /** The bot whose "Run on many" dialog is open. */
  many: Schema.optional(BotId),
  tab: Schema.optional(
    Schema.Literals([
      "bots",
      "runs",
      "history",
      "batches",
      "pipelines",
      "triggers",
      "inbox",
      "usage",
      "computers",
    ]),
  ),
  batch: Schema.optional(Schema.String),
  pipelineRun: Schema.optional(Schema.String),
  /** The pipeline whose run form is open. */
  runPipeline: Schema.optional(BotPipelineId),
  /** The bot whose new trigger editor is open. */
  newTrigger: Schema.optional(BotId),
  /** A thread to draft a bot from; the editor opens with the draft. */
  fromThread: Schema.optional(ThreadId),
  /** The suggestion the draft came from, dismissed once the bot is saved. */
  suggestion: Schema.optional(BotSuggestionId),
});
type BotsSearch = typeof BotsSearch.Type;
const decodeSearch = Schema.decodeUnknownSync(BotsSearch);

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
      return decodeSearch(input);
    } catch {
      return {};
    }
  },
  component: BotsPage,
});
