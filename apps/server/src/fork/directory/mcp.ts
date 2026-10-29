import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  DirectoryError,
  DirectoryEnvironment,
  DirectoryForgetRequest,
  DirectoryListing,
  DirectoryReporting,
} from "@t3tools/contracts/fork";
import { loomCompatibility } from "@t3tools/shared/fork/compatibility";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { DirectoryReporter } from "./DirectoryReporter.ts";
import { DirectoryService } from "./DirectoryService.ts";

const CompatibleDirectoryListing = Schema.Struct({
  ...DirectoryListing.fields,
  environments: Schema.Array(
    Schema.Struct({
      ...DirectoryEnvironment.fields,
      belowCompatibilityFloor: Schema.Boolean,
      missingCompatibilityFeatures: Schema.Array(Schema.String),
    }),
  ),
});

export function directoryCompatibility(listing: DirectoryListing) {
  return {
    ...listing,
    environments: listing.environments.map((environment) => ({
      ...environment,
      ...loomCompatibility(environment.loomFeatures),
    })),
  };
}

export const DirectoryToolkit = Toolkit.make(
  Tool.make("loom_directory_forget", {
    description:
      "Forget a computer or unattached machine in this Library's directory. Clears its pinned key; a running computer returns on its next report, usually within 15 minutes. Run on the Library authority. Retire an active Reach address first. Requires full access.",
    parameters: Schema.Struct({ entry: DirectoryForgetRequest }),
    success: Schema.Void,
    failure: Schema.Union([DirectoryError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_directory_computers", {
    description:
      "List the computers and LoomOS machines in this Library's directory: names, versions, platforms, features, routes, providers, key fingerprints and when each last reported. Answered by the Library authority, also when called on another computer. Includes no credentials.",
    success: CompatibleDirectoryListing,
    failure: Schema.Union([DirectoryError, OrchestratorMcpFailure]),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_directory_reporting", {
    description:
      "Read how this computer's reports to its Library's directory are going: off, unsupported by the Library, reporting, retrying with a reason, or stopped because the computer's key changed or its Library sign-in is missing, expired or refused. A changed key reports again once the computer is forgotten in the directory; a replaced sign-in is reloaded automatically. Includes the last published routes and Library sign-in expiry, renewal state, when it last renewed (null before its first renewal at renewsAt) and repair text. failingChecks lists this computer's recurring background checks (Tailscale CLI and Serve, directory reporting, sign-in renewal, preview registration, Library push) that have failed since they last passed, with first and last time, count and message, kept across restarts. When there are no routes, turn on Tailscale HTTPS or Reach on that computer, or use Pair instead on the new device.",
    success: DirectoryReporting,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

export const directoryHandlers = McpToolAccess.toLayer(
  DirectoryToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_directory_forget: McpToolAccess.writesEnvironment(({ entry }) =>
        withForkRuntime(Effect.flatMap(DirectoryService, (service) => service.forget(entry))).pipe(
          Effect.provideService(ForkRuntime, runtime),
        ),
      ),
      loom_directory_computers: McpToolAccess.reads(() =>
        withForkRuntime(Effect.flatMap(DirectoryService, (service) => service.computers)).pipe(
          Effect.map(directoryCompatibility),
          Effect.provideService(ForkRuntime, runtime),
        ),
      ),
      loom_directory_reporting: McpToolAccess.reads(() =>
        withForkRuntime(Effect.flatMap(DirectoryReporter, (reporter) => reporter.status)).pipe(
          Effect.provideService(ForkRuntime, runtime),
        ),
      ),
    };
  }),
);
