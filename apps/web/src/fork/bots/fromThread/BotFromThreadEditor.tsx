import { useEffect, useEffectEvent, useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotDraftResult } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog } from "../../project-library/LibraryControls";
import { BotEditor } from "../BotEditor";
import { bots } from "../state";

type Loaded =
  | { readonly _tag: "loading" }
  | { readonly _tag: "ready"; readonly result: BotDraftResult }
  | { readonly _tag: "failed"; readonly message: string };

/**
 * The bot editor opened with a draft of a thread, fetched fresh so the id is still free. Key it by
 * thread, since it drafts once.
 */
export function BotFromThreadEditor({
  environmentId,
  threadId,
  suggestionId,
  canSave,
  startersSupported,
  verdictsSupported,
  budgetsSupported,
  onSaved,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The suggestion this draft answers; saving the bot dismisses it. */
  readonly suggestionId: string | null;
  readonly canSave: boolean;
  readonly startersSupported: boolean;
  readonly verdictsSupported: boolean;
  readonly budgetsSupported: boolean;
  readonly onSaved: (bot: BotDefinition) => void;
  readonly onClose: () => void;
}) {
  const draftFromThread = useAtomCommand(bots.draftFromThread, { reportFailure: false });
  const dismissSuggestion = useAtomCommand(bots.dismissSuggestion, { reportFailure: false });
  const [loaded, setLoaded] = useState<Loaded>({ _tag: "loading" });
  const load = useEffectEvent(
    (environmentId: EnvironmentId, threadId: ThreadId, isCurrent: () => boolean) => {
      void draftFromThread({ environmentId, input: { threadId } }).then((result) => {
        if (!isCurrent()) return;
        if (result._tag === "Success") setLoaded({ _tag: "ready", result: result.value });
        else {
          const cause = squashAtomCommandFailure(result);
          setLoaded({
            _tag: "failed",
            message:
              cause instanceof Error ? cause.message : "Could not draft a bot from this thread.",
          });
        }
      });
    },
  );
  useEffect(() => {
    let current = true;
    load(environmentId, threadId, () => current);
    return () => {
      current = false;
    };
  }, [environmentId, threadId]);

  const saved = async (bot: BotDefinition) => {
    // The bot is saved either way; a suggestion left open is only a stale prompt.
    if (suggestionId !== null)
      await dismissSuggestion({ environmentId, input: { suggestionId, dismissed: true } });
    onSaved(bot);
  };

  if (loaded._tag === "ready")
    return (
      <BotEditor
        environmentId={environmentId}
        bot={null}
        fromThread={loaded.result}
        canSave={canSave}
        startersSupported={startersSupported}
        verdictsSupported={verdictsSupported}
        budgetsSupported={budgetsSupported}
        onSaved={(bot) => void saved(bot)}
        onClose={onClose}
      />
    );
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Save as bot"
      description="The thread's first message becomes the bot's instructions."
      actions={
        <Button variant="ghost" onClick={onClose}>
          {loaded._tag === "failed" ? "Close" : "Cancel"}
        </Button>
      }
    >
      {loaded._tag === "failed" ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {loaded.message}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Drafting a bot from the thread…
        </p>
      )}
    </LibraryDialog>
  );
}
