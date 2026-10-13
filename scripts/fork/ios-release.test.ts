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
  withIosReleaseLock,
  nextBuildNumber,
  parseIosReleaseArgs,
  parseReceipt,
  releaseSettings,
  uploadedBuilds,
  validateArtifactInfo,
  validateIosReleaseConfig,
  validateSigningEntitlements,
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
