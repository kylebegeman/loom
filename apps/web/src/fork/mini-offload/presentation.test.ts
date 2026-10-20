import { describe, expect, it } from "vite-plus/test";
import type { MiniReceipt } from "@t3tools/contracts/fork";
import { jobStateLabel, parseOutputFiles, workerCheckStatus } from "./presentation";
const receipt: MiniReceipt = {
  request: {
    threadId: "fixture" as MiniReceipt["request"]["threadId"],
    requestId: "a".repeat(32),
    workerId: "pi",
    label: "Build",
    argv: ["true"],
    memoryMiB: 128,
    cpuPercent: 100,
    timeoutSeconds: 60,
    committedOnly: false,
  },
  workerName: "Pi",
  sourceRevision: "a".repeat(40),
  archiveSha256: "a".repeat(64),
  archiveBytes: 1024,
  localEditsExcluded: false,
  createdAt: "2026-10-12T00:00:00Z",
  state: "submitted",
  job: {
    id: "b".repeat(32),
    state: "succeeded",
    label: "Build",
    exit_code: 0,
    reason: "completed",
  },
};
describe("Mini task presentation", () => {
  it("keeps an uncertain transfer visible despite a cached completed job", () => {
    expect(jobStateLabel(receipt)).toBe("Completed");
    expect(jobStateLabel({ ...receipt, state: "transfer_pending" })).toBe("Check transfer");
  });
  it("does not report completion when accepted work has no job status yet", () => {
    expect(jobStateLabel({ ...receipt, job: null })).toBe("Waiting for status");
  });
});

describe("output file declarations", () => {
  it("accepts an optional newline-separated list, including file names with spaces", () => {
    expect(parseOutputFiles("  dist/firmware.bin\r\n\nreport with spaces.txt  ")).toEqual({
      outputs: ["dist/firmware.bin", "report with spaces.txt"],
      error: null,
    });
    expect(parseOutputFiles("\n ")).toEqual({ outputs: [], error: null });
  });
  it("blocks duplicate, noncanonical and too many paths before submission", () => {
    for (const text of [
      "same\nsame",
      "../x",
      "/x",
      "a/.git/config",
      "a//b",
      "a\\b",
      Array.from({ length: 33 }, (_, i) => `file-${i}`).join("\n"),
    ])
      expect(parseOutputFiles(text).error).not.toBeNull();
  });
});
describe("workerCheckStatus", () => {
  it("asks for the new host key to be confirmed instead of reporting a generic failure", () => {
    expect(workerCheckStatus({ status: "unreachable", reasons: ["host_key_mismatch"] })).toMatch(
      /^SSH refused this worker's host key\..*known_hosts/,
    );
    expect(workerCheckStatus({ status: "unreachable", reasons: ["connection_failed"] })).toBe(
      "Connection or setup check failed. Check SSH access and Mini installation on the worker.",
    );
  });
});
