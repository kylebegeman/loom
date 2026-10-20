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

/** Only command families whose repository selection Loom can make authoritative are routed. */
export const githubTerminalArgs = (
  repository: string,
  command: VaultGitHubTerminalCommand,
): string[] | null => {
  const argv = [...command.argv];
  if (command.tool === "gh") {
    const [family, action, ...rest] = argv;
    if (!family || !action || !ghCommands[family]?.includes(action)) return null;
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
