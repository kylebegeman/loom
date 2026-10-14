import { describe, expect, it } from "vite-plus/test";
import { projectHomeThreadMenuActions } from "./projectHomeThreadMenuActions";

const access = {
  connected: true,
  permitted: true,
  settlementSupported: true,
  snoozeSupported: true,
  handoffSupported: true,
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
});
