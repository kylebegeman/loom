import type { AppleDestination, AppleToolchain } from "@t3tools/contracts/fork";

/** Parsers for `simctl list ... -j` and `devicectl list devices --json-output -`. */

type Simulator = Extract<AppleDestination, { _tag: "simulator" }>;
type Device = Extract<AppleDestination, { _tag: "device" }>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const at = (value: unknown, ...path: ReadonlyArray<string>): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** `com.apple.CoreSimulator.SimRuntime.iOS-27-0` gives `iOS 27.0`. */
export const runtimeDisplayName = (identifier: string) => {
  const match = /SimRuntime\.([A-Za-z]+)-([\d-]+)$/.exec(identifier);
  return match ? `${match[1]} ${match[2]!.replace(/-/g, ".")}` : identifier;
};

export const parseRuntimes = (stdout: string): AppleToolchain["runtimes"] => {
  const runtimes = at(parseJson(stdout), "runtimes");
  if (!Array.isArray(runtimes)) return [];
  return runtimes.flatMap((runtime) => {
    const identifier = text(at(runtime, "identifier"));
    if (identifier === undefined || at(runtime, "isAvailable") === false) return [];
    return [
      {
        identifier,
        platform: text(at(runtime, "platform")) ?? runtimeDisplayName(identifier).split(" ")[0]!,
        version: text(at(runtime, "version")) ?? "",
      },
    ];
  });
};

/** Platform A to Z, then newest version first. */
const compareRuntimes = (left: string, right: string) => {
  const [leftPlatform = "", leftVersion = ""] = left.split(" ");
  const [rightPlatform = "", rightVersion = ""] = right.split(" ");
  return (
    leftPlatform.localeCompare(rightPlatform) ||
    rightVersion.localeCompare(leftVersion, undefined, { numeric: true })
  );
};

/** Available simulators: booted first, then by runtime and name. */
export const parseSimulators = (stdout: string): Array<Simulator> => {
  const devices = at(parseJson(stdout), "devices");
  if (!isRecord(devices)) return [];
  const simulators = Object.entries(devices).flatMap(([runtimeId, list]) =>
    (Array.isArray(list) ? list : []).flatMap((device): Array<Simulator> => {
      const udid = text(at(device, "udid"));
      const name = text(at(device, "name"));
      if (udid === undefined || name === undefined || at(device, "isAvailable") === false)
        return [];
      return [
        {
          _tag: "simulator",
          udid,
          name,
          runtime: runtimeDisplayName(runtimeId),
          booted: at(device, "state") === "Booted",
        },
      ];
    }),
  );
  return simulators.sort(
    (left, right) =>
      Number(right.booted) - Number(left.booted) ||
      compareRuntimes(left.runtime, right.runtime) ||
      left.name.localeCompare(right.name),
  );
};

/** `properties.state.developerModeStatus` is `{ enabled: {...} }`; the deprecated form a string. */
const developerMode = (value: unknown): boolean | null => {
  const status = typeof value === "string" ? value : isRecord(value) ? Object.keys(value)[0] : null;
  if (status === "enabled") return true;
  if (status === "disabled") return false;
  return null;
};

/**
 * Physical devices only: on Xcode 27 devicectl lists simulators too. Reads the `properties`
 * dictionary, falling back to the deprecated dictionaries when it is absent.
 */
export const parseDevicectlDevices = (stdout: string): Array<Device> => {
  const devices = at(parseJson(stdout), "result", "devices");
  if (!Array.isArray(devices)) return [];
  return devices.flatMap((device): Array<Device> => {
    const properties = at(device, "properties");
    const modern = isRecord(properties);
    const hardware = modern ? at(properties, "hardware") : at(device, "hardwareProperties");
    if (at(hardware, "reality") !== "physical") return [];
    const connection = modern ? at(properties, "connection") : at(device, "connectionProperties");
    const deprecated = at(device, "deviceProperties");
    // `--device` and `-destination id=` both take the hardware UDID.
    const identifier = text(at(hardware, "udid")) ?? text(at(device, "identifier"));
    if (identifier === undefined) return [];
    const name =
      (modern ? text(at(properties, "state", "name")) : text(at(deprecated, "name"))) ??
      text(at(hardware, "marketingName")) ??
      identifier;
    return [
      {
        _tag: "device",
        identifier,
        name,
        platform: text(at(hardware, "platform")) ?? "iOS",
        osVersion:
          (modern
            ? text(at(properties, "software", "osVersionNumber", "stringValue"))
            : text(at(deprecated, "osVersionNumber"))) ?? "",
        paired: at(connection, "pairingState") === "paired",
        developerModeEnabled: developerMode(
          modern
            ? at(properties, "state", "developerModeStatus")
            : at(deprecated, "developerModeStatus"),
        ),
        connection: modern
          ? (text(at(connection, "state")) ?? null)
          : (text(at(connection, "tunnelState")) ?? null),
      },
    ];
  });
};

/** A device a run can target: paired, and Developer Mode not reported off. */
export const isSelectableDevice = (device: Device) =>
  device.paired && device.developerModeEnabled !== false;
