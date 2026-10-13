// @effect-diagnostics nodeBuiltinImport:off - Exercises maintenance checks and database backups against isolated fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, expect, it } from "@effect/vitest";

const roots: string[] = [];
const script = NodePath.join(import.meta.dirname, "loom.sh");

function fixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-database-backup-"));
  roots.push(root);
  const userdata = NodePath.join(root, "userdata");
  const previous = NodePath.join(root, "previous");
  const current = NodePath.join(root, "current");
  NodeFS.mkdirSync(userdata);
  NodeFS.mkdirSync(NodePath.join(previous, "state"), { recursive: true });
  NodeFS.mkdirSync(current);
  NodeFS.writeFileSync(NodePath.join(previous, "build.env"), "upstream=test\n");
  return { userdata, previous, current };
}

function database(file: string, value: string) {
  NodeChildProcess.execFileSync("sqlite3", [
    file,
    `CREATE TABLE history(value TEXT); INSERT INTO history VALUES ('${value}');`,
  ]);
}

function history(file: string) {
  return NodeChildProcess.execFileSync(
    "sqlite3",
    ["-readonly", file, "SELECT value FROM history"],
    {
      encoding: "utf8",
    },
  ).trim();
}

function run(f: ReturnType<typeof fixture>, command: string) {
  return NodeChildProcess.execFileSync(
    "bash",
    [
      "-c",
      `
    source "$LOOM_TEST_SCRIPT"
    T3_USERDATA=$LOOM_TEST_USERDATA
    installed_record() { echo "$LOOM_TEST_CURRENT"; }
    records() { echo "$LOOM_TEST_PREVIOUS"; }
    quit_app() { :; }
    install_record() { :; }
    ${command}
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LOOM_TEST_SCRIPT: script,
        LOOM_TEST_USERDATA: f.userdata,
        LOOM_TEST_CURRENT: f.current,
        LOOM_TEST_PREVIOUS: f.previous,
      },
    },
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

it("saves and restores V1 and V2 history", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "state.sqlite"), "v1");
  database(NodePath.join(f.userdata, "statev2.sqlite"), "v2");
  run(f, 'snapshot_state "$LOOM_TEST_PREVIOUS"');
  expect(history(NodePath.join(f.previous, "state/state.sqlite"))).toBe("v1");
  expect(history(NodePath.join(f.previous, "state/statev2.sqlite"))).toBe("v2");
  NodeChildProcess.execFileSync("sqlite3", [
    NodePath.join(f.userdata, "statev2.sqlite"),
    "UPDATE history SET value = 'new-v2'",
  ]);
  run(f, "cmd_rollback");
  expect(history(NodePath.join(f.userdata, "statev2.sqlite"))).toBe("v2");
  expect(history(NodePath.join(f.current, "state/statev2.sqlite"))).toBe("new-v2");
});

it("restores a V2-only snapshot", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
  database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous");
  run(f, "cmd_rollback");
  expect(history(NodePath.join(f.userdata, "statev2.sqlite"))).toBe("previous");
  expect(history(NodePath.join(f.current, "state/statev2.sqlite"))).toBe("current");
});

it("removes the newer database when rolling back to a V1-only snapshot", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "statev2.sqlite"), "v2");
  database(NodePath.join(f.previous, "state/state.sqlite"), "v1");
  run(f, "cmd_rollback");
  expect(history(NodePath.join(f.userdata, "state.sqlite"))).toBe("v1");
  expect(NodeFS.existsSync(NodePath.join(f.userdata, "statev2.sqlite"))).toBe(false);
  expect(history(NodePath.join(f.current, "state/statev2.sqlite"))).toBe("v2");
});

function lintFixture(paths: string[] = []) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-fork-check-"));
  roots.push(root);
  for (const path of paths) {
    const absolutePath = NodePath.join(root, path);
    if (path.endsWith(".tsx")) {
      NodeFS.mkdirSync(NodePath.dirname(absolutePath), { recursive: true });
      NodeFS.writeFileSync(absolutePath, "");
    } else {
      NodeFS.mkdirSync(absolutePath, { recursive: true });
    }
  }
  const bin = NodePath.join(root, "bin");
  const log = NodePath.join(root, "calls.log");
  NodeFS.mkdirSync(bin);
  NodeFS.writeFileSync(
    NodePath.join(bin, "pnpm"),
    `#!/bin/bash
printf '%s\\t' "$@" >> "$LOOM_TEST_LOG"
printf '\\n' >> "$LOOM_TEST_LOG"
if [ "$1" = exec ] && [ "$2" = vp ] && [ "$3" = lint ]; then
  exit "$LOOM_TEST_LINT_STATUS"
fi
`,
    { mode: 0o755 },
  );
  NodeFS.writeFileSync(log, "");
  return { root, bin, log };
}

function runLint(f: ReturnType<typeof lintFixture>, command: string, lintStatus = 0) {
  return NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `
source "$LOOM_TEST_SCRIPT"
cd "$LOOM_TEST_ROOT"
export PATH="$LOOM_TEST_BIN:$PATH"
check_seams() { printf 'seams\\n' >> "$LOOM_TEST_LOG"; }
fork_tests() {
  printf 'discover-tests\\n' >> "$LOOM_TEST_LOG"
  printf 'apps/web/src/fork/example.test.ts\\n'
}
restore_lockfile() { printf 'restore-lockfile\\n' >> "$LOOM_TEST_LOG"; }
TYPECHECK_DIRS=(packages/contracts)
${command}
`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LOOM_TEST_SCRIPT: script,
        LOOM_TEST_ROOT: f.root,
        LOOM_TEST_BIN: f.bin,
        LOOM_TEST_LOG: f.log,
        LOOM_TEST_LINT_STATUS: String(lintStatus),
      },
    },
  );
}

function lintCalls(f: ReturnType<typeof lintFixture>) {
  return NodeFS.readFileSync(f.log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trimEnd().split("\t"));
}

it("discovers existing fork paths, including future surfaces and Loom routes", () => {
  const paths = [
    "apps/desktop/src/fork",
    "apps/server/src/fork",
    "apps/web/src/fork",
    "packages/client-runtime/src/fork",
    "packages/contracts/src/fork",
    "packages/shared/src/fork",
    "apps/web/src/routes/settings.loom.tsx",
    "apps/web/src/routes/settings.loom.models.tsx",
    "scripts/fork",
  ];
  const f = lintFixture([...paths, "apps/web/src/routes/settings.general.tsx", "apps/mobile/src"]);
  const result = runLint(f, "fork_lint_paths");
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n").sort()).toEqual([...paths].sort());
});

it("passes strict lint flags and only existing paths to vp", () => {
  const paths = ["apps/web/src/fork", "scripts/fork"];
  const f = lintFixture(paths);
  const result = runLint(f, "check_fork_lint");
  expect(result.status).toBe(0);
  expect(lintCalls(f)).toEqual([
    ["exec", "vp", "lint", "--report-unused-disable-directives", "--deny-warnings", ...paths],
  ]);
});

it("skips lint when no fork paths exist instead of linting the repository", () => {
  const f = lintFixture();
  const result = runLint(f, "check_fork_lint");
  expect(result.status).toBe(0);
  expect(lintCalls(f)).toEqual([]);
});

it("reports lint failure and exits unsuccessfully", () => {
  const f = lintFixture(["scripts/fork"]);
  const result = runLint(f, "check_fork_lint", 7);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("loom: fork lint failed; fix the findings above");
});

it("runs lint after installation and before tests, builds and typechecks", () => {
  const f = lintFixture(["apps/web/src/fork", "packages/contracts", "scripts/fork"]);
  const result = runLint(f, "run_checks");
  expect(result.status).toBe(0);
  expect(lintCalls(f)).toEqual([
    ["seams"],
    ["install", "--frozen-lockfile"],
    [
      "exec",
      "vp",
      "lint",
      "--report-unused-disable-directives",
      "--deny-warnings",
      "apps/web/src/fork",
      "scripts/fork",
    ],
    ["discover-tests"],
    [
      "exec",
      "vp",
      "test",
      "run",
      "--exclude",
      "**/.claude/**",
      "apps/web/src/fork/example.test.ts",
    ],
    ["exec", "vp", "build"],
    ["run", "-s", "typecheck"],
    ["restore-lockfile"],
  ]);
});

it("stops run_checks before discovering or running tests when lint fails", () => {
  const f = lintFixture(["apps/web/src/fork", "packages/contracts", "scripts/fork"]);
  const result = runLint(f, "run_checks", 1);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("loom: fork lint failed");
  expect(lintCalls(f).map(([first]) => first)).toEqual(["seams", "install", "exec"]);
  expect(lintCalls(f).at(-1)?.slice(0, 3)).toEqual(["exec", "vp", "lint"]);
});

function repositoryFixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-upstream-provenance-"));
  roots.push(root);
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_DATE: "2026-10-13T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-10-13T00:00:00Z",
      },
    }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Loom release fixture");
  git("config", "user.email", "loom-release@example.test");
  git("commit", "--quiet", "--allow-empty", "-m", "initial upstream");
  return { root, git };
}

function runMetadata(root: string, command: string, extraEnv: Record<string, string> = {}) {
  return NodeChildProcess.execFileSync(
    "bash",
    ["-c", `source "$LOOM_TEST_SCRIPT"; cd "$LOOM_TEST_ROOT"; ${command}`],
    {
      encoding: "utf8",
      env: { ...process.env, LOOM_TEST_SCRIPT: script, LOOM_TEST_ROOT: root, ...extraEnv },
    },
  ).trim();
}

it("reports true upstream provenance when Loom has a higher patch version", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.0.46-nightly.20261013.3044");
  f.git("commit", "--quiet", "--allow-empty", "-m", "Loom fixes");
  f.git(
    "tag",
    "-a",
    "loom-v0.0.48-nightly.20261013.3044",
    "-m",
    "Loom release\nloom-release=0.0.48-nightly.20261013.3044\nupstream=v0.0.46-nightly.20261013.3044",
  );
  expect(runMetadata(f.root, "current_upstream")).toBe("v0.0.46-nightly.20261013.3044");
});

it("reads upstream provenance from legacy Loom tag annotations", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.0.46-nightly.20261012.3035");
  f.git("commit", "--quiet", "--allow-empty", "-m", "Loom fixes");
  f.git(
    "tag",
    "-a",
    "loom-v0.0.47-nightly.20261013.3044",
    "-m",
    "Loom built from upstream v0.0.46-nightly.20261012.3035",
  );
  expect(runMetadata(f.root, "current_upstream")).toBe("v0.0.46-nightly.20261012.3035");
});

it("falls back to the newest genuine merged upstream tag when annotation is absent", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.0.46");
  f.git("tag", "v0.0.46-nightly.20261013.3044");
  f.git("commit", "--quiet", "--allow-empty", "-m", "Loom fixes");
  f.git("tag", "loom-v0.0.48-nightly.20261013.3044");
  expect(runMetadata(f.root, "current_upstream")).toBe("v0.0.46-nightly.20261013.3044");
});

it("does not accept annotation provenance for an upstream tag outside main", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.0.46-nightly.20261013.3044");
  f.git("checkout", "--quiet", "-b", "unmerged-upstream");
  f.git("commit", "--quiet", "--allow-empty", "-m", "future upstream");
  f.git("tag", "v0.0.46-nightly.20261014.3100");
  f.git("checkout", "--quiet", "main");
  f.git(
    "tag",
    "-a",
    "loom-v0.0.48-nightly.20261013.3044",
    "-m",
    "upstream=v0.0.46-nightly.20261014.3100",
  );
  expect(runMetadata(f.root, "current_upstream")).toBe("v0.0.46-nightly.20261013.3044");
});

it("records the checkout's upstream history independently of main", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.0.46-nightly.20261013.3044");
  const original = f.git("rev-parse", "HEAD");
  f.git("commit", "--quiet", "--allow-empty", "-m", "next upstream");
  f.git("tag", "v0.0.46-nightly.20261014.3100");
  f.git("checkout", "--quiet", "--detach", original);
  expect(runMetadata(f.root, "upstream_at HEAD")).toBe("v0.0.46-nightly.20261013.3044");
  expect(runMetadata(f.root, "current_upstream")).toBe("v0.0.46-nightly.20261014.3100");
});

it("does not manufacture upstream provenance when no genuine upstream tag exists", () => {
  const f = repositoryFixture();
  f.git("tag", "-a", "loom-v0.0.48-nightly.20261013.3044", "-m", "Loom fixes");
  expect(runMetadata(f.root, "current_upstream")).toBe("");
});

function installedFixture(metadata: string, version: string) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-installed-record-"));
  roots.push(root);
  const app = NodePath.join(root, "Loom.app");
  const builds = NodePath.join(root, "builds");
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const record = NodePath.join(builds, `${version}-${commit.slice(0, 10)}`);
  NodeFS.mkdirSync(NodePath.join(app, "Contents/Resources"), { recursive: true });
  NodeFS.mkdirSync(record, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(app, "Contents/Resources/loom-build.env"),
    `${metadata}\ncommit=${commit}\n`,
  );
  return { root, app, builds, record };
}

it("locates an installed record by its Loom version rather than its genuine upstream", () => {
  const f = installedFixture(
    "version=0.0.48-nightly.20261013.3044\nupstream=v0.0.46-nightly.20261013.3044",
    "0.0.48-nightly.20261013.3044",
  );
  expect(
    runMetadata(f.root, "APP_PATH=$LOOM_TEST_APP; BUILDS_DIR=$LOOM_TEST_BUILDS; installed_record", {
      LOOM_TEST_APP: f.app,
      LOOM_TEST_BUILDS: f.builds,
    }),
  ).toBe(f.record);
});

it("still locates legacy installed records carrying the version in upstream", () => {
  const f = installedFixture(
    "upstream=0.0.46-nightly.20261013.3044",
    "0.0.46-nightly.20261013.3044",
  );
  expect(
    runMetadata(f.root, "APP_PATH=$LOOM_TEST_APP; BUILDS_DIR=$LOOM_TEST_BUILDS; installed_record", {
      LOOM_TEST_APP: f.app,
      LOOM_TEST_BUILDS: f.builds,
    }),
  ).toBe(f.record);
});

it("suggests the exact saved commit after rollback instead of inventing a Loom tag", () => {
  const f = fixture();
  const commit = "0123456789abcdef0123456789abcdef01234567";
  NodeFS.writeFileSync(
    NodePath.join(f.previous, "build.env"),
    `version=0.0.48-nightly.20261013.3044\nupstream=v0.0.46-nightly.20261013.3044\ncommit=${commit}\n`,
  );
  database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
  database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous");
  const output = run(f, "cmd_rollback");
  expect(output).toContain(`git reset --hard ${commit}`);
  expect(output).not.toContain("git reset --hard loom-");
});

it("does not fabricate a rollback revision when legacy metadata has no commit", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
  database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous");
  const output = run(f, "cmd_rollback");
  expect(output).toContain("The previous build has no recorded source commit");
  expect(output).not.toContain("git reset --hard");
});
