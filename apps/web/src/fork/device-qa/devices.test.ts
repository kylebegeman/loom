import type { DeviceServiceState } from "@t3tools/contracts";
import type { DeviceQaLocalDevice } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { deviceOptions, pickDevice } from "./devices";

const sim: DeviceQaLocalDevice = {
  target: { hostId: "local", deviceId: "SIM-1", platform: "ios" },
  name: "iPhone 17",
  version: "iOS 27.0",
};

const hubDevice = (
  id: string,
  options: { hostId?: string; booted?: boolean; physical?: boolean } = {},
) => ({
  hostId: options.hostId ?? "local",
  id,
  platform: "ios" as const,
  name: `Device ${id}`,
  version: "iOS 27.0",
  booted: options.booted ?? true,
  physical: options.physical ?? false,
});

const hub = {
  hosts: [{ id: "studio", label: "Studio Mac" }],
  devices: [
    hubDevice("SIM-1"),
    hubDevice("PHONE-1", { physical: true }),
    hubDevice("SIM-9", { hostId: "studio" }),
    hubDevice("SIM-OFF", { booted: false }),
  ],
} as unknown as Pick<DeviceServiceState, "devices" | "hosts">;

describe("deviceOptions", () => {
  it("lists local simulators once, then booted hub devices that only take screenshots", () => {
    const options = deviceOptions([sim], hub);
    expect(
      options.map(({ key, local, physical, hostLabel }) => [key, local, physical, hostLabel]),
    ).toEqual([
      ["local:SIM-1", true, false, null],
      ["local:PHONE-1", false, true, null],
      ["studio:SIM-9", false, false, "Studio Mac"],
    ]);
    expect(options[0]!.name).toBe("iPhone 17");
  });
});

describe("pickDevice", () => {
  const options = deviceOptions([sim], hub);

  it("keeps the chosen device, else the watched one, else the first local one", () => {
    expect(pickDevice(options, options[2]!.target, [])?.key).toBe("studio:SIM-9");
    expect(pickDevice(options, null, [{ hostId: "local", deviceId: "PHONE-1" }])?.key).toBe(
      "local:PHONE-1",
    );
    expect(
      pickDevice(options, { hostId: "local", deviceId: "GONE", platform: "ios" }, [])?.key,
    ).toBe("local:SIM-1");
    expect(pickDevice([], null, [])).toBeNull();
  });
});
