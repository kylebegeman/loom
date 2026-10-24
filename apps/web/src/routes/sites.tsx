import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { SiteId } from "@t3tools/contracts/fork";
import { SitesPage } from "~/fork/sites/SitesPage";
const decodeSearch = Schema.decodeUnknownSync(
  Schema.Struct({
    siteId: Schema.optional(SiteId),
    view: Schema.optional(Schema.Literals(["sites", "services"])),
  }),
);
export const Route = createFileRoute("/sites")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: (
    input: Record<string, unknown>,
  ): { siteId?: string | undefined; view?: "sites" | "services" | undefined } => {
    try {
      return decodeSearch(input);
    } catch {
      // A stale or hand-edited link still opens the page, just without its selection.
      return {};
    }
  },
  component: SitesPage,
});
