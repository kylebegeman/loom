import type {
  AppleReadinessCheck,
  AppleReadinessReport,
  AppleReadinessSeverity,
  AppleRunStatus,
  AppleXcodegenReport,
} from "@t3tools/contracts/fork";

/** What the release checklist reads; the service gathers it, this module only judges it. */
export interface ReadinessFacts {
  readonly buildSettings: Readonly<Record<string, string>>;
  readonly schemeShared: boolean;
  /** Null when no icon name is configured. */
  readonly appIconFound: boolean | null;
  readonly privacyManifestFound: boolean;
  readonly infoPlistDeclaresEncryption: boolean;
  /** Null when `git status` could not run. */
  readonly gitClean: boolean | null;
  readonly xcodegen: AppleXcodegenReport["state"] | null;
  readonly lastCommitAt: string | null;
  readonly latestReleaseBuild: LatestRun | null;
  readonly latestTest: LatestRun | null;
}

export interface LatestRun {
  readonly status: AppleRunStatus;
  readonly finishedAt: string | null;
}

const XCODEGEN_MESSAGES: Record<AppleXcodegenReport["state"], string> = {
  "in-sync": "In sync with the spec.",
  "out-of-date": "The generated project is out of date; run XcodeGen generate.",
  "not-generated": "The project has not been generated yet.",
  invalid: "The XcodeGen spec is invalid.",
  "xcodegen-missing": "XcodeGen is not installed, so the project could not be compared.",
};

const ORDER: ReadonlyArray<AppleReadinessSeverity> = ["fail", "warning", "unknown", "pass"];

/** Any fail, else any warning, else any unknown, else pass. */
export const rollUp = (checks: ReadonlyArray<AppleReadinessCheck>): AppleReadinessSeverity =>
  ORDER.find((severity) => checks.some((check) => check.severity === severity)) ?? "pass";

const check = (
  code: string,
  title: string,
  passed: boolean,
  otherwise: AppleReadinessSeverity,
  passMessage: string,
  failMessage: string,
): AppleReadinessCheck => ({
  code,
  title,
  severity: passed ? "pass" : otherwise,
  message: passed ? passMessage : failMessage,
});

const runCheck = (
  code: string,
  title: string,
  latest: LatestRun | null,
  lastCommitAt: string | null,
): AppleReadinessCheck => {
  if (latest === null || latest.finishedAt === null)
    return { code, title, severity: "unknown", message: "No run yet." };
  const current =
    lastCommitAt === null || Date.parse(latest.finishedAt) >= Date.parse(lastCommitAt);
  if (latest.status === "succeeded" && current)
    return { code, title, severity: "pass", message: "Succeeded after the last commit." };
  return {
    code,
    title,
    severity: latest.status === "succeeded" ? "unknown" : "warning",
    message:
      latest.status === "succeeded"
        ? "The last success is older than the last commit."
        : `The latest run ${latest.status}.`,
  };
};

export const evaluateReadiness = (facts: ReadinessFacts): AppleReadinessReport => {
  const settings = facts.buildSettings;
  const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER ?? "";
  const buildNumber = settings.CURRENT_PROJECT_VERSION ?? "";
  const deploymentTarget = settings.IPHONEOS_DEPLOYMENT_TARGET ?? settings.MACOSX_DEPLOYMENT_TARGET;
  const checks: Array<AppleReadinessCheck> = [
    check(
      "scheme-shared",
      "Shared scheme",
      facts.schemeShared,
      "warning",
      "The scheme is shared.",
      "The scheme is not shared; CI and other checkouts will not see it.",
    ),
    check(
      "bundle-id",
      "Bundle identifier",
      bundleId !== "" && !bundleId.startsWith("com.example."),
      "fail",
      bundleId,
      bundleId === "" ? "No bundle identifier is set." : `${bundleId} is a placeholder.`,
    ),
    check(
      "version",
      "Version",
      Boolean(settings.MARKETING_VERSION),
      "fail",
      settings.MARKETING_VERSION ?? "",
      "MARKETING_VERSION is not set.",
    ),
    check(
      "build-number",
      "Build number",
      /^\d+(\.\d+)*$/.test(buildNumber),
      "fail",
      buildNumber,
      buildNumber === ""
        ? "CURRENT_PROJECT_VERSION is not set."
        : `${buildNumber} is not a numeric build number.`,
    ),
    check(
      "signing-team",
      "Signing team",
      Boolean(settings.DEVELOPMENT_TEAM),
      "warning",
      `Team ${settings.DEVELOPMENT_TEAM ?? ""}.`,
      "No development team is set. Choose one in Xcode under Signing & Capabilities.",
    ),
    check(
      "app-icon",
      "App icon",
      facts.appIconFound === true,
      "warning",
      "A 1024 px app icon was found.",
      facts.appIconFound === null
        ? "No app icon is configured."
        : `No 1024 px image was found for ${settings.ASSETCATALOG_COMPILER_APPICON_NAME}.`,
    ),
    check(
      "privacy-manifest",
      "Privacy manifest",
      facts.privacyManifestFound,
      "warning",
      "PrivacyInfo.xcprivacy found.",
      "No PrivacyInfo.xcprivacy was found in the app's sources.",
    ),
    check(
      "export-compliance",
      "Export compliance",
      Boolean(settings.INFOPLIST_KEY_ITSAppUsesNonExemptEncryption) ||
        facts.infoPlistDeclaresEncryption,
      "warning",
      "ITSAppUsesNonExemptEncryption is declared.",
      "ITSAppUsesNonExemptEncryption is not declared; App Store Connect will ask on every upload.",
    ),
    {
      code: "deployment-target",
      title: "Deployment target",
      severity: "pass",
      message: deploymentTarget === undefined ? "Not reported." : deploymentTarget,
    },
    facts.gitClean === null
      ? {
          code: "git-clean",
          title: "Clean checkout",
          severity: "unknown",
          message: "Not a Git checkout.",
        }
      : check(
          "git-clean",
          "Clean checkout",
          facts.gitClean,
          "warning",
          "No uncommitted changes.",
          "There are uncommitted changes.",
        ),
    check(
      "xcodegen-sync",
      "XcodeGen project",
      facts.xcodegen === null || facts.xcodegen === "in-sync",
      "warning",
      facts.xcodegen === null ? "No XcodeGen spec." : "In sync with the spec.",
      facts.xcodegen === null ? "" : XCODEGEN_MESSAGES[facts.xcodegen],
    ),
    runCheck("release-build", "Release build", facts.latestReleaseBuild, facts.lastCommitAt),
    runCheck("tests", "Tests", facts.latestTest, facts.lastCommitAt),
  ];
  return { overall: rollUp(checks), checks };
};

export interface BuildSettingsEntry {
  readonly target: string;
  readonly buildSettings: Readonly<Record<string, string>>;
}

/** `xcodebuild -showBuildSettings -json`: one entry per target. Unreadable output gives none. */
export const parseBuildSettings = (json: string): Array<BuildSettingsEntry> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): Array<BuildSettingsEntry> => {
    const settings: unknown = entry?.buildSettings;
    if (typeof settings !== "object" || settings === null) return [];
    const strings = Object.fromEntries(
      Object.entries(settings).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    );
    return [
      { target: typeof entry.target === "string" ? entry.target : "", buildSettings: strings },
    ];
  });
};

export const APPLICATION_PRODUCT_TYPE = "com.apple.product-type.application";

/** Never the first `.app` on disk: the scheme must build exactly one application. */
export const applicationProduct = (entries: ReadonlyArray<BuildSettingsEntry>) => {
  const apps = entries.filter(
    (entry) => entry.buildSettings.PRODUCT_TYPE === APPLICATION_PRODUCT_TYPE,
  );
  if (apps.length !== 1)
    return {
      error: `The scheme builds ${apps.length} applications; choose a scheme that builds one.`,
    } as const;
  const settings = apps[0]!.buildSettings;
  const dir = settings.TARGET_BUILD_DIR;
  const wrapper = settings.WRAPPER_NAME;
  const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER;
  if (!dir || !wrapper || !bundleId)
    return {
      error: "The build settings do not name the app's location and bundle identifier.",
    } as const;
  return { appPath: `${dir}/${wrapper}`, bundleId, settings } as const;
};
