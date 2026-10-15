import type { ChatAttachment } from "@t3tools/contracts";
import type { LibraryThreadArchive } from "@t3tools/contracts/fork";

/** Includes attachment references retained in turn items when message projections change. */
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
