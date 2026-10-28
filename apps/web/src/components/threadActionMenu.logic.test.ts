import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});

// fork: attention-status
it("offers queue recovery only for held work and disables it for read-only connections", () => {
  expect(buildThreadActionMenuItems(baseState).map((item) => item.id)).not.toContain(
    "resume-queue",
  );
  expect(
    buildThreadActionMenuItems({ ...baseState, queueHeld: true }).find(
      (item) => item.id === "resume-queue",
    )?.disabled,
  ).not.toBe(true);
  expect(
    buildThreadActionMenuItems({ ...baseState, queueHeld: true, canOperate: false }).find(
      (item) => item.id === "resume-queue",
    )?.disabled,
  ).toBe(true);
});

// fork: project-lifecycle
describe("release checkout", () => {
  const ids = (state: ThreadActionMenuState) =>
    buildThreadActionMenuItems(state).map((item) => item.id);
  const releaseItem = (state: ThreadActionMenuState) =>
    buildThreadActionMenuItems(state).find((item) => item.id === "release-checkout");
  const supported = { ...baseState.supports, checkoutRelease: true };

  it("appears just above archive only when the host supports it and the thread has a checkout", () => {
    expect(ids({ ...baseState, supports: supported, hasWorktree: true }).slice(-3)).toEqual([
      "release-checkout",
      "archive",
      "delete",
    ]);
    expect(ids({ ...baseState, supports: supported, hasWorktree: false })).not.toContain(
      "release-checkout",
    );
    expect(ids({ ...baseState, hasWorktree: true })).not.toContain("release-checkout");
    const released = {
      ...baseState,
      supports: { ...supported, checkoutRestore: true },
      hasWorktree: true,
      checkoutReleased: true,
    };
    expect(ids(released)).not.toContain("release-checkout");
    expect(ids(released)).toContain("restore-checkout");
    expect(
      buildThreadActionMenuItems({ ...released, canOperate: false }).find(
        (item) => item.id === "restore-checkout",
      )?.disabled,
    ).toBe(true);
  });

  it("keeps a single separator before the lifecycle group", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      supports: supported,
      hasWorktree: true,
    });
    expect(
      items
        .filter((item) => item.id === "release-checkout" || item.id === "archive")
        .map((item) => item.separatorBefore),
    ).toEqual([true, false]);
  });

  it("is disabled while the thread runs or without operate permission", () => {
    const state = { ...baseState, supports: supported, hasWorktree: true };
    expect(releaseItem(state)?.disabled).toBe(false);
    expect(releaseItem({ ...state, isRunning: true })?.disabled).toBe(true);
    expect(releaseItem({ ...state, canOperate: false })?.disabled).toBe(true);
  });
});
