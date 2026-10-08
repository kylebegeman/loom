// @effect-diagnostics nodeBuiltinImport:off - Reads recorded tool output.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "@effect/vitest";

import {
  classifySigningIssue,
  parseCompilerDiagnostics,
  parseTestFailureLines,
} from "./diagnostics.ts";
import {
  isSelectableDevice,
  parseDevicectlDevices,
  parseRuntimes,
  parseSimulators,
} from "./simulators.ts";
import {
  buildSummaryFromXcresult,
  parseSourceUrl,
  SUMMARY_ITEM_CAP,
  testSummaryFromXcresult,
} from "./xcresult.ts";
import { mergeSwiftTestSummary, readXunit } from "./xunit.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const APP = "/Users/test/scratch/App";
const PKG = "/Users/test/scratch/Pkg";

describe("xcresult", () => {
  it("maps build issues with workspace-relative files and 1-based lines", () => {
    expect(buildSummaryFromXcresult(fixture("xcresult-build-fail.json"), APP)).toEqual({
      status: "failed",
      errorCount: 1,
      warningCount: 1,
      issues: [
        {
          severity: "error",
          message: "Cannot convert return expression of type 'String' to return type 'Int'",
          file: "Sources/App.swift",
          line: 6,
        },
        {
          severity: "warning",
          message:
            "Initialization of variable 'never' was never used; consider replacing with assignment to '_' or removing it",
          file: "Sources/App.swift",
          line: 5,
        },
      ],
    });
    expect(buildSummaryFromXcresult(fixture("xcresult-build-ok.json"), APP)).toMatchObject({
      status: "succeeded",
      errorCount: 0,
      issues: [],
    });
  });

  it("decodes non-zero test counts and target-qualified identifiers", () => {
    const tests = testSummaryFromXcresult(fixture("xcresult-test-summary.json"));
    expect(tests).toMatchObject({ result: "Failed", total: 3, passed: 1, failed: 2, skipped: 0 });
    expect(tests?.failures.map((failure) => failure.identifier)).toEqual([
      "SampleAppTests/swiftTestingFails()",
      "SampleAppTests/DoubleTests/testDoubleFails()",
    ]);
    expect(tests?.failures[1]?.message).toContain("XCTAssertEqual failed");
  });

  it("degrades instead of failing on unknown or missing fields", () => {
    expect(
      testSummaryFromXcresult(
        JSON.stringify({
          totalTestCount: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          newField: { nested: true },
        }),
      ),
    ).toMatchObject({ result: "unknown", environment: "", failures: [] });
    expect(testSummaryFromXcresult("{}")).toBeUndefined();
    expect(buildSummaryFromXcresult("not json", APP)).toBeUndefined();
  });

  it("parses source URLs defensively", () => {
    expect(
      parseSourceUrl(`file://${APP}/A.swift#StartingLineNumber=0&EndingLineNumber=0`, APP),
    ).toEqual({
      file: "A.swift",
      line: 1,
    });
    expect(parseSourceUrl("file:///elsewhere/B.swift", APP)).toEqual({
      file: "/elsewhere/B.swift",
    });
    // Xcode drops the /private prefix of a temporary folder's real path.
    expect(
      parseSourceUrl("file:///var/tmp/ws/A.swift#StartingLineNumber=4", "/private/var/tmp/ws"),
    ).toEqual({ file: "A.swift", line: 5 });
    expect(parseSourceUrl("test://odd", APP)).toEqual({});
    expect(parseSourceUrl(undefined, APP)).toEqual({});
  });

  it("caps issues", () => {
    const errors = Array.from({ length: 150 }, (_, index) => ({ message: `e${index}` }));
    const build = buildSummaryFromXcresult(
      JSON.stringify({ errorCount: 150, warningCount: 0, errors }),
      APP,
    );
    expect(build?.issues).toHaveLength(SUMMARY_ITEM_CAP);
    expect(build?.errorCount).toBe(150);
  });
});

describe("simulators and devices", () => {
  it("lists available simulators, booted first", () => {
    expect(parseSimulators(fixture("simctl-devices.json"))).toEqual([
      {
        _tag: "simulator",
        udid: "AE0F1145-5E6D-5379-858D-CB3037426D5C",
        name: "iPhone 17",
        runtime: "iOS 27.0",
        booted: true,
      },
      {
        _tag: "simulator",
        udid: "9FC2582D-B155-5C50-8834-6228C024B965",
        name: "iPhone Air",
        runtime: "iOS 27.0",
        booted: false,
      },
    ]);
    expect(
      parseRuntimes(fixture("simctl-runtimes.json")).map((runtime) => runtime.version),
    ).toEqual(["18.6", "26.5", "27.0", "27.1"]);
  });

  // The devicectl fixture is synthetic: written by hand, no real device values.
  it("keeps physical devices from both the current and deprecated devicectl forms", () => {
    const devices = parseDevicectlDevices(fixture("devicectl-devices.json"));
    expect(devices).toEqual([
      {
        _tag: "device",
        identifier: "00000000-0000000000000001",
        name: "Test Phone",
        platform: "iOS",
        osVersion: "27.0",
        paired: true,
        developerModeEnabled: true,
        connection: "connected",
      },
      {
        _tag: "device",
        identifier: "00000000-0000000000000002",
        name: "Test Tablet",
        platform: "iOS",
        osVersion: "26.5",
        paired: false,
        developerModeEnabled: false,
        connection: null,
      },
    ]);
    expect(devices.map(isSelectableDevice)).toEqual([true, false]);
  });

  it("gives no devices for output it cannot read", () => {
    expect(parseDevicectlDevices("")).toEqual([]);
    expect(parseDevicectlDevices('{"error": {"code": 1}}')).toEqual([]);
  });
});

describe("package diagnostics", () => {
  it("reads compiler errors once each, without excerpts or color codes", () => {
    expect(parseCompilerDiagnostics(fixture("swift-build-error.log"), PKG)).toEqual([
      {
        severity: "error",
        message:
          "use of 'add' refers to instance method rather than global function 'add' in module 'Pkg'",
        file: "Tests/PkgTests/XCTests.swift",
        line: 4,
      },
      {
        severity: "error",
        message:
          "use of 'add' refers to instance method rather than global function 'add' in module 'Pkg'",
        file: "Tests/PkgTests/XCTests.swift",
        line: 5,
      },
    ]);
  });

  it("keys XCTest and Swift Testing failure lines", () => {
    const lines = parseTestFailureLines(fixture("swift-test.log"), PKG);
    expect(lines.get("PkgTests.MathTests/testAddFails")).toEqual({
      message: 'XCTAssertEqual failed: ("4") is not equal to ("5") - two plus two',
      file: "Tests/PkgTests/XCTests.swift",
      line: 5,
    });
    expect(lines.get("addBreaks()")).toEqual({
      message: "Expectation failed: add(1, 1) == 3",
      file: "SwiftTests.swift",
      line: 4,
    });
    expect(lines.get("insideSuiteFails()")?.line).toBe(7);
  });

  it("recognizes signing failures but not compile errors", () => {
    // Synthetic messages: Xcode 27's exact signing wording was not reproduced.
    expect(
      classifySigningIssue([
        { severity: "error", message: 'Signing for "App" requires a development team.' },
      ]),
    ).toBe(true);
    expect(
      classifySigningIssue([
        { severity: "error", message: "No profiles for 'dev.app' were found" },
      ]),
    ).toBe(true);
    expect(classifySigningIssue([{ severity: "error", message: "Cannot find 'x' in scope" }])).toBe(
      false,
    );
  });
});

describe("xunit", () => {
  it("reads cases, statuses, skip reasons and entities", () => {
    const swiftTesting = readXunit(fixture("xunit-swift-testing.xml"));
    expect(swiftTesting).toMatchObject({ total: 4, failed: 2, skipped: 1 });
    expect(swiftTesting.cases.find((testCase) => testCase.name === "addLater()")).toEqual({
      classname: "PkgTests",
      name: "addLater()",
      status: "skipped",
      message: "not ready",
    });
    expect(
      readXunit(
        '<testcase classname="A.B" name="t"><failure message="a &lt; b &amp;&quot;"/></testcase>',
      ).cases[0]?.message,
    ).toBe('a < b &"');
    expect(readXunit("<testsuites><testcase oops").cases).toEqual([]);
  });

  it("merges both files with filterable identifiers and the log's messages", () => {
    const tests = mergeSwiftTestSummary(
      readXunit(fixture("xunit.xml")),
      readXunit(fixture("xunit-swift-testing.xml")),
      parseTestFailureLines(fixture("swift-test.log"), PKG),
    );
    expect(tests).toMatchObject({ result: "Failed", total: 6, passed: 2, failed: 3, skipped: 1 });
    expect(tests?.failures).toEqual([
      {
        testName: "testAddFails",
        target: "PkgTests",
        identifier: "PkgTests.MathTests/testAddFails",
        message: 'XCTAssertEqual failed: ("4") is not equal to ("5") - two plus two',
        file: "Tests/PkgTests/XCTests.swift",
        line: 5,
      },
      {
        testName: "addBreaks()",
        target: "PkgTests",
        identifier: "PkgTests.addBreaks()",
        message: "Expectation failed: add(1, 1) == 3 (error): one plus one",
        file: "SwiftTests.swift",
        line: 4,
      },
      {
        testName: "insideSuiteFails()",
        target: "PkgTests",
        identifier: "PkgTests.Grouped/insideSuiteFails()",
        message: "Expectation failed: add(0, 0) == 1 (error)",
        file: "SwiftTests.swift",
        line: 7,
      },
    ]);
  });

  it("leaves a missing half empty, and nothing when both are missing", () => {
    expect(mergeSwiftTestSummary(readXunit(fixture("xunit.xml")), null, new Map())).toMatchObject({
      total: 2,
      failed: 1,
      failures: [{ message: "failure" }],
    });
    expect(mergeSwiftTestSummary(null, null, new Map())).toBeUndefined();
  });
});
