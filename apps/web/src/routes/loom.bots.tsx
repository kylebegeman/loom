import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseBotsSearch, type BotsSearch } from "~/fork/bots/botsRoute";
import { BotsPage } from "~/fork/bots/BotsPage";

export const Route = createFileRoute("/loom/bots")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: (input: Record<string, unknown>): BotsSearch => parseBotsSearch(input),
  component: BotsPage,
});
