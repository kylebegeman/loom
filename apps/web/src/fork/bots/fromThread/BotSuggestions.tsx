import { useEffect, useRef, useState, type ReactNode } from "react";
import { LightbulbIcon, PlusIcon, Undo2Icon, XIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotSuggestion } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LIBRARY_OUTLINE, LibraryErrorNotice } from "../../project-library/LibraryControls";
import { bots } from "../state";

/** Suggestions quote whole prompts, so only a few rows show before the list folds. */
const VISIBLE_SUGGESTIONS = 3;

const suggestionDetail = (suggestion: BotSuggestion) =>
  `${suggestion.startedBy === "agent" ? "Agents started" : "You started"} ${suggestion.count} threads like this in the last two weeks`;

function SuggestionRow({
  suggestion,
  muted = false,
  children,
}: {
  readonly suggestion: BotSuggestion;
  readonly muted?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", muted && "text-muted-foreground")}>
          “{suggestion.shape}”
        </p>
        <p className="truncate text-xs text-muted-foreground">{suggestionDetail(suggestion)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </li>
  );
}

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
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useEnvironmentQuery(bots.suggestions({ environmentId, input: {} }));
  const suggestions = open.data?.suggestions ?? [];
  // With nothing open, the dismissed list is the only way back to a suggestion, so learn whether
  // it has anything before offering it.
  const dismissed = useEnvironmentQuery(
    showDismissed || (open.data && suggestions.length === 0)
      ? bots.suggestions({ environmentId, input: { dismissed: true } })
      : null,
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

  const dismissedSuggestions = dismissed.data?.suggestions ?? [];
  const dismissedToggle = (
    <Button
      shape="pill"
      size="xs"
      variant="ghost"
      aria-expanded={showDismissed}
      onClick={() => setShowDismissed((on) => !on)}
    >
      {showDismissed ? "Hide dismissed" : "Dismissed"}
    </Button>
  );

  if (!open.data || (suggestions.length === 0 && !showDismissed)) {
    return dismissedSuggestions.length > 0 ? (
      <div className="flex justify-end">{dismissedToggle}</div>
    ) : null;
  }

  const shown = expanded ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTIONS);
  const folded = suggestions.length - VISIBLE_SUGGESTIONS;
  return (
    <section aria-label="Suggested bots" className={cn(LIBRARY_OUTLINE, "overflow-hidden")}>
      <div className="flex min-h-12 items-center gap-2.5 py-2 ps-4 pe-2">
        <span
          aria-hidden
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
        >
          <LightbulbIcon className="size-3" />
        </span>
        <h2 className="text-sm font-semibold tracking-tight">Suggested bots</h2>
        {suggestions.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">({suggestions.length})</span>
        ) : null}
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
          Repeated briefs. Make one a bot?
        </p>
        <div className="ms-auto">{dismissedToggle}</div>
      </div>
      {suggestions.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {shown.map((suggestion) => (
            <SuggestionRow key={suggestion.id} suggestion={suggestion}>
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canChange}
                onClick={() => onCreate(suggestion)}
              >
                <PlusIcon />
                Create
              </Button>
              <Button
                shape="pill"
                size="icon-xs"
                variant="ghost"
                aria-label="Dismiss"
                disabled={!canChange}
                onClick={() => void setDismissed(suggestion, true)}
              >
                <XIcon />
              </Button>
            </SuggestionRow>
          ))}
        </ul>
      ) : null}
      {folded > 0 ? (
        <div className="border-t border-border px-2 py-1.5">
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((on) => !on)}
          >
            {expanded ? "Show fewer" : `Show ${folded} more`}
          </Button>
        </div>
      ) : null}
      {showDismissed ? (
        <div className="border-t border-border">
          <h3 className="px-4 pt-2.5 text-xs font-medium text-muted-foreground">Dismissed</h3>
          {!dismissed.data ? (
            <div role="status" aria-label="Loading dismissed suggestions" className="px-4 py-2.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="mt-1.5 h-2.5 w-1/3" />
            </div>
          ) : dismissedSuggestions.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted-foreground">No dismissed suggestions.</p>
          ) : (
            <ul className="divide-y divide-border">
              {dismissedSuggestions.map((suggestion) => (
                <SuggestionRow key={suggestion.id} suggestion={suggestion} muted>
                  <Button
                    shape="pill"
                    size="xs"
                    variant="ghost"
                    disabled={!canChange}
                    onClick={() => void setDismissed(suggestion, false)}
                  >
                    <Undo2Icon />
                    Restore
                  </Button>
                </SuggestionRow>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {error ? (
        <div className="border-t border-border px-4">
          <LibraryErrorNotice error={error} />
        </div>
      ) : null}
    </section>
  );
}

// STUB(bots-redesign): replaced by the owning area's implementation.
/** Suggested bots drawn from recent threads, for the Bots view. Nothing when there are none. */
export function BotSuggestionsSection() {
  return null;
}
