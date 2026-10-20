import type { ChatAttachment, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { LibraryError, type LibraryThreadArchive } from "@t3tools/contracts/fork";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";
import { mcpAppFileName } from "@t3tools/shared/mcpApp";
import { htmlRenderFromToolItem, mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import {
  parseAttachmentFileExtension,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import { LIBRARY_ASSET_MAX_BYTES } from "./assets/LibraryObjectStore.ts";

/**
 * The attachments a Library must hold for a conversation: backups and import proofs count any
 * that are absent. Includes references retained in turn items when message projections change.
 */
export function libraryAttachments(archive: LibraryThreadArchive): readonly ChatAttachment[] {
  const attachments = new Map<string, ChatAttachment>();
  for (const message of archive.projection.messages) {
    for (const attachment of message.attachments) attachments.set(attachment.id, attachment);
  }
  for (const item of archive.projection.turnItems) {
    if (item.type === "user_message" || item.type === "assistant_message") {
      for (const attachment of item.attachments ?? []) attachments.set(attachment.id, attachment);
    }
  }
  for (const { item } of archive.projection.visibleTurnItems) {
    if (item.type === "user_message" || item.type === "assistant_message") {
      for (const attachment of item.attachments ?? []) attachments.set(attachment.id, attachment);
    }
  }
  return [...attachments.values()];
}

export interface LibraryPage {
  readonly id: string;
  readonly name: string;
}

export interface LibraryPageUpload extends LibraryPage {
  readonly mimeType: string;
  readonly sizeBytes: number;
}

// The Library's asset store rejects media type parameters, so MCP App documents go up as plain
// HTML; the conversation's tool item still says which kind of page it is.
const PAGE_MIME_TYPE = "text/html";

function pageOf(item: OrchestrationV2TurnItem): LibraryPage | undefined {
  if (item.type !== "dynamic_tool") return undefined;
  const render = htmlRenderFromToolItem(item);
  if (render !== undefined)
    return { id: render.attachmentId, name: htmlRenderFileName(render.title) };
  const app = mcpAppFromToolItem(item);
  return app === undefined ? undefined : { id: app.attachmentId, name: mcpAppFileName(app) };
}

/**
 * Pages that html_render and MCP App calls saved, including ones a fork inherited from its source
 * thread, which the Library shows as saved pages.
 */
export function libraryPages(archive: LibraryThreadArchive): readonly LibraryPage[] {
  const attached = new Set(libraryAttachments(archive).map((attachment) => attachment.id));
  const pages = new Map<string, LibraryPage>();
  const collect = (item: OrchestrationV2TurnItem) => {
    const page = pageOf(item);
    // Every page is saved under an html id minted for the thread whose tool call saved it, which
    // an inherited item keeps as its thread. A tool result can name any attachment, and an MCP
    // App result can imitate the reference, so anything else, such as an image or another
    // thread's page from a project that is not in the Library, must not pull that file in.
    if (
      page === undefined ||
      attached.has(page.id) ||
      pages.has(page.id) ||
      parseAttachmentFileExtension(page.id) !== "html" ||
      parseThreadSegmentFromAttachmentId(page.id) !== toSafeThreadAttachmentSegment(item.threadId)
    )
      return;
    pages.set(page.id, page);
  };
  for (const item of archive.projection.turnItems) collect(item);
  for (const { item } of archive.projection.visibleTurnItems) collect(item);
  return [...pages.values()];
}

/**
 * Sizes each page from its file so pages go through the same checked upload as message
 * attachments. Pages are not references the Library must hold: a fork keeps showing pages its
 * deleted source thread took with it, so a missing or oversized page is skipped rather than
 * blocking the conversation's history.
 */
export const libraryPageUploads = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  attachmentsDir: string,
  archive: LibraryThreadArchive,
) {
  const uploads: LibraryPageUpload[] = [];
  for (const page of libraryPages(archive)) {
    const path = resolveAttachmentPathById({ attachmentsDir, attachmentId: page.id });
    if (path === null) continue;
    const stat = yield* fs
      .stat(path)
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
    const sizeBytes = Number(stat.size);
    if (sizeBytes > LIBRARY_ASSET_MAX_BYTES) continue;
    uploads.push({ ...page, mimeType: PAGE_MIME_TYPE, sizeBytes });
  }
  return uploads;
});
