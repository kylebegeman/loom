import type { AppleRunSummary, AppleTestFailure } from "@t3tools/contracts/fork";

import type { FailureLine } from "./diagnostics.ts";
import { SUMMARY_ITEM_CAP } from "./xcresult.ts";

/**
 * A reader for the flat xUnit files SwiftPM writes. No XML dependency: SwiftPM's shape is
 * fixed, and anything unrecognized is skipped rather than fatal.
 */

export interface XunitCase {
  readonly classname: string;
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly message?: string;
}

export interface XunitReport {
  readonly total: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cases: ReadonlyArray<XunitCase>;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export const decodeEntities = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (entity, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name] ?? entity;
  });

const attributes = (tag: string) => {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    found.set(match[1]!, decodeEntities(match[2] ?? match[3] ?? ""));
  return found;
};

const TESTCASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;

export const readXunit = (xml: string): XunitReport => {
  const cases: Array<XunitCase> = [];
  for (const match of xml.matchAll(TESTCASE)) {
    const attrs = attributes(match[1]!);
    const classname = attrs.get("classname");
    const name = attrs.get("name");
    if (classname === undefined || name === undefined) continue;
    const body = match[3] ?? "";
    const failure = /<failure\b([^>]*?)\/?>/.exec(body);
    const skipped = /<skipped\b[^>]*?(?:\/>|>([\s\S]*?)<\/skipped>)/.exec(body);
    if (failure) {
      cases.push({
        classname,
        name,
        status: "failed",
        message: attributes(failure[1]!).get("message") ?? "",
      });
    } else if (skipped) {
      const reason = decodeEntities(skipped[1] ?? "").trim();
      cases.push({ classname, name, status: "skipped", ...(reason ? { message: reason } : {}) });
    } else {
      cases.push({ classname, name, status: "passed" });
    }
  }
  return {
    total: cases.length,
    failed: cases.filter((testCase) => testCase.status === "failed").length,
    skipped: cases.filter((testCase) => testCase.status === "skipped").length,
    cases,
  };
};

/** The identifier `swift test --filter` and `swift test list` use. */
export const swiftTestIdentifier = (testCase: XunitCase, swiftTesting: boolean) =>
  swiftTesting && !testCase.classname.includes(".")
    ? `${testCase.classname}.${testCase.name}`
    : `${testCase.classname}/${testCase.name}`;

/**
 * One summary from the XCTest and Swift Testing files. XCTest's xUnit message is always the
 * word "failure"; the log line carries the real message, file and line.
 */
export const mergeSwiftTestSummary = (
  xctest: XunitReport | null,
  swiftTesting: XunitReport | null,
  failureLines: ReadonlyMap<string, FailureLine>,
): AppleRunSummary["tests"] => {
  if (xctest === null && swiftTesting === null) return undefined;
  const reports = [
    { report: xctest, swiftTesting: false },
    { report: swiftTesting, swiftTesting: true },
  ];
  const failures: Array<AppleTestFailure> = [];
  let total = 0;
  let failed = 0;
  let skipped = 0;
  for (const { report, swiftTesting: isSwiftTesting } of reports) {
    if (report === null) continue;
    total += report.total;
    failed += report.failed;
    skipped += report.skipped;
    for (const testCase of report.cases) {
      if (testCase.status !== "failed") continue;
      const logged = failureLines.get(
        isSwiftTesting ? testCase.name : `${testCase.classname}/${testCase.name}`,
      );
      const message =
        testCase.message && testCase.message !== "failure"
          ? testCase.message
          : (logged?.message ?? testCase.message ?? "");
      failures.push({
        testName: testCase.name,
        target: testCase.classname.split(".")[0]!,
        identifier: swiftTestIdentifier(testCase, isSwiftTesting),
        message,
        ...(logged ? { file: logged.file, line: logged.line } : {}),
      });
    }
  }
  return {
    result: failed > 0 ? "Failed" : total > 0 && skipped === total ? "Skipped" : "Passed",
    total,
    passed: total - failed - skipped,
    failed,
    skipped,
    expectedFailures: 0,
    environment: "swift test",
    failures: failures.slice(0, SUMMARY_ITEM_CAP),
  };
};
