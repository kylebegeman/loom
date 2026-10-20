import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import type { LibraryProject } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { createAttachmentId } from "../../attachmentStore.ts";
import { archiveFor, resource, threadId } from "./Library.testkit.ts";
import { libraryAttachments, libraryPageUploads, libraryPages } from "./attachments.ts";

const project: LibraryProject = {
  id: "project",
  title: "AspectAvy",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const sourceThreadId = ThreadId.make("forked-from-thread");
const renderPage = createAttachmentId(threadId, "html")!;
const inheritedPage = createAttachmentId(sourceThreadId, "html")!;
const appPage = createAttachmentId(threadId, "html")!;
const failedPage = createAttachmentId(threadId, "html")!;
const missingPage = createAttachmentId(threadId, "html")!;
const image = createAttachmentId(threadId, "png")!;
// A page or upload of a thread whose project is not in the Library.
const foreignPage = createAttachmentId("unbound-thread", "html")!;
const uploadedHtml = createAttachmentId(threadId, "html")!;

const fixture = Effect.gen(function* () {
  const base = yield* archiveFor(project);
  const timestamp = yield* DateTime.now;
  let ordinal = 0;
  const tool = (
    toolName: string,
    output: unknown,
    owner: ThreadId = threadId,
  ): OrchestrationV2TurnItem => ({
    id: TurnItemId.make(`tool-${++ordinal}`),
    threadId: owner,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: null,
    startedAt: timestamp,
    completedAt: timestamp,
    updatedAt: timestamp,
    type: "dynamic_tool",
    toolName,
    input: {},
    output,
  });
  const render = (attachmentId: string, title: string, extra = {}, owner?: ThreadId) =>
    tool(
      "mcp__t3-code__html_render",
      [
        {
          type: "text",
          text: JSON.stringify({ htmlRender: { attachmentId, title, height: 300 }, ...extra }),
        },
      ],
      owner,
    );
  const appItem = (attachmentId: string) =>
    tool("weather.get_weather", {
      t3McpApp: {
        attachmentId,
        server: "weather",
        tool: "get_weather",
        resourceUri: "ui://weather/dashboard",
      },
      result: { content: [] },
    });
  const ownRender = render(renderPage, "Q3: plan / review");
  // Inherited items keep the source thread, which minted their pages.
  const inherited = render(inheritedPage, "Dossier", {}, sourceThreadId);
  const app = appItem(appPage);
  const archive = {
    ...base,
    projection: {
      ...base.projection,
      messages: [
        {
          ...base.projection.messages[0]!,
          attachments: [
            {
              type: "file" as const,
              id: ChatAttachmentId.make(uploadedHtml),
              name: "upload.html",
              mimeType: "text/html",
              sizeBytes: 4,
            },
          ],
        },
      ],
      turnItems: [
        ownRender,
        app,
        render(failedPage, "Broken", { isError: true }),
        render(missingPage, "Gone"),
        // A tool result can name any attachment; only this thread's page ids may reach the
        // Library this way.
        render(image, "Not a page"),
        render(foreignPage, "Another project"),
        appItem(foreignPage),
        // Already uploaded as a message attachment, so it must not go up twice.
        render(uploadedHtml, "Upload"),
      ],
      visibleTurnItems: [
        {
          position: 0,
          visibility: "inherited" as const,
          sourceThreadId,
          sourceItemId: inherited.id,
          item: inherited,
        },
        {
          position: 1,
          visibility: "local" as const,
          sourceThreadId: threadId,
          sourceItemId: ownRender.id,
          item: ownRender,
        },
      ],
    },
  };
  return archive;
});

describe("Library attachments", () => {
  it.effect("collects saved pages from turn items and inherited items once each", () =>
    Effect.gen(function* () {
      const archive = yield* fixture;
      expect(libraryPages(archive)).toEqual([
        { id: renderPage, name: "Q3 plan review.html" },
        { id: appPage, name: "get_weather.html" },
        { id: missingPage, name: "Gone.html" },
        { id: inheritedPage, name: "Dossier.html" },
      ]);
      // Backups and import proofs count only what the conversation's messages reference.
      expect(libraryAttachments(archive).map((attachment) => attachment.id)).toEqual([
        uploadedHtml,
      ]);
    }),
  );

  it.effect("sizes pages from their files and skips pages whose file is gone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const attachmentsDir = yield* fs.makeTempDirectoryScoped({
        prefix: "library-attachments-test-",
      });
      for (const [id, html] of [
        [renderPage, "<p>plan</p>"],
        [inheritedPage, "<p>dossier</p>"],
        [appPage, "<main></main>"],
        [image, "png"],
        [foreignPage, "<p>private</p>"],
      ] as const)
        yield* fs.writeFileString(
          `${attachmentsDir}/${id}.${id.endsWith("-png") ? "png" : "html"}`,
          html,
        );
      const uploads = yield* libraryPageUploads(fs, attachmentsDir, yield* fixture);
      expect(uploads).toEqual([
        { id: renderPage, name: "Q3 plan review.html", mimeType: "text/html", sizeBytes: 11 },
        { id: appPage, name: "get_weather.html", mimeType: "text/html", sizeBytes: 13 },
        { id: inheritedPage, name: "Dossier.html", mimeType: "text/html", sizeBytes: 14 },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
