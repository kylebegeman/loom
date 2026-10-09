import { describe, expect, it } from "@effect/vitest";
import type { DeviceQaFlow, DeviceQaLocalDevice } from "@t3tools/contracts/fork";
import { selectDevice, selectFlows } from "./mcp.ts";

const flow = (path: string, kind: DeviceQaFlow["kind"] = "e2e"): DeviceQaFlow => {
  const relative = path.slice(".argent/flows/".length);
  const slash = relative.lastIndexOf("/");
  return {
    path,
    name: relative.slice(slash + 1).replace(/\.yaml$/, ""),
    folder: slash === -1 ? "" : relative.slice(0, slash),
    kind,
    prerequisite: kind === "fragment" ? "Signed in" : null,
    firstEcho: null,
    stepCount: 3,
    snapshotSteps: 1,
    platforms: ["ios"],
    parseError: kind === "invalid" ? "steps must be a list" : null,
    modifiedAt: "2026-10-08T00:00:00.000Z",
  };
};

const FLOWS = [
  flow(".argent/flows/login.yaml"),
  flow(".argent/flows/checkout/pay.yaml"),
  flow(".argent/flows/checkout/refund.yaml"),
  flow(".argent/flows/checkout/signed-in.yaml", "fragment"),
  flow(".argent/flows/checkout/eu/pay.yaml"),
  flow(".argent/flows/broken.yaml", "invalid"),
];

const paths = (result: ReturnType<typeof selectFlows>) =>
  Array.isArray(result) ? result.map((entry) => entry.path) : result;

describe("selectFlows", () => {
  it("finds one flow by path, by path without .yaml, or by a unique name", () => {
    expect(paths(selectFlows(FLOWS, ".argent/flows/login.yaml"))).toEqual([
      ".argent/flows/login.yaml",
    ]);
    expect(paths(selectFlows(FLOWS, "checkout/pay"))).toEqual([".argent/flows/checkout/pay.yaml"]);
    expect(paths(selectFlows(FLOWS, "refund"))).toEqual([".argent/flows/checkout/refund.yaml"]);
  });

  it("runs a folder's e2e flows, nested folders included, and skips fragments", () => {
    expect(paths(selectFlows(FLOWS, ".argent/flows/checkout/"))).toEqual([
      ".argent/flows/checkout/pay.yaml",
      ".argent/flows/checkout/refund.yaml",
      ".argent/flows/checkout/eu/pay.yaml",
    ]);
  });

  it("explains ambiguous names, invalid flows and unknown names", () => {
    expect(selectFlows(FLOWS, "pay")).toMatchObject({ reason: "invalid-path" });
    expect(selectFlows(FLOWS, "broken")).toMatchObject({
      reason: "invalid-path",
      message: ".argent/flows/broken.yaml cannot run: steps must be a list",
    });
    expect(selectFlows(FLOWS, "nothing")).toMatchObject({ reason: "flow-not-found" });
    expect(selectFlows([flow(".argent/flows/only/frag.yaml", "fragment")], "only")).toMatchObject({
      reason: "invalid-path",
    });
  });
});

const device = (deviceId: string, platform: "ios" | "android" = "ios"): DeviceQaLocalDevice => ({
  target: { hostId: "local", deviceId, platform },
  name: platform === "ios" ? "iPhone 17" : "Pixel 9",
  version: platform === "ios" ? "iOS 27.0" : "Android 16",
});

describe("selectDevice", () => {
  const sim = device("SIM-1");
  const emulator = device("emulator-5554", "android");

  it("uses the named device, else the thread's open device, else the only one", () => {
    expect(selectDevice([sim, emulator], [], "emulator-5554")).toBe(emulator);
    expect(selectDevice([sim, emulator], ["emulator-5554"], undefined)).toBe(emulator);
    expect(selectDevice([sim], [], undefined)).toBe(sim);
  });

  it("asks for device_id when the choice is ambiguous or the device is not running", () => {
    expect(selectDevice([sim, emulator], [], undefined)).toMatchObject({
      reason: "device-unavailable",
      message: expect.stringContaining("Pass device_id"),
    });
    expect(selectDevice([], [], undefined)).toMatchObject({ reason: "device-unavailable" });
    expect(selectDevice([sim], [], "SIM-9")).toMatchObject({
      message: expect.stringContaining("Available: iPhone 17 (SIM-1)"),
    });
  });
});
