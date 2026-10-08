import { describe, expect, it } from "vite-plus/test";

import { formatRunSummaryForAgent, truncateUtf8 } from "./apple-build-tooling.ts";

describe("truncateUtf8", () => {
  it("keeps short text and never splits a character", () => {
    expect(truncateUtf8("short", 100)).toBe("short");
    const cut = truncateUtf8("é".repeat(100), 21);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(21);
    expect(cut).toBe(`${"é".repeat(8)}\n...`);
  });
});

describe("formatRunSummaryForAgent", () => {
  it("lists errors with locations, then failed tests by identifier", () => {
    const text = formatRunSummaryForAgent(
      { kind: "test", status: "failed", commandLine: "xcodebuild test -scheme App" },
      {
        build: {
          status: "failed",
          errorCount: 1,
          warningCount: 2,
          issues: [
            { severity: "warning", message: "unused" },
            { severity: "error", message: "cannot find 'x'", file: "App/App.swift", line: 5 },
          ],
        },
        tests: {
          result: "Failed",
          total: 3,
          passed: 2,
          failed: 1,
          skipped: 0,
          expectedFailures: 0,
          environment: "iPhone 17",
          failures: [
            {
              testName: "testDouble()",
              target: "AppTests",
              identifier: "AppTests/DoubleTests/testDouble()",
              message: "XCTAssertEqual failed",
            },
          ],
        },
      },
    );
    expect(text).toBe(
      [
        "Test failed (xcodebuild test -scheme App)",
        "error: App/App.swift:5: cannot find 'x'",
        "2 warnings",
        "tests: 2/3 passed, 1 failed, 0 skipped",
        "FAIL AppTests/DoubleTests/testDouble(): XCTAssertEqual failed",
      ].join("\n"),
    );
  });
});
