import { createFileRoute, redirect } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { SiteId } from "@t3tools/contracts/fork";
import { SitesPage } from "~/fork/sites/SitesPage";

const SitesSearch = Schema.Struct({
  siteId: Schema.optional(SiteId),
  view: Schema.optional(Schema.Literals(["sites", "services"])),
  /** The open view on a site's page. */
  tab: Schema.optional(Schema.Literals(["overview", "preview", "traffic", "checks"])),
  /** The page the Preview shows, as a path on the site. */
  path: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  /** The site editor: `new` for a new site, or open on `siteId`. */
  edit: Schema.optional(Schema.Literals(["new", "site"])),
});
export type SitesSearch = typeof SitesSearch.Type;
const decodeSearch = Schema.decodeUnknownSync(SitesSearch);

export const Route = createFileRoute("/sites")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: (input: Record<string, unknown>): SitesSearch => {
    try {
      return decodeSearch(input);
    } catch {
      // A stale or hand-edited link still opens the page, just without its selection.
      return {};
    }
  },
  component: SitesPage,
});
