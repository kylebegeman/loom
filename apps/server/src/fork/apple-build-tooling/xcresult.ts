import { AppleTestResult, type AppleIssue, type AppleRunSummary } from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * `xcresulttool get build-results` and `get test-results summary` JSON. Only the fields Loom
 * reads are decoded and most are optional, so a schema bump degrades instead of failing.
 */

export const SUMMARY_ITEM_CAP = 100;

const Issue = Schema.Struct({
  issueType: Schema.optional(Schema.String),
  message: Schema.String,
  targetName: Schema.optional(Schema.String),
  sourceURL: Schema.optional(Schema.String),
});

const BuildResults = Schema.Struct({
  status: Schema.optional(Schema.String),
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  analyzerWarningCount: Schema.optional(Schema.Number),
  errors: Schema.optional(Schema.Array(Issue)),
  warnings: Schema.optional(Schema.Array(Issue)),
  analyzerWarnings: Schema.optional(Schema.Array(Issue)),
});

const TestFailure = Schema.Struct({
  testName: Schema.String,
  targetName: Schema.optional(Schema.String),
  failureText: Schema.optional(Schema.String),
  testIdentifierString: Schema.optional(Schema.String),
});

const TestSummary = Schema.Struct({
  environmentDescription: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  totalTestCount: Schema.Number,
  passedTests: Schema.Number,
  failedTests: Schema.Number,
  skippedTests: Schema.Number,
  expectedFailures: Schema.optional(Schema.Number),
  testFailures: Schema.optional(Schema.Array(TestFailure)),
});

const decodeBuildResults = Schema.decodeUnknownOption(Schema.fromJsonString(BuildResults));
const decodeTestSummary = Schema.decodeUnknownOption(Schema.fromJsonString(TestSummary));

/** Workspace-relative when inside `cwd`, else unchanged. */
export const relativeTo = (cwd: string, path: string) => {
  // Xcode reports paths below /private/var and /private/tmp without the /private prefix.
  const bases = cwd.startsWith("/private/") ? [cwd, cwd.slice("/private".length)] : [cwd];
  for (const base of bases) {
    const root = base.endsWith("/") ? base : `${base}/`;
    if (path.startsWith(root)) return path.slice(root.length);
  }
  return path;
};

/**
 * `file:///abs/File.swift#...&StartingLineNumber=4&...`. The line number is 0-based; the result
 * is 1-based. Unknown shapes give nothing, so the issue keeps only its message.
 */
export const parseSourceUrl = (sourceURL: string | undefined, cwd: string) => {
  if (sourceURL === undefined || !sourceURL.startsWith("file://")) return {};
  const [location = "", fragment = ""] = sourceURL.slice("file://".length).split("#");
  let path: string;
  try {
    path = decodeURIComponent(location);
  } catch {
    return {};
  }
  if (!path.startsWith("/")) return {};
  const line = Number(new URLSearchParams(fragment).get("StartingLineNumber"));
  return {
    file: relativeTo(cwd, path),
    ...(fragment.includes("StartingLineNumber=") && Number.isInteger(line) && line >= 0
      ? { line: line + 1 }
      : {}),
  };
};

const toIssue =
  (severity: AppleIssue["severity"], cwd: string) =>
  (issue: typeof Issue.Type): AppleIssue => ({
    severity,
    message: issue.message,
    ...(issue.targetName === undefined ? {} : { target: issue.targetName }),
    ...parseSourceUrl(issue.sourceURL, cwd),
  });

export const buildSummaryFromXcresult = (
  json: string,
  cwd: string,
): AppleRunSummary["build"] | undefined =>
  Option.getOrUndefined(
    Option.map(decodeBuildResults(json), (results) => ({
      status: results.status ?? "unknown",
      errorCount: results.errorCount,
      warningCount: results.warningCount + (results.analyzerWarningCount ?? 0),
      issues: [
        ...(results.errors ?? []).map(toIssue("error", cwd)),
        ...(results.warnings ?? []).map(toIssue("warning", cwd)),
        ...(results.analyzerWarnings ?? []).map(toIssue("analyzer", cwd)),
      ].slice(0, SUMMARY_ITEM_CAP),
    })),
  );

const isTestResult = Schema.is(AppleTestResult);

type Tests = NonNullable<AppleRunSummary["tests"]>;

export const testSummaryFromXcresult = (json: string): Tests | undefined =>
  Option.getOrUndefined(
    Option.map(decodeTestSummary(json), (summary): Tests => ({
      result: isTestResult(summary.result) ? summary.result : "unknown",
      total: summary.totalTestCount,
      passed: summary.passedTests,
      failed: summary.failedTests,
      skipped: summary.skippedTests,
      expectedFailures: summary.expectedFailures ?? 0,
      environment: summary.environmentDescription ?? "",
      failures: (summary.testFailures ?? []).slice(0, SUMMARY_ITEM_CAP).map((failure) => {
        const target = failure.targetName ?? "";
        const test = failure.testIdentifierString ?? failure.testName;
        return {
          testName: failure.testName,
          target,
          // `-only-testing:` takes the test target, then the identifier string.
          identifier: target === "" ? test : `${target}/${test}`,
          message: failure.failureText ?? "",
        };
      }),
    })),
  );
