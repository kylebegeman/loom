import { RunId } from "@t3tools/contracts"; // fork: checkpoint-capable
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  resolveAvailableDiffPanelSelection, // fork: checkpoint-capable
  useDiffPanelSessionStore,
  useDiffPanelStore,
} from "./diffPanelStore";

describe("diffPanelStore", () => {
  beforeEach(() => {
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
    });
    useDiffPanelSessionStore.setState({ collapsedFileKeysByScopeKey: {} });
  });

  it("retains fold choices when a panel consumer returns with fresh defaults", () => {
    const scopeKey = "environment-1:thread-1:branch";
    const defaults = new Set(["src/app.ts", "src/index.ts"]);
    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, defaults, (current) => {
      const next = new Set(current);
      next.delete("src/app.ts");
      return next;
    });

    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(["src/index.ts"]),
    );

    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, new Set(), (current) => {
      const next = new Set(current);
      next.delete("src/index.ts");
      return next;
    });
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );

    useDiffPanelSessionStore
      .getState()
      .updateCollapsedFileKeys(scopeKey, defaults, (current) => current);
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );
    expect(defaults).toEqual(new Set(["src/app.ts", "src/index.ts"]));
  });
});

// fork: checkpoint-capable
describe("diff scope for whole-project conversations", () => {
  const latestTurnId = RunId.make("latest-turn");
  it("opens turn history when the parent folder cannot show a branch diff", () => {
    expect(
      resolveAvailableDiffPanelSelection({ kind: "branch", baseRef: null }, false, latestTurnId),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: null,
      revealRequestId: 0,
    });
    expect(resolveAvailableDiffPanelSelection({ kind: "unstaged" }, false, latestTurnId).kind).toBe(
      "turn",
    );
  });
  it("keeps component Git scopes and explicitly selected historical turns", () => {
    const branch = { kind: "branch" as const, baseRef: "origin/main" };
    const turn = {
      kind: "turn" as const,
      turnId: RunId.make("older-turn"),
      filePath: "app/main.ts",
      revealRequestId: 1,
    };
    expect(resolveAvailableDiffPanelSelection(branch, true, latestTurnId)).toBe(branch);
    expect(resolveAvailableDiffPanelSelection(turn, false, latestTurnId)).toBe(turn);
  });
});
