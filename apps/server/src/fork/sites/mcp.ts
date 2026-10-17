import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  SaveSiteRequest,
  SaveSiteServiceRequest,
  SaveSiteCheckRequest,
  SitesSnapshot,
  SitesState,
  SitesError,
  SiteId,
  SiteAnalytics,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as SitesService from "./SitesService.ts";
const failure = Schema.Union([SitesError, OrchestratorMcpFailure]);
export const SitesToolkit = Toolkit.make(
  Tool.make("loom_site_save", {
    description:
      "Register or update a site with at least one existing Library project. Full replacement: include origins, serviceIds, projectIds, and active. Pause with active:false; history is retained.",
    parameters: SaveSiteRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_site_service_save", {
    description:
      "Register or update a shared website, API or redirect service. Pause/resume with active. Sites link to services by serviceIds.",
    parameters: SaveSiteServiceRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_site_check_save", {
    description:
      "Register or update an HTTPS endpoint check on its registered service origin. Pause/resume with active. Expected status and optional content are checked.",
    parameters: SaveSiteCheckRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_site_checks_run", {
    description:
      "Run registered endpoint checks now and return fresh status. This performs network requests.",
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),

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
      loom_site_save: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(context),
            Effect.mapError((cause) => new SitesError({ stage: "write", cause })),
          );
          return yield* onHost(
            Effect.flatMap(SitesService.SitesService, (service) =>
              service.saveSite(input, authorize),
            ),
          );
        }),
      ),
      loom_site_service_save: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(context),
            Effect.mapError((cause) => new SitesError({ stage: "write", cause })),
          );
          return yield* onHost(
            Effect.flatMap(SitesService.SitesService, (service) =>
              service.saveService(input, authorize),
            ),
          );
        }),
      ),
      loom_site_check_save: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(context),
            Effect.mapError((cause) => new SitesError({ stage: "write", cause })),
          );
          return yield* onHost(
            Effect.flatMap(SitesService.SitesService, (service) =>
              service.saveCheck(input, authorize),
            ),
          );
        }),
      ),
      loom_site_checks_run: McpToolAccess.writesEnvironment((_, check) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(context),
            Effect.mapError((cause) => new SitesError({ stage: "write", cause })),
          );
          return yield* onHost(
            Effect.flatMap(SitesService.SitesService, (service) => service.runChecks(authorize)),
          );
        }),
      ),
      loom_sites: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(SitesService.SitesService, (service) => service.snapshot)),
      ),
      loom_site_analytics: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(SitesService.SitesService, (service) => service.analytics(input))),
      ),
    };
  }),
);
