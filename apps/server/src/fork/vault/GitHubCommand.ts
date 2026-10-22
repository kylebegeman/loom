import type { VaultGitHubTerminalCommand } from "@t3tools/contracts/fork";

const ghCommands: Readonly<Record<string, ReadonlyArray<string>>> = {
  repo: ["view"],
  pr: [
    "list",
    "view",
    "checks",
    "diff",
    "create",
    "comment",
    "close",
    "reopen",
    "merge",
    "ready",
    "review",
  ],
  issue: ["list", "view", "create", "comment", "close", "reopen"],
};
const ghValues = new Set([
  "--json",
  "--jq",
  "--template",
  "--limit",
  "-L",
  "--state",
  "-s",
  "--base",
  "-B",
  "--head",
  "-H",
  "--author",
  "-A",
  "--assignee",
  "-a",
  "--label",
  "-l",
  "--search",
  "-S",
  "--title",
  "-t",
  "--body",
  "-b",
  "--reviewer",
  "-r",
  "--milestone",
  "-m",
  "--project",
  "-p",
  "--reason",
  "--subject",
  "--match-head-commit",
]);
const ghSwitches = new Set([
  "--draft",
  "--fill",
  "--fill-first",
  "--fill-verbose",
  "--comments",
  "--patch",
  "--name-only",
  "--required",
  "--watch",
  "--fail-fast",
  "--approve",
  "--request-changes",
  "--comment",
  "--squash",
  "--merge",
  "--rebase",
  "--auto",
  "--disable-auto",
  "--delete-branch",
  "--admin",
  "--undo",
]);
const remote = (value: string, repository: string) =>
  value === "origin" ||
  value.toLowerCase() === `https://github.com/${repository}` ||
  value.toLowerCase() === `https://github.com/${repository}.git`;
const ref = /^[+a-zA-Z0-9_][a-zA-Z0-9_./:*+-]{0,255}$/;

type GhOption =
  | "text"
  | "count"
  | "id"
  | "ref"
  | "file"
  | "directory"
  | "field"
  | "archive"
  | "order"
  | "switch"
  | "boolean";
const formatting: Readonly<Record<string, GhOption>> = {
  "--json": "text",
  "--jq": "text",
  "-q": "text",
  "--template": "text",
  "-t": "text",
};
const listing: Readonly<Record<string, GhOption>> = {
  ...formatting,
  "--limit": "count",
  "-L": "count",
};
const releaseNotes: Readonly<Record<string, GhOption>> = {
  "--title": "text",
  "-t": "text",
  "--notes": "text",
  "-n": "text",
  "--notes-file": "file",
  "-F": "file",
  "--draft": "boolean",
  "--prerelease": "boolean",
  "--latest": "boolean",
  "--verify-tag": "switch",
};
const publicationCommands: Readonly<Record<string, Readonly<Record<string, GhOption>>>> = {
  "release list": {
    ...listing,
    "--exclude-drafts": "switch",
    "--exclude-pre-releases": "switch",
    "--order": "order",
    "-O": "order",
  },
  "release view": formatting,
  "release create": {
    ...releaseNotes,
    "-d": "boolean",
    "-p": "boolean",
    "--target": "ref",
    "--generate-notes": "switch",
    "--notes-from-tag": "switch",
    "--notes-start-tag": "ref",
    "--fail-on-no-commits": "switch",
  },
  "release edit": releaseNotes,
  "release upload": { "--clobber": "switch" },
  "release download": {
    "--dir": "directory",
    "-D": "directory",
    "--pattern": "text",
    "-p": "text",
    "--archive": "archive",
    "-A": "archive",
  },
  "workflow list": { ...listing, "--all": "switch", "-a": "switch" },
  "workflow view": { "--ref": "ref", "-r": "ref", "--yaml": "switch", "-y": "switch" },
  "workflow run": { "--ref": "ref", "-r": "ref", "--raw-field": "field", "-f": "field" },
  "run list": {
    ...listing,
    "--workflow": "text",
    "-w": "text",
    "--branch": "ref",
    "-b": "ref",
    "--commit": "ref",
    "-c": "ref",
    "--event": "text",
    "-e": "text",
    "--status": "text",
    "-s": "text",
    "--user": "text",
    "-u": "text",
    "--created": "text",
    "--all": "switch",
    "-a": "switch",
  },
  "run view": {
    ...formatting,
    "--attempt": "count",
    "-a": "count",
    "--job": "id",
    "-j": "id",
    "--log": "switch",
    "--log-failed": "switch",
    "--exit-status": "switch",
    "--verbose": "switch",
    "-v": "switch",
  },
  "run watch": {
    "--interval": "count",
    "-i": "count",
    "--exit-status": "switch",
    "--compact": "switch",
  },
  "run rerun": { "--failed": "switch", "--job": "id", "-j": "id" },
  "run cancel": {},
};
const publicationRef = (value: string) =>
  /^[a-zA-Z0-9_][a-zA-Z0-9_./+-]{0,255}$/.test(value) &&
  !value.includes("..") &&
  !value.includes("//") &&
  !value.endsWith("/");
const literalFile = (value: string) => {
  if (!value || value.startsWith("-") || /[*?[\]{}\\]/.test(value)) return false;
  for (const character of value) if (character.charCodeAt(0) < 32) return false;
  return true;
};
const publicationOption = (kind: GhOption, value: string) => {
  switch (kind) {
    case "count":
      return /^[1-9][0-9]{0,3}$/.test(value);
    case "id":
      return /^[1-9][0-9]{0,19}$/.test(value);
    case "ref":
      return publicationRef(value);
    case "file":
    case "directory":
      return literalFile(value);
    case "field":
      return /^[a-zA-Z_][a-zA-Z0-9_-]*=/.test(value);
    case "archive":
      return value === "zip" || value === "tar.gz";
    case "order":
      return value === "asc" || value === "desc";
    default:
      return true;
  }
};
const publicationArgs = (
  repository: string,
  family: string,
  action: string,
  rest: ReadonlyArray<string>,
): string[] | null => {
  const options = publicationCommands[`${family} ${action}`];
  if (!options) return null;
  const seen = new Set<string>();
  const flags: string[] = [],
    positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i]!;
    if (!value.startsWith("-")) {
      positional.push(value);
      continue;
    }
    const split = value.indexOf("="),
      flag = split < 0 ? value : value.slice(0, split);
    if (flag === "--repo" || flag === "-R") {
      const argument = split < 0 ? rest[++i] : value.slice(split + 1);
      if (argument?.toLowerCase() !== repository) return null;
      continue;
    }
    const kind = options[flag];
    if (!kind) return null;
    seen.add(flag === "-F" ? "--notes-file" : flag === "-D" ? "--dir" : flag);
    if (kind === "switch" || kind === "boolean") {
      if (split >= 0) {
        const argument = value.slice(split + 1);
        if (kind !== "boolean" || (argument !== "true" && argument !== "false")) return null;
      }
      flags.push(value);
      continue;
    }
    const argument = split < 0 ? rest[++i] : value.slice(split + 1);
    if (!argument || !publicationOption(kind, argument)) return null;
    flags.push(flag === "-F" ? "--notes-file" : flag === "-D" ? "--dir" : flag, argument);
  }
  if (action === "list") {
    if (positional.length) return null;
  } else if (family === "release") {
    if (!positional[0] || !publicationRef(positional[0])) return null;
    if (action === "create" || action === "upload") {
      if (action === "upload" && positional.length < 2) return null;
      if (positional.slice(1).some((file) => !literalFile(file.split("#")[0]!))) return null;
      if (
        action === "create" &&
        !["--notes", "-n", "--notes-file", "--generate-notes", "--notes-from-tag"].some((flag) =>
          seen.has(flag),
        )
      )
        return null;
    } else if (positional.length !== 1) return null;
    if (action === "download" && !seen.has("--dir")) return null;
    // Creating a release must never silently create its source tag at the default branch.
    if (action === "create" && !seen.has("--verify-tag")) flags.push("--verify-tag");
  } else if (positional.length !== 1) return null;
  else if (family === "run" && !/^[1-9][0-9]{0,19}$/.test(positional[0]!)) return null;
  else if (family === "workflow" && !/^[a-zA-Z0-9_][a-zA-Z0-9_. -]{0,199}$/.test(positional[0]!))
    return null;
  return [family, action, ...positional, "--repo", repository, ...flags];
};

/** Only command families whose repository selection Loom can make authoritative are routed. */
export const githubTerminalArgs = (
  repository: string,
  command: VaultGitHubTerminalCommand,
): string[] | null => {
  const argv = [...command.argv];
  if (command.tool === "gh") {
    const [family, action, ...rest] = argv;
    if (!family || !action) return null;
    if (family === "release" || family === "workflow" || family === "run")
      return publicationArgs(repository, family, action, rest);
    if (!ghCommands[family]?.includes(action)) return null;
    const flags: string[] = [],
      positional: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const value = rest[i]!;
      const split = value.indexOf("=");
      const flag = split < 0 ? value : value.slice(0, split);
      if (flag === "--repo" || flag === "-R" || ghValues.has(flag)) {
        const argument = split < 0 ? rest[++i] : value.slice(split + 1);
        if (!argument) return null;
        if (flag === "--repo" || flag === "-R") {
          if (argument.toLowerCase() !== repository) return null;
        } else flags.push(flag, argument);
      } else if (ghSwitches.has(value)) flags.push(value);
      else if (value.startsWith("-")) return null;
      else positional.push(value);
    }
    if (family === "repo") {
      if (positional.length > 1 || (positional[0] && positional[0].toLowerCase() !== repository))
        return null;
      return [family, action, repository, ...flags];
    }
    if (action === "list" || action === "create") {
      if (positional.length) return null;
    } else if (positional.length !== 1 || !/^[1-9][0-9]{0,9}$/.test(positional[0]!)) return null;
    return [family, action, ...positional, "--repo", repository, ...flags];
  }
  const action = argv.shift();
  if (!action || !["ls-remote", "fetch", "push", "clone"].includes(action)) return null;
  const switches = new Set(
    action === "ls-remote"
      ? ["--heads", "--tags", "--refs", "--symref", "--exit-code", "--quiet"]
      : action === "fetch"
        ? [
            "--prune",
            "--prune-tags",
            "--tags",
            "--no-tags",
            "--force",
            "--quiet",
            "--verbose",
            "--dry-run",
            "--atomic",
          ]
        : action === "push"
          ? [
              "--dry-run",
              "--force-with-lease",
              "--force",
              "--delete",
              "--tags",
              "--all",
              "--set-upstream",
              "--atomic",
              "--porcelain",
              "--quiet",
            ]
          : ["--bare", "--no-checkout", "--single-branch", "--quiet"],
  );
  const flags: string[] = [],
    positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!;
    if (switches.has(value)) flags.push(value);
    else if (
      (action === "clone" || action === "fetch") &&
      (value === "--depth" || value.startsWith("--depth="))
    ) {
      const depth = value === "--depth" ? argv[++i] : value.slice(8);
      if (!depth || !/^[1-9][0-9]{0,5}$/.test(depth)) return null;
      flags.push("--depth", depth);
    } else if (action === "clone" && (value === "--branch" || value === "-b")) {
      const branch = argv[++i];
      if (!branch || !ref.test(branch)) return null;
      flags.push("--branch", branch);
    } else if (value.startsWith("-")) return null;
    else positional.push(value);
  }
  if (!positional[0] || !remote(positional[0], repository)) return null;
  if (action === "clone") {
    if (
      positional[0] === "origin" ||
      positional.length > 2 ||
      (positional[1] && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(positional[1]))
    )
      return null;
  } else if (positional.slice(1).some((value) => !ref.test(value))) return null;
  return [
    action,
    ...flags,
    `https://github.com/${repository}.git`,
    ...positional.slice(1),
    ...(action === "fetch" && positional[0] === "origin" && positional.length === 1
      ? ["+refs/heads/*:refs/remotes/origin/*"]
      : []),
  ];
};
