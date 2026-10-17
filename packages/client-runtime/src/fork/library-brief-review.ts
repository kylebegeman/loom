import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryAcceptBriefProposalRequest,
  LibraryBriefProposal,
  LibraryProject,
} from "@t3tools/contracts/fork";

/**
 * How a proposal reads against the brief on screen. The diff always starts from the current
 * brief, so a proposal written against an older revision shows what accepting would change now.
 */
export type LibraryBriefReview = {
  readonly before: string;
  readonly after: string;
  /** The brief was revised after the proposal was written. */
  readonly stale: boolean;
  /** Accepting would leave the brief as it is. */
  readonly unchanged: boolean;
};

export function libraryBriefReview(
  proposal: LibraryBriefProposal,
  project: LibraryProject,
): LibraryBriefReview {
  return {
    before: project.brief,
    after: proposal.proposedBrief,
    stale: proposal.baseRevision !== project.revision,
    unchanged: proposal.proposedBrief === project.brief,
  };
}

export type LibraryBriefAcceptance =
  /** The base is stale and the person has not yet said to replace the newer brief. */
  | { readonly kind: "confirm-stale" }
  /** The text to save matches the current brief, so there is nothing to accept. */
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "ready";
      readonly input: Omit<LibraryAcceptBriefProposalRequest, "requestId">;
    };

/**
 * What accepting sends. The Library applies a proposal as written only against its own base, so a
 * stale or edited acceptance sends the text to save, after the person confirms a stale one.
 */
export function libraryBriefAcceptance(
  proposal: LibraryBriefProposal,
  project: LibraryProject,
  decision: { readonly edited?: string; readonly confirmedStale: boolean },
): LibraryBriefAcceptance {
  const review = libraryBriefReview(proposal, project);
  const text = decision.edited ?? proposal.proposedBrief;
  if (text === project.brief) return { kind: "unchanged" };
  if (review.stale && !decision.confirmedStale) return { kind: "confirm-stale" };
  const sendText = review.stale || text !== proposal.proposedBrief;
  return {
    kind: "ready",
    input: {
      proposalId: proposal.id,
      expectedRevision: project.revision,
      ...(sendText ? { brief: text } : {}),
    },
  };
}

export const libraryBriefSuggestionsLabel = (count: number) =>
  count === 1 ? "1 suggested update" : `${count} suggested updates`;

/** The suggestion a review is on, and where it stood in the list when it was picked. */
export type LibraryBriefProposalPick = { readonly id: string; readonly index: number };

/**
 * Which pending suggestion a review shows. It follows the picked id, so a newer suggestion arriving
 * at the front of the list never slides a different one under the Accept button. Once the picked
 * one leaves the list without a decision on this screen, it was replaced or decided elsewhere:
 * `proposal` is absent and `index` is where it stood, so the review can say so and offer the one
 * now in its place rather than silently showing it.
 */
export function libraryBriefProposalSelection<P extends { readonly id: string }>(
  proposals: readonly P[],
  pick: LibraryBriefProposalPick | null,
): { readonly index: number; readonly proposal: P | undefined; readonly missing: boolean } {
  if (pick === null) return { index: 0, proposal: proposals[0], missing: false };
  const index = proposals.findIndex((proposal) => proposal.id === pick.id);
  if (index >= 0) return { index, proposal: proposals[index], missing: false };
  return {
    index: Math.min(pick.index, Math.max(proposals.length - 1, 0)),
    proposal: undefined,
    missing: true,
  };
}

/**
 * Where a review goes after the person decides the suggestion at `index`: the one that takes its
 * place, or nowhere when none are left.
 */
export function libraryBriefProposalAfterDecision<P extends { readonly id: string }>(
  proposals: readonly P[],
  decidedId: string,
  index: number,
): LibraryBriefProposalPick | null {
  const rest = proposals.filter((proposal) => proposal.id !== decidedId);
  const at = Math.min(index, rest.length - 1);
  const next = rest[at];
  return next ? { id: next.id, index: at } : null;
}

/** Who suggested a change, naming the computer a conversation ran on. */
export function libraryBriefProposalSourceLabel(
  proposal: LibraryBriefProposal,
  hostLabel: (id: EnvironmentId) => string,
): string {
  switch (proposal.source.kind) {
    case "conversation":
      return `From a conversation on ${hostLabel(proposal.source.environmentId)}`;
    case "agent":
      return `From ${proposal.source.label}`;
    case "user":
      return "From a person";
  }
}

export type LibraryBriefSuggestionAvailability =
  | { readonly kind: "hidden" }
  | { readonly kind: "disabled"; readonly reason: string }
  | { readonly kind: "ready" };

/**
 * Whether a saved conversation can be asked to suggest brief updates. It only applies to settled
 * conversations in a live project on a Library that keeps proposals; the rest of the time the
 * action explains what is missing.
 */
export function libraryBriefSuggestionAvailability(input: {
  readonly libraryKeepsProposals: boolean;
  readonly settled: boolean;
  readonly archived: boolean;
  readonly hostLabel: string;
  readonly hostConnected: boolean;
  /** The conversation's computer has the `loom_library_brief_propose` tool. */
  readonly hostProposes: boolean;
  readonly canSend: boolean;
}): LibraryBriefSuggestionAvailability {
  if (!input.libraryKeepsProposals || !input.settled || input.archived) return { kind: "hidden" };
  if (!input.hostConnected)
    return { kind: "disabled", reason: `Connect ${input.hostLabel} to ask its agent.` };
  if (!input.hostProposes)
    return {
      kind: "disabled",
      reason: `Update Loom on ${input.hostLabel} so its agent can suggest brief updates.`,
    };
  if (!input.canSend)
    return { kind: "disabled", reason: "This connection can't send messages to conversations." };
  return { kind: "ready" };
}

/** The follow-up a settled conversation's agent receives. It proposes; a person decides. */
export const libraryBriefSuggestionPrompt = (projectId: string) =>
  `Please look back over this conversation and suggest updates to the project brief. Read the current brief with loom_library_project (project ${projectId}). If what we did or learned should change it, call loom_library_brief_propose with the full new brief, its current revision as the base, and a short summary of why. If it doesn't need to change, say so and stop.`;
