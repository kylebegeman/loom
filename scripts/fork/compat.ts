// @effect-diagnostics nodeBuiltinImport:off - Read-only source inventory for fork maintenance.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { LOOM_COMPAT_FLOOR } from "@t3tools/shared/fork/compatibility";

export interface CompatibilitySource {
  readonly path: string;
  readonly text: string;
}

/** Split a call's arguments without mistaking a nested call or quoted comma for a separator. */
function argumentsAt(text: string, start: number) {
  const args: string[] = [];
  let depth = 0;
  let quote = "";
  let from = start;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
      continue;
    }
    if ("\"'`".includes(char)) quote = char;
    else if ("([{<".includes(char)) depth++;
    else if (char === ")" && depth === 0) {
      args.push(text.slice(from, index).trim());
      return args;
    } else if (")]}>".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      args.push(text.slice(from, index).trim());
      from = index + 1;
    }
  }
  return args;
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

export function compatibilityReport(sources: readonly CompatibilitySource[]) {
  const constants = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const match of source.text.matchAll(
      /\b(?:export\s+)?const\s+(\w+)\s*=\s*["']([\w-]+)["']/g,
    )) {
      const values = constants.get(match[1]!) ?? new Set<string>();
      values.add(match[2]!);
      constants.set(match[1]!, values);
    }
  }
  const floor = new Set<string>(LOOM_COMPAT_FLOOR);
  const checks: {
    path: string;
    line: number;
    expression: string;
    feature: string | null;
    impliedByFloor: boolean;
  }[] = [];
  const wording: { path: string; line: number; text: string; nearbyFloorFeatures: string[] }[] = [];
  for (const source of sources) {
    if (!source.path.includes("/fork/")) continue;
    const aliases = new Map<string, string>();
    for (const match of source.text.matchAll(/\b(\w+)\s+as\s+(\w+)\b/g))
      aliases.set(match[2]!, match[1]!);
    for (const match of source.text.matchAll(/\bsupportsLoomFeature\s*\(/g)) {
      const expression = argumentsAt(source.text, match.index + match[0].length)[1] ?? "";
      const literal = /^["']([\w-]+)["']$/.exec(expression)?.[1];
      const values = constants.get(aliases.get(expression) ?? expression);
      const feature = literal ?? (values?.size === 1 ? [...values][0]! : null);
      checks.push({
        path: source.path,
        line: lineAt(source.text, match.index),
        expression,
        feature,
        impliedByFloor: feature !== null && floor.has(feature),
      });
    }
    for (const [index, line] of source.text.split("\n").entries()) {
      if (!/older (?:library|computer|server)|update loom on/i.test(line)) continue;
      wording.push({
        path: source.path,
        line: index + 1,
        text: line.trim(),
        nearbyFloorFeatures: [
          ...new Set(
            checks
              .filter(
                (check) =>
                  check.path === source.path &&
                  check.impliedByFloor &&
                  Math.abs(check.line - index - 1) <= 20,
              )
              .map((check) => check.feature!),
          ),
        ],
      });
    }
  }
  return { floor: LOOM_COMPAT_FLOOR, checks, wording };
}

export function formatCompatibilityReport(report: ReturnType<typeof compatibilityReport>) {
  return [
    `Loom compatibility floor: ${report.floor.join(", ")}`,
    "Floor-implied guards (review for removal; servers keep advertising these flags):",
    ...report.checks
      .filter((check) => check.impliedByFloor)
      .map((check) => `  ${check.path}:${check.line} ${check.feature}`),
    "Other guards (not implied by this floor, including packet-presence checks):",
    ...report.checks
      .filter((check) => !check.impliedByFloor)
      .map(
        (check) =>
          `  ${check.path}:${check.line} ${check.feature ?? `unresolved: ${check.expression}`}`,
      ),
    "Older-computer wording (nearby flags are review hints, not proof of ownership):",
    ...report.wording.map(
      (row) =>
        `  ${row.path}:${row.line}${row.nearbyFloorFeatures.length ? ` [near ${row.nearbyFloorFeatures.join(", ")}]` : ""} ${row.text}`,
    ),
  ].join("\n");
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const root = NodePath.resolve(import.meta.dirname, "../..");
  const paths = NodeChildProcess.execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps", "packages"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n");
  const sources = paths
    .filter(
      (path) =>
        /^(?:apps|packages)\/.*\.[cm]?[jt]sx?$/.test(path) && !/\.(?:test|spec)\./.test(path),
    )
    .map((path) => ({ path, text: NodeFS.readFileSync(NodePath.resolve(root, path), "utf8") }));
  process.stdout.write(formatCompatibilityReport(compatibilityReport(sources)) + "\n");
}
