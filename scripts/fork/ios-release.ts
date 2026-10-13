#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - Standalone local iOS publisher runs before an Effect runtime and keeps signing in the host keychain.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import Plist from "plist";

const BUNDLE_ID = "com.kylebegeman.loom";
const BUNDLE_IDS = [BUNDLE_ID, `${BUNDLE_ID}.sharing`, `${BUNDLE_ID}.widgets`] as const;
const ASSOCIATED_DOMAINS_ENTITLEMENT = "com.apple.developer.associated-domains";
const UPSTREAM_APP_ID = "6787819824";
const UPSTREAM_TEAM_ID = "ARK85ZXQ4Z";
const SOURCE_ROOT = NodePath.resolve(NodeURL.fileURLToPath(new URL("../..", import.meta.url)));
const RECEIPT_FILE = "loom-ios-release.json";
const COMPLETED_ARTIFACT_LIMIT = 2;
const BULKY_ARTIFACTS = [
  "Loom.ipa",
  "Loom.xcarchive",
  "Loom-pending.xcarchive",
  "DerivedData",
  "archive-signing",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;
type JsonRecord = Record<string, unknown>;

function record(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${context} is required.`);
  return value;
}

export function parseBuildNumber(value: string): readonly [number, number, number] {
  if (!/^[1-9]\d{0,3}(?:\.(?:0|[1-9]\d?)){0,2}$/.test(value)) {
    throw new Error(
      "Build numbers require one to three numeric components (major 1-9999, minor/patch 0-99).",
    );
  }
  const components = value.split(".").map(Number);
  return [components[0]!, components[1] ?? 0, components[2] ?? 0];
}

export function compareBuildNumbers(a: string, b: string): number {
  const left = parseBuildNumber(a);
  const right = parseBuildNumber(b);
  for (let index = 0; index < 3; index++) {
    const delta = left[index]! - right[index]!;
    if (delta) return delta;
  }
  return 0;
}

export function nextBuildNumber(
  previous: readonly string[],
  explicit?: string,
  now = Date.now(),
): string {
  // Minutes since 2020 fit Apple's four/two/two-digit version components until 2210.
  const minutes = Math.floor((now - Date.UTC(2020, 0, 1)) / 60_000);
  const encode = (value: number) =>
    `${Math.floor(value / 10_000)}.${Math.floor(value / 100) % 100}.${value % 100}`;
  const latest = previous.reduce<string | undefined>(
    (max, value) => (max === undefined || compareBuildNumbers(value, max) > 0 ? value : max),
    undefined,
  );
  if (explicit) {
    parseBuildNumber(explicit);
    if (latest && compareBuildNumbers(explicit, latest) <= 0) {
      throw new Error(`Build number must be newer than ${latest}.`);
    }
    return explicit;
  }
  let candidate = encode(minutes);
  if (latest && compareBuildNumbers(candidate, latest) <= 0) {
    const [major, minor, patch] = parseBuildNumber(latest);
    candidate = encode(major * 10_000 + minor * 100 + patch + 1);
  }
  parseBuildNumber(candidate);
  return candidate;
}

export function releaseSettings(env: Environment) {
  const teamId = env.LOOM_IOS_TEAM_ID?.trim();
  const appId = env.LOOM_IOS_ASC_APP_ID?.trim();
  if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId) || teamId === UPSTREAM_TEAM_ID) {
    throw new Error("LOOM_IOS_TEAM_ID must be your own 10-character Apple Developer team ID.");
  }
  if (!appId || !/^[1-9]\d{1,19}$/.test(appId) || appId === UPSTREAM_APP_ID) {
    throw new Error("LOOM_IOS_ASC_APP_ID must be the numeric App Store Connect ID for Loom.");
  }
  const groups = (env.LOOM_IOS_TESTFLIGHT_GROUPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    groups.some(
      (group) =>
        group.includes("\r") || group.includes("\n") || group.includes(String.fromCharCode(0)),
    )
  )
    throw new Error("TestFlight groups cannot contain control characters.");
  return { teamId, appId, groups: [...new Set(groups)] };
}

export function iosBuildEnvironment(
  env: Environment,
  buildNumber?: string,
  sourceSha?: string,
): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(result)) {
    if (
      key.startsWith("EXPO_PUBLIC_") ||
      key.startsWith("T3CODE_") ||
      key.startsWith("T3_SHOWCASE_") ||
      key.startsWith("VITE_") ||
      key.startsWith("LOOM_MOBILE_")
    )
      delete result[key];
  }
  return {
    ...result,
    APP_VARIANT: "production",
    LOOM_IOS_RELEASE_BUILD: "1",
    EXPO_NO_DOTENV: "1",
    EXPO_NO_GIT_STATUS: "1",
    CI: "1",
    LOOM_MOBILE_CONNECT_ENABLED: "0",
    LOOM_MOBILE_UPDATES_ENABLED: "0",
    LOOM_MOBILE_PUSH_ENABLED: "0",
    LOOM_MOBILE_APPLE_SIGN_IN_ENABLED: "0",
    T3CODE_IOS_PERSONAL_TEAM: "0",
    ...(buildNumber ? { LOOM_IOS_BUILD_NUMBER: buildNumber } : {}),
    ...(sourceSha ? { LOOM_IOS_SOURCE_SHA: sourceSha } : {}),
  };
}

export function validateIosReleaseConfig(input: unknown, teamId: string, buildNumber?: string) {
  const config = record(input, "Expo config");
  const ios = record(config.ios, "Expo iOS config");
  const updates = record(config.updates, "Expo updates config");
  const extra = record(config.extra, "Expo extra config");
  if (
    config.name !== "Loom" ||
    config.scheme !== "loom" ||
    ios.bundleIdentifier !== BUNDLE_ID ||
    ios.appleTeamId !== teamId
  ) {
    throw new Error(
      "Release config must use Loom's production name, scheme, bundle ID, and selected Apple team.",
    );
  }
  if (
    updates.enabled !== false ||
    updates.url !== undefined ||
    config.owner !== undefined ||
    record(extra.eas ?? {}, "Expo EAS config").projectId !== undefined
  ) {
    throw new Error(
      "Local TestFlight releases must disable OTA and omit cloud publishing identity.",
    );
  }
  if (
    ios.associatedDomains !== undefined ||
    Object.hasOwn(
      record(ios.entitlements ?? {}, "Expo iOS entitlements"),
      ASSOCIATED_DOMAINS_ENTITLEMENT,
    )
  ) {
    throw new Error(
      "Local TestFlight releases must omit associated domains while Connect is disabled.",
    );
  }
  if (extra.appVariant !== "production" || extra.iosPersonalTeamBuild === true)
    throw new Error("TestFlight requires a production Apple Developer build.");
  if (buildNumber && ios.buildNumber !== buildNumber)
    throw new Error("Expo build number differs from the prepared release.");
  const version = text(config.version, "App version");
  if (!/^[1-9]\d{0,3}\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/.test(version))
    throw new Error("App version must be three numeric components.");
  return { version, bundleId: BUNDLE_ID };
}

export function validateArtifactInfo(
  input: unknown,
  expected: { teamId: string; version: string; buildNumber: string; sourceSha?: string },
  bundleId: string,
) {
  const info = record(input, "Bundle Info.plist");
  if (
    !BUNDLE_IDS.includes(bundleId as (typeof BUNDLE_IDS)[number]) ||
    info.CFBundleIdentifier !== bundleId ||
    info.CFBundleShortVersionString !== expected.version ||
    info.CFBundleVersion !== expected.buildNumber
  ) {
    throw new Error(`Unexpected identity or version in ${bundleId}.`);
  }
  if (
    bundleId === BUNDLE_ID &&
    expected.sourceSha &&
    info.LoomSourceCommit !== expected.sourceSha
  ) {
    throw new Error("Packaged source does not match the prepared release.");
  }
}

export function validateSigningEntitlements(
  input: unknown,
  expected: { teamId: string },
  bundleId: string,
) {
  const entitlements = record(input, "Signing entitlements");
  if (
    entitlements["com.apple.developer.team-identifier"] !== expected.teamId ||
    entitlements["application-identifier"] !== `${expected.teamId}.${bundleId}` ||
    entitlements["get-task-allow"] === true
  ) {
    throw new Error(`Unexpected signing identity in ${bundleId}.`);
  }
  if (Object.hasOwn(entitlements, ASSOCIATED_DOMAINS_ENTITLEMENT))
    throw new Error(`Unexpected associated domains in ${bundleId}.`);
  const appGroups = entitlements["com.apple.security.application-groups"] ?? [];
  if (!Array.isArray(appGroups)) throw new Error("Invalid signing app groups.");
  if (!appGroups.includes(`group.${BUNDLE_ID}`))
    throw new Error(`Missing required app group in ${bundleId}.`);
  for (const group of appGroups) {
    if (group !== `group.${BUNDLE_ID}`) throw new Error(`Unexpected app group in ${bundleId}.`);
  }
}

export function manualSigningManifest(input: unknown, teamId: string) {
  const options = record(input, "Export options");
  if (
    options.method !== "app-store-connect" ||
    options.destination !== "export" ||
    options.signingStyle !== "manual" ||
    options.teamID !== teamId
  ) {
    throw new Error(
      "Export options must export locally with manual app-store-connect signing for the selected team.",
    );
  }
  const profiles = record(options.provisioningProfiles, "Export provisioning profiles");
  if (
    Object.keys(profiles).some(
      (bundle) => !BUNDLE_IDS.includes(bundle as (typeof BUNDLE_IDS)[number]),
    ) ||
    BUNDLE_IDS.some((bundle) => typeof profiles[bundle] !== "string" || !profiles[bundle])
  ) {
    throw new Error("Export options must explicitly map Loom app, sharing, and widget profiles.");
  }
  const targets = ["Loom", "expo-sharing-extension", "ExpoWidgetsTarget"];
  return {
    schemaVersion: 1,
    targets: BUNDLE_IDS.map((bundleId, index) => ({
      name: targets[index]!,
      configurations: [
        {
          name: "Release",
          settings: {
            CODE_SIGN_STYLE: "Manual",
            DEVELOPMENT_TEAM: teamId,
            CODE_SIGN_IDENTITY: "Apple Distribution",
            PROVISIONING_PROFILE_SPECIFIER: profiles[bundleId],
            PROVISIONING_PROFILE: null,
            PRODUCT_BUNDLE_IDENTIFIER: bundleId,
          },
        },
      ],
    })),
  };
}

function pbxValue(input: unknown, context: string) {
  const value = text(input, context);
  return value.startsWith('"') ? text(JSON.parse(value), context) : value;
}

export function applyManualArchiveSigningSettings(
  input: unknown,
  manifest: ReturnType<typeof manualSigningManifest>,
) {
  const objects = record(
    record(record(input, "Xcode project hash").project, "Xcode project").objects,
    "Xcode objects",
  );
  const targets = record(objects.PBXNativeTarget, "Xcode native targets");
  const lists = record(objects.XCConfigurationList, "Xcode configuration lists");
  const configurations = record(objects.XCBuildConfiguration, "Xcode build configurations");
  const patches: { settings: JsonRecord; desired: JsonRecord }[] = [];
  const selected = new Set<string>();
  for (const desiredTarget of manifest.targets) {
    const matches = Object.entries(targets).filter(([key, value]) => {
      if (key.endsWith("_comment")) return false;
      const target = record(value, "Xcode native target");
      return pbxValue(target.name, "Xcode target name") === desiredTarget.name;
    });
    if (matches.length !== 1)
      throw new Error(`Expected one archive target named ${desiredTarget.name}.`);
    const target = record(matches[0]![1], "Xcode archive target");
    const list = record(
      lists[text(target.buildConfigurationList, "Target configuration list")],
      "Target configuration list",
    );
    if (!Array.isArray(list.buildConfigurations))
      throw new Error("Target configuration references must be an array.");
    for (const desiredConfiguration of desiredTarget.configurations) {
      const matches = list.buildConfigurations
        .map((reference: unknown) => {
          const id = text(
            record(reference, "Build configuration reference").value,
            "Build configuration ID",
          );
          return { id, configuration: record(configurations[id], "Build configuration") };
        })
        .filter(
          ({ configuration }) =>
            pbxValue(configuration.name, "Configuration name") === desiredConfiguration.name,
        );
      if (matches.length !== 1)
        throw new Error(
          `Expected one ${desiredConfiguration.name} configuration in ${desiredTarget.name}.`,
        );
      const { id, configuration } = matches[0]!;
      if (selected.has(id))
        throw new Error("Archive targets cannot share a signing configuration.");
      selected.add(id);
      const settings = record(configuration.buildSettings, "Archive build settings");
      if (
        pbxValue(settings.PRODUCT_BUNDLE_IDENTIFIER, "Archive bundle ID") !==
        desiredConfiguration.settings.PRODUCT_BUNDLE_IDENTIFIER
      ) {
        throw new Error(`Unexpected generated bundle ID in ${desiredTarget.name}.`);
      }
      patches.push({ settings, desired: desiredConfiguration.settings });
    }
  }
  // Resolve every target before changing any configuration. SDK-qualified values can
  // override an unconditional identity, so update the matching signing keys too.
  for (const { settings, desired } of patches) {
    for (const [key, value] of Object.entries(desired)) {
      for (const existing of Object.keys(settings)) {
        if (pbxValue(existing, "Build setting key").split("[", 1)[0] !== key) continue;
        if (value === null) delete settings[existing];
        else settings[existing] = JSON.stringify(value);
      }
      if (value === null) delete settings[key];
      else settings[key] = JSON.stringify(value);
    }
  }
}

export async function applyGeneratedManualArchiveSigning(
  mobileRoot: string,
  projectFile: string,
  manifest: ReturnType<typeof manualSigningManifest>,
) {
  const requireMobile = NodeModule.createRequire(NodePath.join(mobileRoot, "package.json"));
  const plugins = record(requireMobile("expo/config-plugins"), "Expo config plugins");
  const utils = record(
    record(plugins.IOSConfig, "Expo iOS config").XcodeUtils,
    "Expo Xcode utilities",
  );
  if (typeof utils.getPbxproj !== "function")
    throw new Error("Expo cannot parse the generated Xcode project.");
  const project = record(utils.getPbxproj(mobileRoot), "Parsed Xcode project");
  if (
    NodePath.resolve(text(project.filepath, "Parsed project path")) !==
    NodePath.resolve(projectFile)
  ) {
    throw new Error("Expo selected a different generated Xcode project.");
  }
  applyManualArchiveSigningSettings(project.hash, manifest);
  if (typeof project.writeSync !== "function")
    throw new Error("Expo cannot serialize the generated Xcode project.");
  await NodeFSP.writeFile(projectFile, text(project.writeSync(), "Serialized Xcode project"));
}

export function uploadedBuilds(input: unknown) {
  const response = record(input, "App Store Connect builds");
  if (!Array.isArray(response.data))
    throw new Error("App Store Connect builds must contain a data array.");
  return response.data.map((item: unknown) => {
    const build = record(item, "Build");
    const attributes = record(build.attributes, "Build attributes");
    const buildNumber = text(attributes.version, "Uploaded build number");
    parseBuildNumber(buildNumber);
    return {
      id: text(build.id, "Build ID"),
      buildNumber,
      processingState: text(attributes.processingState, "Build processing state"),
    };
  });
}

export type IosReleaseReceipt = {
  schemaVersion: 1;
  sourceRoot: string;
  sourceSha: string;
  teamId: string;
  appId: string;
  version: string;
  buildNumber: string;
  groups: string[];
  preparedAt: string;
  artifactSha256?: string;
  buildId?: string;
};

export function parseReceipt(input: unknown): IosReleaseReceipt {
  const value = record(input, "iOS release receipt");
  const settings = releaseSettings({
    LOOM_IOS_TEAM_ID: text(value.teamId, "Team ID"),
    LOOM_IOS_ASC_APP_ID: text(value.appId, "App ID"),
  });
  const sourceRoot = text(value.sourceRoot, "Source root");
  const sourceSha = text(value.sourceSha, "Source SHA");
  if (
    value.schemaVersion !== 1 ||
    !NodePath.isAbsolute(sourceRoot) ||
    !/^[a-f0-9]{40}$/.test(sourceSha)
  )
    throw new Error("Invalid iOS release receipt source.");
  if (
    !Array.isArray(value.groups) ||
    value.groups.some(
      (group) =>
        typeof group !== "string" ||
        !group.trim() ||
        group.includes("\r") ||
        group.includes("\n") ||
        group.includes(",") ||
        group.includes(String.fromCharCode(0)),
    )
  )
    throw new Error("Invalid TestFlight groups in release receipt.");
  const buildNumber = text(value.buildNumber, "Build number");
  parseBuildNumber(buildNumber);
  const version = text(value.version, "App version");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid app version in release receipt.");
  const artifactSha256 = value.artifactSha256;
  if (
    artifactSha256 !== undefined &&
    (typeof artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifactSha256))
  )
    throw new Error("Invalid artifact digest in release receipt.");
  if (value.buildId !== undefined && (typeof value.buildId !== "string" || !value.buildId.trim()))
    throw new Error("Invalid uploaded build ID in release receipt.");
  return {
    schemaVersion: 1,
    sourceRoot,
    sourceSha,
    ...settings,
    version,
    buildNumber,
    groups: value.groups as string[],
    preparedAt: text(value.preparedAt, "Preparation time"),
    ...(artifactSha256 ? { artifactSha256 } : {}),
    ...(typeof value.buildId === "string" ? { buildId: value.buildId } : {}),
  };
}

/** A pruned local artifact may only reuse the exact upload already confirmed in its receipt. */
export function confirmedUploadedBuild(
  receipt: Pick<IosReleaseReceipt, "buildId" | "artifactSha256" | "buildNumber">,
  builds: ReturnType<typeof uploadedBuilds>,
) {
  if (!receipt.buildId || !receipt.artifactSha256)
    throw new Error("A confirmed upload receipt is required to reuse a pruned IPA.");
  const build = builds.find(
    (item) => item.id === receipt.buildId && item.buildNumber === receipt.buildNumber,
  );
  if (!build)
    throw new Error("The recorded Apple build was not found; do not recreate its upload.");
  if (build.processingState !== "VALID")
    throw new Error("The recorded Apple build is no longer valid; inspect it before proceeding.");
  return build;
}

async function ownedPath(filename: string) {
  let info;
  try {
    info = await NodeFSP.lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink() || (NodeProcess.getuid && info.uid !== NodeProcess.getuid()))
    throw new Error(`Build cleanup requires an owned path without symlinks: ${filename}`);
  return info;
}

async function removeOwnedArtifact(filename: string) {
  if (await ownedPath(filename)) await NodeFSP.rm(filename, { recursive: true, force: true });
}

/** Keep upload receipts, ambiguous uploads, and unrelated directories; prune only named owned artifacts. */
export async function pruneCompletedIosBuilds(
  outputDir: string,
  current: Pick<IosReleaseReceipt, "sourceRoot" | "teamId" | "appId">,
  limit = COMPLETED_ARTIFACT_LIMIT,
) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Keep at least one completed build.");
  const parent = NodePath.dirname(outputDir);
  await ownedPath(parent);
  const completed: { directory: string; receipt: IosReleaseReceipt }[] = [];
  for (const name of await NodeFSP.readdir(parent)) {
    const directory = NodePath.join(parent, name);
    try {
      if (!(await ownedPath(directory))?.isDirectory()) continue;
      if (!(await ownedPath(NodePath.join(directory, RECEIPT_FILE)))?.isFile()) continue;
      const receipt = await readReceipt(directory);
      if (
        !receipt.buildId ||
        !receipt.artifactSha256 ||
        receipt.sourceRoot !== current.sourceRoot ||
        receipt.teamId !== current.teamId ||
        receipt.appId !== current.appId
      )
        continue;
      // Check the whole record before deleting anything; a symlink leaves all its evidence intact.
      for (const artifact of BULKY_ARTIFACTS) await ownedPath(NodePath.join(directory, artifact));
      completed.push({ directory, receipt });
    } catch {
      // This directory is not an intact, owned release record and cannot be cleaned automatically.
    }
  }
  completed.sort((a, b) => compareBuildNumbers(b.receipt.buildNumber, a.receipt.buildNumber));
  const retained = new Set([outputDir]);
  for (const item of completed) {
    if (retained.size >= limit) break;
    retained.add(item.directory);
  }
  const removed: string[] = [];
  for (const item of completed) {
    if (retained.has(item.directory)) continue;
    for (const artifact of BULKY_ARTIFACTS) {
      const filename = NodePath.join(item.directory, artifact);
      if (await ownedPath(filename)) {
        await removeOwnedArtifact(filename);
        removed.push(filename);
      }
    }
  }
  return removed;
}

export function parseIosReleaseArgs(args: readonly string[]) {
  const [command, ...flags] = args;
  if (
    !command ||
    !["prepare", "build", "inspect", "publish", "release", "verify-config"].includes(command)
  )
    throw new Error(
      "Usage: node scripts/fork/ios-release.ts <prepare|build|inspect|publish|release|verify-config> --output-dir ABS [--source-sha SHA]",
    );
  const options = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (
      !flag ||
      !["--output-dir", "--source-sha"].includes(flag) ||
      !value ||
      value.startsWith("--") ||
      options.has(flag)
    )
      throw new Error("Unexpected, duplicate, or missing iOS release argument.");
    options.set(flag, value);
  }
  const outputDir = options.get("--output-dir");
  if (command !== "verify-config" && (!outputDir || !NodePath.isAbsolute(outputDir)))
    throw new Error("An absolute --output-dir outside the source checkout is required.");
  const sourceSha = options.get("--source-sha");
  if (sourceSha && !/^[a-f0-9]{40}$/.test(sourceSha))
    throw new Error("--source-sha requires the full 40-character commit SHA.");
  return { command, outputDir, sourceSha };
}

function run(
  command: string,
  args: string[],
  cwd = SOURCE_ROOT,
  env = NodeProcess.env,
  stream = false,
): string {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: stream ? "inherit" : "pipe",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args[0] ?? ""} failed (${result.status ?? result.signal}). Inspect the local command output; credentials are never included in error receipts.`,
    );
  return result.stdout?.trim() ?? "";
}

function json(command: string, args: string[], cwd = SOURCE_ROOT, env = NodeProcess.env): unknown {
  return JSON.parse(run(command, args, cwd, env));
}

function sourceIdentity(sourceRoot: string, expected?: string): string {
  const sha = run("git", ["rev-parse", "HEAD"], sourceRoot);
  if (!/^[a-f0-9]{40}$/.test(sha) || (expected && expected !== sha))
    throw new Error("Source checkout does not match the requested commit.");
  if (run("git", ["status", "--porcelain", "--untracked-files=normal"], sourceRoot))
    throw new Error("Commit source changes before preparing or publishing an iOS release.");
  return sha;
}

function configFor(sourceRoot: string, teamId: string, buildNumber?: string) {
  const env = iosBuildEnvironment({ ...NodeProcess.env, LOOM_IOS_TEAM_ID: teamId }, buildNumber);
  const config = json(
    NodePath.join(sourceRoot, "apps/mobile/node_modules/.bin/expo"),
    ["config", "--json", "--type", "public"],
    NodePath.join(sourceRoot, "apps/mobile"),
    env,
  );
  return validateIosReleaseConfig(config, teamId, buildNumber);
}

function buildList(appId: string) {
  return uploadedBuilds(
    json("asc", [
      "builds",
      "list",
      "--app",
      appId,
      "--platform",
      "IOS",
      "--paginate",
      "--output",
      "json",
    ]),
  );
}

function assertOwnApp(appId: string) {
  const response = record(
    json("asc", ["apps", "view", "--id", appId, "--output", "json"]),
    "App Store Connect app",
  );
  const data = record(response.data, "App Store Connect app data");
  if (data.id !== appId || record(data.attributes, "App attributes").bundleId !== BUNDLE_ID)
    throw new Error("App Store Connect app must own com.kylebegeman.loom.");
}

async function readReceipt(outputDir: string) {
  await ownedPath(NodePath.join(outputDir, RECEIPT_FILE));
  return parseReceipt(
    JSON.parse(await NodeFSP.readFile(NodePath.join(outputDir, RECEIPT_FILE), "utf8")),
  );
}

async function writeReceipt(outputDir: string, receipt: IosReleaseReceipt) {
  const temporary = NodePath.join(outputDir, `${RECEIPT_FILE}.tmp-${NodeProcess.pid}`);
  await NodeFSP.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await NodeFSP.rename(temporary, NodePath.join(outputDir, RECEIPT_FILE));
}

function assertReceiptContext(receipt: IosReleaseReceipt, requestedSha?: string) {
  const settings = releaseSettings(NodeProcess.env);
  if (
    settings.teamId !== receipt.teamId ||
    settings.appId !== receipt.appId ||
    (requestedSha && requestedSha !== receipt.sourceSha)
  )
    throw new Error("The selected signing account or source differs from the prepared release.");
  sourceIdentity(receipt.sourceRoot, receipt.sourceSha);
  const config = configFor(receipt.sourceRoot, receipt.teamId, receipt.buildNumber);
  if (config.version !== receipt.version)
    throw new Error("Prepared release app version no longer matches source.");
}

async function prepare(outputDir: string, sourceSha?: string): Promise<IosReleaseReceipt> {
  const sha = sourceIdentity(SOURCE_ROOT, sourceSha);
  const settings = releaseSettings(NodeProcess.env);
  assertOwnApp(settings.appId);
  if (NodeFS.existsSync(NodePath.join(outputDir, RECEIPT_FILE))) {
    const existing = await readReceipt(outputDir);
    assertReceiptContext(existing, sha);
    return existing;
  }
  const entries = await NodeFSP.readdir(outputDir);
  if (entries.length)
    throw new Error("Use an empty output directory or an existing Loom iOS release record.");
  const buildNumber = nextBuildNumber(
    buildList(settings.appId).map((build) => build.buildNumber),
    NodeProcess.env.LOOM_IOS_BUILD_NUMBER,
  );
  const { version } = configFor(SOURCE_ROOT, settings.teamId, buildNumber);
  const receipt: IosReleaseReceipt = {
    schemaVersion: 1,
    sourceRoot: SOURCE_ROOT,
    sourceSha: sha,
    ...settings,
    version,
    buildNumber,
    preparedAt: new Date().toISOString(),
  };
  await writeReceipt(outputDir, receipt);
  return receipt;
}

async function build(outputDir: string, receipt: IosReleaseReceipt) {
  assertReceiptContext(receipt);
  if (receipt.buildId && receipt.artifactSha256) {
    assertOwnApp(receipt.appId);
    confirmedUploadedBuild(receipt, buildList(receipt.appId));
    return;
  }
  if (await ownedPath(NodePath.join(outputDir, "Loom.ipa"))) return;
  const mobileRoot = NodePath.join(receipt.sourceRoot, "apps/mobile");
  const env = iosBuildEnvironment(NodeProcess.env, receipt.buildNumber, receipt.sourceSha);
  const exportOptions = NodeProcess.env.LOOM_IOS_EXPORT_OPTIONS?.trim();
  let signingManifest: ReturnType<typeof manualSigningManifest> | undefined;
  if (exportOptions) {
    if (!NodePath.isAbsolute(exportOptions))
      throw new Error("LOOM_IOS_EXPORT_OPTIONS must be an absolute path.");
    signingManifest = manualSigningManifest(
      json("plutil", ["-convert", "json", "-o", "-", exportOptions]),
      receipt.teamId,
    );
  }
  const archive = NodePath.join(outputDir, "Loom.xcarchive");
  const pendingArchive = NodePath.join(outputDir, "Loom-pending.xcarchive");
  const derivedData = NodePath.join(outputDir, "DerivedData");
  await ownedPath(pendingArchive);
  await ownedPath(derivedData);
  if (!(await ownedPath(archive))) {
    // A release gets fresh native sources; Expo's clean prebuild only replaces its generated ios directory.
    run(
      NodePath.join(mobileRoot, "node_modules/.bin/expo"),
      ["prebuild", "--clean", "--platform", "ios"],
      mobileRoot,
      env,
      true,
    );
    const workspaces = (await NodeFSP.readdir(NodePath.join(mobileRoot, "ios"))).filter((entry) =>
      entry.endsWith(".xcworkspace"),
    );
    if (workspaces.length !== 1) throw new Error("Expected one generated iOS workspace.");
    const workspace = NodePath.join(mobileRoot, "ios", workspaces[0]!);
    const schemes = record(
      json("xcodebuild", ["-list", "-json", "-workspace", workspace], mobileRoot, env),
      "Xcode workspace",
    );
    const names = record(schemes.workspace, "Xcode workspace schemes").schemes;
    if (!Array.isArray(names) || !names.includes("Loom"))
      throw new Error("Generated workspace does not contain the Loom scheme.");
    if (signingManifest) {
      const projects = (await NodeFSP.readdir(NodePath.join(mobileRoot, "ios"))).filter((entry) =>
        entry.endsWith(".xcodeproj"),
      );
      if (projects.length !== 1) throw new Error("Expected one generated iOS project.");
      const projectPath = NodePath.join(mobileRoot, "ios", projects[0]!);
      await applyGeneratedManualArchiveSigning(
        mobileRoot,
        NodePath.join(projectPath, "project.pbxproj"),
        signingManifest,
      );
      const settingsFile = NodePath.join(outputDir, "archive-signing-settings.json");
      const signingState = NodePath.join(outputDir, "archive-signing");
      await NodeFSP.writeFile(settingsFile, `${JSON.stringify(signingManifest, null, 2)}\n`, {
        mode: 0o600,
      });
      const plan = record(
        json(
          "asc",
          [
            "xcode",
            "signing",
            "plan",
            "--project",
            projectPath,
            "--settings-file",
            settingsFile,
            "--state-dir",
            signingState,
            "--overwrite",
            "--output",
            "json",
          ],
          mobileRoot,
          env,
        ),
        "Xcode signing plan",
      );
      if (plan.ready !== true)
        throw new Error(
          "Manual archive signing plan is blocked. Inspect archive-signing/plan.json.",
        );
      run(
        "asc",
        [
          "xcode",
          "signing",
          "apply",
          "--plan",
          NodePath.join(signingState, "plan.json"),
          "--confirm",
          "--output",
          "json",
        ],
        mobileRoot,
        env,
        true,
      );
    }
    const args = [
      "xcode",
      "archive",
      "--workspace",
      workspace,
      "--scheme",
      "Loom",
      "--configuration",
      "Release",
      "--archive-path",
      pendingArchive,
      "--xcodebuild-flag=-destination",
      "--xcodebuild-flag=generic/platform=iOS",
      "--xcodebuild-flag=-derivedDataPath",
      `--xcodebuild-flag=${derivedData}`,
      `--xcodebuild-flag=DEVELOPMENT_TEAM=${receipt.teamId}`,
      `--xcodebuild-flag=CURRENT_PROJECT_VERSION=${receipt.buildNumber}`,
      `--xcodebuild-flag=MARKETING_VERSION=${receipt.version}`,
      "--output",
      "json",
    ];
    // An interrupted archive may leave a partial directory; only this record owns it.
    await removeOwnedArtifact(pendingArchive);
    try {
      run("asc", args, mobileRoot, env, true);
      await NodeFSP.rename(pendingArchive, archive);
    } catch (error) {
      await removeOwnedArtifact(pendingArchive);
      throw error;
    } finally {
      await removeOwnedArtifact(derivedData);
    }
  }
  const args = [
    "xcode",
    "export",
    "--archive-path",
    archive,
    "--ipa-path",
    NodePath.join(outputDir, "Loom.ipa"),
    "--output",
    "json",
  ];
  if (exportOptions) args.push("--export-options", exportOptions);
  else
    args.push(
      "--method",
      "app-store-connect",
      "--signing-style",
      "manual",
      "--team-id",
      receipt.teamId,
    );
  run("asc", args, mobileRoot, env, true);
}

async function sha256(filename: string) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function inspect(outputDir: string, receipt: IosReleaseReceipt) {
  assertReceiptContext(receipt);
  const ipa = NodePath.join(outputDir, "Loom.ipa");
  if (!(await ownedPath(ipa))?.isFile()) throw new Error("The signed IPA is missing.");
  const digest = await sha256(ipa);
  if (receipt.artifactSha256 && receipt.artifactSha256 !== digest)
    throw new Error("Prepared IPA digest changed; do not publish it.");
  const temporary = await NodeFSP.mkdtemp(NodePath.join(outputDir, "inspect-"));
  try {
    run("ditto", ["-x", "-k", ipa, temporary]);
    const payload = NodePath.join(temporary, "Payload");
    const apps = (await NodeFSP.readdir(payload)).filter((entry) => entry.endsWith(".app"));
    if (apps.length !== 1) throw new Error("IPA must contain one app.");
    const app = NodePath.join(payload, apps[0]!);
    run("codesign", ["--verify", "--deep", "--strict", app]);
    const plugins = NodePath.join(app, "PlugIns");
    const extensions = (await NodeFSP.readdir(plugins)).filter((entry) => entry.endsWith(".appex"));
    if (extensions.length !== 2)
      throw new Error("IPA must preserve the Loom share and widget extensions.");
    const found = new Set<string>();
    for (const bundle of [app, ...extensions.map((entry) => NodePath.join(plugins, entry))]) {
      const info = record(
        json("plutil", ["-convert", "json", "-o", "-", NodePath.join(bundle, "Info.plist")]),
        "Bundle Info.plist",
      );
      const bundleId = text(info.CFBundleIdentifier, "Bundle ID");
      if (found.has(bundleId)) throw new Error("Duplicate bundle identity in IPA.");
      found.add(bundleId);
      validateArtifactInfo(info, receipt, bundleId);
      const entitlementsFile = NodePath.join(temporary, `${found.size}-entitlements.plist`);
      const signed = NodeChildProcess.spawnSync(
        "codesign",
        ["-d", "--entitlements", ":-", bundle],
        { encoding: "utf8" },
      );
      if (signed.status !== 0 || !signed.stdout.trim())
        throw new Error("Cannot inspect signed IPA entitlements.");
      await NodeFSP.writeFile(entitlementsFile, signed.stdout, { mode: 0o600 });
      validateSigningEntitlements(
        json("plutil", ["-convert", "json", "-o", "-", entitlementsFile]),
        receipt,
        bundleId,
      );
      const profile = run("security", [
        "cms",
        "-D",
        "-i",
        NodePath.join(bundle, "embedded.mobileprovision"),
      ]);
      const profileInfo = record(Plist.parse(profile), "Provisioning profile");
      if (profileInfo.ProvisionedDevices !== undefined || profileInfo.ProvisionsAllDevices === true)
        throw new Error("TestFlight requires App Store distribution provisioning profiles.");
      validateSigningEntitlements(profileInfo.Entitlements, receipt, bundleId);
      if (
        !Array.isArray(profileInfo.TeamIdentifier) ||
        !profileInfo.TeamIdentifier.includes(receipt.teamId)
      )
        throw new Error("Provisioning profile belongs to another team.");
      const expiration =
        profileInfo.ExpirationDate instanceof Date ? profileInfo.ExpirationDate.getTime() : NaN;
      if (!Number.isFinite(expiration) || expiration <= Date.now())
        throw new Error("Provisioning profile is expired or lacks expiration.");
    }
    if (BUNDLE_IDS.some((bundle) => !found.has(bundle)))
      throw new Error("IPA is missing a required extension.");
    const next = { ...receipt, artifactSha256: digest };
    await writeReceipt(outputDir, next);
    return next;
  } finally {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
  }
}

async function publish(outputDir: string, receipt: IosReleaseReceipt) {
  if (!receipt.artifactSha256) throw new Error("Inspect the signed IPA before publishing.");
  assertReceiptContext(receipt);
  const ipaExists = Boolean(await ownedPath(NodePath.join(outputDir, "Loom.ipa")));
  if (ipaExists) receipt = await inspect(outputDir, receipt);
  assertOwnApp(receipt.appId);
  const builds = buildList(receipt.appId);
  const existing = !ipaExists
    ? confirmedUploadedBuild(receipt, builds)
    : builds.find((build) => build.buildNumber === receipt.buildNumber);
  if (existing && (!receipt.buildId || existing.id !== receipt.buildId))
    throw new Error(
      "This build number already exists in Apple without a matching local upload receipt. Inspect it before retrying; no duplicate upload was attempted.",
    );
  const args = [
    "publish",
    "testflight",
    "--app",
    receipt.appId,
    "--wait",
    "--timeout",
    "45m",
    "--output",
    "json",
  ];
  if (existing) {
    if (["FAILED", "INVALID"].includes(existing.processingState))
      throw new Error("Apple rejected this build; prepare a new build number after correcting it.");
    args.push("--build-id", existing.id);
  } else {
    args.push("--ipa", NodePath.join(outputDir, "Loom.ipa"));
  }
  if (receipt.groups.length) args.push("--group", receipt.groups.join(","));
  else args.push("--upload-only");
  const result = json("asc", args);
  await NodeFSP.writeFile(
    NodePath.join(outputDir, "testflight-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  const uploaded = buildList(receipt.appId).find(
    (candidate) => candidate.buildNumber === receipt.buildNumber,
  );
  if (!uploaded || uploaded.processingState !== "VALID")
    throw new Error(
      "TestFlight did not confirm a valid processed build. Check Apple before retrying upload.",
    );
  const published = { ...receipt, buildId: uploaded.id };
  await writeReceipt(outputDir, published);
  console.log(
    `TestFlight build ${receipt.version} (${receipt.buildNumber}) is processed. Source: ${receipt.sourceSha}`,
  );
  return published;
}

export async function withIosReleaseLock<T>(
  outputDir: string,
  appId: string,
  body: () => Promise<T>,
): Promise<T> {
  // Serialize all release records in this publisher's builds root, including retries.
  const lock = NodePath.join(NodePath.dirname(outputDir), `.loom-ios-${appId}.lock`);
  try {
    await NodeFSP.mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await NodeFSP.readFile(NodePath.join(lock, "pid"), "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error("Inspect the incomplete iOS publisher lock before retrying.", {
        cause: error,
      });
    try {
      NodeProcess.kill(pid, 0);
      throw new Error(`An iOS publisher is already running (PID ${pid}).`, { cause: error });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
    await NodeFSP.rm(lock, { recursive: true });
    await NodeFSP.mkdir(lock);
  }
  try {
    await NodeFSP.writeFile(NodePath.join(lock, "pid"), String(NodeProcess.pid), {
      flag: "wx",
      mode: 0o600,
    });
    return await body();
  } finally {
    await NodeFSP.rm(lock, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseIosReleaseArgs(NodeProcess.argv.slice(2));
  if (args.command === "verify-config") {
    const teamId = NodeProcess.env.LOOM_IOS_TEAM_ID || "LOOMTEST01";
    console.log(JSON.stringify(configFor(SOURCE_ROOT, teamId, "1")));
    return;
  }
  if (NodeProcess.platform !== "darwin" || !NodeProcess.versions.node.startsWith("24."))
    throw new Error("Local iOS release commands require macOS and Node 24.");
  const outputDir = args.outputDir!;
  await NodeFSP.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const realOutput = await NodeFSP.realpath(outputDir);
  await ownedPath(realOutput);
  const relative = NodePath.relative(await NodeFSP.realpath(SOURCE_ROOT), realOutput);
  if (
    !relative ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  )
    throw new Error("Release output must stay outside the source checkout.");
  const { appId } = releaseSettings(NodeProcess.env);
  await withIosReleaseLock(realOutput, appId, async () => {
    let receipt =
      args.command === "prepare" || args.command === "release"
        ? await prepare(realOutput, args.sourceSha)
        : await readReceipt(realOutput);
    assertReceiptContext(receipt, args.sourceSha);
    if (args.command === "build" || args.command === "release") await build(realOutput, receipt);
    if (
      args.command === "inspect" ||
      (["build", "release"].includes(args.command) &&
        (await ownedPath(NodePath.join(realOutput, "Loom.ipa"))))
    )
      receipt = await inspect(realOutput, receipt);
    if (args.command === "publish" || args.command === "release")
      receipt = await publish(realOutput, receipt);
    if (receipt.buildId && receipt.artifactSha256 && args.command !== "prepare") {
      await removeOwnedArtifact(NodePath.join(realOutput, "DerivedData"));
      await removeOwnedArtifact(NodePath.join(realOutput, "Loom-pending.xcarchive"));
      await pruneCompletedIosBuilds(realOutput, receipt);
    }
    if (args.command === "prepare") console.log(JSON.stringify(receipt, null, 2));
  });
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
