// @effect-diagnostics nodeBuiltinImport:off - Release policy tests inspect standalone publisher inputs without accessing Apple or native tools.
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodeProcess from "node:process";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { parseLoomConnectConfig } from "./connect-config.ts";

import {
  compareBuildNumbers,
  iosBuildEnvironment,
  manualSigningManifest,
  applyManualArchiveSigningSettings,
  withIosReleaseLock,
  nextBuildNumber,
  parseIosReleaseArgs,
  parseReceipt,
  releaseSettings,
  uploadedBuilds,
  validateArtifactInfo,
  validateIosReleaseConfig,
  validateSigningEntitlements,
  confirmedUploadedBuild,
  pruneCompletedIosBuilds,
  resetArchiveSigningState,
  publish,
  missingTestFlightGroups,
} from "./ios-release.ts";

const { spawnSync } = vi.hoisted(() => ({
  spawnSync: vi.fn<(command: string, args: string[]) => { status: number; stdout: string }>(),
}));
vi.mock("node:child_process", () => ({ spawnSync }));

const TEAM = "LOOMTEST01";
const APP = "1234567890";
const SHA = "a".repeat(40);
const CERTIFICATE_SHA1 = "0123456789ABCDEF0123456789ABCDEF01234567";
const config = {
  name: "Loom",
  scheme: "loom",
  version: "2.0.0",
  ios: { bundleIdentifier: "com.kylebegeman.loom", appleTeamId: TEAM, buildNumber: "1" },
  updates: { enabled: false },
  extra: { appVariant: "production" },
};
const receipt = {
  schemaVersion: 1,
  sourceRoot: NodePath.resolve("source"),
  sourceSha: SHA,
  teamId: TEAM,
  appId: APP,
  version: "2.0.0",
  buildNumber: "1",
  groups: ["Internal"],
  preparedAt: "2026-10-13T00:00:00Z",
};

describe("Loom iOS release boundaries", () => {
  it("requires a private absolute output directory and exact source identity", () => {
    expect(
      parseIosReleaseArgs([
        "release",
        "--output-dir",
        NodePath.resolve("release"),
        "--source-sha",
        SHA,
      ]).sourceSha,
    ).toBe(SHA);
    expect(() => parseIosReleaseArgs(["prepare", "--output-dir", "relative"])).toThrow("absolute");
    expect(() =>
      parseIosReleaseArgs([
        "publish",
        "--output-dir",
        NodePath.resolve("release"),
        "--source-sha",
        "main",
      ]),
    ).toThrow("40-character");
    expect(() =>
      parseIosReleaseArgs([
        "publish",
        "--output-dir",
        NodePath.resolve("release"),
        "--output-dir",
        NodePath.resolve("other"),
      ]),
    ).toThrow("duplicate");
    expect(() =>
      parseIosReleaseArgs([
        "release",
        "--output-dir",
        NodePath.resolve("release"),
        "--notify",
        "true",
      ]),
    ).toThrow("Unexpected");
  });

  it("rejects upstream and incomplete signing/ASC configuration", () => {
    expect(
      releaseSettings({
        LOOM_IOS_TEAM_ID: TEAM,
        LOOM_IOS_ASC_APP_ID: APP,
        LOOM_IOS_TESTFLIGHT_GROUPS: "Internal, Internal,QA",
      }),
    ).toEqual({ teamId: TEAM, appId: APP, groups: ["Internal", "QA"] });
    expect(() =>
      releaseSettings({ LOOM_IOS_TEAM_ID: "ARK85ZXQ4Z", LOOM_IOS_ASC_APP_ID: APP }),
    ).toThrow("own");
    expect(() =>
      releaseSettings({ LOOM_IOS_TEAM_ID: TEAM, LOOM_IOS_ASC_APP_ID: "6787819824" }),
    ).toThrow("Loom");
    expect(() => releaseSettings({ LOOM_IOS_TEAM_ID: TEAM })).toThrow("App Store");
    expect(() =>
      releaseSettings({
        LOOM_IOS_TEAM_ID: TEAM,
        LOOM_IOS_ASC_APP_ID: APP,
        LOOM_IOS_TESTFLIGHT_GROUPS: "QA\nInjected",
      }),
    ).toThrow("control");
  });

  it("chooses monotonic Apple-compatible build numbers across versions and retries", () => {
    expect(compareBuildNumbers("10.1", "9.99.99")).toBeGreaterThan(0);
    expect(compareBuildNumbers("10.1", "10.1.0")).toBe(0);
    expect(nextBuildNumber(["999.99.99", "9"], undefined, Date.UTC(2026, 0, 1))).toBe("1000.0.0");
    expect(nextBuildNumber(["1000.0.0"], "1000.0.1")).toBe("1000.0.1");
    expect(() => nextBuildNumber(["1000"], "1000.0.0")).toThrow("newer");
    expect(() => nextBuildNumber(["9999.99.99"], undefined, Date.UTC(2026, 0, 1))).toThrow(
      "Build numbers",
    );
    expect(() => nextBuildNumber([], "20261013")).toThrow("Build numbers");
    expect(() => nextBuildNumber([], "1.100")).toThrow("Build numbers");
  });

  it("keeps host credentials private and strips inherited cloud/dev overrides", () => {
    expect(
      iosBuildEnvironment(
        {
          ASC_PRIVATE_KEY_PATH: "/private/key.p8",
          LOOM_IOS_TEAM_ID: TEAM,
          APP_VARIANT: "preview",
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "upstream",
          T3CODE_RELAY_URL: "https://upstream",
          LOOM_MOBILE_EXPO_PROJECT_ID: "upstream",
          ELECTRON_RUN_AS_NODE: "1",
          VITE_WS_URL: "ws://localhost",
          LOOM_IOS_RELEASE_BUILD: "0",
          T3_SHOWCASE_CAPTURE_BUILD: "1",
        },
        "42",
        SHA,
      ),
    ).toMatchObject({
      ASC_PRIVATE_KEY_PATH: "/private/key.p8",
      LOOM_IOS_TEAM_ID: TEAM,
      APP_VARIANT: "production",
      LOOM_IOS_RELEASE_BUILD: "1",
      LOOM_MOBILE_CONNECT_ENABLED: "0",
      LOOM_MOBILE_UPDATES_ENABLED: "0",
      LOOM_IOS_BUILD_NUMBER: "42",
      LOOM_IOS_SOURCE_SHA: SHA,
    });
    expect(
      iosBuildEnvironment({
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "upstream",
        LOOM_MOBILE_EXPO_PROJECT_ID: "upstream",
        VITE_WS_URL: "ws://localhost",
      }),
    ).not.toHaveProperty("VITE_WS_URL");
    expect(
      iosBuildEnvironment({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "upstream" }),
    ).not.toHaveProperty("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(iosBuildEnvironment({ T3_SHOWCASE_CAPTURE_BUILD: "1" })).not.toHaveProperty(
      "T3_SHOWCASE_CAPTURE_BUILD",
    );
  });

  it("preserves explicit public Connect configuration while stripping unrelated cloud secrets", () => {
    const env = {
      LOOM_MOBILE_CONNECT_ENABLED: "1",
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_live_YXV0aC5leGFtcGxlLnRlc3Qk",
      T3CODE_CLERK_JWT_TEMPLATE: "relay",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "public-oauth-id",
      T3CODE_RELAY_URL: "https://relay.example.test",
      LOOM_MOBILE_ACCOUNT_PORTAL_URL: "https://accounts.example.test",
      CLERK_SECRET_KEY: "private-must-not-cross",
      EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: "unqualified-upstream-native-app",
      LOOM_MOBILE_PUSH_ENABLED: "1",
      LOOM_MOBILE_APPLE_SIGN_IN_ENABLED: "1",
    };
    const built = iosBuildEnvironment(env, "42", SHA);
    expect(built).toMatchObject({
      LOOM_MOBILE_CONNECT_ENABLED: "1",
      T3CODE_CLERK_PUBLISHABLE_KEY: env.T3CODE_CLERK_PUBLISHABLE_KEY,
      T3CODE_CLERK_JWT_TEMPLATE: "relay",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "public-oauth-id",
      T3CODE_RELAY_URL: "https://relay.example.test",
      LOOM_MOBILE_ACCOUNT_PORTAL_URL: "https://accounts.example.test",
      LOOM_MOBILE_PUSH_ENABLED: "0",
      LOOM_MOBILE_APPLE_SIGN_IN_ENABLED: "0",
      LOOM_MOBILE_UPDATES_ENABLED: "0",
    });
    expect(built).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(built).not.toHaveProperty("EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID");
    expect(iosBuildEnvironment(env, "42", SHA, null)).not.toHaveProperty("T3CODE_RELAY_URL");
  });

  it("freezes public Connect identity in receipts and verifies Expo against that exact identity", () => {
    const connectConfig = parseLoomConnectConfig({
      enabled: true,
      mobileEnabled: true,
      clerkPublishableKey: "pk_live_YXV0aC5leGFtcGxlLnRlc3Qk",
      clerkJwtTemplate: "relay",
      clerkCliOAuthClientId: "public-oauth-id",
      relayUrl: "https://relay.example.test",
      accountPortalUrl: "https://accounts.example.test",
    })!;
    const prepared = parseReceipt({ ...receipt, connectConfig });
    expect(prepared.connectConfig).toEqual(connectConfig);
    expect(parseReceipt(receipt)).not.toHaveProperty("connectConfig");
    const connected = {
      ...config,
      extra: {
        appVariant: "production",
        clerk: {
          publishableKey: connectConfig.clerkPublishableKey,
          jwtTemplate: connectConfig.clerkJwtTemplate,
          accountPortalUrl: connectConfig.accountPortalUrl,
          nativeAuthDomain: null,
        },
        relay: { url: connectConfig.relayUrl },
      },
    };
    expect(() => validateIosReleaseConfig(connected, TEAM, "1", connectConfig)).not.toThrow();
    expect(() => validateIosReleaseConfig(connected, TEAM, "1")).toThrow("Connect configuration");
    expect(() =>
      parseReceipt({ ...receipt, connectConfig: { ...connectConfig, mobileEnabled: false } }),
    ).toThrow("enabled");
    const changedEnvironment = {
      LOOM_MOBILE_CONNECT_ENABLED: "1",
      T3CODE_RELAY_URL: "https://different.example.test",
    };
    expect(iosBuildEnvironment(changedEnvironment, "1", SHA, prepared.connectConfig)).toMatchObject(
      {
        T3CODE_RELAY_URL: connectConfig.relayUrl,
        T3CODE_CLERK_PUBLISHABLE_KEY: connectConfig.clerkPublishableKey,
      },
    );
  });

  it("only permits associated domains for the explicitly qualified native app", () => {
    const connectConfig = parseLoomConnectConfig({
      enabled: true,
      mobileEnabled: true,
      clerkPublishableKey: "pk_live_YXV0aC5leGFtcGxlLnRlc3Qk",
      clerkJwtTemplate: "relay",
      clerkCliOAuthClientId: "public-oauth-id",
      relayUrl: "https://relay.example.test",
      accountPortalUrl: "https://accounts.example.test",
      nativeAuthDomain: "auth.example.test",
    })!;
    const domains = ["applinks:auth.example.test", "webcredentials:auth.example.test"];
    const connected = {
      ...config,
      ios: { ...config.ios, associatedDomains: domains },
      extra: {
        appVariant: "production",
        clerk: {
          publishableKey: connectConfig.clerkPublishableKey,
          jwtTemplate: connectConfig.clerkJwtTemplate,
          accountPortalUrl: connectConfig.accountPortalUrl,
          nativeAuthDomain: connectConfig.nativeAuthDomain,
        },
        relay: { url: connectConfig.relayUrl },
      },
    };
    expect(() => validateIosReleaseConfig(connected, TEAM, "1", connectConfig)).not.toThrow();
    const entitlements = {
      "application-identifier": `${TEAM}.com.kylebegeman.loom`,
      "com.apple.developer.team-identifier": TEAM,
      "com.apple.security.application-groups": ["group.com.kylebegeman.loom"],
      "com.apple.developer.associated-domains": domains,
    };
    expect(() =>
      validateSigningEntitlements(
        entitlements,
        { ...receipt, connectConfig },
        "com.kylebegeman.loom",
      ),
    ).not.toThrow();
    const profile = { ...entitlements, "com.apple.developer.associated-domains": ["*"] };
    expect(() =>
      validateSigningEntitlements(
        profile,
        { ...receipt, connectConfig },
        "com.kylebegeman.loom",
        true,
      ),
    ).not.toThrow();
    expect(() =>
      validateSigningEntitlements(profile, { ...receipt, connectConfig }, "com.kylebegeman.loom"),
    ).toThrow("associated domains");
    expect(() =>
      validateSigningEntitlements(
        {
          ...entitlements,
          "com.apple.developer.associated-domains": ["applinks:wrong.example.test"],
        },
        { ...receipt, connectConfig },
        "com.kylebegeman.loom",
      ),
    ).toThrow("associated domains");
    expect(() =>
      validateSigningEntitlements(entitlements, receipt, "com.kylebegeman.loom"),
    ).toThrow("associated domains");
  });

  it("requires an isolated production bundle and prevents upstream OTA delivery", () => {
    expect(validateIosReleaseConfig(config, TEAM, "1")).toEqual({
      version: "2.0.0",
      bundleId: "com.kylebegeman.loom",
    });
    expect(() =>
      validateIosReleaseConfig(
        { ...config, ios: { ...config.ios, bundleIdentifier: "com.t3tools.t3code" } },
        TEAM,
      ),
    ).toThrow("production");
    expect(() =>
      validateIosReleaseConfig(
        { ...config, updates: { enabled: true, url: "https://u.expo.dev/upstream" } },
        TEAM,
      ),
    ).toThrow("disable OTA");
    expect(() =>
      validateIosReleaseConfig(
        { ...config, extra: { ...config.extra, eas: { projectId: "upstream" } } },
        TEAM,
      ),
    ).toThrow("cloud");
    expect(() => validateIosReleaseConfig({ ...config, owner: "pingdotgg" }, TEAM)).toThrow(
      "cloud",
    );
    expect(() => validateIosReleaseConfig(config, "WRONGTEAM1")).toThrow("selected");
    expect(() => validateIosReleaseConfig(config, TEAM, "2")).toThrow("build number");
  });

  it("rejects associated-domain capabilities from local release config, including empty declarations", () => {
    for (const domains of [[], ["applinks:auth.example.test"]]) {
      expect(() =>
        validateIosReleaseConfig(
          { ...config, ios: { ...config.ios, associatedDomains: domains } },
          TEAM,
        ),
      ).toThrow("associated domains");
      expect(() =>
        validateIosReleaseConfig(
          {
            ...config,
            ios: {
              ...config.ios,
              entitlements: { "com.apple.developer.associated-domains": domains },
            },
          },
          TEAM,
        ),
      ).toThrow("associated domains");
    }
  });

  it("checks the IPA's embedded source and all extension bundle versions", () => {
    const expected = { ...receipt };
    expect(() =>
      validateArtifactInfo(
        {
          CFBundleIdentifier: "com.kylebegeman.loom",
          CFBundleShortVersionString: "2.0.0",
          CFBundleVersion: "1",
          LoomSourceCommit: SHA,
        },
        expected,
        "com.kylebegeman.loom",
      ),
    ).not.toThrow();
    expect(() =>
      validateArtifactInfo(
        {
          CFBundleIdentifier: "com.kylebegeman.loom",
          CFBundleShortVersionString: "2.0.0",
          CFBundleVersion: "1",
          LoomSourceCommit: "b".repeat(40),
        },
        expected,
        "com.kylebegeman.loom",
      ),
    ).toThrow("source");
    expect(() =>
      validateArtifactInfo(
        {
          CFBundleIdentifier: "com.kylebegeman.loom.widgets",
          CFBundleShortVersionString: "2.0.0",
          CFBundleVersion: "2",
        },
        expected,
        "com.kylebegeman.loom.widgets",
      ),
    ).toThrow("version");
    expect(() =>
      validateArtifactInfo(
        {
          CFBundleIdentifier: "com.t3tools.t3code.sharing",
          CFBundleShortVersionString: "2.0.0",
          CFBundleVersion: "1",
        },
        expected,
        "com.t3tools.t3code.sharing",
      ),
    ).toThrow("identity");
  });

  it("rejects another team's or development signing entitlements", () => {
    const entitlements = {
      "application-identifier": `${TEAM}.com.kylebegeman.loom`,
      "com.apple.developer.team-identifier": TEAM,
      "get-task-allow": false,
      "com.apple.security.application-groups": ["group.com.kylebegeman.loom"],
    };
    expect(() =>
      validateSigningEntitlements(entitlements, receipt, "com.kylebegeman.loom"),
    ).not.toThrow();
    expect(() =>
      validateSigningEntitlements(
        { ...entitlements, "get-task-allow": true },
        receipt,
        "com.kylebegeman.loom",
      ),
    ).toThrow("identity");
    expect(() =>
      validateSigningEntitlements(
        { ...entitlements, "com.apple.security.application-groups": ["group.com.t3tools.t3code"] },
        receipt,
        "com.kylebegeman.loom",
      ),
    ).toThrow("app group");
    expect(() =>
      validateSigningEntitlements(
        { ...entitlements, "com.apple.security.application-groups": "bad" },
        receipt,
        "com.kylebegeman.loom",
      ),
    ).toThrow("app groups");
    for (const domains of [[], ["applinks:auth.example.test"]]) {
      expect(() =>
        validateSigningEntitlements(
          { ...entitlements, "com.apple.developer.associated-domains": domains },
          receipt,
          "com.kylebegeman.loom",
        ),
      ).toThrow("associated domains");
    }
    for (const bundleId of [
      "com.kylebegeman.loom",
      "com.kylebegeman.loom.sharing",
      "com.kylebegeman.loom.widgets",
    ]) {
      const target = { ...entitlements, "application-identifier": `${TEAM}.${bundleId}` };
      expect(() => validateSigningEntitlements(target, receipt, bundleId)).not.toThrow();
      expect(() =>
        validateSigningEntitlements(
          { ...target, "com.apple.security.application-groups": undefined },
          receipt,
          bundleId,
        ),
      ).toThrow("required app group");
      expect(() =>
        validateSigningEntitlements(
          { ...target, "com.apple.security.application-groups": [] },
          receipt,
          bundleId,
        ),
      ).toThrow("required app group");
    }
  });

  it("fails closed on malformed receipts and unrecognized Apple responses", () => {
    expect(parseReceipt(receipt)).toEqual(receipt);
    expect(() => parseReceipt({ ...receipt, artifactSha256: "modified" })).toThrow("digest");
    expect(() => parseReceipt({ ...receipt, sourceSha: "main" })).toThrow("source");
    expect(() => parseReceipt({ ...receipt, groups: [null] })).toThrow("groups");
    expect(
      uploadedBuilds({
        data: [{ id: "build-id", attributes: { version: "42", processingState: "VALID" } }],
      }),
    ).toEqual([{ id: "build-id", buildNumber: "42", processingState: "VALID" }]);
    expect(() => uploadedBuilds({ error: "permission denied" })).toThrow("data array");
    expect(() =>
      uploadedBuilds({
        data: [{ id: "build", attributes: { version: "nightly", processingState: "VALID" } }],
      }),
    ).toThrow("Build numbers");
  });
  it("pins every archive target to the explicit export certificate fingerprint", () => {
    const options = {
      method: "app-store-connect",
      destination: "export",
      signingStyle: "manual",
      teamID: TEAM,
      signingCertificate: CERTIFICATE_SHA1.toLowerCase(),
      provisioningProfiles: {
        "com.kylebegeman.loom": "Loom App Store",
        "com.kylebegeman.loom.sharing": "Loom Sharing App Store",
        "com.kylebegeman.loom.widgets": "Loom Widgets App Store",
      },
    };
    expect(
      manualSigningManifest(options, TEAM).targets.map(
        (target) => target.configurations[0]!.settings.CODE_SIGN_IDENTITY,
      ),
    ).toEqual(Array(3).fill(CERTIFICATE_SHA1));
    for (const signingCertificate of [
      undefined,
      null,
      "",
      "Apple Distribution",
      "Apple Distribution: Example (LOOMTEST01)",
      "a".repeat(39),
      "a".repeat(41),
      "g".repeat(40),
      123,
    ]) {
      expect(() => manualSigningManifest({ ...options, signingCertificate }, TEAM)).toThrow(
        "SHA-1",
      );
    }
  });

  it("maps every archive target to its own App Store profile and forbids direct upload exports", () => {
    const options = {
      method: "app-store-connect",
      destination: "export",
      signingStyle: "manual",
      teamID: TEAM,
      signingCertificate: CERTIFICATE_SHA1,
      provisioningProfiles: {
        "com.kylebegeman.loom": "Loom App Store",
        "com.kylebegeman.loom.sharing": "Loom Sharing App Store",
        "com.kylebegeman.loom.widgets": "Loom Widgets App Store",
      },
    };
    const manifest = manualSigningManifest(options, TEAM);
    expect(
      manifest.targets.map(
        (target) => target.configurations[0]!.settings.PROVISIONING_PROFILE_SPECIFIER,
      ),
    ).toEqual(["Loom App Store", "Loom Sharing App Store", "Loom Widgets App Store"]);
    expect(() => manualSigningManifest({ ...options, destination: "upload" }, TEAM)).toThrow(
      "export locally",
    );
    expect(() => manualSigningManifest({ ...options, teamID: "ARK85ZXQ4Z" }, TEAM)).toThrow(
      "selected team",
    );
    expect(() =>
      manualSigningManifest(
        { ...options, provisioningProfiles: { "com.kylebegeman.loom": "Loom App Store" } },
        TEAM,
      ),
    ).toThrow("explicitly map");
    expect(() =>
      manualSigningManifest(
        {
          ...options,
          provisioningProfiles: {
            ...options.provisioningProfiles,
            "com.t3tools.t3code": "upstream",
          },
        },
        TEAM,
      ),
    ).toThrow("explicitly map");
  });

  it("replaces generated SDK-qualified signing values only in the three archive target configurations", () => {
    const options = {
      method: "app-store-connect",
      destination: "export",
      signingStyle: "manual",
      teamID: TEAM,
      signingCertificate: CERTIFICATE_SHA1,
      provisioningProfiles: {
        "com.kylebegeman.loom": "Loom App Store",
        "com.kylebegeman.loom.sharing": "Loom Sharing App Store",
        "com.kylebegeman.loom.widgets": "Loom Widgets App Store",
      },
    };
    const target = (name: string, list: string) => ({ name, buildConfigurationList: list });
    const list = (release: string) => ({
      buildConfigurations: [{ value: "debug" }, { value: release }],
    });
    const configuration = (bundleId: string, settings: Record<string, string> = {}) => ({
      name: "Release",
      buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: bundleId, ...settings },
    });
    const objects = {
      PBXNativeTarget: {
        app: target("Loom", "appList"),
        sharing: target('"expo-sharing-extension"', "sharingList"),
        widget: target("ExpoWidgetsTarget", "widgetList"),
        other: target("Unrelated", "otherList"),
      },
      XCConfigurationList: {
        appList: list("appRelease"),
        sharingList: list("sharingRelease"),
        widgetList: list("widgetRelease"),
        otherList: list("otherRelease"),
      },
      XCBuildConfiguration: {
        debug: {
          name: "Debug",
          buildSettings: { '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': '"iPhone Developer"' },
        },
        projectRelease: {
          name: "Release",
          buildSettings: { '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': '"iPhone Developer"' },
        },
        appRelease: configuration("com.kylebegeman.loom", {
          CODE_SIGN_ENTITLEMENTS: "Loom/Loom.entitlements",
        }),
        sharingRelease: configuration("com.kylebegeman.loom.sharing", {
          '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': '"iPhone Developer"',
          '"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]"': '"Development profile"',
          '"PROVISIONING_PROFILE[sdk=iphoneos*]"': '"legacy-development-uuid"',
        }),
        widgetRelease: configuration("com.kylebegeman.loom.widgets"),
        otherRelease: configuration("com.example.unrelated", {
          CODE_SIGN_IDENTITY: '"iPhone Developer"',
        }),
      },
    };
    const untouched = structuredClone({
      debug: objects.XCBuildConfiguration.debug,
      project: objects.XCBuildConfiguration.projectRelease,
      other: objects.XCBuildConfiguration.otherRelease,
    });
    const hash = { project: { objects } };
    const manifest = manualSigningManifest(options, TEAM);
    applyManualArchiveSigningSettings(hash, manifest);
    for (const settings of [
      objects.XCBuildConfiguration.appRelease.buildSettings,
      objects.XCBuildConfiguration.sharingRelease.buildSettings,
      objects.XCBuildConfiguration.widgetRelease.buildSettings,
    ]) {
      expect(settings).toMatchObject({
        CODE_SIGN_IDENTITY: JSON.stringify(CERTIFICATE_SHA1),
        CODE_SIGN_STYLE: '"Manual"',
        DEVELOPMENT_TEAM: JSON.stringify(TEAM),
      });
    }
    expect(objects.XCBuildConfiguration.sharingRelease.buildSettings).toMatchObject({
      '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': JSON.stringify(CERTIFICATE_SHA1),
      '"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]"': '"Loom Sharing App Store"',
      PROVISIONING_PROFILE_SPECIFIER: '"Loom Sharing App Store"',
    });
    expect(objects.XCBuildConfiguration.sharingRelease.buildSettings).not.toHaveProperty(
      '"PROVISIONING_PROFILE[sdk=iphoneos*]"',
    );
    expect(objects.XCBuildConfiguration.appRelease.buildSettings).toMatchObject({
      CODE_SIGN_ENTITLEMENTS: "Loom/Loom.entitlements",
    });
    expect({
      debug: objects.XCBuildConfiguration.debug,
      project: objects.XCBuildConfiguration.projectRelease,
      other: objects.XCBuildConfiguration.otherRelease,
    }).toEqual(untouched);
    const once = structuredClone(hash);
    applyManualArchiveSigningSettings(hash, manifest);
    expect(hash).toEqual(once);
    const invalid = structuredClone(once);
    invalid.project.objects.XCBuildConfiguration.widgetRelease.buildSettings.PRODUCT_BUNDLE_IDENTIFIER =
      "com.example.other";
    const beforeFailure = structuredClone(invalid);
    expect(() => applyManualArchiveSigningSettings(invalid, manifest)).toThrow(
      "Unexpected generated bundle ID",
    );
    expect(invalid).toEqual(beforeFailure);
  });

  it("reuses only a recorded valid Apple build after its local IPA is pruned", () => {
    const published = { ...receipt, artifactSha256: "b".repeat(64), buildId: "confirmed" };
    const builds = [{ id: "confirmed", buildNumber: "1", processingState: "VALID" }];
    expect(confirmedUploadedBuild(published, builds)).toEqual(builds[0]);
    expect(() =>
      confirmedUploadedBuild(
        { buildNumber: published.buildNumber, artifactSha256: published.artifactSha256 },
        builds,
      ),
    ).toThrow("confirmed upload receipt");
    expect(() =>
      confirmedUploadedBuild(
        { buildNumber: published.buildNumber, buildId: published.buildId },
        builds,
      ),
    ).toThrow("confirmed upload receipt");
    expect(() =>
      confirmedUploadedBuild(published, [{ ...builds[0]!, id: "someone-else" }]),
    ).toThrow("recorded Apple build");
    expect(() => confirmedUploadedBuild(published, [{ ...builds[0]!, buildNumber: "2" }])).toThrow(
      "recorded Apple build",
    );
    expect(() =>
      confirmedUploadedBuild(published, [{ ...builds[0]!, processingState: "INVALID" }]),
    ).toThrow("valid");
  });

  it("matches assigned group IDs and names and retains only missing requested groups", () => {
    const membership = {
      appId: APP,
      buildId: "confirmed",
      complete: true,
      groupCount: 2,
      groups: [
        { id: "internal-id", name: "Internal", membership: "explicit-and-all-builds" },
        { id: "external-id", name: "External", membership: "explicit" },
      ],
    };
    const expected = { appId: APP, buildId: "confirmed" };
    expect(missingTestFlightGroups(membership, expected, ["Internal", "external-id"])).toEqual([]);
    expect(
      missingTestFlightGroups(membership, expected, ["Internal", "New", "new-id", "New"]),
    ).toEqual(["New", "new-id"]);
    expect(
      missingTestFlightGroups({ ...membership, groupCount: 0, groups: [] }, expected, ["Internal"]),
    ).toEqual(["Internal"]);
    expect(missingTestFlightGroups(membership, expected, [])).toEqual([]);
  });

  it.each([
    ["wrong app", { appId: "9876543210" }],
    ["wrong build", { buildId: "someone-else" }],
    ["partial lookup", { complete: false }],
    ["missing completion", { complete: undefined }],
    ["nonboolean completion", { complete: "true" }],
    ["missing groups", { groups: undefined }],
    ["object groups", { groups: {} }],
    ["inconsistent count", { groupCount: 2 }],
    ["missing count", { groupCount: undefined }],
    ["invalid group", { groups: [null] }],
    ["missing group ID", { groups: [{ name: "Internal" }] }],
    ["blank group name", { groups: [{ id: "internal-id", name: " " }] }],
    [
      "malformed irrelevant group",
      {
        groupCount: 2,
        groups: [{ id: "internal-id", name: "Internal" }, { id: "other-id" }],
      },
    ],
  ])("rejects %s membership before deciding distribution", (_label, overrides) => {
    expect(() =>
      missingTestFlightGroups(
        {
          appId: APP,
          buildId: "confirmed",
          complete: true,
          groupCount: 1,
          groups: [{ id: "internal-id", name: "Internal" }],
          ...overrides,
        },
        { appId: APP, buildId: "confirmed" },
        ["Internal"],
      ),
    ).toThrow();
  });

  it("bounds completed build artifacts and retains upload evidence and unconfirmed records", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-ios-retention-"));
    const create = async (
      name: string,
      buildNumber: string,
      confirmed = true,
      sourceRoot = receipt.sourceRoot,
    ) => {
      const output = NodePath.join(directory, name);
      await NodeFSP.mkdir(NodePath.join(output, "Loom.xcarchive"), { recursive: true });
      await NodeFSP.mkdir(NodePath.join(output, "DerivedData"));
      await NodeFSP.writeFile(NodePath.join(output, "Loom.ipa"), "owned artifact");
      const saved = {
        ...receipt,
        buildNumber,
        sourceRoot,
        artifactSha256: "b".repeat(64),
        ...(confirmed ? { buildId: name } : {}),
      };
      await NodeFSP.writeFile(
        NodePath.join(output, "loom-ios-release.json"),
        JSON.stringify(saved),
      );
      await NodeFSP.writeFile(NodePath.join(output, "testflight-result.json"), "{}");
      return { output, saved };
    };
    try {
      const old = await create("old", "1");
      await create("middle", "2");
      await create("recent", "3");
      const current = await create("current", "4");
      const unknown = await create("ambiguous", "5", false);
      const unrelated = await create("other-source", "1", true, NodePath.resolve("someone-else"));
      await pruneCompletedIosBuilds(current.output, current.saved);
      expect(await NodeFSP.readdir(old.output)).toEqual([
        "loom-ios-release.json",
        "testflight-result.json",
      ]);
      expect(
        JSON.parse(
          await NodeFSP.readFile(NodePath.join(old.output, "loom-ios-release.json"), "utf8"),
        ),
      ).toEqual(old.saved);
      expect(await NodeFSP.readdir(NodePath.join(directory, "recent"))).toContain("Loom.ipa");
      expect(await NodeFSP.readdir(current.output)).toContain("Loom.ipa");
      expect(await NodeFSP.readdir(unknown.output)).toContain("Loom.xcarchive");
      expect(await NodeFSP.readdir(unrelated.output)).toContain("Loom.ipa");
      await pruneCompletedIosBuilds(current.output, current.saved);
      expect(await NodeFSP.readdir(old.output)).toEqual([
        "loom-ios-release.json",
        "testflight-result.json",
      ]);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("resets stale archive signing receipts without deleting release evidence or other records", async () => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "loom-ios-signing-reset-"),
    );
    const output = NodePath.join(directory, "retry");
    const signingState = NodePath.join(output, "archive-signing");
    const other = NodePath.join(directory, "completed");
    const saved = JSON.stringify(receipt);
    try {
      await NodeFSP.mkdir(signingState, { recursive: true });
      await NodeFSP.mkdir(NodePath.join(other, "Loom.xcarchive"), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(output, "loom-ios-release.json"), saved);
      await NodeFSP.writeFile(NodePath.join(output, "notes.txt"), "retry evidence");
      await NodeFSP.writeFile(NodePath.join(signingState, "receipt.json"), "stale receipt");
      await NodeFSP.writeFile(NodePath.join(signingState, "plan.json"), "stale plan");
      await NodeFSP.writeFile(NodePath.join(other, "loom-ios-release.json"), saved);
      await NodeFSP.writeFile(
        NodePath.join(other, "Loom.xcarchive", "Info.plist"),
        "signed archive",
      );

      expect(await resetArchiveSigningState(output)).toBe(signingState);
      await expect(NodeFSP.lstat(signingState)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await NodeFSP.readFile(NodePath.join(output, "loom-ios-release.json"), "utf8")).toBe(
        saved,
      );
      expect(await NodeFSP.readFile(NodePath.join(output, "notes.txt"), "utf8")).toBe(
        "retry evidence",
      );
      expect(await NodeFSP.readFile(NodePath.join(other, "loom-ios-release.json"), "utf8")).toBe(
        saved,
      );
      expect(
        await NodeFSP.readFile(NodePath.join(other, "Loom.xcarchive", "Info.plist"), "utf8"),
      ).toBe("signed archive");
      expect(await resetArchiveSigningState(output)).toBe(signingState);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["record", "signing state"])(
    "rejects a symlinked %s during archive signing reset",
    async (kind) => {
      const directory = await NodeFSP.mkdtemp(
        NodePath.join(NodeOS.tmpdir(), "loom-ios-signing-link-"),
      );
      const output = NodePath.join(directory, "retry");
      const outside = NodePath.join(directory, "unrelated");
      try {
        await NodeFSP.mkdir(NodePath.join(outside, "archive-signing"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(outside, "loom-ios-release.json"), "release receipt");
        await NodeFSP.writeFile(
          NodePath.join(outside, "archive-signing", "receipt.json"),
          "keep signing receipt",
        );
        if (kind === "record") await NodeFSP.symlink(outside, output);
        else {
          await NodeFSP.mkdir(output);
          await NodeFSP.symlink(
            NodePath.join(outside, "archive-signing"),
            NodePath.join(output, "archive-signing"),
          );
        }
        await expect(resetArchiveSigningState(output)).rejects.toThrow(
          "owned path without symlinks",
        );
        expect(
          await NodeFSP.readFile(NodePath.join(outside, "loom-ios-release.json"), "utf8"),
        ).toBe("release receipt");
        expect(
          await NodeFSP.readFile(NodePath.join(outside, "archive-signing", "receipt.json"), "utf8"),
        ).toBe("keep signing receipt");
      } finally {
        await NodeFSP.rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("skips symlinked records, receipts and artifacts during retention", async () => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "loom-ios-retention-links-"),
    );
    const outside = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-ios-unrelated-"));
    try {
      await NodeFSP.writeFile(NodePath.join(outside, "keep"), "unrelated");
      const saved = { ...receipt, artifactSha256: "b".repeat(64), buildId: "old" };
      await NodeFSP.writeFile(
        NodePath.join(outside, "loom-ios-release.json"),
        JSON.stringify(saved),
      );
      await NodeFSP.symlink(outside, NodePath.join(directory, "linked-record"));
      for (const name of ["linked-receipt", "linked-artifact"]) {
        const output = NodePath.join(directory, name);
        await NodeFSP.mkdir(output);
        await NodeFSP.writeFile(NodePath.join(output, "Loom.ipa"), "retain");
        if (name === "linked-receipt") {
          await NodeFSP.symlink(
            NodePath.join(outside, "loom-ios-release.json"),
            NodePath.join(output, "loom-ios-release.json"),
          );
        } else {
          await NodeFSP.writeFile(
            NodePath.join(output, "loom-ios-release.json"),
            JSON.stringify(saved),
          );
          await NodeFSP.symlink(outside, NodePath.join(output, "Loom.xcarchive"));
        }
      }
      const current = NodePath.join(directory, "current");
      await NodeFSP.mkdir(current);
      const currentReceipt = { ...saved, buildNumber: "3", buildId: "current" };
      await NodeFSP.writeFile(
        NodePath.join(current, "loom-ios-release.json"),
        JSON.stringify(currentReceipt),
      );
      await pruneCompletedIosBuilds(current, currentReceipt, 1);
      expect(await NodeFSP.readFile(NodePath.join(outside, "keep"), "utf8")).toBe("unrelated");
      for (const name of ["linked-receipt", "linked-artifact"])
        expect(await NodeFSP.readFile(NodePath.join(directory, name, "Loom.ipa"), "utf8")).toBe(
          "retain",
        );
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
      await NodeFSP.rm(outside, { recursive: true, force: true });
    }
  });

  it("serializes different records for one app and releases its lock after failures", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-ios-lock-"));
    try {
      await withIosReleaseLock(NodePath.join(directory, "first"), APP, async () => {
        await expect(
          withIosReleaseLock(NodePath.join(directory, "second"), APP, async () => "unexpected"),
        ).rejects.toThrow("already running");
      });
      await expect(
        withIosReleaseLock(NodePath.join(directory, "first"), APP, async () => {
          throw new Error("simulated signing failure");
        }),
      ).rejects.toThrow("simulated");
      expect(
        await withIosReleaseLock(NodePath.join(directory, "second"), APP, async () => "recovered"),
      ).toBe("recovered");
      expect(await NodeFSP.readdir(directory)).toEqual([]);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("does not clear live or malformed publisher locks", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-ios-lock-owned-"));
    const lock = NodePath.join(directory, `.loom-ios-${APP}.lock`);
    try {
      await NodeFSP.mkdir(lock);
      await NodeFSP.writeFile(NodePath.join(lock, "pid"), String(NodeProcess.pid));
      await expect(
        withIosReleaseLock(NodePath.join(directory, "record"), APP, async () => "unexpected"),
      ).rejects.toThrow("already running");
      await NodeFSP.writeFile(NodePath.join(lock, "pid"), "bad");
      await expect(
        withIosReleaseLock(NodePath.join(directory, "record"), APP, async () => "unexpected"),
      ).rejects.toThrow("incomplete");
      expect(await NodeFSP.readFile(NodePath.join(lock, "pid"), "utf8")).toBe("bad");
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Loom TestFlight publication replay", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    spawnSync.mockReset();
  });

  const fixture = async (groups = ["Internal"]) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-ios-replay-"));
    const confirmed = parseReceipt({
      ...receipt,
      groups,
      artifactSha256: "b".repeat(64),
      buildId: "confirmed",
    });
    const membership = {
      buildId: confirmed.buildId,
      appId: APP,
      complete: true,
      groupCount: 1,
      groups: [{ id: "internal-id", name: "Internal" }],
    };
    const uploaded = [{ id: "confirmed", attributes: { version: "1", processingState: "VALID" } }];
    const calls: string[][] = [];
    vi.stubEnv("LOOM_IOS_TEAM_ID", TEAM);
    vi.stubEnv("LOOM_IOS_ASC_APP_ID", APP);
    spawnSync.mockImplementation((command, args) => {
      calls.push([command, ...args]);
      const ok = (result: unknown) => ({ status: 0, stdout: JSON.stringify(result) });
      if (command === "git" && args.join(" ") === "rev-parse HEAD")
        return { status: 0, stdout: SHA };
      if (command === "git" && args[0] === "status") return { status: 0, stdout: "" };
      if (command === NodePath.join(receipt.sourceRoot, "apps/mobile/node_modules/.bin/expo"))
        return ok(config);
      if (command === "asc" && args[0] === "apps" && args[1] === "view")
        return ok({ data: { id: APP, attributes: { bundleId: "com.kylebegeman.loom" } } });
      if (command === "asc" && args[0] === "builds" && args[1] === "list")
        return ok({ data: uploaded });
      if (command === "asc" && args.slice(0, 3).join(" ") === "testflight groups list")
        return ok(membership);
      if (command === "asc" && args.slice(0, 2).join(" ") === "publish testflight")
        return ok({ buildId: "confirmed" });
      throw new Error(`Unexpected mocked release command: ${command} ${args.join(" ")}`);
    });
    return { directory, confirmed, membership, uploaded, calls };
  };

  it("does not redistribute or reupload a confirmed valid build already in every requested group", async () => {
    const setup = await fixture(["Internal", "internal-id"]);
    try {
      expect(await publish(setup.directory, setup.confirmed)).toEqual(setup.confirmed);
      expect(setup.calls.filter((call) => call[1] === "publish")).toEqual([]);
      expect(setup.calls).toContainEqual([
        "asc",
        "testflight",
        "groups",
        "list",
        "--build-id",
        "confirmed",
        "--app",
        APP,
        "--output",
        "json",
      ]);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });

  it("distributes only missing requested group IDs and names", async () => {
    const setup = await fixture(["Internal", "internal-id", "External", "other-id"]);
    try {
      expect(await publish(setup.directory, setup.confirmed)).toEqual(setup.confirmed);
      const distribution = setup.calls.filter((call) => call[1] === "publish");
      expect(distribution).toHaveLength(1);
      expect(distribution[0]).toContain("--build-id");
      expect(distribution[0]).not.toContain("--ipa");
      expect(distribution[0]?.slice(-2)).toEqual(["--group", "External,other-id"]);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });

  it("stops before distribution if complete group membership cannot be established", async () => {
    const setup = await fixture();
    setup.membership.complete = false;
    try {
      await expect(publish(setup.directory, setup.confirmed)).rejects.toThrow("complete");
      expect(setup.calls.filter((call) => call[1] === "publish")).toEqual([]);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });
  it("distributes all groups when complete membership is empty and preserves the confirmed receipt", async () => {
    const setup = await fixture();
    setup.membership.groups = [];
    setup.membership.groupCount = 0;
    try {
      await publish(setup.directory, setup.confirmed);
      const distribution = setup.calls.filter((call) => call[1] === "publish");
      expect(distribution).toHaveLength(1);
      expect(distribution[0]?.slice(-2)).toEqual(["--group", "Internal"]);
      expect(
        JSON.parse(
          await NodeFSP.readFile(NodePath.join(setup.directory, "loom-ios-release.json"), "utf8"),
        ),
      ).toEqual(setup.confirmed);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });

  it("does not run an upload-only replay when no groups were requested", async () => {
    const setup = await fixture([]);
    try {
      expect(await publish(setup.directory, setup.confirmed)).toEqual(setup.confirmed);
      expect(setup.calls.filter((call) => call[1] === "publish")).toEqual([]);
      expect(
        setup.calls.filter((call) => call.slice(1, 4).join(" ") === "testflight groups list"),
      ).toEqual([]);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "unconfirmed receipt",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        delete setup.confirmed.buildId;
      },
    ],
    [
      "missing artifact digest",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        delete setup.confirmed.artifactSha256;
      },
    ],
    [
      "missing recorded build",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.uploaded.length = 0;
      },
    ],
    [
      "different recorded build",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.uploaded[0]!.id = "someone-else";
      },
    ],
    [
      "different build number",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.uploaded[0]!.attributes.version = "2";
      },
    ],
    [
      "invalid build",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.uploaded[0]!.attributes.processingState = "INVALID";
      },
    ],
    [
      "processing build without IPA",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.uploaded[0]!.attributes.processingState = "PROCESSING";
      },
    ],
    [
      "different source",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.confirmed.sourceSha = "c".repeat(40);
      },
    ],
    [
      "different account",
      (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.confirmed.appId = "9876543210";
      },
    ],
  ])("never distributes or uploads a %s", async (_label, invalidate) => {
    const setup = await fixture();
    invalidate(setup);
    try {
      await expect(publish(setup.directory, setup.confirmed)).rejects.toThrow();
      expect(setup.calls.filter((call) => call[1] === "publish")).toEqual([]);
      expect(
        setup.calls.filter((call) => call.slice(1, 4).join(" ") === "testflight groups list"),
      ).toEqual([]);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });

  it("still inspects a retained IPA before treating group membership as published", async () => {
    const setup = await fixture();
    try {
      await NodeFSP.writeFile(NodePath.join(setup.directory, "Loom.ipa"), "changed artifact");
      await expect(publish(setup.directory, setup.confirmed)).rejects.toThrow("digest changed");
      expect(setup.calls.filter((call) => call[1] === "publish")).toEqual([]);
      expect(
        setup.calls.filter((call) => call.slice(1, 4).join(" ") === "testflight groups list"),
      ).toEqual([]);
    } finally {
      await NodeFSP.rm(setup.directory, { recursive: true, force: true });
    }
  });
});
