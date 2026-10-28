import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { takeEmptyLibraryConversation } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { refreshArchivedThreadsForEnvironment } from "~/lib/archivedThreadsState";
import { readThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { useRouteThread } from "../routeThread";

/**
 * Leaving a conversation started here from the Library before its first message offers to
 * discard it. Discarding archives it at once and deletes it once the Undo notice closes, so Undo
 * only has to unarchive; a window closed in between leaves it archived rather than lost.
 */
export function EmptyConversationOffer() {
  const current = useRouteThread()?.threadRef ?? null;
  const shown = useRef<ScopedThreadRef | null>(null);
  const archive = useOrchestrationCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchive = useOrchestrationCommand(threadEnvironment.unarchive, { reportFailure: false });
  const remove = useOrchestrationCommand(threadEnvironment.delete, { reportFailure: false });
  const clearDraft = useComposerDraftStore((store) => store.clearDraftThread);

  const offer = useEffectEvent((left: ScopedThreadRef) => {
    const shell = readThreadShell(left);
    if (shell === null || !takeEmptyLibraryConversation(scopedThreadKey(left), shell)) return;
    const input = { environmentId: left.environmentId, input: { threadId: left.threadId } };
    const failed = (title: string, cause: unknown) =>
      toastManager.add({
        type: "error",
        title,
        description: cause instanceof Error ? cause.message : "Try again from the sidebar.",
      });
    const discard = async () => {
      const archived = await archive(input);
      if (archived._tag === "Failure")
        return failed("Could not discard the conversation", squashAtomCommandFailure(archived));
      refreshArchivedThreadsForEnvironment(left.environmentId);
      let undone = false;
      const undoId = toastManager.add({
        type: "success",
        title: `Discarded ${shell.title}`,
        actionProps: {
          children: "Undo",
          onClick: () => {
            undone = true;
            toastManager.close(undoId);
            void unarchive(input).then((result) => {
              if (result._tag === "Failure")
                failed("Could not restore the conversation", squashAtomCommandFailure(result));
              refreshArchivedThreadsForEnvironment(left.environmentId);
            });
          },
        },
        onClose: () => {
          if (undone) return;
          void remove(input).then((result) => {
            if (result._tag === "Failure") return;
            clearDraft(left);
            refreshArchivedThreadsForEnvironment(left.environmentId);
          });
        },
      });
    };
    const offerId = toastManager.add({
      type: "info",
      title: `${shell.title} has no messages`,
      description: "Keep it to come back to, or discard it.",
      actionProps: {
        children: "Discard empty conversation",
        onClick: () => {
          toastManager.close(offerId);
          void discard();
        },
      },
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- offers to discard an empty conversation through a toast when the route leaves it
  useEffect(() => {
    const left = shown.current;
    shown.current = current;
    if (left !== null && (current === null || scopedThreadKey(current) !== scopedThreadKey(left)))
      offer(left);
  }, [current]);
  return null;
}
