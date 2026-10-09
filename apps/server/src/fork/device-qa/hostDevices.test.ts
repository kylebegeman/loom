// @effect-diagnostics nodeBuiltinImport:off - Reads synthetic tool output.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";

import {
  adbRecordArgs,
  parseAaptPackage,
  parseAdbDevices,
  parseAvdDisplayName,
  parseDevicePid,
  parseEmulatorProps,
  parseSimctlBooted,
  pngInfo,
  simctlRecordArgs,
  statusBarClearArgs,
  statusBarOverrideArgs,
} from "./hostDevices.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "__fixtures__", name), "utf8");

describe("local device lists", () => {
  it("lists booted iOS simulators only", () => {
    expect(parseSimctlBooted(fixture("simctl-booted.json"))).toEqual([
      {
        target: {
          hostId: "local",
          deviceId: "00000000-0000-4000-8000-000000000001",
          platform: "ios",
        },
        name: "iPhone 17",
        version: "iOS 27.0",
      },
    ]);
    expect(parseSimctlBooted("not json")).toEqual([]);
  });

  it("lists running emulators only", () => {
    expect(parseAdbDevices(fixture("adb-devices.txt"))).toEqual([
      { serial: "emulator-5554", name: "sdk gphone64 arm64" },
    ]);
  });

  it("reads an emulator's release and AVD, either of which can be missing", () => {
    expect(parseEmulatorProps("16\nmedium_phone\n")).toEqual({
      release: "16",
      avd: "medium_phone",
    });
    expect(parseEmulatorProps("16\r\n\r\n")).toEqual({ release: "16", avd: null });
    expect(parseEmulatorProps("")).toEqual({ release: null, avd: null });
  });

  it("reads Android Studio's display name for an AVD", () => {
    const config =
      "AvdId=medium_phone\navd.ini.displayname=Medium Phone\ntag.displaynames=Google Play\n";
    expect(parseAvdDisplayName(config)).toBe("Medium Phone");
    expect(parseAvdDisplayName("AvdId=medium_phone\n")).toBeNull();
  });
});

describe("device commands", () => {
  it("overrides the status bar to the App Store look and clears it", () => {
    const args = statusBarOverrideArgs("SIM-1");
    expect(args.slice(0, 4)).toEqual(["simctl", "status_bar", "SIM-1", "override"]);
    expect(args.join(" ")).toContain("--time 9:41");
    expect(args.join(" ")).toContain("--batteryLevel 100");
    expect(statusBarClearArgs("SIM-1")).toEqual(["simctl", "status_bar", "SIM-1", "clear"]);
  });

  it("records with h264 on iOS and in the background on Android", () => {
    expect(simctlRecordArgs("SIM-1", "/e/x.mp4")).toEqual([
      "simctl",
      "io",
      "SIM-1",
      "recordVideo",
      "--codec=h264",
      "--force",
      "/e/x.mp4",
    ]);
    const android = adbRecordArgs("emulator-5554", "/sdcard/loom-1.mp4", 30);
    expect(android.slice(0, 3)).toEqual(["-s", "emulator-5554", "shell"]);
    expect(android[3]).toBe(
      "screenrecord --time-limit 30 /sdcard/loom-1.mp4 > /dev/null 2>&1 & echo $!",
    );
    expect(parseDevicePid("\n4321\n")).toBe(4321);
    expect(parseDevicePid("error")).toBeNull();
  });

  it("reads the package name from aapt", () => {
    expect(
      parseAaptPackage("package: name='com.example.app' versionCode='1' versionName='1.0'\n"),
    ).toBe("com.example.app");
    expect(parseAaptPackage("ERROR")).toBeNull();
  });
});

describe("pngInfo", () => {
  const png = (width: number, height: number) => {
    const bytes = new Uint8Array(24);
    bytes.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
  };

  it("reads dimensions and refuses other bytes", () => {
    expect(pngInfo(png(1206, 2622))).toEqual({ width: 1206, height: 2622 });
    expect(pngInfo(new TextEncoder().encode("definitely not a png file"))).toBeNull();
    expect(pngInfo(png(0, 10))).toBeNull();
  });
});
