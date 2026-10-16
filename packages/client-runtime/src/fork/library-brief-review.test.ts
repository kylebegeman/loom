import { describe, expect, it } from "vite-plus/test";
import type { LibraryBriefProposal, LibraryProject } from "@t3tools/contracts/fork";
import {
  libraryBriefAcceptance,
  libraryBriefReview,
  libraryBriefSuggestionAvailability,
} from "./library-brief-review.ts";

const project: LibraryProject = {
  id: "loom",
  title: "Loom",
  brief: "Ship the Library.",
  revision: 3,
  resources: [],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
};
const proposal: LibraryBriefProposal = {
  id: "proposal-1",
  projectId: "loom",
  baseRevision: 3,
  proposedBrief: "Ship the Library and its brief review.",
  summary: "The review flow is part of the work now.",
  source: { kind: "user" },
  status: "pending",
  createdAt: "2026-10-16T01:00:00.000Z",
};
// Someone revised the brief after the proposal was written against revision 3.
const revised: LibraryProject = { ...project, brief: "Ship the Library on time.", revision: 4 };

describe("libraryBriefReview", () => {
  it("diffs a current proposal against the brief it was written for", () => {
    expect(libraryBriefReview(proposal, project)).toEqual({
      before: "Ship the Library.",
      after: proposal.proposedBrief,
      stale: false,
      unchanged: false,
    });
  });

  it("diffs a stale proposal against the current brief, not its base", () => {
    expect(libraryBriefReview(proposal, revised)).toMatchObject({
      before: "Ship the Library on time.",
      stale: true,
    });
  });
});

describe("libraryBriefAcceptance", () => {
  it("accepts a current proposal as written", () => {
    expect(libraryBriefAcceptance(proposal, project, { confirmedStale: false })).toEqual({
      kind: "ready",
      input: { proposalId: "proposal-1", expectedRevision: 3 },
    });
  });

  it("asks before a stale proposal replaces the newer brief", () => {
    expect(libraryBriefAcceptance(proposal, revised, { confirmedStale: false })).toEqual({
      kind: "confirm-stale",
    });
  });

  it("sends the text against the current revision once a stale base is confirmed", () => {
    expect(libraryBriefAcceptance(proposal, revised, { confirmedStale: true })).toEqual({
      kind: "ready",
      input: { proposalId: "proposal-1", expectedRevision: 4, brief: proposal.proposedBrief },
    });
  });

  it("sends an edited brief, and still asks first when the base is stale", () => {
    const edited = "Ship the Library, then review briefs.";
    expect(libraryBriefAcceptance(proposal, project, { edited, confirmedStale: false })).toEqual({
      kind: "ready",
      input: { proposalId: "proposal-1", expectedRevision: 3, brief: edited },
    });
    expect(libraryBriefAcceptance(proposal, revised, { edited, confirmedStale: false })).toEqual({
      kind: "confirm-stale",
    });
  });

  it("has nothing to accept when the text already matches the brief", () => {
    const applied = { ...revised, brief: proposal.proposedBrief };
    expect(libraryBriefReview(proposal, applied).unchanged).toBe(true);
    expect(libraryBriefAcceptance(proposal, applied, { confirmedStale: true })).toEqual({
      kind: "unchanged",
    });
    expect(
      libraryBriefAcceptance(proposal, project, { edited: project.brief, confirmedStale: false }),
    ).toEqual({ kind: "unchanged" });
  });
});

describe("libraryBriefSuggestionAvailability", () => {
  const ready = {
    libraryKeepsProposals: true,
    settled: true,
    archived: false,
    hostLabel: "Studio",
    hostConnected: true,
    hostProposes: true,
    canSend: true,
  };

  it("offers the action on a settled conversation whose computer can propose", () => {
    expect(libraryBriefSuggestionAvailability(ready)).toEqual({ kind: "ready" });
  });

  it("stays out of the way without proposals, before settling, or once archived", () => {
    for (const change of [{ libraryKeepsProposals: false }, { settled: false }, { archived: true }])
      expect(libraryBriefSuggestionAvailability({ ...ready, ...change })).toEqual({
        kind: "hidden",
      });
  });

  it("says why when the computer is offline, too old, or the connection can't send", () => {
    expect(libraryBriefSuggestionAvailability({ ...ready, hostConnected: false })).toEqual({
      kind: "disabled",
      reason: "Connect Studio to ask its agent.",
    });
    expect(libraryBriefSuggestionAvailability({ ...ready, hostProposes: false })).toMatchObject({
      kind: "disabled",
    });
    expect(libraryBriefSuggestionAvailability({ ...ready, canSend: false })).toMatchObject({
      kind: "disabled",
    });
  });
});
