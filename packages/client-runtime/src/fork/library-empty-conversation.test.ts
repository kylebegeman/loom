import { describe, expect, it } from "vite-plus/test";

import {
  markLibraryConversationStarted,
  takeEmptyLibraryConversation,
} from "./library-empty-conversation.ts";

const empty = { itemCount: 0, latestRun: null, runtime: null, archivedAt: null };

describe("empty Library conversations", () => {
  it("offers a conversation started here while it is empty, once", () => {
    markLibraryConversationStarted("computer:started");
    expect(takeEmptyLibraryConversation("computer:started", empty)).toBe(true);
    expect(takeEmptyLibraryConversation("computer:started", empty)).toBe(false);
  });

  it("never offers a conversation started elsewhere", () => {
    expect(takeEmptyLibraryConversation("computer:elsewhere", empty)).toBe(false);
  });

  it("keeps a conversation that has items or was archived, and does not ask again", () => {
    for (const shell of [
      { ...empty, itemCount: 1 },
      { ...empty, archivedAt: "2026-10-25T00:00:00.000Z" },
    ]) {
      markLibraryConversationStarted("computer:used");
      expect(takeEmptyLibraryConversation("computer:used", shell)).toBe(false);
      expect(takeEmptyLibraryConversation("computer:used", empty)).toBe(false);
    }
  });
});
