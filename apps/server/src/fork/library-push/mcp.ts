import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryPushDeliveryReason,
  LibraryPushDeviceRowId,
  LibraryPushError,
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
import { LibraryPushAgentStatus, LibraryPushReadinessService } from "./LibraryPushReadiness.ts";
import { AGENT_CALLER, LibraryPushService } from "./LibraryPushService.ts";

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
      "Read whether this computer's Library can send iPhone notifications: off, misconfigured, ready or failing, with the reason, how many iPhones are registered, and whether it sends agent alerts, which tell iPhones when an agent on any of its computers needs approval or an answer, fails, reaches a usage limit or finishes. A `deviceCount` of 0 means no alert or Vault approval request reaches anyone until someone signs in to the Library with a passkey in Loom on an iPhone and allows notifications. On the Library itself it also returns the Apple Team ID and Key ID and `topics`, the app builds (bundle ID and APNs environment) its push settings accept: empty when none is usable, absent while push is off. Another computer asks its Library over its sign-in and gets no key or builds. A computer without a Library answers off. Returns no device names, push tokens, key material or file paths.",
    success: LibraryPushAgentStatus,
    failure: Schema.Union([LibraryError, OrchestratorMcpFailure]),
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
        withForkRuntime(
          Effect.flatMap(LibraryPushReadinessService, (readiness) => readiness.current),
        ).pipe(Effect.provideService(ForkRuntime, runtime)),
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
