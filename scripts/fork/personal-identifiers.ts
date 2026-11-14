// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - standalone git hook-style check, run by check:changed and CI.
// Fails when a change adds a personal infrastructure identifier to this public repository:
// a real tailnet name, a home directory under a real account name, a real-looking UUID outside
// test fixtures, or any entry of the private deny list. Lines that upstream already carries are
// exempt, so an upstream merge never fails it. See docs/fork/operations/personal-identifiers.md.
//
//   node scripts/fork/personal-identifiers.ts                compare against the merge base with origin/main
//   node scripts/fork/personal-identifiers.ts --base <ref>   compare against <ref>
//   node scripts/fork/personal-identifiers.ts --all          scan every tracked file
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
  readonly match: string;
  readonly text: string;
}

export interface DenyEntry {
  readonly label: string;
  readonly pattern: RegExp;
}

export interface AllowEntry {
  readonly path: RegExp;
  readonly text: string;
}

/** Tailnet labels that only ever appear as documented placeholders. */
const PLACEHOLDER_TAILNETS = new Set([
  "tail",
  "tailnet",
  "tail1234",
  "tailxxxx",
  "example",
  "your-tailnet",
  "my-tailnet",
]);

/** Account names used as examples in paths such as `/Users/me/project`. */
const PLACEHOLDER_USERS = new Set([
  "a",
  "admin",
  "alice",
  "bob",
  "carol",
  "desk",
  "dev",
  "developer",
  "example",
  "foo",
  "jane",
  "john",
  "laptop",
  "linuxbrew",
  "local",
  "loom",
  "me",
  "name",
  "node",
  "other",
  "runner",
  "server",
  "shared",
  "someone",
  "t3",
  "test",
  "tester",
  "u",
  "ubuntu",
  "user",
  "username",
  "x",
  "you",
]);
const PLACEHOLDER_USER_SUFFIX = /-(?:replay|user|test|fixture)$/;

/** Sample UUIDs from RFC 9562 appendix A, RFC 4122 and common documentation. */
const SAMPLE_UUIDS = new Set([
  "c232ab00-9414-11ec-b3c8-9f6bdeced846",
  "5df41881-3aed-3515-88a7-2f4a814cf09e",
  "919108f7-52d1-4320-9bac-f847db4148a8",
  "2ed6657d-e927-568b-95e1-2665a8aea6a2",
  "1ec9414c-232a-6b00-b3c8-9f6bdeced846",
  "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
  "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "550e8400-e29b-41d4-a716-446655440000",
  "123e4567-e89b-12d3-a456-426614174000",
]);

const TAILNET_HOST = /\b(?:[a-z0-9-]+\.)*?([a-z0-9-]+)\.ts\.net\b/gi;
// A path segment only counts when it starts a path, so `features/home/x` is not a home directory.
const HOME_DIRECTORY = /(?<![\w./-])\/(Users|home)\/([A-Za-z0-9._-]+)(?=\/|\b)/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const FIXTURE_PATH =
  /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|\.fixture\.[cm]?[jt]s$|(?:^|\/)(?:fixtures?|__fixtures__|testkit|__tests__|__snapshots__|cases)\/|\.ndjson$)/;
const SKIPPED_PATH = /^(?:\.repos\/|pnpm-lock\.yaml$|third-party-licenses\/)/;

/** Tailscale names a tailnet `tail` plus hex digits, or with two words such as `cobra-tuna`. */
export const isRealLookingTailnet = (label: string) => {
  const lower = label.toLowerCase();
  if (PLACEHOLDER_TAILNETS.has(lower)) return false;
  return /^tail[0-9a-f]{4,}$/.test(lower) || /^[a-z]+-[a-z]+$/.test(lower);
};

export const isPlaceholderUser = (name: string) => {
  const lower = name.toLowerCase();
  return (
    PLACEHOLDER_USERS.has(lower) ||
    PLACEHOLDER_USER_SUFFIX.test(lower) ||
    lower.startsWith("<") ||
    lower.startsWith(".")
  );
};

export const isSyntheticUuid = (uuid: string) => {
  const lower = uuid.toLowerCase();
  const hex = lower.replaceAll("-", "");
  return (
    SAMPLE_UUIDS.has(lower) ||
    /(.)\1{3}/.test(hex) ||
    hex.includes("1234") ||
    hex.includes("abcd") ||
    hex.includes("0000")
  );
};

/** One entry per line; `#` starts a comment, `re:` starts a case-insensitive regular expression. */
export const parseDenyList = (text: string): ReadonlyArray<DenyEntry> =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((entry, index) => ({
      label: `deny list entry ${index + 1}`,
      pattern: entry.startsWith("re:")
        ? new RegExp(entry.slice(3), "gi")
        : new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    }));

/** `path-glob<TAB>text`: a generic-rule finding is allowed when its path matches and its line contains the text. */
export const parseAllowList = (text: string): ReadonlyArray<AllowEntry> =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.startsWith("#"))
    .map((line) => {
      const [glob = "", allowed = ""] = line.split("\t");
      const source = glob
        .split("**")
        .map((part) =>
          part
            .split("*")
            .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
        )
        .join(".*");
      return { path: new RegExp(`^${source}$`), text: allowed };
    });

export const scanLine = (
  path: string,
  line: number,
  text: string,
  deny: ReadonlyArray<DenyEntry>,
  allow: ReadonlyArray<AllowEntry>,
): ReadonlyArray<Finding> => {
  const findings: Array<Finding> = [];
  const add = (rule: string, match: string) => findings.push({ path, line, rule, match, text });
  const allowed = allow.some((entry) => entry.path.test(path) && text.includes(entry.text));
  if (!allowed) {
    for (const [match, label = ""] of text.matchAll(TAILNET_HOST)) {
      if (isRealLookingTailnet(label)) add("tailnet name", match);
    }
    for (const [match, , name = ""] of text.matchAll(HOME_DIRECTORY)) {
      if (!isPlaceholderUser(name)) add("home directory", match);
    }
    if (!FIXTURE_PATH.test(path)) {
      for (const [match] of text.matchAll(UUID)) {
        if (!isSyntheticUuid(match)) add("UUID outside test fixtures", match);
      }
    }
  }
  for (const entry of deny) {
    for (const [match] of text.matchAll(entry.pattern)) add(entry.label, match);
  }
  return findings;
};

export interface AddedLine {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** Added lines from `git diff --unified=0` output. */
export const addedLines = (diff: string): ReadonlyArray<AddedLine> => {
  const lines: Array<AddedLine> = [];
  let path: string | null = null;
  let next = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      path = raw === "+++ /dev/null" ? null : raw.slice("+++ b/".length);
    } else if (raw.startsWith("@@ ")) {
      next = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (raw.startsWith("+") && path !== null) {
      lines.push({ path, line: next, text: raw.slice(1) });
      next++;
    } else if (raw.startsWith(" ")) {
      next++;
    }
  }
  return lines;
};

const git = (root: string, args: ReadonlyArray<string>, allowFailure = false) => {
  const result = NodeChildProcess.spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

const readIfPresent = (file: string) => {
  try {
    return NodeFS.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

export const DENY_LIST_FILE = ".personal-identifiers";

/** The private deny list: the environment first, then this checkout's file, then the main checkout's. */
const loadDenyList = (root: string) => {
  const inline = process.env.LOOM_PERSONAL_DENYLIST;
  if (inline?.trim()) return { source: "LOOM_PERSONAL_DENYLIST", text: inline };
  const explicit = process.env.LOOM_PERSONAL_DENYLIST_FILE;
  if (explicit) {
    const text = readIfPresent(explicit);
    if (text === null) throw new Error(`LOOM_PERSONAL_DENYLIST_FILE does not exist: ${explicit}`);
    return { source: explicit, text };
  }
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], true);
  const candidates = [NodePath.join(root, DENY_LIST_FILE)];
  if (common) candidates.push(NodePath.join(NodePath.dirname(common.trim()), DENY_LIST_FILE));
  for (const file of candidates) {
    const text = readIfPresent(file);
    if (text !== null) return { source: file, text };
  }
  return null;
};

/** The newest upstream release in HEAD's history, or upstream/main, whose lines are exempt. */
const upstreamRef = (root: string) => {
  const tag = git(root, ["tag", "-l", "v[0-9]*", "--merged", "HEAD", "--sort=-creatordate"], true)
    ?.split("\n")
    .find((name) => name.length > 0);
  if (tag) return tag;
  return git(root, ["rev-parse", "--verify", "--quiet", "upstream/main"], true)
    ? "upstream/main"
    : null;
};

const defaultBase = (root: string) => {
  for (const ref of ["origin/main", "main"]) {
    const base = git(root, ["merge-base", "HEAD", ref], true)?.trim();
    if (base) return base;
  }
  throw new Error("no merge base with origin/main or main; pass --base <ref>");
};

const isBinary = (text: string) => text.includes("\0");

const collectLines = (root: string, mode: { all: true } | { base: string }) => {
  if ("all" in mode) {
    const files = git(root, ["ls-files", "-z"])!.split("\0").filter(Boolean);
    return files.flatMap((path) => {
      if (SKIPPED_PATH.test(path)) return [];
      const text = readIfPresent(NodePath.join(root, path));
      if (text === null || isBinary(text)) return [];
      return text.split("\n").map((line, index) => ({ path, line: index + 1, text: line }));
    });
  }
  const diff = git(root, [
    "diff",
    "--unified=0",
    "--no-color",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--diff-filter=d",
    mode.base,
    "--",
  ])!;
  const untracked = git(root, ["ls-files", "-z", "--others", "--exclude-standard"])!
    .split("\0")
    .filter(Boolean)
    .flatMap((path) => {
      const text = readIfPresent(NodePath.join(root, path));
      if (text === null || isBinary(text)) return [];
      return text.split("\n").map((line, index) => ({ path, line: index + 1, text: line }));
    });
  return [...addedLines(diff), ...untracked].filter(({ path }) => !SKIPPED_PATH.test(path));
};

export const ALLOW_LIST_FILE = "docs/fork/personal-identifier-allowlist.tsv";

const main = () => {
  const args = process.argv.slice(2);
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])!.trim();
  const all = args.includes("--all");
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  if (baseIndex >= 0 && !base) throw new Error("--base needs a ref");

  const denyList = loadDenyList(root);
  const deny = denyList ? parseDenyList(denyList.text) : [];
  // The allowlist's own rows are the reviewed values, so the generic rules skip that file.
  const allow = [
    { path: new RegExp(`^${ALLOW_LIST_FILE.replaceAll(".", "\\.")}$`), text: "" },
    ...parseAllowList(readIfPresent(NodePath.join(root, ALLOW_LIST_FILE)) ?? ""),
  ];
  const lines = collectLines(root, all ? { all: true } : { base: base ?? defaultBase(root) });
  const candidates = lines.flatMap(({ path, line, text }) =>
    scanLine(path, line, text, deny, allow),
  );

  // Upstream's own lines are not ours to scrub; compare by trimmed text in the same file.
  const upstream = upstreamRef(root);
  const upstreamFiles = new Map<string, Set<string> | null>();
  const upstreamHas = (path: string, text: string) => {
    if (!upstream) return false;
    if (!upstreamFiles.has(path)) {
      const content = git(root, ["show", `${upstream}:${path}`], true);
      upstreamFiles.set(
        path,
        content === null ? null : new Set(content.split("\n").map((l) => l.trim())),
      );
    }
    return upstreamFiles.get(path)?.has(text.trim()) ?? false;
  };
  const findings = candidates.filter(({ path, text }) => !upstreamHas(path, text));

  if (!denyList) {
    console.log(
      `personal identifiers: no deny list (set LOOM_PERSONAL_DENYLIST or create ${DENY_LIST_FILE}); generic patterns only.`,
    );
  }
  if (findings.length === 0) {
    console.log(`personal identifiers: ${lines.length} lines checked, none found.`);
    return 0;
  }
  for (const finding of findings) {
    const text = finding.text.trim();
    console.log(
      `${finding.path}:${finding.line}: ${finding.rule}: ${finding.match}\n    ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`,
    );
  }
  console.log(
    `\npersonal identifiers: ${findings.length} found. Use a placeholder (machine.tailnet.ts.net, /Users/me, example.com), ` +
      `move personal setup notes to the private platform repository, or allowlist a reviewed placeholder in ${ALLOW_LIST_FILE}.`,
  );
  return 1;
};

if (import.meta.main) process.exit(main());
