import type { ChatThreadActionContext } from "~/lib/chatThreadActions";

export type NewConversationShortcutContext = ChatThreadActionContext & {
  readonly showProjectPicker: boolean;
};

type StartNewConversation = (
  command: "chat.new" | "chat.newLocal",
  context: NewConversationShortcutContext,
) => Promise<void>;

let current: StartNewConversation | null = null;

/** While provided, the chat route's new-conversation keys start here instead. */
export function provideNewConversationShortcut(start: StartNewConversation) {
  current = start;
  return () => {
    if (current === start) current = null;
  };
}

export function readNewConversationShortcut() {
  return current;
}
