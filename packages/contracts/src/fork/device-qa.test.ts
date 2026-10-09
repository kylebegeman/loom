import { describe, expect, it } from "vite-plus/test";

import {
  DEVICE_QA_WS_METHODS,
  deviceQaTargetKey,
  isArgentFlowName,
  parseDeviceQaTargetKey,
} from "./device-qa.ts";

describe("device-qa contracts", () => {
  it("prefixes every tag with loom.device-qa.", () => {
    const tags = Object.values(DEVICE_QA_WS_METHODS);
    expect(tags.filter((tag) => !tag.startsWith("loom.device-qa."))).toEqual([]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("accepts only argent's flow name charset", () => {
    expect(isArgentFlowName("login_happy-path2")).toBe(true);
    expect(isArgentFlowName("log in")).toBe(false);
    expect(isArgentFlowName("../x")).toBe(false);
    expect(isArgentFlowName("")).toBe(false);
  });

  it("round-trips target keys whose device id contains a colon", () => {
    const key = deviceQaTargetKey({ hostId: "local", deviceId: "emulator-5554:extra" });
    expect(parseDeviceQaTargetKey(key)).toEqual({
      hostId: "local",
      deviceId: "emulator-5554:extra",
    });
    expect(parseDeviceQaTargetKey("nocolon")).toBeNull();
  });
});
