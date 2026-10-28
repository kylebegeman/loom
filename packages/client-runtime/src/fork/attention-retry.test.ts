import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, RunId } from "@t3tools/contracts";
import { v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";
import { presentThreadShell } from "../state/models.ts";
import {
  attentionRow,
  runAttentionRetries,
  type AttentionRetryOutcome,
} from "./attention-retry.ts";

describe("attention retry", () => {
  it("opens child questions instead of offering retry for a failed parent", () => {
    const source = {
      ...v2ThreadShell,
      status: "failed" as const,
      latestRunId: RunId.make("failed"),
      lastErrorClass: "transport_error" as const,
    };
    const environmentId = EnvironmentId.make("host");
    expect(attentionRow(presentThreadShell(environmentId, source))?.target?.runId).toBe("failed");
    const row = attentionRow(presentThreadShell(environmentId, source, "approval"));
    expect(row?.kind).toBe("approval");
    expect(row?.target).toBeNull();
  });

  it("retries sequentially and keeps each failure without stopping later runs", async () => {
    const starts: number[] = [];
    const results: [number, AttentionRetryOutcome][] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = runAttentionRetries(
      [1, 2, 3],
      async (target) => {
        starts.push(target);
        if (target === 1) await first;
        if (target === 2) throw new Error("Run changed");
      },
      (target, result) => results.push([target, result]),
    );
    expect(starts).toEqual([1]);
    release();
    await done;
    expect(starts).toEqual([1, 2, 3]);
    expect(results).toEqual([
      [1, { status: "retrying" }],
      [1, { status: "retried" }],
      [2, { status: "retrying" }],
      [2, { status: "failed", message: "Run changed" }],
      [3, { status: "retrying" }],
      [3, { status: "retried" }],
    ]);
  });
});
