import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { BotId } from "@t3tools/contracts/fork";
import { BotsPage } from "~/fork/bots/BotsPage";

const BotsSearch = Schema.Struct({
  bot: Schema.optional(BotId),
  run: Schema.optional(BotId),
  /** The bot whose "Run on many" dialog is open. */
  many: Schema.optional(BotId),
  tab: Schema.optional(Schema.Literals(["runs", "batches", "inbox"])),
  batch: Schema.optional(Schema.String),
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
