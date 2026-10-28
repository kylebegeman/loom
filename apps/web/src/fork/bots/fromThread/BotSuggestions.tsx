import { useEffect, useRef, useState, type ReactNode } from "react";
import { LightbulbIcon, PlusIcon, Undo2Icon, XIcon } from "lucide-react";
import type { BotSuggestion } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryGroupHeading,
} from "../../project-library/LibraryControls";
import { runTime } from "../BotIdentity";
import { useBotsNavigation } from "../navigation";
import { bots, useBots, useBotsAccess } from "../state";

/** Suggestions quote whole briefs, so only a few rows show before the list folds. */
const VISIBLE_SUGGESTIONS = 3;

const suggestionDetail = (suggestion: BotSuggestion, now: number) => {
  const who = suggestion.startedBy === "agent" ? "Agents started" : "You started";
  const threads = suggestion.count === 1 ? "1 thread" : `${suggestion.count} threads`;
  const last = runTime(suggestion.lastSeenAt, now);
  return `${who} ${threads} like this in the last two weeks${last ? `, last ${last}` : ""}`;
};

function SuggestionRow({
  suggestion,
  now,
  muted = false,
  children,
}: {
  readonly suggestion: BotSuggestion;
  readonly now: number;
  readonly muted?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={cn("line-clamp-2 text-sm wrap-anywhere", muted && "text-muted-foreground")}>
          “{suggestion.shape}”
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {suggestionDetail(suggestion, now)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </li>
  );
}

/**
 * Briefs the user keeps repeating, offered as bots. Creating one opens the editor on a draft of
 * its first thread; dismissed ones stay a click away. Nothing when the server cannot suggest.
 */
export function BotSuggestionsSection() {
  const { host, changes } = useBots();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const environmentId = host.fromThreadSupported ? host.environmentId : null;
  const [showDismissed, setShowDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const open = useEnvironmentQuery(
    environmentId ? bots.suggestions({ environmentId, input: {} }) : null,
  );
  const suggestions = open.data?.suggestions ?? [];
  // With nothing open, the dismissed list is the only way back to a suggestion, so learn whether
  // it has anything before offering it.
  const dismissed = useEnvironmentQuery(
    environmentId && (showDismissed || (open.data && suggestions.length === 0))
      ? bots.suggestions({ environmentId, input: { dismissed: true } })
      : null,
  );
  const dismiss = useAtomCommand(bots.dismissSuggestion, { reportFailure: false });

  // Saving a bot can use up a suggestion, so each bot change refetches the open list.
  const refreshOpen = open.refresh;
  const seenChanges = useRef(changes.bots);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches open suggestions when the watched bot change stream advances
  useEffect(() => {
    if (seenChanges.current === changes.bots) return;
    seenChanges.current = changes.bots;
    refreshOpen();
  }, [changes.bots, refreshOpen]);

  if (environmentId === null) return null;

  const setDismissed = async (suggestion: BotSuggestion, value: boolean) => {
    setError(null);
    const result = await dismiss({
      environmentId,
      input: { suggestionId: suggestion.id, dismissed: value },
    });
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Could not change the suggestion.",
      );
      return;
    }
    open.refresh();
    dismissed.refresh();
  };

  const dismissedSuggestions = dismissed.data?.suggestions ?? [];
  if (open.error)
    return (
      <section aria-label="Suggested bots" className="flex flex-col gap-2">
        <LibraryGroupHeading title="Suggested bots" />
        <LibraryErrorNotice error={open.error} onRetry={open.refresh} />
      </section>
    );
  if (!open.data) return null;
  if (suggestions.length === 0 && dismissedSuggestions.length === 0 && !showDismissed) return null;

  const shown = expanded ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTIONS);
  const folded = suggestions.length - VISIBLE_SUGGESTIONS;
  return (
    <section aria-label="Suggested bots" className="flex flex-col gap-2">
      <LibraryGroupHeading
        title="Suggested bots"
        count={suggestions.length}
        hint={
          suggestions.length > 0
            ? "Briefs you keep repeating. Make one a bot?"
            : "Nothing new to suggest."
        }
        marker={<LightbulbIcon aria-hidden className="size-3.5 text-muted-foreground" />}
        action={
          <Button
            shape="pill"
            size="xs"
            variant="ghost-muted"
            aria-expanded={showDismissed}
            onClick={() => setShowDismissed((on) => !on)}
          >
            {showDismissed ? "Hide dismissed" : "Dismissed"}
          </Button>
        }
      />
      {suggestions.length > 0 ? (
        <div className={cn(LIBRARY_OUTLINE, "overflow-hidden")}>
          <ul aria-label="Open suggestions" className="divide-y divide-border">
            {shown.map((suggestion) => {
              const threadId = suggestion.threadIds[0];
              return (
                <SuggestionRow key={suggestion.id} suggestion={suggestion} now={now}>
                  <Button
                    shape="pill"
                    size="xs"
                    variant="outline"
                    disabled={!access.canSave || threadId === undefined}
                    onClick={() => {
                      if (threadId !== undefined)
                        nav.open({ fromThread: threadId, suggestion: suggestion.id });
                    }}
                  >
                    <PlusIcon />
                    Create
                  </Button>
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dismiss suggestion"
                    disabled={!access.canSave}
                    onClick={() => void setDismissed(suggestion, true)}
                  >
                    <XIcon />
                  </Button>
                </SuggestionRow>
              );
            })}
          </ul>
          {folded > 0 ? (
            <div className="border-t border-border px-2 py-1.5">
              <Button
                shape="pill"
                size="xs"
                variant="ghost-muted"
                aria-expanded={expanded}
                onClick={() => setExpanded((on) => !on)}
              >
                {expanded ? "Show fewer" : `Show ${folded} more`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {showDismissed ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Dismissed</h3>
          {dismissed.error ? (
            <LibraryErrorNotice error={dismissed.error} onRetry={dismissed.refresh} />
          ) : !dismissed.data ? (
            <div
              role="status"
              aria-label="Loading dismissed suggestions"
              className={cn(LIBRARY_OUTLINE, "flex flex-col gap-1.5 px-3 py-2.5")}
            >
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          ) : dismissedSuggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dismissed suggestions.</p>
          ) : (
            <ul
              aria-label="Dismissed suggestions"
              className={cn(LIBRARY_OUTLINE, "divide-y divide-border overflow-hidden")}
            >
              {dismissedSuggestions.map((suggestion) => (
                <SuggestionRow key={suggestion.id} suggestion={suggestion} now={now} muted>
                  <Button
                    shape="pill"
                    size="xs"
                    variant="ghost"
                    disabled={!access.canSave}
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
      <LibraryErrorNotice error={error} />
    </section>
  );
}
