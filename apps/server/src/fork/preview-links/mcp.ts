import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import {
  PreviewLink,
  PreviewLinkShareInput,
  PreviewLinksError,
  PreviewPage,
  PreviewPageKind,
  PreviewPagesError,
  PreviewPagesList,
  PreviewPageTitle,
  PreviewPageUpdateInput,
  PreviewTunnelState,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext, requireThreadScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import {
  PreviewPagesService,
  type PreviewPageSource,
} from "../preview-pages/PreviewPagesService.ts";
import { PreviewLinksService } from "./PreviewLinksService.ts";

const failure = Schema.Union([PreviewLinksError, OrchestratorMcpFailure]);
const pagesFailure = Schema.Union([PreviewPagesError, OrchestratorMcpFailure]);

// MCP input schemas need an object root, so the two sources are sibling fields checked in the handler.
const PagePublishParams = Schema.Struct({
  title: PreviewPageTitle.annotate({ description: "Shown above the page and in the page list." }),
  kind: Schema.optionalKey(
    PreviewPageKind.annotate({
      description: 'Use "dossier" for Dossier pages, which size themselves. Defaults to "html".',
    }),
  ),
  attachmentId: Schema.optionalKey(
    Schema.String.annotate({
      description: "The attachmentId of an html_render result in this thread.",
    }),
  ),
  path: Schema.optionalKey(
    Schema.String.annotate({
      description: "An .html file in this thread's workspace, relative to its root or absolute.",
    }),
  ),
  pageId: Schema.optionalKey(
    PreviewPageUpdateInput.fields.pageId.annotate({
      description: "Republish this page in place, keeping its address.",
    }),
  ),
});

const pageSource = (
  input: typeof PagePublishParams.Type,
): Effect.Effect<PreviewPageSource, PreviewPagesError> =>
  input.attachmentId !== undefined && input.path === undefined
    ? Effect.succeed({ attachmentId: input.attachmentId })
    : input.path !== undefined && input.attachmentId === undefined
      ? Effect.succeed({ path: input.path })
      : Effect.fail(
          new PreviewPagesError({
            reason: "invalid",
            message: "Give exactly one of attachmentId or path.",
          }),
        );

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
      "Share a dev server port on this computer at an HTTPS link. The port must be one of this thread's lane ports or have a server from this thread's terminal listening on it. Post the URL for the user to open: a browser opened from Loom goes straight in, and any other browser signs in through the user's Library first, or is asked to open the link from Loom when this computer has no Library. Sharing a port that already has a link returns that link. A link ends when its lifetime runs out or its lane is released.",
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
  Tool.make("loom_page_publish", {
    description:
      "Publish a page to the user's Library at a private pages address that only the user can open, after signing in. Give exactly one source: the attachmentId from an html_render result, or the path of an .html file in this thread's workspace such as a Dossier. Use kind \"dossier\" for Dossier pages. Republish with pageId to update a page in place at the same address. Pages last 30 days unless the user keeps them. Replies the user sends from the page arrive in this thread as messages. Returns the page with its url to post for the user.",
    parameters: PagePublishParams,
    success: PreviewPage,
    failure: pagesFailure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Pages: publish")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_pages_list", {
    description:
      "List the pages this thread has published, with their url, state and expiry. available is false when this computer has no Library or its Library does not publish pages.",
    parameters: Tool.EmptyParams,
    success: PreviewPagesList,
    failure: pagesFailure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Pages: list")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_page_update", {
    description:
      "Change one of this thread's pages: keep it so it never expires, release it to expire 30 days from now, end it now, or restore an ended or expired page within 7 days. Pages published by other threads cannot be changed here.",
    parameters: PreviewPageUpdateInput,
    success: PreviewPage,
    failure: pagesFailure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Pages: update")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);

const callerThread = McpInvocationContext.pipe(
  Effect.flatMap((scope) => requireThreadScope(scope, "Preview link and page tools")),
  Effect.map((scope) => scope.thread.threadId),
);

/**
 * Agents act only as their own thread and never call `open`, so they see canonical URLs
 * and never an entry code. Their pages are published as, and changed only within, that thread.
 */
export const previewLinksHandlers = McpToolAccess.toLayer(
  PreviewLinksToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onCaller = <A, E, R>(use: (threadId: ThreadId) => Effect.Effect<A, E, R>) =>
      callerThread.pipe(
        Effect.flatMap((threadId) => withForkRuntime(use(threadId))),
        Effect.provideService(ForkRuntime, runtime),
      );
    const onCallerThread = <A, E>(
      use: (service: PreviewLinksService["Service"], threadId: ThreadId) => Effect.Effect<A, E>,
    ) =>
      onCaller((threadId) =>
        Effect.flatMap(PreviewLinksService, (service) => use(service, threadId)),
      );
    const onCallerPages = <A, E>(
      use: (service: PreviewPagesService["Service"], threadId: ThreadId) => Effect.Effect<A, E>,
    ) =>
      onCaller((threadId) =>
        Effect.flatMap(PreviewPagesService, (service) => use(service, threadId)),
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
      loom_page_publish: McpToolAccess.actsAsCaller((input) =>
        onCallerPages((service, threadId) =>
          pageSource(input).pipe(
            Effect.flatMap((source) =>
              service.publish({
                threadId,
                source,
                title: input.title,
                ...(input.kind === undefined ? {} : { kind: input.kind }),
                ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
              }),
            ),
          ),
        ),
      ),
      loom_pages_list: McpToolAccess.readsAsCaller(() =>
        onCallerPages((service, threadId) => service.list({ threadId })),
      ),
      loom_page_update: McpToolAccess.actsAsCaller((input) =>
        onCallerPages((service, threadId) => service.update(input, { threadId })),
      ),
    };
  }),
);
