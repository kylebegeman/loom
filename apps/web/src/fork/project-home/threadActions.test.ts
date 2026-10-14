import { describe, expect, it } from "vite-plus/test";
import { projectHomeThreadAction } from "./threadActions";

const enabled = {
  connected: true,
  canOperate: true,
  supportsSettlement: true,
  supportsSnooze: true,
};

describe("project home conversation lifecycle", () => {
  it("keeps pending work and failure review out of the quick settle path", () => {
    for (const activity of ["attention", "working", "failed"] as const)
      expect(projectHomeThreadAction({ ...enabled, activity })).toBeNull();
    expect(projectHomeThreadAction({ ...enabled, activity: "ready" })).toEqual({
      action: "settle",
      label: "Settle",
    });
  });

  it("provides the reverse operation for parked conversations", () => {
    expect(projectHomeThreadAction({ ...enabled, activity: "settled" })).toEqual({
      action: "unsettle",
      label: "Reopen",
    });
    expect(projectHomeThreadAction({ ...enabled, activity: "snoozed" })).toEqual({
      action: "unsnooze",
      label: "Wake",
    });
  });

  it("never mutates offline, read-only or unsupported conversations", () => {
    for (const activity of ["ready", "snoozed", "settled"] as const) {
      expect(projectHomeThreadAction({ ...enabled, connected: false, activity })).toBeNull();
      expect(projectHomeThreadAction({ ...enabled, canOperate: false, activity })).toBeNull();
      expect(
        projectHomeThreadAction({
          ...enabled,
          supportsSettlement: false,
          supportsSnooze: false,
          activity,
        }),
      ).toBeNull();
    }
  });
});
