import { useLibraryNewConversation } from "~/fork/project-library/useLibraryNewConversation";
import { useNoProjectStart } from "~/fork/project-library/useNoProjectStart";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext, type ChatThreadActionContext } from "../lib/chatThreadActions";
import { useStableCallback } from "./useStableCallback";

export function useNewConversationShortcut(
  context: ChatThreadActionContext & { readonly showProjectPicker: boolean },
) {
  const tryLibraryConversation = useLibraryNewConversation();
  const noProjectStart = useNoProjectStart();
  return useStableCallback(async (command: "chat.new" | "chat.newLocal") => {
    if (await tryLibraryConversation()) return;
    if (command === "chat.new" && context.showProjectPicker) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    // With no project to start in, No project is the only choice.
    if (!(await startNewThreadFromContext(context))) await noProjectStart?.start();
  });
}
