import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import type { LibraryBriefSuggestion } from "@t3tools/contracts/fork";
import { compactLibraryProfile, libraryProfileChange } from "./library-project-profile.ts";
import {
  libraryBriefSuggestionChoiceLabel,
  libraryBriefSuggestionDraftValue,
  libraryBriefSuggestionNotice,
} from "./library-brief-suggestions.ts";

const suggestion = (patch: Partial<LibraryBriefSuggestion>): LibraryBriefSuggestion => ({
  threadId: ThreadId.make("thread-1"),
  projectId: "loom",
  mode: "ask",
  settledAt: "2026-10-16T10:00:00.000Z",
  status: "offered",
  updatedAt: "2026-10-16T10:00:00.000Z",
  ...patch,
});

describe("brief suggestion setting", () => {
  it("saves off as no setting, so turning it off on an empty profile removes nothing new", () => {
    expect(
      compactLibraryProfile({ briefSuggestions: libraryBriefSuggestionDraftValue("off") }),
    ).toBe(null);
    expect(
      libraryProfileChange(
        { briefSuggestions: libraryBriefSuggestionDraftValue("off") },
        undefined,
      ),
    ).toBeUndefined();
    expect(
      libraryProfileChange(
        { briefSuggestions: libraryBriefSuggestionDraftValue("automatic") },
        undefined,
      ),
    ).toEqual({ briefSuggestions: "automatic" });
  });

  it("reads a profile without the setting as off", () => {
    expect(libraryBriefSuggestionChoiceLabel(undefined)).toBe("Off");
    expect(libraryBriefSuggestionChoiceLabel("ask")).toBe("Ask first");
  });
});

describe("libraryBriefSuggestionNotice", () => {
  it("offers only while the suggestion waits for a person", () => {
    expect(libraryBriefSuggestionNotice(suggestion({}))?.kind).toBe("offer");
    expect(libraryBriefSuggestionNotice(suggestion({ status: "declined" }))).toBeNull();
    expect(libraryBriefSuggestionNotice(null)).toBeNull();
  });

  it("points to the proposal once the run made one", () => {
    expect(
      libraryBriefSuggestionNotice(
        suggestion({ status: "started", runThreadId: ThreadId.make("run-1"), proposalId: "p-1" }),
      ),
    ).toMatchObject({ kind: "status", proposed: true });
  });

  it("says why a settle was skipped", () => {
    expect(
      libraryBriefSuggestionNotice(
        suggestion({ mode: "automatic", status: "skipped", reason: "daily-limit" }),
      ),
    ).toMatchObject({ kind: "status", text: expect.stringContaining("already had 3 today") });
  });
});
