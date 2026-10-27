import { useEffect } from "react";
import {
  provideNewConversationShortcut,
  type NewConversationShortcutContext,
} from "~/fork/project-library/newConversationShortcut";
import { useLibraryNewConversation } from "~/fork/project-library/useLibraryNewConversation";
import { useNoProjectStart } from "~/fork/project-library/useNoProjectStart";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useStableCallback } from "./useStableCallback";

export function useNewConversationShortcut() {
  const tryLibraryConversation = useLibraryNewConversation();
  const noProjectStart = useNoProjectStart();
  return useStableCallback(
    async (command: "chat.new" | "chat.newLocal", context: NewConversationShortcutContext) => {
      if (await tryLibraryConversation()) return;
      if (command === "chat.new" && context.showProjectPicker) {
        openCommandPalette({ open: "new-thread-in" });
        return;
      }
      // With no project to start in, No project is the only choice.
      if (!(await startNewThreadFromContext(context))) await noProjectStart?.start();
    },
  );
}

/** Mounted by the chat route: the Library and No project starts need React state. */
export function NewConversationShortcut() {
  const start = useNewConversationShortcut();
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the hook-backed start to the keydown scope
  useEffect(() => provideNewConversationShortcut(start), [start]);
  return null;
}
