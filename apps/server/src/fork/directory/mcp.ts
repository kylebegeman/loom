import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { DirectoryError, DirectoryListing } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { DirectoryService } from "./DirectoryService.ts";

export const DirectoryToolkit = Toolkit.make(
  Tool.make("loom_directory_computers", {
    description:
      "List the computers and LoomOS machines in this Library's directory: names, versions, platforms, features, routes, providers, key fingerprints and when each last reported. Answered by the Library authority, also when called on another computer. Includes no credentials.",
    success: DirectoryListing,
    failure: Schema.Union([DirectoryError, OrchestratorMcpFailure]),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

export const directoryHandlers = McpToolAccess.toLayer(
  DirectoryToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_directory_computers: McpToolAccess.reads(() =>
        withForkRuntime(Effect.flatMap(DirectoryService, (service) => service.computers)).pipe(
          Effect.provideService(ForkRuntime, runtime),
        ),
      ),
    };
  }),
);
