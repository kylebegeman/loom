import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import {
  PreviewLink,
  PreviewLinkShareInput,
  PreviewLinksError,
  PreviewTunnelState,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext, requireThreadScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { PreviewLinksService } from "./PreviewLinksService.ts";

const failure = Schema.Union([PreviewLinksError, OrchestratorMcpFailure]);

export const PreviewLinksToolkit = Toolkit.make(
  Tool.make("loom_preview_links_list", {
    description:
      "Show whether preview links are set up on this computer and the links this thread has shared, with their state and expiry.",
    parameters: Tool.EmptyParams,
    success: Schema.Struct({
      ready: Schema.Boolean,
      tunnel: PreviewTunnelState,
      links: Schema.Array(PreviewLink),
    }),
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Preview links: list")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_preview_link_share", {
    description:
      "Share a dev server port on this computer at an HTTPS link. The port must be one of this thread's lane ports or have a server from this thread's terminal listening on it. The link opens only in a browser that entered from Loom, so post the URL for the user to open from the Loom app or this chat; other browsers see a page asking them to open it from Loom. Sharing a port that already has a link returns that link. A link ends when its lifetime runs out or its lane is released.",
    parameters: PreviewLinkShareInput,
    success: PreviewLink,
    failure,
    // Acting as the caller checks its run is live.
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Preview links: share")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_preview_link_revoke", {
    description:
      "End one of this thread's preview links now. Links shared by the user or by other threads cannot be ended here.",
    parameters: Schema.Struct({ linkId: Schema.String }),
    success: PreviewLink,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Preview links: revoke")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);

const callerThread = McpInvocationContext.pipe(
  Effect.flatMap((scope) => requireThreadScope(scope, "Preview link tools")),
  Effect.map((scope) => scope.thread.threadId),
);

/**
 * Agents act only as their own thread and never call `open`, so they see canonical URLs
 * and never an entry code.
 */
export const previewLinksHandlers = McpToolAccess.toLayer(
  PreviewLinksToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onCallerThread = <A, E>(
      use: (service: PreviewLinksService["Service"], threadId: ThreadId) => Effect.Effect<A, E>,
    ) =>
      callerThread.pipe(
        Effect.flatMap((threadId) =>
          withForkRuntime(Effect.flatMap(PreviewLinksService, (service) => use(service, threadId))),
        ),
        Effect.provideService(ForkRuntime, runtime),
      );
    return {
      loom_preview_links_list: McpToolAccess.readsAsCaller(() =>
        onCallerThread((service, threadId) =>
          Effect.all({ snapshot: service.snapshot, links: service.listForThread(threadId) }).pipe(
            Effect.map(({ snapshot, links }) => ({
              ready: snapshot.setup.ready,
              tunnel: snapshot.setup.tunnel.state,
              links,
            })),
          ),
        ),
      ),
      loom_preview_link_share: McpToolAccess.actsAsCaller((input) =>
        onCallerThread((service, threadId) => service.share(input, { _tag: "Agent", threadId })),
      ),
      loom_preview_link_revoke: McpToolAccess.actsAsCaller((input) =>
        onCallerThread((service, threadId) =>
          service.revoke(input.linkId, { _tag: "Agent", threadId }),
        ),
      ),
    };
  }),
);
