// @effect-diagnostics nodeBuiltinImport:off - Release policy tests inspect standalone publisher inputs without accessing Apple or native tools.
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodeProcess from "node:process";

import { describe, expect, it } from "vite-plus/test";

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
} from "./ios-release.ts";

const TEAM = "LOOMTEST01";
const APP = "1234567890";
const SHA = "a".repeat(40);
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
  it("maps every archive target to its own App Store profile and forbids direct upload exports", () => {
    const options = {
      method: "app-store-connect",
      destination: "export",
      signingStyle: "manual",
      teamID: TEAM,
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
        CODE_SIGN_IDENTITY: '"Apple Distribution"',
        CODE_SIGN_STYLE: '"Manual"',
        DEVELOPMENT_TEAM: JSON.stringify(TEAM),
      });
    }
    expect(objects.XCBuildConfiguration.sharingRelease.buildSettings).toMatchObject({
      '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': '"Apple Distribution"',
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
