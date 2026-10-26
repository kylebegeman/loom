import { WS_METHODS } from "@t3tools/contracts";
import { LIBRARY_WS_METHODS, PROJECT_WORKFLOW_WS_METHODS } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { rpcAckThresholdMs } from "./requestLatencyState";

describe("rpcAckThresholdMs", () => {
  it("gives Library file preparation and launch operations the long-running threshold", () => {
    for (const method of [
      LIBRARY_WS_METHODS.prepareCopy,
      PROJECT_WORKFLOW_WS_METHODS.execute,
      PROJECT_WORKFLOW_WS_METHODS.resume,
    ]) {
      expect(rpcAckThresholdMs(method)).toBe(120_000);
    }
  });

  it("keeps the normal threshold for ordinary requests", () => {
    expect(rpcAckThresholdMs(WS_METHODS.serverGetConfig)).toBe(15_000);
    expect(rpcAckThresholdMs(LIBRARY_WS_METHODS.copyStatus)).toBe(15_000);
  });
});
