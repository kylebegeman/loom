import { LOCAL_DEVICE_HOST_ID } from "@t3tools/contracts";
import type { DeviceQaLocalDevice } from "@t3tools/contracts/fork";
import { pngDimensions } from "../../mcp/toolkits/device/handlers.ts";

/** Screenshots above this are refused rather than stored. */
export const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height of a PNG, or null when the bytes are not one. */
export const pngInfo = (bytes: Uint8Array) => {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  const { width, height } = pngDimensions(bytes);
  return width > 0 && height > 0 ? { width, height } : null;
};

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `com.apple.CoreSimulator.SimRuntime.iOS-27-0` is `iOS 27.0`; null for other platforms. */
const iosRuntimeVersion = (runtime: string) => {
  const match = /SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/.exec(runtime);
  if (match === null) return null;
  return `iOS ${match.slice(1).filter(Boolean).join(".")}`;
};

/** Booted iOS simulators from `xcrun simctl list devices booted -j`. */
export const parseSimctlBooted = (json: string): ReadonlyArray<DeviceQaLocalDevice> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!isObject(parsed) || !isObject(parsed.devices)) return [];
  return Object.entries(parsed.devices).flatMap(([runtime, devices]) => {
    const version = iosRuntimeVersion(runtime);
    if (version === null || !Array.isArray(devices)) return [];
    return devices.flatMap((device) => {
      if (!isObject(device) || device.state !== "Booted") return [];
      if (typeof device.udid !== "string" || device.udid === "") return [];
      return [
        {
          target: {
            hostId: LOCAL_DEVICE_HOST_ID,
            deviceId: device.udid,
            platform: "ios" as const,
          },
          name: typeof device.name === "string" ? device.name : device.udid,
          version,
        },
      ];
    });
  });
};

/** Running emulators from `adb devices -l`. Physical phones are left to the device hub. */
export const parseAdbDevices = (text: string) =>
  text.split("\n").flatMap((line) => {
    const [serial, state, ...details] = line.trim().split(/\s+/);
    if (serial === undefined || !serial.startsWith("emulator-") || state !== "device") return [];
    const model = details.find((detail) => detail.startsWith("model:"))?.slice("model:".length);
    return [{ serial, name: model ? model.replaceAll("_", " ") : serial }];
  });

/** Prints an emulator's Android release, then its AVD id, one per line. */
export const EMULATOR_PROPS_COMMAND =
  "getprop ro.build.version.release; getprop ro.boot.qemu.avd_name";

/** Reads `EMULATOR_PROPS_COMMAND` output; a blank line is a missing value. */
export const parseEmulatorProps = (stdout: string) => {
  const [release = "", avd = ""] = stdout.split("\n").map((line) => line.trim());
  return { release: release || null, avd: avd || null };
};

/** Android Studio's name for an AVD: `avd.ini.displayname` in its `config.ini`. */
export const parseAvdDisplayName = (configIni: string) =>
  /^avd\.ini\.displayname\s*=\s*(.+)$/m.exec(configIni)?.[1]?.trim() || null;

export const simctlBootedArgs = ["simctl", "list", "devices", "booted", "-j"];

export const simctlScreenshotArgs = (udid: string, file: string) => [
  "simctl",
  "io",
  udid,
  "screenshot",
  "--type=png",
  file,
];

/** The App Store screenshot status bar: 9:41, full Wi-Fi and cellular, charged battery. */
export const statusBarOverrideArgs = (udid: string) => [
  "simctl",
  "status_bar",
  udid,
  "override",
  "--time",
  "9:41",
  "--dataNetwork",
  "wifi",
  "--wifiMode",
  "active",
  "--wifiBars",
  "3",
  "--cellularMode",
  "active",
  "--cellularBars",
  "4",
  "--batteryState",
  "charged",
  "--batteryLevel",
  "100",
];

export const statusBarClearArgs = (udid: string) => ["simctl", "status_bar", udid, "clear"];

/** simctl finalizes the file only when stopped with SIGINT. */
export const simctlRecordArgs = (udid: string, file: string) => [
  "simctl",
  "io",
  udid,
  "recordVideo",
  "--codec=h264",
  "--force",
  file,
];

export const androidRecordingPath = (evidenceId: string) => `/sdcard/loom-${evidenceId}.mp4`;

/**
 * Starts `screenrecord` in the background on the device and prints its pid, so the recording can
 * be stopped by that pid and never by name.
 */
export const adbRecordArgs = (serial: string, devicePath: string, seconds: number) => [
  "-s",
  serial,
  "shell",
  `screenrecord --time-limit ${seconds} ${devicePath} > /dev/null 2>&1 & echo $!`,
];

export const adbScreenshotArgs = (serial: string) => ["-s", serial, "exec-out", "screencap", "-p"];

/** `adb shell` prints the background job's pid alone on a line. */
export const parseDevicePid = (stdout: string) => {
  const pid = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^\d+$/.test(line));
  return pid === undefined ? null : Number(pid);
};

/** `aapt dump badging` starts with `package: name='com.example' versionCode=...`. */
export const parseAaptPackage = (stdout: string) =>
  /package: name='([^']+)'/.exec(stdout)?.[1] ?? null;
