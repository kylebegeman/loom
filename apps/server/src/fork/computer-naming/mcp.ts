import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ComputerNamingError,
  ComputerNamingState,
  ComputerRenameRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as ComputerNaming from "./ComputerNaming.ts";

const failure = Schema.Union([ComputerNamingError, OrchestratorMcpFailure]);
export const ComputerNamingToolkit = Toolkit.make(
  Tool.make("loom_computer_name", {
    description: "Read this computer's shared friendly name and its default operating-system name.",
    success: ComputerNamingState,
    failure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_computer_rename", {
    description:
      "Set this computer's shared friendly name for Loom clients. Pass null to restore its default operating-system name. Changes no machine hostname, routes, credentials or project data. Requires full access.",
    parameters: ComputerRenameRequest,
    success: ComputerNamingState,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
export const computerNamingHandlers = McpToolAccess.toLayer(
  ComputerNamingToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_computer_name: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(ComputerNaming.ComputerNaming, (service) => service.current)),
      ),
      loom_computer_rename: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(ComputerNaming.ComputerNaming, (service) => service.rename(input))),
      ),
    };
  }),
);
