import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { threadCompletionAlertMuted } from "./thread-alerts.ts";

const NOW = DateTime.makeUnsafe("2026-10-25T09:00:00.000Z");

describe("threadCompletionAlertMuted", () => {
  it("mutes settled threads and threads snoozed past now", () => {
    expect(threadCompletionAlertMuted({ settledOverride: "settled" }, NOW)).toBe(true);
    expect(
      threadCompletionAlertMuted(
        { settledOverride: null, snoozedUntil: DateTime.makeUnsafe("2026-10-25T10:00:00.000Z") },
        NOW,
      ),
    ).toBe(true);
  });

  it("alerts once a snooze has ended or a thread was reopened", () => {
    expect(
      threadCompletionAlertMuted(
        { settledOverride: null, snoozedUntil: DateTime.makeUnsafe("2026-10-25T09:00:00.000Z") },
        NOW,
      ),
    ).toBe(false);
    expect(threadCompletionAlertMuted({ settledOverride: "active", snoozedUntil: null }, NOW)).toBe(
      false,
    );
    expect(threadCompletionAlertMuted({ settledOverride: null }, NOW)).toBe(false);
  });
});
