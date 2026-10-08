import type { AppleIssue } from "@t3tools/contracts/fork";

import { relativeTo, SUMMARY_ITEM_CAP } from "./xcresult.ts";

/**
 * Build output parsers for runs without a result bundle: `swift build`, `swift test`, and
 * xcodebuild runs that failed before writing one.
 */

// oxlint-disable-next-line no-control-regex -- ANSI escapes are control characters.
const ANSI = /\x1b\[[0-9;]*m/g;

export const stripAnsi = (text: string) => text.replace(ANSI, "");

const DIAGNOSTIC = /^(\/[^:]+):(\d+):(\d+): (error|warning): (.+)$/;

/**
 * `/abs/File.swift:4:41: error: message`. Swift 6 repeats the message in an indented source
 * excerpt; those lines start with whitespace or `|` and are skipped.
 */
export const parseCompilerDiagnostics = (log: string, cwd: string): Array<AppleIssue> => {
  const seen = new Set<string>();
  const issues: Array<AppleIssue> = [];
  for (const raw of stripAnsi(log).split("\n")) {
    const match = DIAGNOSTIC.exec(raw.trimEnd());
    if (!match) continue;
    const [, path, line, , severity, message] = match;
    const key = `${path}:${line}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      severity: severity === "error" ? "error" : "warning",
      message: message!,
      file: relativeTo(cwd, path!),
      line: Number(line),
    });
  }
  return issues
    .sort((left, right) => Number(right.severity === "error") - Number(left.severity === "error"))
    .slice(0, SUMMARY_ITEM_CAP);
};

export interface FailureLine {
  readonly message: string;
  readonly file: string;
  readonly line: number;
}

const XCTEST_FAILURE = /^(\/.+?):(\d+): error: -\[(\S+) (\S+)\] : (.*)$/;
const SWIFT_TESTING_ISSUE = /Test (\S+) recorded an issue at (.+?):(\d+):\d+: (.*)$/;

/**
 * Test failure lines from `swift test` output, keyed by `<Module>.<Class>/<test>` for XCTest and
 * by `<func>()` for Swift Testing, whose log names only the function. First issue wins.
 */
export const parseTestFailureLines = (log: string, cwd: string) => {
  const failures = new Map<string, FailureLine>();
  for (const raw of stripAnsi(log).split("\n")) {
    const line = raw.trimEnd();
    const xctest = XCTEST_FAILURE.exec(line);
    if (xctest) {
      const [, path, number, testClass, test, message] = xctest;
      const key = `${testClass}/${test}`;
      if (!failures.has(key))
        failures.set(key, {
          message: message!,
          file: relativeTo(cwd, path!),
          line: Number(number),
        });
      continue;
    }
    const swiftTesting = SWIFT_TESTING_ISSUE.exec(line);
    if (swiftTesting) {
      const [, name, file, number, message] = swiftTesting;
      if (!failures.has(name!))
        failures.set(name!, { message: message!, file: file!, line: Number(number) });
    }
  }
  return failures;
};

const SIGNING_MARKERS = [
  "signing for",
  "requires a development team",
  "no profiles for",
  "provisioning profile",
  "no signing certificate",
  "code signing",
];

/** Loose on purpose: Xcode's exact signing wording changes between releases. */
export const classifySigningIssue = (issues: ReadonlyArray<AppleIssue>) =>
  issues.some(
    (issue) =>
      issue.severity === "error" &&
      SIGNING_MARKERS.some((marker) => issue.message.toLowerCase().includes(marker)),
  );

export const SIGNING_FAILURE_REASON =
  "Code signing is not set up for this scheme. Open the project in Xcode, choose a team under Signing & Capabilities, then build again.";
