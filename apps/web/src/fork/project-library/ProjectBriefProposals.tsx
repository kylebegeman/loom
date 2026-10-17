import { useMemo, useState } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryBriefProposal, LibraryProject } from "@t3tools/contracts/fork";
import {
  libraryBriefAcceptance,
  libraryBriefProposalSourceLabel,
  libraryBriefReview,
  libraryBriefSuggestionsLabel,
} from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice } from "./LibraryControls";
import { projectLibrary, useLibraryPermission } from "./state";

/** One page of pending suggestions is plenty; the badge counts what is waiting, not history. */
const PENDING_LIMIT = 100;

/**
 * Agents suggest brief changes; a person reviews each one here. Render it only when the Library
 * advertises `library-brief-proposals`.
 */
export function ProjectBriefProposals({
  project,
  authorityId,
  connected,
  hostLabel,
  onDecided,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onDecided: () => void;
}) {
  const query = useEnvironmentQuery(
    projectLibrary.briefProposals({
      environmentId: authorityId,
      input: { projectId: project.id, status: "pending", limit: PENDING_LIMIT },
    }),
  );
  const proposals = query.data?.proposals ?? [];
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (!proposals.length) return null;
  const shown = Math.min(index, proposals.length - 1);
  const proposal = proposals[shown]!;
  return (
    <>
      <Badge
        variant="info"
        render={<button type="button" onClick={() => setOpen(true)} />}
        aria-haspopup="dialog"
      >
        {libraryBriefSuggestionsLabel(proposals.length)}
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Suggested brief updates</DialogTitle>
            <DialogDescription>
              Agents can suggest changes to the brief. Nothing changes until you accept one.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <BriefProposalReview
              key={proposal.id}
              proposal={proposal}
              project={project}
              authorityId={authorityId}
              connected={connected}
              hostLabel={hostLabel}
              onDecided={() => {
                query.refresh();
                onDecided();
                if (proposals.length === 1) setOpen(false);
              }}
            />
          </DialogPanel>
          <DialogFooter variant="bare">
            {proposals.length > 1 ? (
              <>
                <span className="me-auto text-xs tabular-nums text-muted-foreground">
                  {shown + 1} of {proposals.length}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={shown === 0}
                  onClick={() => setIndex(shown - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={shown === proposals.length - 1}
                  onClick={() => setIndex(shown + 1)}
                >
                  Next
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/** One suggestion as a diff against the brief on screen, with accept, edit and dismiss. */
function BriefProposalReview({
  proposal,
  project,
  authorityId,
  connected,
  hostLabel,
  onDecided,
}: {
  readonly proposal: LibraryBriefProposal;
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onDecided: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const accept = useAtomCommand(projectLibrary.acceptBriefProposal, { reportFailure: false });
  const dismiss = useAtomCommand(projectLibrary.dismissBriefProposal, { reportFailure: false });
  const canAccept = useLibraryPermission(projectLibrary.acceptBriefProposal, authorityId);
  const canDismiss = useLibraryPermission(projectLibrary.dismissBriefProposal, authorityId);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmingStale, setConfirmingStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = libraryBriefReview(proposal, project);
  const diff = useMemo(
    () =>
      review.unchanged
        ? null
        : parseDiffFromFile(
            { name: "brief.md", contents: review.before },
            { name: "brief.md", contents: review.after },
          ),
    [review.before, review.after, review.unchanged],
  );
  const blocked = !connected
    ? "Connect your Library to accept or dismiss suggestions."
    : project.archived
      ? "Restore the project to accept or dismiss suggestions."
      : !canAccept && !canDismiss
        ? "This connection can't change the brief."
        : null;

  const run = async (
    attempt: () => Promise<AtomCommandResult<unknown, unknown>>,
    fallback: string,
    done: string,
  ) => {
    setBusy(true);
    setError(null);
    const result = await attempt();
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : fallback);
      return;
    }
    toastManager.add({ type: "success", title: done });
    onDecided();
  };

  const acceptNow = (confirmedStale: boolean) => {
    const decision = libraryBriefAcceptance(proposal, project, {
      ...(draft !== null ? { edited: draft } : {}),
      confirmedStale,
    });
    if (decision.kind === "confirm-stale") return setConfirmingStale(true);
    if (decision.kind === "unchanged")
      return setError("The brief already says this. Dismiss the suggestion instead.");
    void run(
      () =>
        accept({
          environmentId: authorityId,
          input: { requestId: randomUUID(), ...decision.input },
        }),
      "Could not accept this suggestion.",
      "Brief updated",
    );
  };

  const dismissNow = () =>
    void run(
      () =>
        dismiss({
          environmentId: authorityId,
          input: { requestId: randomUUID(), proposalId: proposal.id },
        }),
      "Could not dismiss this suggestion.",
      "Suggestion dismissed",
    );

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="whitespace-pre-wrap">{proposal.summary}</p>
        <p className="text-xs text-muted-foreground">
          {libraryBriefProposalSourceLabel(proposal, hostLabel)} ·{" "}
          {formatRelativeTimeLabel(proposal.createdAt)}
        </p>
      </div>
      {review.stale ? (
        <p role="status" className="rounded-lg bg-muted/50 px-3 py-2 text-xs dark:bg-accent/50">
          The brief changed after this was suggested. The changes below are against the brief as it
          reads now.
        </p>
      ) : null}
      {draft !== null ? (
        <Textarea
          autoFocus
          rows={10}
          maxLength={65536}
          aria-label="Edited brief"
          value={draft}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
        />
      ) : diff ? (
        <div
          className="max-h-96 overflow-auto rounded-lg border text-xs"
          aria-label="Changes to the brief"
        >
          <FileDiff
            fileDiff={diff}
            options={{
              diffStyle: "unified",
              theme: resolveDiffThemeName(resolvedTheme),
              overflow: "wrap",
            }}
          />
        </div>
      ) : (
        <p className="text-muted-foreground">This already matches the brief.</p>
      )}
      {confirmingStale ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 dark:bg-accent/50"
        >
          <p className="me-auto text-xs">
            Accepting replaces the newer brief with this text. Accept anyway?
          </p>
          <Button size="xs" disabled={busy} onClick={() => acceptNow(true)}>
            Accept anyway
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmingStale(false)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      <LibraryErrorNotice error={error} />
      {blocked ? (
        <p className="text-xs text-muted-foreground">{blocked}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            shape="pill"
            size="sm"
            disabled={busy || !canAccept || confirmingStale}
            onClick={() => acceptNow(false)}
          >
            {draft !== null ? "Accept edited brief" : "Accept"}
          </Button>
          {draft !== null ? (
            <Button
              shape="pill"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel edit
            </Button>
          ) : (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={busy || !canAccept}
              onClick={() => setDraft(proposal.proposedBrief)}
            >
              Edit, then accept
            </Button>
          )}
          <Button
            shape="pill"
            size="sm"
            variant="ghost"
            disabled={busy || !canDismiss}
            onClick={dismissNow}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
