import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ReachLibraryComputer,
  ReachLibraryError,
  ReachLibraryListing,
  ReachRetireInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../../ForkRuntime.ts";
import { ReachProvisioner } from "./ReachProvisioner.ts";

const failure = Schema.Union([ReachLibraryError, OrchestratorMcpFailure]);

/** D10: agents may read reach and turn it off; no tool turns a computer's reach on. */
export const ReachLibraryToolkit = Toolkit.make(
  Tool.make("loom_reach_computers", {
    description:
      "List this Library's reach addresses: each computer's hostname, record state and last error, whether its tunnel is connected and how many connectors it has (more than one means a copy of its connector token runs elsewhere), its Loom Identity resource and whether its Library sign-in is still active, plus the Library's reach setup. Answered only by the Library authority. Includes no credentials or connector tokens.",
    success: ReachLibraryListing,
    failure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_reach_retire", {
    description:
      "Retire a computer's reach address from the Library: deletes its Cloudflare tunnel and DNS record, keeps its hostname reserved, and lets the computer be forgotten in the directory. Set endIdentity to also delete its Loom Identity resource, which ends every device's Loom sign-in renewal for that computer. With endIdentity, for a computer that has a Loom Identity resource, a Library whose Pocket ID admin key file is missing or unreadable (setup.identity missing, or refused for a file with loose permissions) changes nothing and fails with reason identity-key-missing: bring the key online and retry, or retire with endIdentity false. A computer still signed in to the Library sets reach up again on its next start, so also revoke its Library sign-in. Requires full access.",
    parameters: ReachRetireInput,
    success: ReachLibraryComputer,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);

export const reachLibraryHandlers = McpToolAccess.toLayer(
  ReachLibraryToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_reach_computers: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(ReachProvisioner, (provisioner) => provisioner.list)),
      ),
      loom_reach_retire: McpToolAccess.writesEnvironment((input) =>
        onHost(Effect.flatMap(ReachProvisioner, (provisioner) => provisioner.retire(input))),
      ),
    };
  }),
);
