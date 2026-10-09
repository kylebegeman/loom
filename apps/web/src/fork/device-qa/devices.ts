import type { DeviceServiceState } from "@t3tools/contracts";
import {
  deviceQaTargetKey,
  type DeviceQaLocalDevice,
  type DeviceQaTarget,
} from "@t3tools/contracts/fork";

export interface DeviceQaOption {
  readonly key: string;
  readonly target: DeviceQaTarget;
  readonly name: string;
  readonly version: string;
  /** Host label for devices on another device host; null on the environment host. */
  readonly hostLabel: string | null;
  readonly physical: boolean;
  /** A booted simulator or running emulator on the environment host: flows, recordings, installs. */
  readonly local: boolean;
}

/**
 * The devices the panel can work with: the host's booted simulators and emulators, plus every
 * booted device the Device panel's hub reports (physical devices and other hosts take
 * screenshots only).
 */
export function deviceOptions(
  localDevices: ReadonlyArray<DeviceQaLocalDevice>,
  hub: Pick<DeviceServiceState, "devices" | "hosts">,
): ReadonlyArray<DeviceQaOption> {
  const options = new Map<string, DeviceQaOption>();
  for (const device of localDevices) {
    const key = deviceQaTargetKey(device.target);
    options.set(key, {
      key,
      target: device.target,
      name: device.name,
      version: device.version,
      hostLabel: null,
      physical: false,
      local: true,
    });
  }
  for (const device of hub.devices) {
    if (!device.booted) continue;
    const target = { hostId: device.hostId, deviceId: device.id, platform: device.platform };
    const key = deviceQaTargetKey(target);
    if (options.has(key)) continue;
    options.set(key, {
      key,
      target,
      name: device.name,
      version: device.version,
      hostLabel:
        device.hostId === "local"
          ? null
          : (hub.hosts.find((host) => host.id === device.hostId)?.label ?? device.hostId),
      physical: device.physical,
      local: false,
    });
  }
  return [...options.values()];
}

/** The chosen device if it is still listed, else the one the thread watches, else the first local one. */
export function pickDevice(
  options: ReadonlyArray<DeviceQaOption>,
  chosen: DeviceQaTarget | null,
  watched: ReadonlyArray<Pick<DeviceQaTarget, "hostId" | "deviceId">>,
): DeviceQaOption | null {
  const byKey = (key: string) => options.find((option) => option.key === key);
  return (
    (chosen && byKey(deviceQaTargetKey(chosen))) ||
    watched.map((target) => byKey(deviceQaTargetKey(target))).find(Boolean) ||
    options.find((option) => option.local) ||
    options[0] ||
    null
  );
}
