import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { SitesState, SitesError, SiteId, SiteAnalytics } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as SitesService from "./SitesService.ts";
const failure = Schema.Union([SitesError, OrchestratorMcpFailure]);
export const SitesToolkit = Toolkit.make(
  Tool.make("loom_sites", {
    description:
      "Read the registered sites, services and endpoint status from this server's personal API integration.",
    success: SitesState,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_site_analytics", {
    description: "Read thirty days of activity for a registered site, isolated by site ID.",
    parameters: Schema.Struct({ siteId: SiteId }),
    success: SiteAnalytics,
    failure,
  }).annotate(Tool.Readonly, true),
);
export const sitesHandlers = McpToolAccess.toLayer(
  SitesToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_sites: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(SitesService.SitesService, (service) => service.snapshot)),
      ),
      loom_site_analytics: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(SitesService.SitesService, (service) => service.analytics(input))),
      ),
    };
  }),
);
