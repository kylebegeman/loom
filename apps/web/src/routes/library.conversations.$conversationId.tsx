import { createFileRoute } from "@tanstack/react-router";
import { LibraryConversationPage } from "~/fork/project-library/LibraryConversationPage";
export const Route = createFileRoute("/library/conversations/$conversationId")({ component: Page });
function Page() {
  const { conversationId } = Route.useParams();
  return <LibraryConversationPage key={conversationId} conversationId={conversationId} />;
}
