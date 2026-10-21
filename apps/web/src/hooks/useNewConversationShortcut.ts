import { useLibraryNewConversation } from "~/fork/project-library/useLibraryNewConversation";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext, type ChatThreadActionContext } from "../lib/chatThreadActions";
import { useStableCallback } from "./useStableCallback";

export function useNewConversationShortcut(
  context: ChatThreadActionContext & { readonly showProjectPicker: boolean },
) {
  const tryLibraryConversation = useLibraryNewConversation();
  return useStableCallback(async (command: "chat.new" | "chat.newLocal") => {
    if (await tryLibraryConversation()) return;
    if (command === "chat.new" && context.showProjectPicker) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    await startNewThreadFromContext(context);
  });
}
