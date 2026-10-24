import { NonNegativeInt, OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  LibraryPushDeliveryReason,
  LibraryPushDeviceRowId,
  LibraryPushError,
  LibraryPushKeySummary,
  LibraryPushState,
  LibraryPushStatusReason,
  LibraryPushTestDelivery,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { AGENT_CALLER, LibraryPushService } from "./LibraryPushService.ts";

/** Agents learn whether push works, never who registered what. */
export const LibraryPushAgentStatus = Schema.Struct({
  state: LibraryPushState,
  reason: Schema.NullOr(LibraryPushStatusReason),
  key: Schema.NullOr(LibraryPushKeySummary),
  deviceCount: NonNegativeInt,
});
export type LibraryPushAgentStatus = typeof LibraryPushAgentStatus.Type;

export const LibraryPushAgentTestResult = Schema.Struct({
  deliveries: Schema.Array(
    Schema.Struct({
      id: LibraryPushDeviceRowId,
      outcome: LibraryPushTestDelivery.fields.outcome,
      reason: Schema.NullOr(LibraryPushDeliveryReason),
    }),
  ),
});
export type LibraryPushAgentTestResult = typeof LibraryPushAgentTestResult.Type;

export const LibraryPushToolkit = Toolkit.make(
  Tool.make("loom_push_status", {
    description:
      "Read whether this Library can send iPhone notifications: off, misconfigured, ready or failing, with the reason, the Apple Team ID and Key ID, and how many devices are registered. Answers only for the Library this agent runs on and never asks another computer. Returns no device names, push tokens, key material or file paths.",
    success: LibraryPushAgentStatus,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_push_test", {
    description:
      "Send the fixed test notification to one device registered on this Library, named by its row id from the Library's device list. Acts only on the Library this agent runs on and never asks another computer. Each device takes at most 3 tests per 10 minutes. A device whose push token Apple reports dead is removed. Returns the outcome, never a push token. Requires full access.",
    parameters: Schema.Struct({ id: LibraryPushDeviceRowId }),
    success: LibraryPushAgentTestResult,
    failure: Schema.Union([LibraryPushError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);

export const libraryPushHandlers = McpToolAccess.toLayer(
  LibraryPushToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    // An optional lookup keeps the service out of the tool's static requirements, which only
    // McpInvocationContext and ThreadManagementService may be.
    const onLibrary = <A, E>(
      use: (service: LibraryPushService["Service"]) => Effect.Effect<A, E>,
    ) =>
      withForkRuntime(Effect.serviceOption(LibraryPushService)).pipe(
        Effect.provideService(ForkRuntime, runtime),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die(new Error("The Library push service is not installed.")),
            onSome: use,
          }),
        ),
      );
    return {
      loom_push_status: McpToolAccess.reads(() =>
        onLibrary((service) => service.status(AGENT_CALLER)).pipe(
          Effect.map((status): LibraryPushAgentStatus => ({
            state: status.state,
            reason: status.reason,
            key: status.key,
            deviceCount: status.devices.length,
          })),
        ),
      ),
      loom_push_test: McpToolAccess.writesEnvironment(({ id }) =>
        onLibrary((service) => service.test(AGENT_CALLER, { id })).pipe(
          Effect.map((result): LibraryPushAgentTestResult => ({
            deliveries: result.deliveries.map(({ id, outcome, reason }) => ({
              id,
              outcome,
              reason,
            })),
          })),
        ),
      ),
    };
  }),
);
