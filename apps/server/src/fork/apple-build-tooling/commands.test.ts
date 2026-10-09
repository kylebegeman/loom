import { describe, expect, it } from "@effect/vitest";
import type { AppleDestination, AppleRunRequest } from "@t3tools/contracts/fork";
import { ThreadId } from "@t3tools/contracts";

import {
  destinationSpecifier,
  deviceLaunchSteps,
  isAlreadyBooted,
  releaseDestination,
  shellQuote,
  showBuildSettingsArgs,
  simulatorLaunchSteps,
  swiftTestArgs,
  xcodebuildArgs,
} from "./commands.ts";

const workspace = { threadId: ThreadId.make("thread-1") };
const simulator: AppleDestination = {
  _tag: "simulator",
  udid: "SIM-1",
  name: "iPhone 17",
  runtime: "iOS 27.0",
  booted: true,
};
const device: AppleDestination = {
  _tag: "device",
  identifier: "UDID-1",
  name: "Phone",
  platform: "iPadOS",
  osVersion: "27.0",
  paired: true,
  developerModeEnabled: true,
  connection: "connected",
};
const paths = {
  derivedDataPath: "/state/derived/abc",
  resultBundlePath: "/runs/r1/Result.xcresult",
};

const request = (overrides: Partial<AppleRunRequest>): AppleRunRequest => ({
  workspace,
  kind: "build",
  container: { kind: "workspace", path: "App.xcworkspace", name: "App" },
  scheme: "App",
  destination: simulator,
  ...overrides,
});

const FORBIDDEN = [
  "-allowProvisioningUpdates",
  "-allowProvisioningDeviceRegistration",
  "-authenticationKey",
  "CODE_SIGN_",
  "DEVELOPMENT_TEAM=",
  "PROVISIONING_PROFILE",
  "-skipMacroValidation",
  "-skipPackagePluginValidation",
];

describe("destinationSpecifier", () => {
  it("names the simulator platform from its runtime", () => {
    expect(destinationSpecifier(simulator)).toBe("platform=iOS Simulator,id=SIM-1");
    expect(destinationSpecifier({ ...simulator, runtime: "watchOS 13.0" })).toBe(
      "platform=watchOS Simulator,id=SIM-1",
    );
    expect(destinationSpecifier({ ...simulator, runtime: "visionOS 3.0" })).toBe(
      "platform=visionOS Simulator,id=SIM-1",
    );
  });

  it("covers devices, this Mac and generic platforms", () => {
    expect(destinationSpecifier(device)).toBe("platform=iOS,id=UDID-1");
    expect(destinationSpecifier({ _tag: "mac" })).toBe("platform=macOS");
    expect(destinationSpecifier({ _tag: "generic", platform: "iOS" })).toBe("generic/platform=iOS");
  });

  it("derives the release platform from SUPPORTED_PLATFORMS", () => {
    expect(releaseDestination("iphoneos iphonesimulator")).toEqual({
      _tag: "generic",
      platform: "iOS",
    });
    expect(releaseDestination("macosx")).toEqual({ _tag: "generic", platform: "macOS" });
    expect(releaseDestination(undefined)).toEqual({ _tag: "generic", platform: "iOS" });
  });
});

describe("xcodebuildArgs", () => {
  const settings = { collectTestDiagnostics: "on-failure" as const };

  it("builds with the container, scheme, destination, derived data and result bundle", () => {
    expect(xcodebuildArgs(request({}), "build", paths, settings)).toEqual([
      "-workspace",
      "App.xcworkspace",
      "-scheme",
      "App",
      "-destination",
      "platform=iOS Simulator,id=SIM-1",
      "-derivedDataPath",
      "/state/derived/abc",
      "-resultBundlePath",
      "/runs/r1/Result.xcresult",
      "build",
    ]);
  });

  it("omits derived data when Xcode or the lane shim chooses it", () => {
    expect(
      xcodebuildArgs(request({}), "build", { ...paths, derivedDataPath: null }, settings),
    ).not.toContain("-derivedDataPath");
  });

  it("adds test options, one -only-testing per identifier", () => {
    const args = xcodebuildArgs(
      request({
        kind: "test",
        testPlan: "Unit",
        onlyTesting: ["AppTests/DoubleTests/testDouble()", "AppTests/swiftTesting()"],
        retryFailedTests: 3,
      }),
      "test",
      paths,
      settings,
    );
    expect(args?.slice(args.indexOf("test"))).toEqual([
      "test",
      "-collect-test-diagnostics",
      "on-failure",
      "-testPlan",
      "Unit",
      "-only-testing:AppTests/DoubleTests/testDouble()",
      "-only-testing:AppTests/swiftTesting()",
      "-retry-tests-on-failure",
      "-test-iterations",
      "3",
    ]);
  });

  it("builds XcodeGen specs through their generated project, and refuses packages", () => {
    const spec = { kind: "xcodegen" as const, path: "project.yml", name: "App" };
    expect(xcodebuildArgs(request({ container: spec }), "build", paths, settings)).toBeNull();
    expect(
      xcodebuildArgs(
        request({ container: { ...spec, generatedProjectPath: "App.xcodeproj" } }),
        "build",
        paths,
        settings,
      )?.slice(0, 2),
    ).toEqual(["-project", "App.xcodeproj"]);
    expect(
      xcodebuildArgs(
        request({ container: { kind: "package", path: "Package.swift", name: "Pkg" } }),
        "build",
        paths,
        settings,
      ),
    ).toBeNull();
  });

  it("release builds use Release without signing", () => {
    const args = xcodebuildArgs(
      request({ kind: "releaseBuild", destination: { _tag: "generic", platform: "iOS" } }),
      "build",
      paths,
      settings,
    );
    expect(args).toContain("Release");
    expect(args?.at(-1)).toBe("CODE_SIGNING_ALLOWED=NO");
  });

  it("never manages provisioning, signing or validation", () => {
    const all = [
      ...(["build", "test", "run", "releaseBuild"] as const).flatMap((kind) =>
        [simulator, device, { _tag: "mac" } as const].flatMap((destination) =>
          (["build", "test"] as const).map(
            (action) =>
              xcodebuildArgs(request({ kind, destination }), action, paths, settings) ?? [],
          ),
        ),
      ),
      showBuildSettingsArgs({
        ...request({ destination: device }),
        container: request({}).container!,
        scheme: "App",
        derivedDataPath: null,
      }) ?? [],
      Object.values(deviceLaunchSteps("UDID-1", "/p/App.app", "dev.app")).flat(),
    ].flat();
    for (const forbidden of FORBIDDEN)
      expect(
        all.some((arg) => arg.includes(forbidden)),
        forbidden,
      ).toBe(false);
  });
});

describe("other commands", () => {
  it("swift test writes xUnit and filters by escaped identifiers", () => {
    expect(
      swiftTestArgs("/runs/r1", ["PkgTests.MathTests/testAdd", "PkgTests.addBreaks()"]),
    ).toEqual([
      "test",
      "--parallel",
      "--xunit-output",
      "/runs/r1/xunit.xml",
      "--filter",
      "PkgTests\\.MathTests/testAdd",
      "--filter",
      "PkgTests\\.addBreaks\\(\\)",
    ]);
  });

  it("installs and launches with simctl and devicectl", () => {
    expect(simulatorLaunchSteps("SIM-1", "/p/App.app", "dev.app").launch).toEqual([
      "simctl",
      "launch",
      "--terminate-running-process",
      "SIM-1",
      "dev.app",
    ]);
    expect(deviceLaunchSteps("UDID-1", "/p/App.app", "dev.app")).toEqual({
      install: [
        "devicectl",
        "device",
        "install",
        "app",
        "--device",
        "UDID-1",
        "/p/App.app",
        "--json-output",
        "-",
      ],
      launch: [
        "devicectl",
        "device",
        "process",
        "launch",
        "--device",
        "UDID-1",
        "--terminate-existing",
        "dev.app",
        "--json-output",
        "-",
      ],
    });
    expect(isAlreadyBooted("Unable to boot device in current state: Booted")).toBe(true);
  });

  it("quotes for display", () => {
    expect(shellQuote(["xcodebuild", "-scheme", "My App", "-only-testing:A/b()"])).toBe(
      "xcodebuild -scheme 'My App' '-only-testing:A/b()'",
    );
  });
});
