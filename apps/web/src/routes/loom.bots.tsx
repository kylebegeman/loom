import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { BotId } from "@t3tools/contracts/fork";
import { BotsPage } from "~/fork/bots/BotsPage";

const decodeSearch = Schema.decodeUnknownSync(
  Schema.Struct({ bot: Schema.optional(BotId), run: Schema.optional(BotId) }),
);

export const Route = createFileRoute("/loom/bots")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: (
    input: Record<string, unknown>,
  ): { bot?: string | undefined; run?: string | undefined } => {
    try {
      return decodeSearch(input);
    } catch {
      return {};
    }
  },
  component: BotsPage,
});
