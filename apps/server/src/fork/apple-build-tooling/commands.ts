import type {
  AppleBuildSettings,
  AppleContainer,
  AppleDestination,
  AppleRunRequest,
} from "@t3tools/contracts/fork";

/**
 * Pure argv builders. No builder ever adds provisioning, authentication or signing overrides,
 * nor the macro and package plugin validation skips: signing is the project's, set up in Xcode.
 */

export type XcodeAction = "build" | "test";

export interface XcodebuildPaths {
  /** Omitted when Xcode's default applies or the lane's xcodebuild shim adds its own. */
  readonly derivedDataPath: string | null;
  readonly resultBundlePath: string;
}

/** `-workspace W` or `-project P`; XcodeGen specs build their generated project. */
export const containerArgs = (container: AppleContainer): ReadonlyArray<string> | null => {
  switch (container.kind) {
    case "workspace":
      return ["-workspace", container.path];
    case "project":
      return ["-project", container.path];
    case "xcodegen":
      return container.generatedProjectPath === undefined
        ? null
        : ["-project", container.generatedProjectPath];
    case "package":
      return null;
  }
};

/** `iOS 27.0` gives `iOS`; xcodebuild names device platforms without the iPad split. */
const runtimePlatform = (runtime: string) => runtime.split(" ")[0] || "iOS";
const devicePlatform = (platform: string) => (platform === "iPadOS" ? "iOS" : platform);

export const destinationSpecifier = (destination: AppleDestination) => {
  switch (destination._tag) {
    case "simulator":
      return `platform=${runtimePlatform(destination.runtime)} Simulator,id=${destination.udid}`;
    case "device":
      return `platform=${devicePlatform(destination.platform)},id=${destination.identifier}`;
    case "mac":
      return "platform=macOS";
    case "generic":
      return `generic/platform=${destination.platform}`;
  }
};

const PLATFORM_BY_SDK: ReadonlyArray<readonly [string, AppleDestination & { _tag: "generic" }]> = [
  ["iphoneos", { _tag: "generic", platform: "iOS" }],
  ["macosx", { _tag: "generic", platform: "macOS" }],
  ["xros", { _tag: "generic", platform: "visionOS" }],
  ["watchos", { _tag: "generic", platform: "watchOS" }],
  ["appletvos", { _tag: "generic", platform: "tvOS" }],
];

/** Release builds target the generic device platform from `SUPPORTED_PLATFORMS`. */
export const releaseDestination = (supportedPlatforms: string | undefined): AppleDestination => {
  const platforms = (supportedPlatforms ?? "").split(/\s+/);
  return (
    PLATFORM_BY_SDK.find(([sdk]) => platforms.includes(sdk))?.[1] ?? {
      _tag: "generic",
      platform: "iOS",
    }
  );
};

/** Shared scheme selection: container, scheme, configuration and destination. */
export const schemeArgs = (input: {
  readonly container: AppleContainer;
  readonly scheme: string;
  readonly configuration?: string | undefined;
  readonly destination?: AppleDestination | undefined;
}) => {
  const container = containerArgs(input.container);
  if (container === null) return null;
  return [
    ...container,
    "-scheme",
    input.scheme,
    ...(input.configuration ? ["-configuration", input.configuration] : []),
    ...(input.destination ? ["-destination", destinationSpecifier(input.destination)] : []),
  ];
};

/** `xcodebuild` argv for build and test actions, or null when the request cannot build. */
export const xcodebuildArgs = (
  request: AppleRunRequest,
  action: XcodeAction,
  paths: XcodebuildPaths,
  settings: Pick<AppleBuildSettings, "collectTestDiagnostics">,
) => {
  if (request.container === undefined || request.scheme === undefined) return null;
  const releaseBuild = request.kind === "releaseBuild";
  const selection = schemeArgs({
    container: request.container,
    scheme: request.scheme,
    configuration: releaseBuild ? "Release" : request.configuration,
    destination: request.destination,
  });
  if (selection === null) return null;
  const testArgs =
    action === "test"
      ? [
          "-collect-test-diagnostics",
          settings.collectTestDiagnostics,
          ...(request.testPlan ? ["-testPlan", request.testPlan] : []),
          ...(request.onlyTesting ?? []).map((identifier) => `-only-testing:${identifier}`),
          ...(request.retryFailedTests
            ? ["-retry-tests-on-failure", "-test-iterations", String(request.retryFailedTests)]
            : []),
        ]
      : [];
  return [
    ...selection,
    ...(paths.derivedDataPath ? ["-derivedDataPath", paths.derivedDataPath] : []),
    "-resultBundlePath",
    paths.resultBundlePath,
    action,
    ...testArgs,
    ...(releaseBuild ? ["CODE_SIGNING_ALLOWED=NO"] : []),
  ];
};

/** Build settings for the same selection, so product paths match the build. */
export const showBuildSettingsArgs = (
  input: Parameters<typeof schemeArgs>[0] & { readonly derivedDataPath: string | null },
) => {
  const selection = schemeArgs(input);
  if (selection === null) return null;
  return [
    ...selection,
    ...(input.derivedDataPath ? ["-derivedDataPath", input.derivedDataPath] : []),
    "-showBuildSettings",
    "-json",
  ];
};

export const listArgs = (container: AppleContainer) => {
  const args = containerArgs(container);
  return args === null ? null : ["-list", "-json", ...args];
};

export const showTestPlansArgs = (container: AppleContainer, scheme: string) => {
  const args = containerArgs(container);
  return args === null ? null : [...args, "-scheme", scheme, "-showTestPlans", "-json"];
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const swiftBuildArgs = () => ["build"];

/** `--parallel` is what makes SwiftPM write the XCTest xUnit file. */
export const swiftTestArgs = (runDir: string, onlyTesting: ReadonlyArray<string> = []) => [
  "test",
  "--parallel",
  "--xunit-output",
  `${runDir}/xunit.xml`,
  ...onlyTesting.flatMap((identifier) => ["--filter", escapeRegex(identifier)]),
];

/** xcrun argv for a simulator install and launch, in order. */
export const simulatorLaunchSteps = (udid: string, appPath: string, bundleId: string) => ({
  boot: ["simctl", "boot", udid],
  bootstatus: ["simctl", "bootstatus", udid, "-b"],
  install: ["simctl", "install", udid, appPath],
  launch: ["simctl", "launch", "--terminate-running-process", udid, bundleId],
});

/** `simctl boot` on a booted device exits non-zero; that is success here. */
export const isAlreadyBooted = (output: string) =>
  output.includes("Unable to boot device in current state: Booted");

/** xcrun argv for a physical device install and launch. devicectl's human output is not stable. */
export const deviceLaunchSteps = (identifier: string, appPath: string, bundleId: string) => ({
  install: [
    "devicectl",
    "device",
    "install",
    "app",
    "--device",
    identifier,
    appPath,
    "--json-output",
    "-",
  ],
  launch: [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    identifier,
    "--terminate-existing",
    bundleId,
    "--json-output",
    "-",
  ],
});

export const xcodegenGenerateArgs = (spec: string, cachePath: string) => [
  "generate",
  "--spec",
  spec,
  "--use-cache",
  "--cache-path",
  cachePath,
];

const SAFE_ARG = /^[\w@%+=:,./-]+$/;

/** For display only. */
export const shellQuote = (args: ReadonlyArray<string>) =>
  args.map((arg) => (SAFE_ARG.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(" ");
