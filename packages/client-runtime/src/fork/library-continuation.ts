import type { LibraryThreadArchive } from "@t3tools/contracts/fork";

/** Carry readable recent discussion, bounded for the destination composer. Execution stays local. */
export function libraryContinuationContext(archive: {
  readonly summary: Pick<
    LibraryThreadArchive["summary"],
    "title" | "threadId" | "environmentId" | "sequence"
  >;
  readonly projection: {
    readonly messages: readonly { readonly role: string; readonly text: string }[];
    readonly visibleTurnItems: readonly {
      readonly item: { readonly type: string; readonly text?: string };
    }[];
  };
}): string {
  const messages =
    archive.projection.visibleTurnItems.length > 0
      ? archive.projection.visibleTurnItems.flatMap(({ item }) =>
          item.type === "user_message" || item.type === "assistant_message"
            ? [{ role: item.type === "user_message" ? "You" : "Agent", text: item.text ?? "" }]
            : [],
        )
      : archive.projection.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({
            role: message.role === "user" ? "You" : "Agent",
            text: message.text,
          }));
  const recent = messages
    .slice(-32)
    .map((message) => `${message.role}: ${message.text.slice(0, 6000)}`)
    .join("\n\n");
  return [
    `Continue the work from “${archive.summary.title}”.`,
    `Source conversation: ${archive.summary.threadId}, computer: ${archive.summary.environmentId}, saved sequence: ${archive.summary.sequence}.`,
    "This is a linked conversation on the selected computer. Verify its current files before acting; the original computer's running tools and local paths have not moved.",
    recent
      ? `Recent saved discussion:\n${recent.slice(-16000)}`
      : "No recent message text was saved. Review the linked source history before proceeding.",
    "Continue from the latest decisions above. Ask for any missing context before making assumptions.",
  ].join("\n\n");
}
