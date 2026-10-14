import { describe, expect, it } from "vite-plus/test";
import { projectHomeThreadActions } from "./projectHomeThreadActions";

const access = {
  connected: true,
  permitted: true,
  settlementSupported: true,
  snoozeSupported: true,
};
describe("project home lifecycle access", () => {
  it("offers settle, reopen and wake through the matching lifecycle", () => {
    expect(projectHomeThreadActions({ ...access, activity: "ready" })[0]?.id).toBe("settle");
    expect(projectHomeThreadActions({ ...access, activity: "settled" })[0]?.id).toBe("reopen");
    expect(projectHomeThreadActions({ ...access, activity: "snoozed" })[0]?.id).toBe("wake");
  });
  it("does not expose actions for offline, read-only or incompatible computers", () => {
    expect(projectHomeThreadActions({ ...access, activity: "ready", connected: false })).toEqual(
      [],
    );
    expect(projectHomeThreadActions({ ...access, activity: "settled", permitted: false })).toEqual(
      [],
    );
    expect(
      projectHomeThreadActions({ ...access, activity: "ready", settlementSupported: false }),
    ).toEqual([]);
    expect(
      projectHomeThreadActions({ ...access, activity: "snoozed", snoozeSupported: false }),
    ).toEqual([]);
  });
});
