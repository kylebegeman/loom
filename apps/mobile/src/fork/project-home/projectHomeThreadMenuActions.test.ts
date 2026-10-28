import { describe, expect, it } from "vite-plus/test";
import { projectHomeThreadMenuActions } from "./projectHomeThreadMenuActions";

const access = {
  connected: true,
  permitted: true,
  settlementSupported: true,
  snoozeSupported: true,
  handoffSupported: true,
  checkoutReleaseSupported: false,
  running: false,
};

describe("project row operation access", () => {
  it("preserves settle, reopen and wake beside reviewed Move work", () => {
    expect(
      projectHomeThreadMenuActions({ ...access, activity: "ready" }).map((action) => action.id),
    ).toEqual(["settle", "move-work"]);
    expect(
      projectHomeThreadMenuActions({ ...access, activity: "settled" }).map((action) => action.id),
    ).toEqual(["reopen", "move-work"]);
    expect(
      projectHomeThreadMenuActions({ ...access, activity: "snoozed" }).map((action) => action.id),
    ).toEqual(["wake", "move-work"]);
  });
  it("keeps host and grant boundaries for Move work", () => {
    expect(
      projectHomeThreadMenuActions({ ...access, activity: "ready", connected: false }),
    ).toEqual([]);
    expect(
      projectHomeThreadMenuActions({ ...access, activity: "ready", permitted: false }),
    ).toEqual([]);
    expect(
      projectHomeThreadMenuActions({ ...access, activity: "ready", handoffSupported: false }).map(
        (action) => action.id,
      ),
    ).toEqual(["settle"]);
  });
  it("offers Release checkout for idle worktree threads and disables it while running", () => {
    const release = { ...access, checkoutReleaseSupported: true };
    expect(
      projectHomeThreadMenuActions({ ...release, activity: "settled", checkoutReleased: true }).map(
        (action) => action.id,
      ),
    ).toEqual(["reopen", "move-work", "restore-checkout"]);
    expect(
      projectHomeThreadMenuActions({ ...release, activity: "settled" }).map((action) => action.id),
    ).toEqual(["reopen", "move-work", "release-checkout"]);
    expect(
      projectHomeThreadMenuActions({ ...release, activity: "ready" }).find(
        (action) => action.id === "release-checkout",
      )?.attributes?.disabled,
    ).toBe(false);
    expect(
      projectHomeThreadMenuActions({ ...release, activity: "working", running: true }).find(
        (action) => action.id === "release-checkout",
      )?.attributes?.disabled,
    ).toBe(true);
    expect(
      projectHomeThreadMenuActions({ ...release, activity: "settled", connected: false }),
    ).toEqual([]);
    expect(
      projectHomeThreadMenuActions({ ...release, activity: "settled", permitted: false }),
    ).toEqual([]);
  });
});
