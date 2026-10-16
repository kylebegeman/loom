import type {
  LibraryProfileDifference,
  LibraryProfileReadiness,
  LibraryToolCheck,
} from "@t3tools/contracts/fork";

export type LibraryToolCheckTone = "ok" | "problem" | "unknown";

/** How a check reads in a list: `ok` passes, `problem` needs fixing, `unknown` was not read. */
export function libraryToolCheckTone(check: LibraryToolCheck): LibraryToolCheckTone {
  if (check.status === "ok") return "ok";
  return check.status === "unknown" ? "unknown" : "problem";
}

/** One check in words, for example "Node.js 24.3.0", "Xcode missing" or "Go 1.21 (needs 1.24)". */
export function libraryToolCheckText(check: LibraryToolCheck): string {
  switch (check.status) {
    case "ok":
      return check.version === undefined ? check.label : `${check.label} ${check.version}`;
    case "outdated":
      return `${check.label} ${check.version ?? "too old"} (needs ${check.minimumVersion ?? "newer"})`;
    case "missing":
      return check.minimumVersion === undefined
        ? `${check.label} missing`
        : `${check.label} ${check.minimumVersion} missing`;
    case "unknown":
      return `${check.label} could not be checked`;
  }
}

const MARKS: Record<LibraryToolCheckTone, string> = { ok: "✓", problem: "✗", unknown: "?" };

/** The whole checklist on one line, for example "Node.js 24.3.0 ✓ · Xcode missing ✗". */
export function libraryReadinessSummary(readiness: LibraryProfileReadiness): string {
  return readiness.checks
    .map((check) => `${libraryToolCheckText(check)} ${MARKS[libraryToolCheckTone(check)]}`)
    .join(" · ");
}

/** Every required tool checked and found new enough. Secrets are not checked. */
export function libraryReadinessReady(readiness: LibraryProfileReadiness): boolean {
  return readiness.checks.every((check) => check.status === "ok");
}

const scriptNames = (scripts: ReadonlyArray<{ readonly name: string }>) =>
  scripts.length === 0 ? "none" : scripts.map((script) => script.name).join(", ");

/** What applying one difference changes, with this computer's value first. */
export function libraryProfileDifferenceText(difference: LibraryProfileDifference): string {
  if (difference.field === "scripts")
    return `Scripts: ${scriptNames(difference.local)} here, ${scriptNames(difference.profile)} in the project setup`;
  return `Default model: ${difference.local?.model ?? "none"} here, ${difference.profile.model} in the project setup`;
}
