import { LOOM_IOS_PUSH_BUNDLE_IDS } from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  resolveLoomMobileIdentity,
  type MobileAppVariant,
} from "../../../../../scripts/fork/mobileIdentity.ts";
import { libraryPushBuild, libraryPushDeviceLabel } from "./libraryPushBuild";

vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("react-native", () => ({ Linking: {}, Platform: { OS: "ios" } }));

const TEAM_ID = "ABCDE12345";

function buildFor(variant: MobileAppVariant, env: Record<string, string> = {}) {
  const identity = resolveLoomMobileIdentity({
    APP_VARIANT: variant,
    LOOM_IOS_TEAM_ID: TEAM_ID,
    ...env,
  });
  return {
    identity,
    input: {
      platform: "ios",
      extra: {
        appVariant: identity.appVariant,
        iosPersonalTeamBuild: identity.personalTeam,
        loomLibraryPush: identity.libraryPushEnabled,
      },
      bundleId: identity.iosBundleIdentifier,
      version: "1.4.0",
    },
  };
}

describe("libraryPushBuild", () => {
  it("supports every Loom variant built with the flag, on a topic the Library allows", () => {
    const variants: ReadonlyArray<MobileAppVariant> = ["development", "preview", "production"];
    for (const variant of variants) {
      const { identity, input } = buildFor(variant, { LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1" });
      expect(LOOM_IOS_PUSH_BUNDLE_IDS).toContain(identity.iosBundleIdentifier);
      expect(libraryPushBuild(input)).toEqual({
        bundleId: identity.iosBundleIdentifier,
        apsEnvironment: variant === "development" ? "sandbox" : "production",
        appVersion: "1.4.0",
      });
    }
  });

  it("is unsupported without the release flag", () => {
    expect(libraryPushBuild(buildFor("production").input)).toBeNull();
  });

  it("is unsupported on Android even with the flag", () => {
    const { input } = buildFor("production", { LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1" });
    expect(libraryPushBuild({ ...input, platform: "android" })).toBeNull();
  });

  it("is unsupported on a personal team build", () => {
    const { input } = buildFor("production", { LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1" });
    expect(
      libraryPushBuild({ ...input, extra: { ...input.extra, iosPersonalTeamBuild: true } }),
    ).toBeNull();
    // The identity itself refuses the combination, so no such build can be made.
    expect(() =>
      resolveLoomMobileIdentity({
        T3CODE_IOS_PERSONAL_TEAM: "1",
        T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.loom",
        LOOM_IOS_TEAM_ID: TEAM_ID,
        LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1",
      }),
    ).toThrow("Loom Library push requires an eligible Apple team.");
  });

  it("is unsupported for a bundle the Library would refuse as a topic", () => {
    const { input } = buildFor("production", { LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1" });
    expect(libraryPushBuild({ ...input, bundleId: "com.example.loom" })).toBeNull();
  });

  it("omits an app version the Library would refuse", () => {
    const { input } = buildFor("production", { LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1" });
    expect(libraryPushBuild({ ...input, version: "1".repeat(65) })?.appVersion).toBeNull();
    expect(libraryPushBuild({ ...input, version: undefined })?.appVersion).toBeNull();
  });
});

describe("libraryPushDeviceLabel", () => {
  it("drops control characters, keeps emoji whole and fits the Library's limit", () => {
    expect(libraryPushDeviceLabel("Kyle's\niPhone\u0085")).toBe("Kyle'siPhone");
    const long = `${"a".repeat(79)}\u{1F4F1}tail`;
    expect(libraryPushDeviceLabel(long)).toBe(`${"a".repeat(79)}\u{1F4F1}`);
  });

  it("falls back when iOS gives no usable name", () => {
    expect(libraryPushDeviceLabel(undefined)).toBe("iPhone");
    expect(libraryPushDeviceLabel(" \u0007 ")).toBe("iPhone");
  });
});
