import type { RestartCompactionOutcome } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { describeRestartCompaction } from "./database-compaction.ts";

const attempt = (outcome: RestartCompactionOutcome, detail = `${outcome} detail`) => ({
  at: "2026-10-25T12:00:00.000Z",
  outcome,
  detail,
});

describe("describeRestartCompaction", () => {
  it("promises the next update restart only while the desktop would still run on its own", () => {
    for (const lastAttempt of [null, attempt("completed"), attempt("skipped")]) {
      expect(describeRestartCompaction({ requested: false, lastAttempt }, "Studio").plan).toBe(
        "Loom on Studio returns it to disk when it restarts for its next update, or at its next restart if you ask now.",
      );
    }
  });

  it("asks for a request after a repair that failed or was stopped", () => {
    for (const outcome of ["failed", "interrupted"] as const) {
      const copy = describeRestartCompaction(
        { requested: false, lastAttempt: attempt(outcome, "The repair stopped.") },
        "Studio",
      );
      expect(copy.plan).toBe(
        "Loom will not try again on its own; choose Compact at next restart to retry.",
      );
      expect(copy.lastAttempt).toBe("Last attempt: The repair stopped.");
    }
  });

  it("names the next start once requested, whatever happened before", () => {
    expect(
      describeRestartCompaction({ requested: true, lastAttempt: attempt("failed") }, "Studio").plan,
    ).toBe("Loom on Studio returns it to disk the next time it starts.");
  });

  it("hides a completed attempt, which left nothing to report", () => {
    expect(
      describeRestartCompaction({ requested: false, lastAttempt: attempt("completed") }, "Studio")
        .lastAttempt,
    ).toBeNull();
  });
});
