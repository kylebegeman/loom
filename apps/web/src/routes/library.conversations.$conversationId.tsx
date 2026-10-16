import { createFileRoute } from "@tanstack/react-router";
import { LibraryConversationPage } from "~/fork/project-library/LibraryConversationPage";

/** A history search result opens the conversation at its matched item. */
type ConversationSearch = { readonly item?: string; readonly position?: number };

export const Route = createFileRoute("/library/conversations/$conversationId")({
  validateSearch: (raw: Record<string, unknown>): ConversationSearch => {
    const position = Number(raw.position);
    return typeof raw.item === "string" &&
      raw.item &&
      Number.isSafeInteger(position) &&
      position >= 0
      ? { item: raw.item, position }
      : {};
  },
  component: Page,
});
function Page() {
  const { conversationId } = Route.useParams();
  const { item, position } = Route.useSearch();
  const target = item !== undefined && position !== undefined ? { item, position } : undefined;
  return (
    <LibraryConversationPage
      // Another result in the same conversation opens at its own item.
      key={`${conversationId}:${item ?? ""}`}
      conversationId={conversationId}
      {...(target ? { target } : {})}
    />
  );
}
