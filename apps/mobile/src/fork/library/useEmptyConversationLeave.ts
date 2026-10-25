import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { takeEmptyLibraryConversation } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useMemo } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { refreshArchivedThreadsForEnvironment } from "../../features/archive/useArchivedThreadSnapshots";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { clearComposerDraft } from "../../state/use-composer-drafts";

/**
 * Leaving a conversation started on this device from the Library before its first message asks
 * whether to keep or discard it. iPhone has no Undo notice to delete it behind, so the question,
 * with Keep as the safe answer, is the safety net.
 */
export function useEmptyConversationLeave(
  environmentId: EnvironmentId | null,
  threadId: string | null,
) {
  const navigation = useNavigation();
  const threadRef = useMemo(
    () =>
      environmentId !== null && threadId !== null
        ? scopeThreadRef(environmentId, ThreadId.make(threadId))
        : null,
    [environmentId, threadId],
  );
  const shell = useThreadShell(threadRef);
  const remove = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const leave = useEffectEvent(
    (event: { preventDefault: () => void; data: { action: Parameters<typeof navigation.dispatch>[0] } }) => {
      if (threadRef === null || shell === null) return;
      const key = scopedThreadKey(threadRef);
      if (!takeEmptyLibraryConversation(key, shell)) return;
      event.preventDefault();
      const go = () => navigation.dispatch(event.data.action);
      Dialog.alert(`${shell.title} has no messages`, "Keep it to come back to, or discard it.", [
        { text: "Keep", style: "cancel", onPress: go },
        {
          text: "Discard empty conversation",
          style: "destructive",
          onPress: () => {
            go();
            void remove({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId },
            }).then((result) => {
              if (result._tag === "Failure") {
                const cause = squashAtomCommandFailure(result);
                Dialog.alert(
                  "Could not discard the conversation",
                  cause instanceof Error ? cause.message : "Try again from the thread list.",
                );
                return;
              }
              clearComposerDraft(key);
              refreshArchivedThreadsForEnvironment(threadRef.environmentId);
            });
          },
        },
      ]);
    },
  );
  useEffect(() => navigation.addListener("beforeRemove", (event) => leave(event)), [navigation]);
}
