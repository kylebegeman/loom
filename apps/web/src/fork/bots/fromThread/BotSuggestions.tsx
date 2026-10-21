import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotSuggestion } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { bots } from "../state";
import { suggestionText } from "./logic";

/** Repeated briefs offered as bots, with the dismissed ones a click away. */
export function BotSuggestions({
  environmentId,
  canChange,
  botChanges,
  pendingSuggestionId,
  onCreate,
}: {
  readonly environmentId: EnvironmentId;
  readonly canChange: boolean;
  /** Saving a bot can use up a suggestion, so each change refetches. */
  readonly botChanges: unknown;
  /** The suggestion being made into a bot; it is dismissed after the save, so refetch then too. */
  readonly pendingSuggestionId: string | null;
  readonly onCreate: (suggestion: BotSuggestion) => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useEnvironmentQuery(bots.suggestions({ environmentId, input: {} }));
  const dismissed = useEnvironmentQuery(
    showDismissed ? bots.suggestions({ environmentId, input: { dismissed: true } }) : null,
  );
  const dismiss = useAtomCommand(bots.dismissSuggestion, { reportFailure: false });

  const refreshOpen = open.refresh;
  const seen = useRef({ botChanges, pendingSuggestionId });
  useEffect(() => {
    if (
      seen.current.botChanges === botChanges &&
      seen.current.pendingSuggestionId === pendingSuggestionId
    )
      return;
    seen.current = { botChanges, pendingSuggestionId };
    refreshOpen();
  }, [botChanges, pendingSuggestionId, refreshOpen]);

  const setDismissed = async (suggestion: BotSuggestion, value: boolean) => {
    setError(null);
    const result = await dismiss({
      environmentId,
      input: { suggestionId: suggestion.id, dismissed: value },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not change the suggestion.");
      return;
    }
    open.refresh();
    dismissed.refresh();
  };

  const suggestions = open.data?.suggestions ?? [];
  const dismissedSuggestions = dismissed.data?.suggestions ?? [];
  return (
    <section aria-label="Suggested bots" className="space-y-2">
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <p className="min-w-0 flex-1">
            {suggestionText(suggestion)}{" "}
            <span className="text-muted-foreground">Make it a bot?</span>
          </p>
          <Button size="xs" disabled={!canChange} onClick={() => onCreate(suggestion)}>
            Create
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!canChange}
            onClick={() => void setDismissed(suggestion, true)}
          >
            Dismiss
          </Button>
        </div>
      ))}
      {open.data ? (
        <Button size="xs" variant="ghost" onClick={() => setShowDismissed((on) => !on)}>
          {showDismissed ? "Hide dismissed suggestions" : "Dismissed suggestions"}
        </Button>
      ) : null}
      {showDismissed ? (
        dismissed.data && dismissedSuggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dismissed suggestions.</p>
        ) : (
          dismissedSuggestions.map((suggestion) => (
            <div key={suggestion.id} className="flex flex-wrap items-center gap-3 text-sm">
              <p className="min-w-0 flex-1 text-muted-foreground">{suggestionText(suggestion)}</p>
              <Button
                size="xs"
                variant="outline"
                disabled={!canChange}
                onClick={() => void setDismissed(suggestion, false)}
              >
                Restore
              </Button>
            </div>
          ))
        )
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}
