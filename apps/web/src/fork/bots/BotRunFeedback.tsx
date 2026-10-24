import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { BOTS_RUN_NOTE_MAX, type BotRun, type BotRunRating } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { NotebookPenIcon, ThumbsDownIcon, ThumbsUpIcon, type LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryField } from "../project-library/LibraryControls";
import { bots } from "./state";

const RATINGS = [
  { rating: "up", label: "Good", icon: ThumbsUpIcon },
  { rating: "down", label: "Bad", icon: ThumbsDownIcon },
] as const satisfies ReadonlyArray<{
  readonly rating: BotRunRating;
  readonly label: string;
  readonly icon: LucideIcon;
}>;

/** Rating and note share one mutation, so each edit preserves the other saved value. */
export function BotRunFeedback({
  environmentId,
  run,
  canRate,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly canRate: boolean;
}) {
  const rateRun = useAtomCommand(bots.rateRun, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ readonly from: BotRun; readonly run: BotRun } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use the response until the watch advances, without hiding a later edit from another client.
  const current = saved?.from === run ? saved.run : run;

  const persist = async (rating: BotRunRating | null, note: string | null, closeEditor = false) => {
    if (!canRate || busy) return;
    setBusy(true);
    setError(null);
    const result = await rateRun({ environmentId, input: { runId: run.id, rating, note } });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not save run feedback.");
      return;
    }
    setSaved({ from: run, run: result.value });
    if (closeEditor) setDraft(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex items-center gap-0.5" role="group" aria-label="Run feedback">
          {RATINGS.map(({ rating, label, icon: Icon }) => {
            const pressed = current.rating === rating;
            return (
              <Button
                key={rating}
                shape="pill"
                size="xs"
                variant={pressed ? "secondary" : "ghost-muted"}
                aria-pressed={pressed}
                disabled={!canRate || busy}
                onClick={() => void persist(pressed ? null : rating, current.note ?? null)}
              >
                <Icon />
                {label}
              </Button>
            );
          })}
        </div>
        {draft === null ? (
          <Button
            shape="pill"
            size="xs"
            variant="ghost-muted"
            disabled={!canRate || busy}
            onClick={() => {
              setError(null);
              setDraft(current.note ?? "");
            }}
          >
            <NotebookPenIcon />
            {current.note ? "Edit note" : "Add note"}
          </Button>
        ) : null}
      </div>
      {draft === null ? (
        current.note ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground wrap-anywhere">
            {current.note}
          </p>
        ) : null
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.length <= BOTS_RUN_NOTE_MAX)
              void persist(current.rating ?? null, draft.trim() || null, true);
          }}
        >
          <LibraryField label="Run note">
            <Textarea
              size="sm"
              value={draft}
              maxLength={BOTS_RUN_NOTE_MAX}
              disabled={!canRate || busy}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="What did this run get right or miss?"
            />
          </LibraryField>
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-auto text-xs tabular-nums text-muted-foreground">
              {draft.length}/{BOTS_RUN_NOTE_MAX}
            </span>
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              shape="pill"
              type="submit"
              size="xs"
              disabled={!canRate || busy || draft.length > BOTS_RUN_NOTE_MAX}
            >
              {busy ? "Saving…" : "Save note"}
            </Button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
