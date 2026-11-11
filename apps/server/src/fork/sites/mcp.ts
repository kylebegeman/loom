import { AuthSessionId, OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  SaveSiteRequest,
  RunSiteChecksRequest,
  type LibrarySitesMutation,
  LibraryError,
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
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import * as SitesService from "./SitesService.ts";
const failure = Schema.Union([SitesError, LibraryError, OrchestratorMcpFailure]);
const isSitesError = Schema.is(SitesError);
export const SitesToolkit = Toolkit.make(
  Tool.make("loom_site_save", {
    description:
      "Register or update a site with at least one existing Library project. Read loom_sites first. For edits pass the row etag as expectedEtag; for a new ID pass expectedEtag:null. Supply a unique requestId for this exact intent and retain it after an uncertain reply. Full replacement: include origins, serviceIds, projectIds, and active. Pause with active:false; history is retained.",
    parameters: SaveSiteRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_site_service_save", {
    description:
      "Register or update a shared website, API or redirect service. Pause/resume with active. Sites link to services by serviceIds. Read loom_sites first; pass the row etag as expectedEtag, or null for a new ID. Supply and retain requestId for this exact intent.",
    parameters: SaveSiteServiceRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_site_check_save", {
    description:
      "Register or update an HTTPS endpoint check on its registered service origin. Pause/resume with active. Expected status and optional content are checked. Read loom_sites first; pass the row etag as expectedEtag, or null for a new ID. Supply and retain requestId for this exact intent.",
    parameters: SaveSiteCheckRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_site_checks_run", {
    description:
      "Run registered endpoint checks now and return fresh status. This performs network requests. Supply a unique requestId and keep it if the reply is lost. No receipt lookup is available: do not repeat an uncertain run automatically.",
    parameters: RunSiteChecksRequest,
    success: SitesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),

  Tool.make("loom_sites", {
    description:
      "Read sites, services and endpoint status through this computer's enrolled Library. Sites credentials stay on the Library. If an older work computer reports unconfigured, check its Loom version before changing the existing Library connections. Rows with etag support conditional saves. Missing etags mean stale-write protection is unavailable. After an uncertain save, read current settings first; a matching snapshot confirms state, not an operation receipt. Do not retry writes automatically, including after sign-in or permission repair. A retry needs an explicit decision and the original requestId; retain the original precondition. For revision conflicts, review the new settings and create a new intent. Idempotency replay depends on API configuration and retention, so a key alone does not make retries safe.",
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
    const mutate = Effect.fn("SitesMcp.mutate")(function* <R>(
      input: LibrarySitesMutation,
      check: Effect.Effect<unknown, OrchestratorMcpFailure, R>,
    ) {
      const context = yield* Effect.context<R>();
      const scope = yield* McpInvocationContext;
      const authorize = check.pipe(
        Effect.asVoid,
        Effect.provide(context),
        Effect.mapError((cause) => new LibraryError({ reason: "blocked", cause })),
      );
      return yield* onHost(
        Effect.flatMap(LibraryManagement, (management) =>
          scope.thread
            ? management.sitesAgent(input, scope.thread, authorize)
            : scope.client
              ? management.sites(
                  input,
                  { kind: "client", sessionId: AuthSessionId.make(scope.client.sessionId) },
                  authorize,
                )
              : Effect.fail(new LibraryError({ reason: "blocked" })),
        ),
      ).pipe(Effect.mapError((cause) => (isSitesError(cause.cause) ? cause.cause : cause)));
    });
    return {
      loom_site_save: McpToolAccess.writesEnvironment((input, check) =>
        mutate({ action: "saveSite", input }, check),
      ),
      loom_site_service_save: McpToolAccess.writesEnvironment((input, check) =>
        mutate({ action: "saveService", input }, check),
      ),
      loom_site_check_save: McpToolAccess.writesEnvironment((input, check) =>
        mutate({ action: "saveCheck", input }, check),
      ),
      loom_site_checks_run: McpToolAccess.writesEnvironment((input, check) =>
        mutate({ action: "runChecks", input }, check),
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
