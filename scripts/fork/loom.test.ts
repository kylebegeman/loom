// @effect-diagnostics nodeBuiltinImport:off - Exercises maintenance checks and database backups against isolated fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeVM from "node:vm";

import { afterEach, expect, it } from "@effect/vitest";

const roots: string[] = [];
const script = NodePath.join(import.meta.dirname, "loom.sh");
const BUILT_EARLIER = "2026-10-01T00:00:00Z";

function fixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-database-backup-"));
  roots.push(root);
  const userdata = NodePath.join(root, "userdata");
  const previous = NodePath.join(root, "previous");
  const current = NodePath.join(root, "current");
  NodeFS.mkdirSync(userdata);
  NodeFS.mkdirSync(NodePath.join(previous, "state"), { recursive: true });
  NodeFS.mkdirSync(current);
  NodeFS.writeFileSync(
    NodePath.join(previous, "build.env"),
    `upstream=test\nbuilt=${BUILT_EARLIER}\n`,
  );
  NodeFS.writeFileSync(NodePath.join(current, "build.env"), "built=2026-10-02T00:00:00Z\n");
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
    APP_PATH="$LOOM_TEST_CURRENT/Loom.app"
    mkdir -p "$APP_PATH"
    installed_record() { echo "$LOOM_TEST_CURRENT"; }
    records() { echo "$LOOM_TEST_PREVIOUS"; }
    quit_app() { :; }
    install_record() { rm -rf "$2/Loom.app"; }
    verify_install_signing() { :; }
    prepare_install() { verify_install_signing "$1" || return; mkdir -p "$LOOM_TEST_CURRENT/prepared/Loom.app"; echo "$LOOM_TEST_CURRENT/prepared"; }
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

it("saves committed data that only the WAL holds", () => {
  const f = fixture();
  const live = new NodeSqlite.DatabaseSync(NodePath.join(f.userdata, "statev2.sqlite"));
  try {
    live.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    live.exec("CREATE TABLE history(value TEXT); INSERT INTO history VALUES ('uncheckpointed')");
    run(f, 'snapshot_state "$LOOM_TEST_PREVIOUS"');
  } finally {
    live.close();
  }
  expect(NodeFS.existsSync(NodePath.join(f.previous, "state/statev2.sqlite-wal"))).toBe(true);
  expect(history(NodePath.join(f.previous, "state/statev2.sqlite"))).toBe("uncheckpointed");
});

it("keeps the existing snapshot when the disk could not hold another copy", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
  database(NodePath.join(f.previous, "state/statev2.sqlite"), "saved");
  expect(() => run(f, 'free_bytes() { echo 0; }; snapshot_state "$LOOM_TEST_PREVIOUS"')).toThrow(
    /Not enough free disk space/,
  );
  expect(history(NodePath.join(f.previous, "state/statev2.sqlite"))).toBe("saved");
  expect(NodeFS.readdirSync(f.previous).sort()).toEqual(["build.env", "state"]);
});

it("does not roll back when the outgoing data cannot be saved", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
  database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous");
  expect(() => run(f, "free_bytes() { echo 0; }; cmd_rollback")).toThrow(/nothing was rolled back/);
  expect(history(NodePath.join(f.userdata, "statev2.sqlite"))).toBe("current");
});

it("installs without a snapshot when none can be saved, and says so", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-install-unsaved-"));
  roots.push(root);
  const app = NodePath.join(root, "Loom.app");
  const record = NodePath.join(root, "record");
  NodeFS.mkdirSync(app);
  NodeFS.mkdirSync(NodePath.join(record, "Loom.app"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(record, "Loom.app/candidate"), "new bytes");
  const result = NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `source "$LOOM_TEST_SCRIPT"
      APP_PATH=$LOOM_TEST_APP
      BUILDS_DIR=$LOOM_TEST_ROOT
      verify_install_signing() { :; }
      quit_app() { :; }
      installed_record() { :; }
      snapshot_state() { return 1; }
      ditto() { cp -R "$1" "$2"; }
      open() { :; }
      installed_version() { echo test; }
      install_record "$LOOM_TEST_RECORD"`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LOOM_TEST_SCRIPT: script,
        LOOM_TEST_APP: app,
        LOOM_TEST_ROOT: root,
        LOOM_TEST_RECORD: record,
      },
    },
  );
  expect(result.status).toBe(0);
  expect(NodeFS.readFileSync(NodePath.join(app, "candidate"), "utf8")).toBe("new bytes");
  expect(result.stderr).toContain("the T3 data was not saved");
});

function buildsFixture(names: ReadonlyArray<string>) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-retention-"));
  roots.push(root);
  const records = names.map((name, index) => {
    const dir = NodePath.join(root, name);
    NodeFS.mkdirSync(NodePath.join(dir, "updates"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, "updates/ready"), "");
    NodeFS.writeFileSync(
      NodePath.join(dir, "build.env"),
      `built=2026-10-0${index + 1}T00:00:00Z\n`,
    );
    return dir;
  });
  const saveState = (dir: string, savedAt: number) => {
    NodeFS.mkdirSync(NodePath.join(dir, "state"));
    NodeFS.utimesSync(NodePath.join(dir, "state"), savedAt, savedAt);
  };
  const runIn = (command: string, installed: string) =>
    runMetadata(
      root,
      `BUILDS_DIR=$LOOM_TEST_ROOT; installed_record() { echo "$LOOM_TEST_INSTALLED"; }; ${command}`,
      { LOOM_TEST_INSTALLED: installed },
    );
  return { root, records, saveState, runIn };
}

it("rolls back to the build this Mac ran before, not a newer build it never opened", () => {
  const b = buildsFixture(["a", "b", "current", "unopened", "left-by-rollback"]);
  const [a, previous, current, , leftByRollback] = b.records as [
    string,
    string,
    string,
    string,
    string,
  ];
  b.saveState(a, 1_000);
  b.saveState(previous, 2_000);
  b.saveState(leftByRollback, 3_000);
  expect(b.runIn(`rollback_target "${current}"`, current)).toBe(previous);
});

it("keeps two snapshots, and every build holding one", () => {
  const b = buildsFixture(["1", "2", "3", "4", "5", "6", "7"]);
  const [first, second, third, installed] = b.records as [string, string, string, string];
  b.saveState(first, 1_000);
  b.saveState(second, 2_000);
  b.saveState(third, 3_000);
  b.runIn("prune_snapshots; prune_builds", installed);
  expect(NodeFS.readdirSync(b.root).sort()).toEqual(["2", "3", "4", "5", "6", "7"]);
  expect(NodeFS.existsSync(NodePath.join(second, "state"))).toBe(true);
  expect(NodeFS.existsSync(NodePath.join(third, "state"))).toBe(true);
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
if [ "$1" = exec ] && [ "$2" = vp ] && [ "$3" = build ]; then
  exit "$LOOM_TEST_BUILD_STATUS"
fi
if [ "$1" = install ]; then
  exit "$LOOM_TEST_INSTALL_STATUS"
fi
`,
    { mode: 0o755 },
  );
  NodeFS.writeFileSync(log, "");
  const desktopScripts = NodePath.join(root, "apps", "desktop", "scripts");
  NodeFS.mkdirSync(desktopScripts, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(desktopScripts, "ensure-electron-runtime.mjs"),
    'import fs from "node:fs"; fs.appendFileSync(process.env.LOOM_TEST_LOG, "electron-runtime\\n");',
  );
  return { root, bin, log };
}

function runLint(
  f: ReturnType<typeof lintFixture>,
  command: string,
  {
    lint = 0,
    install = 0,
    build = 0,
  }: { readonly lint?: number; readonly install?: number; readonly build?: number } = {},
) {
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
  printf '%s\\n' apps/mobile/src/lib/navigation.test.ts apps/web/src/fork/example.test.ts \\
    apps/web/src/fork/other.test.ts
}
fork_edited_code() { printf '%s\\n' apps/web/src/components/Sidebar.tsx; }
fork_browser_tests() { printf '%s\\n' src/components/Sidebar.browser.test.tsx; }
restore_lockfile() { printf 'restore-lockfile\\n' >> "$LOOM_TEST_LOG"; }
check_omarchy_pack() { printf 'omarchy-pack\\n' >> "$LOOM_TEST_LOG"; }
check_web_boot() { printf 'web-boot\\n' >> "$LOOM_TEST_LOG"; }
typecheck_dirs() { printf '%s\\n' packages/contracts; }
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
        LOOM_TEST_LINT_STATUS: String(lint),
        LOOM_TEST_INSTALL_STATUS: String(install),
        LOOM_TEST_BUILD_STATUS: String(build),
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
    "apps/web/src/routes/_chat.settings.loom.tsx",
    "apps/web/src/routes/_chat.settings.loom.models.tsx",
    "scripts/fork",
    "deploy/omarchy",
    "benchmarks/loom",
    "apps/server/scripts/benchmark-library.ts",
  ];
  const f = lintFixture([
    ...paths,
    "apps/web/src/routes/_chat.settings.general.tsx",
    "apps/mobile/src",
  ]);
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
  const result = runLint(f, "check_fork_lint", { lint: 7 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("loom: fork lint failed; fix the findings above");
});

it("lints the upstream files the fork edits with upstream's flags, and nothing when it edits none", () => {
  const f = lintFixture();
  expect(runLint(f, "check_edited_lint").status).toBe(0);
  expect(lintCalls(f)).toEqual([
    [
      "exec",
      "vp",
      "lint",
      "--report-unused-disable-directives",
      "apps/web/src/components/Sidebar.tsx",
    ],
  ]);

  const none = lintFixture();
  expect(runLint(none, "fork_edited_code() { :; }; check_edited_lint").status).toBe(0);
  expect(lintCalls(none)).toEqual([]);

  const failing = lintFixture();
  const result = runLint(failing, "check_edited_lint", { lint: 1 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("loom: lint failed in files the fork edits");
});

it("runs lint after installation, then builds, boots and typechecks, and the tests last", () => {
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
    [
      "exec",
      "vp",
      "lint",
      "--report-unused-disable-directives",
      "apps/web/src/components/Sidebar.tsx",
    ],
    ["omarchy-pack"],
    ["exec", "vp", "build"],
    ["web-boot"],
    ["exec", "vp", "run", "typecheck"],
    ["exec", "tsc", "--noEmit", "-p", "benchmarks/loom/tsconfig.json"],
    ["electron-runtime"],
    [
      "exec",
      "vp",
      "test",
      "run",
      "--exclude",
      "**/.claude/**",
      "apps/mobile/src/lib/navigation.test.ts",
    ],
    [
      "exec",
      "vp",
      "test",
      "run",
      "--exclude",
      "**/.claude/**",
      "apps/web/src/fork/example.test.ts",
      "apps/web/src/fork/other.test.ts",
    ],
    ["exec", "playwright", "install", "--only-shell", "chromium"],
    [
      "exec",
      "vp",
      "test",
      "run",
      "--project",
      "browser",
      "src/components/Sidebar.browser.test.tsx",
    ],
    ["restore-lockfile"],
  ]);
});

it("runs every check after a failing lint and lists the failures at the end", () => {
  const f = lintFixture(["apps/web/src/fork", "packages/contracts", "scripts/fork"]);
  const result = runLint(f, "run_checks", { lint: 1 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("loom: fork lint failed");
  expect(result.stderr.trimEnd().split("\n").slice(-2)).toEqual([
    "loom: check failed: Linting fork code",
    "loom: check failed: Linting upstream files the fork edits",
  ]);
  expect(lintCalls(f).map(([first, second]) => second ?? first)).toEqual([
    "seams",
    "--frozen-lockfile",
    "vp",
    "vp",
    "omarchy-pack",
    "vp",
    "web-boot",
    "vp",
    "tsc",
    "electron-runtime",
    "vp",
    "vp",
    "playwright",
    "vp",
    "restore-lockfile",
  ]);
});

it("boots no stale web client when the build fails, and still runs the rest", () => {
  const f = lintFixture(["apps/web/src/fork", "packages/contracts", "scripts/fork"]);
  const result = runLint(f, "run_checks", { build: 1 });
  expect(result.status).toBe(1);
  expect(
    result.stderr
      .trimEnd()
      .split("\n")
      .filter((line) => line.startsWith("loom: ")),
  ).toEqual(["loom: check failed: Regenerating web routes and building the web client"]);
  const calls = lintCalls(f).map(([first, second, third]) =>
    second ? `${second} ${third}` : first,
  );
  expect(calls).not.toContain("web-boot");
  expect(calls.slice(calls.indexOf("vp build"))).toEqual([
    "vp build",
    "vp run",
    "tsc --noEmit",
    "electron-runtime",
    "vp test",
    "vp test",
    "playwright install",
    "vp test",
    "restore-lockfile",
  ]);
});

it("skips every later check when installing dependencies fails", () => {
  const f = lintFixture(["apps/web/src/fork", "packages/contracts", "scripts/fork"]);
  const result = runLint(f, "run_checks", { install: 1 });
  expect(result.status).toBe(1);
  expect(
    result.stderr
      .trimEnd()
      .split("\n")
      .filter((line) => line.startsWith("loom: ")),
  ).toEqual(["loom: check failed: Installing dependencies"]);
  expect(lintCalls(f)).toEqual([["seams"], ["install", "--frozen-lockfile"], ["restore-lockfile"]]);
});

it("fails instead of skipping typechecks and tests it cannot list", () => {
  const f = lintFixture(["apps/web/src/fork"]);
  const result = runLint(
    f,
    "typecheck_dirs() { return 1; }; fork_tests() { return 1; }; run_checks",
  );
  expect(result.status).toBe(1);
  expect(result.stderr.split("\n").filter((line) => line.startsWith("loom: check failed"))).toEqual(
    [
      "loom: check failed: Listing the packages to typecheck",
      "loom: check failed: Listing the fork's tests",
    ],
  );
  expect(lintCalls(f).filter(([, second, third]) => second === "vp" && third !== "lint")).toEqual([
    ["exec", "vp", "build"],
    [
      "exec",
      "vp",
      "test",
      "run",
      "--project",
      "browser",
      "src/components/Sidebar.browser.test.tsx",
    ],
  ]);
});

it("typechecks every workspace package with a typecheck script or Vite+ task", () => {
  const f = lintFixture();
  const write = (path: string, contents: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(f.root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(f.root, path), contents);
  };
  write("package.json", '{"scripts":{"typecheck":"vp run -r typecheck"}}');
  write("apps/web/package.json", '{"scripts":{"build":"vite build"}}');
  write(
    "apps/web/vite.config.ts",
    "export default {\n  run: {\n    tasks: {\n      typecheck: {\n",
  );
  write("packages/shared/package.json", '{"scripts":{"typecheck":"tsc --noEmit"}}');
  write("packages/docs/package.json", '{"scripts":{"build":"astro build"}}');
  const dirs = runMetadata(
    f.root,
    `pnpm() { local r; r=$(pwd -P); printf '%s\\n' "$r" "$r/apps/web" "$r/packages/docs" "$r/packages/shared"; }
typecheck_dirs`,
  );
  expect(dirs.split("\n")).toEqual(["apps/web", "packages/shared"]);
});

it("runs the tests of each file the fork adds or changes since the upstream release HEAD holds", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-fork-tests-"));
  roots.push(root);
  let day = 10;
  const git = (...args: string[]) => {
    const date = `2026-10-${day++}T00:00:00Z`;
    return NodeChildProcess.execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
  };
  const write = (path: string, contents: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), contents);
  };
  git("init", "--quiet", "--initial-branch=upstream");
  git("config", "user.name", "Loom fixture");
  git("config", "user.email", "loom@example.test");
  for (const path of [
    "apps/web/src/kept.test.ts",
    "apps/web/src/forked.test.ts",
    "apps/web/src/dropped.test.ts",
    "apps/web/src/later.test.ts",
    "apps/web/src/view.browser.test.tsx",
    "apps/web/src/model.ts",
    "apps/web/src/model.test.ts",
    "apps/web/src/panel.tsx",
    "apps/web/src/panel.browser.test.tsx",
    "apps/web/src/untouched.ts",
    "apps/web/src/untouched.test.ts",
    "packages/shared/src/dirty.test.ts",
  ]) {
    write(path, "upstream\n");
  }
  git("add", "-A");
  git("commit", "--quiet", "-m", "upstream");
  git("tag", "-a", "v1.0.0", "-m", "v1.0.0");
  git("switch", "--quiet", "-c", "main");
  write("apps/web/src/forked.test.ts", "fork\n");
  write("apps/web/src/view.browser.test.tsx", "fork\n");
  write("apps/web/src/model.ts", "fork\n");
  write("apps/web/src/panel.tsx", "fork\n");
  write("apps/mobile/src/fork/added.test.ts", "fork\n");
  NodeFS.rmSync(NodePath.join(root, "apps/web/src/dropped.test.ts"));
  git("add", "-A");
  git("commit", "--quiet", "-m", "fork");
  git("switch", "--quiet", "upstream");
  write("apps/web/src/later.test.ts", "upstream again\n");
  git("commit", "--quiet", "-am", "upstream again");
  git("tag", "-a", "v1.1.0", "-m", "v1.1.0");
  write("apps/web/src/kept.test.ts", "upstream, unmerged\n");
  git("commit", "--quiet", "-am", "upstream, unmerged");
  git("tag", "-a", "v1.2.0", "-m", "v1.2.0");
  git("switch", "--quiet", "main");
  git("merge", "--quiet", "--no-edit", "v1.1.0");
  git("tag", "-a", "loom-v1.1.0", "-m", "Loom built from upstream v1.1.0");
  git("tag", "-a", "0.0.5-nightly.1", "-m", "Loom release");
  write("packages/shared/src/dirty.test.ts", "uncommitted fork change\n");
  const tests = [
    "apps/mobile/src/fork/added.test.ts",
    "apps/web/src/forked.test.ts",
    "apps/web/src/model.test.ts",
    "packages/shared/src/dirty.test.ts",
    "scripts/brand.test.ts",
  ];
  expect(runMetadata(root, "BRAND_TESTS=(scripts/brand.test.ts); fork_tests")).toBe(
    tests.join("\n"),
  );
  expect(
    runMetadata(root, "BRAND_TESTS=(scripts/brand.test.ts); fork_tests | test_package | sort -u"),
  ).toBe(["apps/mobile", "apps/web", "packages/shared", "scripts"].join("\n"));
  expect(runMetadata(root, "fork_browser_tests")).toBe(
    ["src/panel.browser.test.tsx", "src/view.browser.test.tsx"].join("\n"),
  );
  // Files under fork_lint_paths get the fork's stricter lint instead.
  expect(runMetadata(root, "fork_edited_code")).toBe(
    [
      "apps/web/src/forked.test.ts",
      "apps/web/src/model.ts",
      "apps/web/src/panel.tsx",
      "apps/web/src/view.browser.test.tsx",
      "packages/shared/src/dirty.test.ts",
    ].join("\n"),
  );
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

it("offers only published builds to install and rollback", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-records-"));
  roots.push(root);
  const record = (name: string, built: string, published: boolean) => {
    const dir = NodePath.join(root, name);
    NodeFS.mkdirSync(NodePath.join(dir, "updates"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, "build.env"), `built=${built}\n`);
    if (published) NodeFS.writeFileSync(NodePath.join(dir, "updates/ready"), "");
    return dir;
  };
  const older = record("0.0.55-nightly.20261014.3054-aaaaaaaaaa", "2026-10-14T00:00:00Z", true);
  record("0.0.46-nightly.20261015.3158-bbbbbbbbbb", "2026-10-15T00:00:00Z", false);
  const newer = record("0.0.56-nightly.20261015.3158-cccccccccc", "2026-10-15T01:00:00Z", true);
  expect(
    runMetadata(root, "BUILDS_DIR=$LOOM_TEST_BUILDS; records", { LOOM_TEST_BUILDS: root }),
  ).toBe(`${newer}\n${older}`);
});

it("suggests the exact saved commit after rollback instead of inventing a Loom tag", () => {
  const f = fixture();
  const commit = "0123456789abcdef0123456789abcdef01234567";
  NodeFS.writeFileSync(
    NodePath.join(f.previous, "build.env"),
    `version=0.0.48-nightly.20261013.3044\nupstream=v0.0.46-nightly.20261013.3044\ncommit=${commit}\nbuilt=${BUILT_EARLIER}\n`,
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

function runningAppState(
  apps: ReadonlyArray<{ readonly bundleURL: { readonly path: string } | null }>,
) {
  return NodeVM.runInNewContext(
    NodeFS.readFileSync(NodePath.join(import.meta.dirname, "running-apps.js"), "utf8") +
      "\nrun(paths)",
    {
      ObjC: { import: () => {}, unwrap: (value: string) => value },
      $: {
        NSWorkspace: {
          sharedWorkspace: {
            runningApplications: {
              count: apps.length,
              objectAtIndex: (index: number) => apps[index],
            },
          },
        },
      },
      paths: ["/Applications/Loom.app", "/Applications/T3 Code (Alpha).app"],
    },
  );
}

it.each(["/Applications/Loom.app", "/Applications/T3 Code (Alpha).app"])(
  "waits for the registered desktop app at %s",
  (path) => {
    expect(runningAppState([{ bundleURL: { path } }])).toBe("running");
  },
);

it("does not treat helper processes or a different installation as the desktop app", () => {
  expect(
    runningAppState([
      { bundleURL: null },
      { bundleURL: { path: "/Users/kyle/other/Loom.app" } },
      { bundleURL: { path: "/Applications/Loom.app.old" } },
    ]),
  ).toBe("stopped");
});

it("refuses installation when application discovery fails", () => {
  const result = NodeChildProcess.spawnSync(
    "bash",
    ["-c", 'source "$LOOM_TEST_SCRIPT"; osascript() { return 1; }; app_running; echo unsafe'],
    { encoding: "utf8", env: { ...process.env, LOOM_TEST_SCRIPT: script } },
  );
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain("unsafe");
  expect(result.stderr).toContain("could not determine whether the desktop app is running");
});

function signingProbe(failure: string, installed: "signed" | "ad-hoc" | "absent" = "signed") {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-install-signing-"));
  roots.push(root);
  const app = NodePath.join(root, "installed.app");
  const record = NodePath.join(root, "record");
  const calls = NodePath.join(root, "calls");
  if (installed !== "absent") {
    NodeFS.mkdirSync(app);
    NodeFS.writeFileSync(NodePath.join(app, "keep"), "installed bytes");
  }
  NodeFS.mkdirSync(NodePath.join(record, "Loom.app"), { recursive: true });
  const result = NodeChildProcess.spawnSync(
    "bash",
    [
      "-c",
      `
    source "$LOOM_TEST_SCRIPT"
    APP_PATH=$LOOM_TEST_APP
    codesign() {
      if [ "$1" = --verify ]; then
        [ "$LOOM_TEST_FAILURE" != damaged ] || return 1
        if [ "$4" = -R ]; then [ "$LOOM_TEST_FAILURE" != incompatible ] || return 1; fi
        return 0
      fi
      if [ "$#" -eq 3 ] && [ "$3" = "$APP_PATH" ]; then
        if [ "$LOOM_TEST_INSTALLED" = ad-hoc ]; then
          echo 'Signature=adhoc'
        else
          echo 'designated => identifier "com.t3tools.t3code" and certificate leaf = H"synthetic"'
        fi
      elif [ "$LOOM_TEST_FAILURE" = ad-hoc ]; then
        echo 'Signature=adhoc'
      elif [ "$LOOM_TEST_FAILURE" = different-signer ]; then
        echo 'Authority=Different Identity'
      else
        echo 'Authority=Loom Local Code Signing'
      fi
    }
    quit_app() { echo quit >> "$LOOM_TEST_CALLS"; }
    snapshot_state() { echo snapshot >> "$LOOM_TEST_CALLS"; }
    if [ "$LOOM_TEST_FAILURE" = none ]; then
      verify_install_signing "$LOOM_TEST_RECORD"
    else
      install_record "$LOOM_TEST_RECORD"
    fi
  `,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        LOOM_TEST_SCRIPT: script,
        LOOM_TEST_APP: app,
        LOOM_TEST_RECORD: record,
        LOOM_TEST_CALLS: calls,
        LOOM_TEST_FAILURE: failure,
        LOOM_TEST_INSTALLED: installed,
      },
    },
  );
  return { app, calls, result };
}

it.each([
  ["ad-hoc", "not signed by"],
  ["different-signer", "not signed by"],
  ["damaged", "invalid signature"],
  ["incompatible", "changes the installed signing identity"],
])("refuses a %s install before quitting or changing the installed app", (failure, message) => {
  const { app, calls, result } = signingProbe(failure);
  expect(result.status).toBe(1);
  expect(NodeFS.readFileSync(NodePath.join(app, "keep"), "utf8")).toBe("installed bytes");
  expect(NodeFS.existsSync(calls)).toBe(false);
  expect(result.stderr).toContain(message);
});

it.each(["signed", "ad-hoc", "absent"] as const)(
  "accepts a stable signed candidate over a %s installation",
  (installed) => {
    const { calls, result } = signingProbe("none", installed);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(NodeFS.existsSync(calls)).toBe(false);
  },
);

it("refuses an incompatible rollback before restoring application data", () => {
  const f = fixture();
  database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
  database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous");
  expect(() => run(f, "verify_install_signing() { return 1; }; cmd_rollback")).toThrow();
  expect(history(NodePath.join(f.userdata, "statev2.sqlite"))).toBe("current");
  expect(NodeFS.existsSync(NodePath.join(f.current, "state"))).toBe(false);
});

it.each(["copy", "replacement"])("preserves the installed app when %s fails", (failure) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-install-failure-"));
  roots.push(root);
  const app = NodePath.join(root, "Loom.app");
  const record = NodePath.join(root, "record");
  NodeFS.mkdirSync(app);
  NodeFS.writeFileSync(NodePath.join(app, "keep"), "installed bytes");
  NodeFS.mkdirSync(NodePath.join(record, "Loom.app"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(record, "Loom.app", "candidate"), "new bytes");
  expect(() =>
    runMetadata(
      root,
      `
    APP_PATH=$LOOM_TEST_APP
    BUILDS_DIR=$LOOM_TEST_ROOT
    verify_install_signing() { :; }
    quit_app() { echo quit > "$LOOM_TEST_ROOT/quit"; }
    installed_record() { :; }
    snapshot_state() { :; }
    open() { :; }
    installed_version() { echo test; }
    ditto() {
      [ "$LOOM_TEST_FAILURE" != copy ] || return 1
      cp -R "$1" "$2"
    }
    mv() {
      if [ "$LOOM_TEST_FAILURE" = replacement ] && [ "$2" = "$APP_PATH" ] && [ "$(basename "$1")" = Loom.app ]; then return 1; fi
      command mv "$@"
    }
    install_record "$LOOM_TEST_RECORD"
  `,
      { LOOM_TEST_APP: app, LOOM_TEST_RECORD: record, LOOM_TEST_FAILURE: failure },
    ),
  ).toThrow();
  expect(NodeFS.readFileSync(NodePath.join(app, "keep"), "utf8")).toBe("installed bytes");
  expect(NodeFS.existsSync(NodePath.join(app, "candidate"))).toBe(false);
  expect(NodeFS.readdirSync(root).some((name) => name.startsWith(".loom-install."))).toBe(false);
  if (failure === "copy") expect(NodeFS.existsSync(NodePath.join(root, "quit"))).toBe(false);
});

it.each(["none", "launch", "interrupted-after-replacement"])(
  "keeps the outgoing snapshot and previous data after replacement (%s)",
  (failure) => {
    const f = fixture();
    const app = NodePath.join(f.current, "Loom.app");
    NodeFS.mkdirSync(app);
    NodeFS.writeFileSync(NodePath.join(app, "version"), "current");
    NodeFS.mkdirSync(NodePath.join(f.previous, "Loom.app"));
    NodeFS.writeFileSync(NodePath.join(f.previous, "Loom.app/version"), "previous");
    database(NodePath.join(f.userdata, "statev2.sqlite"), "current");
    database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous");
    const rollback = () =>
      runMetadata(
        f.current,
        `
    APP_PATH=$LOOM_TEST_APP
    BUILDS_DIR=$LOOM_TEST_ROOT
    T3_USERDATA=$LOOM_TEST_USERDATA
    installed_record() { echo "$LOOM_TEST_CURRENT"; }
    records() { echo "$LOOM_TEST_PREVIOUS"; }
    verify_install_signing() { :; }
    quit_app() { :; }
    ditto() { cp -R "$1" "$2"; }
    mv() {
      command mv "$@" || return
      if [ "$LOOM_TEST_FAILURE" = interrupted-after-replacement ] && [ "$2" = "$APP_PATH" ] && [ "$(basename "$1")" = Loom.app ]; then
        sh -c 'kill -TERM "$PPID"'
      fi
    }
    open() { [ "$LOOM_TEST_FAILURE" != launch ]; }
    installed_version() { echo test; }
    cmd_rollback
  `,
        {
          LOOM_TEST_APP: app,
          LOOM_TEST_USERDATA: f.userdata,
          LOOM_TEST_CURRENT: f.current,
          LOOM_TEST_PREVIOUS: f.previous,
          LOOM_TEST_FAILURE: failure,
        },
      );
    if (failure === "none") rollback();
    else expect(rollback).toThrow();
    expect(NodeFS.readFileSync(NodePath.join(app, "version"), "utf8")).toBe("previous");
    expect(history(NodePath.join(f.userdata, "statev2.sqlite"))).toBe("previous");
    expect(history(NodePath.join(f.current, "state/statev2.sqlite"))).toBe("current");
  },
);

it.each(["state-copy", "state-swap", "replacement", "interrupted"])(
  "restores outgoing app and userdata when rollback fails during %s",
  (failure) => {
    const f = fixture();
    const root = NodePath.dirname(f.current);
    const app = NodePath.join(root, "Loom.app");
    NodeFS.mkdirSync(app);
    NodeFS.writeFileSync(NodePath.join(app, "version"), "current");
    NodeFS.mkdirSync(NodePath.join(f.previous, "Loom.app"));
    NodeFS.writeFileSync(NodePath.join(f.previous, "Loom.app/version"), "previous");
    database(NodePath.join(f.userdata, "state.sqlite"), "current-v1");
    database(NodePath.join(f.userdata, "statev2.sqlite"), "current-v2");
    database(NodePath.join(f.previous, "state/state.sqlite"), "previous-v1");
    database(NodePath.join(f.previous, "state/statev2.sqlite"), "previous-v2");
    NodeFS.writeFileSync(NodePath.join(f.userdata, "settings.json"), "current settings");
    NodeFS.writeFileSync(NodePath.join(f.previous, "state/settings.json"), "previous settings");
    NodeFS.writeFileSync(
      NodePath.join(f.previous, "state/client-settings.json"),
      "previous client",
    );
    expect(() =>
      runMetadata(
        root,
        `
        APP_PATH=$LOOM_TEST_APP
        BUILDS_DIR=$LOOM_TEST_ROOT
        T3_USERDATA=$LOOM_TEST_USERDATA
        installed_record() { echo "$LOOM_TEST_CURRENT"; }
        records() { echo "$LOOM_TEST_PREVIOUS"; }
        verify_install_signing() { :; }
        quit_app() { :; }
        ditto() { command cp -R "$1" "$2"; }
        cp() {
          if [ "$LOOM_TEST_FAILURE" = state-copy ] && [ "$2" = "$LOOM_TEST_PREVIOUS/state/statev2.sqlite" ]; then return 1; fi
          command cp "$@"
        }
        mv() {
          if [ "$LOOM_TEST_FAILURE" = state-swap ] && [ "$2" = "$T3_USERDATA/statev2.sqlite" ] && [[ "$1" = */restored/* ]]; then return 1; fi
          if [ "$2" = "$APP_PATH" ] && [ "$(basename "$1")" = Loom.app ]; then
            case "$LOOM_TEST_FAILURE" in
              replacement) return 1 ;;
              interrupted) sh -c 'kill -TERM "$PPID"'; return 1 ;;
            esac
          fi
          command mv "$@"
        }
        open() { :; }
        installed_version() { echo test; }
        cmd_rollback
        `,
        {
          LOOM_TEST_APP: app,
          LOOM_TEST_USERDATA: f.userdata,
          LOOM_TEST_CURRENT: f.current,
          LOOM_TEST_PREVIOUS: f.previous,
          LOOM_TEST_FAILURE: failure,
        },
      ),
    ).toThrow();
    expect(NodeFS.readFileSync(NodePath.join(app, "version"), "utf8")).toBe("current");
    expect(history(NodePath.join(f.userdata, "state.sqlite"))).toBe("current-v1");
    expect(history(NodePath.join(f.userdata, "statev2.sqlite"))).toBe("current-v2");
    expect(NodeFS.readFileSync(NodePath.join(f.userdata, "settings.json"), "utf8")).toBe(
      "current settings",
    );
    expect(NodeFS.existsSync(NodePath.join(f.userdata, "client-settings.json"))).toBe(false);
    expect(history(NodePath.join(f.current, "state/statev2.sqlite"))).toBe("current-v2");
    expect(NodeFS.readdirSync(root).some((name) => name.startsWith(".loom-install."))).toBe(false);
    expect(NodeFS.readdirSync(f.userdata).some((name) => name.startsWith(".loom-rollback."))).toBe(
      false,
    );
  },
);

function runSync(root: string, command: string, extraEnv: Record<string, string> = {}) {
  return NodeChildProcess.spawnSync(
    "bash",
    ["-c", `source "$LOOM_TEST_SCRIPT"; cd "$LOOM_TEST_ROOT"; ${command}`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        LOOM_TEST_SCRIPT: script,
        LOOM_TEST_ROOT: root,
        ...extraEnv,
      },
    },
  );
}

function commitAt(root: string, date: string, message: string) {
  NodeChildProcess.execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", message], {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
}

const epoch = (date: string) => String(Date.parse(date) / 1000);

it("reports main stale only once a missing nightly has waited past the grace period", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.1.0-nightly.20261013.1");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  commitAt(f.root, "2026-10-14T00:00:00Z", "next upstream");
  f.git("tag", "v0.1.0-nightly.20261014.2");
  const status = (now: string) =>
    Object.fromEntries(
      runSync(f.root, "upstream_status origin/main", { LOOM_NOW: epoch(now) })
        .stdout.trim()
        .split("\n")
        .map((line) => line.split("=")),
    );

  expect(status("2026-10-14T15:00:00Z")).toMatchObject({
    state: "behind",
    newest: "v0.1.0-nightly.20261014.2",
    main: "v0.1.0-nightly.20261013.1",
    oldest_missing: "v0.1.0-nightly.20261014.2",
    waited_hours: "15",
    behind_commits: "1",
    last_unattended: "",
  });
  expect(status("2026-10-14T16:00:00Z")).toMatchObject({ state: "stale", waited_hours: "16" });

  f.git("update-ref", "refs/remotes/origin/main", "v0.1.0-nightly.20261014.2");
  expect(status("2026-10-20T00:00:00Z")).toMatchObject({
    state: "in-sync",
    oldest_missing: "",
    behind_commits: "0",
  });
});

it("names the newest integration the workflow merged unattended, not one merged by hand", () => {
  const f = repositoryFixture();
  f.git("tag", "v0.1.0-nightly.20261013.1");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  const tag = (name: string, tagger: string, date: string, message: string) =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", `user.name=${tagger}`, "tag", "-a", name, "-m", message],
      {
        cwd: f.root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_COMMITTER_DATE: date,
        },
      },
    );
  const bot = "github-actions[bot]";
  tag(
    "loom-v0.0.8-nightly.1",
    bot,
    "2026-10-11T00:00:00Z",
    "Loom built from upstream v0.0.8-nightly.1",
  );
  tag(
    "loom-v0.0.9-nightly.1",
    bot,
    "2026-10-12T00:00:00Z",
    "Loom built from upstream v0.0.9-nightly.1",
  );
  tag(
    "loom-v0.1.0-nightly.20261013.1",
    "Kyle",
    "2026-10-13T00:00:00Z",
    "Loom built from upstream v0.1.0-nightly.20261013.1",
  );
  tag("loom-v0.0.5-nightly.20261013.1", bot, "2026-10-14T00:00:00Z", "Loom fork changes on main");

  expect(runSync(f.root, "upstream_status origin/main").stdout).toContain(
    "\nlast_unattended=loom-v0.0.9-nightly.1 2026-10-12\n",
  );
});

it("alerts once when main goes stale and once a day after, however late the watch runs", () => {
  const f = repositoryFixture();
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  commitAt(f.root, "2026-10-14T00:00:00Z", "upstream");
  f.git("tag", "v0.1.0-nightly.20261014.1");
  const alerts = (since: string, now: string) =>
    runSync(f.root, `stale_crossed v0.1.0-nightly.20261014.1 ${epoch(since)}`, {
      LOOM_NOW: epoch(now),
    }).status === 0;

  expect(alerts("2026-10-14T11:47:00Z", "2026-10-14T14:47:00Z")).toBe(false);
  expect(alerts("2026-10-14T14:47:00Z", "2026-10-14T17:47:00Z")).toBe(true);
  expect(alerts("2026-10-14T17:47:00Z", "2026-10-14T20:47:00Z")).toBe(false);
  // A scheduled run that started an hour late still sends the day's reminder, once.
  expect(alerts("2026-10-15T14:47:00Z", "2026-10-15T17:50:00Z")).toBe(true);
  expect(alerts("2026-10-15T17:50:00Z", "2026-10-15T20:47:00Z")).toBe(false);
});

it("has work for a new nightly or main changes an open integration has not checked", () => {
  const f = repositoryFixture();
  f.git("tag", NIGHTLY);
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  commitAt(f.root, "2026-10-15T00:00:00Z", "upstream next");
  f.git("tag", NEXT);
  f.git("update-ref", "refs/remotes/origin/integrate/holds-next", "HEAD");
  f.git("update-ref", "refs/remotes/origin/integrate/older", NIGHTLY);
  const bin = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-bin`);
  roots.push(bin);
  NodeFS.mkdirSync(bin);
  // Applies loom.sh's own --jq filter, as the real gh does.
  NodeFS.writeFileSync(
    NodePath.join(bin, "gh"),
    `#!/bin/bash
case "$*" in
  "pr list --state open --json headRefName --jq "*) printf '%s' "$LOOM_TEST_PRS" | jq -r "$8" ;;
esac
`,
    { mode: 0o755 },
  );
  const due = (...branches: string[]) =>
    Object.fromEntries(
      runSync(f.root, "upstream_due", {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        LOOM_TEST_PRS: JSON.stringify(
          [...branches, "feature/other"].map((headRefName) => ({ headRefName })),
        ),
      })
        .stdout.trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );

  expect(due()).toEqual({ due: "true", reason: `main lacks ${NEXT}` });
  expect(due("integrate/older")).toMatchObject({ due: "true" });
  expect(due("integrate/older", "integrate/holds-next")).toEqual({
    due: "false",
    reason: `integrate/holds-next already ran at ${NEXT}`,
  });
  // A needs-Kyle draft whose merge stopped holds nothing, but its name says it ran at the tag.
  expect(due(`integrate/${NEXT}`)).toMatchObject({ due: "false" });
  f.git("checkout", "--quiet", "--detach", NIGHTLY);
  f.git("commit", "--quiet", "--allow-empty", "-m", "fork changes after integration started");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  expect(due("integrate/holds-next")).toEqual({
    due: "true",
    reason: "integrate/holds-next needs current main",
  });
  f.git("merge", "--quiet", "--no-edit", NEXT);
  f.git("update-ref", "refs/remotes/origin/integrate/holds-next", "HEAD");
  expect(due("integrate/holds-next")).toMatchObject({ due: "false" });
  f.git("update-ref", "refs/remotes/origin/main", NEXT);
  expect(due()).toEqual({ due: "false", reason: `main has ${NEXT}` });
});

const NIGHTLY = "v1.0.0-nightly.20261014.1";
// Built from parts so the repository's own seam check never counts this file.
const SEAM = ["//", "fork:", "demo"].join(" ");

function agentScript(root: string, name: string, body: string) {
  const path = NodePath.join(root, "..", `${NodePath.basename(root)}-${name}.sh`);
  roots.push(path);
  NodeFS.writeFileSync(path, `#!/bin/bash\nprompt=$(cat)\n${body}\n`, { mode: 0o755 });
  return path;
}

function conflictFixture(
  agent: string,
  options: { readonly seam?: boolean; readonly rerere?: boolean; readonly binary?: boolean } = {},
) {
  const f = repositoryFixture();
  if (options.rerere) f.git("config", "rerere.enabled", "true");
  const write = (file: string, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(f.root, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(f.root, file), text);
  };
  write("apps/a.ts", "export const a = 1;\n");
  write("apps/b.ts", "export const b = 1;\n");
  write("apps/clean.ts", "export const clean = 1;\n");
  if (options.binary) write("apps/icon.bin", "\0base");
  if (options.seam) write("docs/fork/seams.tsv", "apps/a.ts\tdemo\t1\n");
  f.git("add", "-A");
  f.git("commit", "--quiet", "-m", "base");
  f.git("switch", "--quiet", "-c", "upstream");
  write("apps/a.ts", "export const a = 2;\n");
  write("apps/b.ts", "export const b = 2;\n");
  write("apps/clean.ts", "export const clean = 2;\n");
  if (options.binary) write("apps/icon.bin", "\0upstream");
  f.git("commit", "--quiet", "-am", "upstream changes");
  f.git("tag", NIGHTLY);
  f.git("switch", "--quiet", "main");
  write("apps/a.ts", `export const a = 3; ${options.seam ? SEAM : "// loom change"}\n`);
  write("apps/b.ts", "export const b = 3; // loom change\n");
  if (options.binary) write("apps/icon.bin", "\0loom");
  f.git("commit", "--quiet", "-am", "fork changes");
  f.git("switch", "--quiet", "-c", `integrate/${NIGHTLY}`);
  const merge = NodeChildProcess.spawnSync("git", ["merge", "--no-edit", NIGHTLY], {
    cwd: f.root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(merge.status).not.toBe(0);
  const agentPath = agentScript(f.root, "agent", agent);
  const logs = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-logs`);
  roots.push(logs);
  const resolve = (extraEnv: Record<string, string> = {}) =>
    runSync(f.root, `resolve_conflicts ${NIGHTLY}`, {
      LOOM_AGENT: agentPath,
      LOOM_RESOLVE_LOGS: logs,
      LOOM_RESOLVE_JOBS: "2",
      ...extraEnv,
    });
  const read = (file: string) => NodeFS.readFileSync(NodePath.join(f.root, file), "utf8");
  return { ...f, resolve, read, logs };
}

it("resolves each conflicted file in its own session and stages what the sessions changed", () => {
  const f = conflictFixture(`
case "$LOOM_RESOLVE_FILE" in
  apps/a.ts)
    printf 'export const a = 2; // loom change\\n' > apps/a.ts
    printf 'export const moved = 3; // loom change\\n' > apps/moved.ts ;;
  apps/b.ts) printf 'export const b = 2; // loom change\\n' > apps/b.ts ;;
esac
printf 'Kept upstream and reapplied the seam.\\n\\n**RESOLVED**\\n'`);

  const result = f.resolve();

  expect(result.status).toBe(0);
  expect(f.git("diff", "--name-only", "--diff-filter=U")).toBe("");
  expect(f.git("show", ":apps/a.ts")).toBe("export const a = 2; // loom change");
  expect(f.git("show", ":apps/b.ts")).toBe("export const b = 2; // loom change");
  expect(f.git("show", ":apps/moved.ts")).toBe("export const moved = 3; // loom change");
  expect(NodeFS.readFileSync(NodePath.join(f.logs, "summary.md"), "utf8")).toContain(
    "- `apps/moved.ts`",
  );
  f.git("commit", "--quiet", "--no-edit");
  expect(f.read("apps/clean.ts")).toBe("export const clean = 2;\n");
});

it("leaves a file conflicted when its session gives up or leaves conflict markers", () => {
  const f = conflictFixture(`
case "$LOOM_RESOLVE_FILE" in
  apps/a.ts) printf 'Looks done.\\nRESOLVED\\n' ;;
  apps/b.ts) printf 'UNRESOLVED: whether b keeps the fork value\\n' ;;
esac`);

  const result = f.resolve();

  expect(result.status).toBe(1);
  expect(f.git("diff", "--name-only", "--diff-filter=U").split("\n").sort()).toEqual([
    "apps/a.ts",
    "apps/b.ts",
  ]);
  expect(f.read("apps/a.ts")).toContain("<<<<<<<");
  expect(result.stdout).toContain("- `apps/b.ts`: UNRESOLVED: whether b keeps the fork value");
});

it("keeps what a stopped merge resolved, so the next attempt resolves only the rest", () => {
  // b's session removes the markers without resolving b, which rerere must not keep.
  const f = conflictFixture(
    `
echo "$LOOM_RESOLVE_FILE" >> "$LOOM_TEST_CALLS"
case "$LOOM_RESOLVE_FILE" in
  apps/a.ts) printf 'export const a = 2; // loom change\\n' > apps/a.ts; printf 'RESOLVED\\n' ;;
  apps/b.ts)
    printf 'export const b = 2;\\n' > apps/b.ts
    printf 'UNRESOLVED: whether b keeps the fork value\\n' ;;
esac`,
    { rerere: true },
  );
  const calls = NodePath.join(f.logs, "..", `${NodePath.basename(f.root)}-calls`);
  roots.push(calls);

  expect(f.resolve({ LOOM_TEST_CALLS: calls }).status).toBe(1);
  f.git("merge", "--abort");
  const again = NodeChildProcess.spawnSync("git", ["merge", "--no-edit", NIGHTLY], {
    cwd: f.root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(again.status).not.toBe(0);
  expect(f.read("apps/b.ts")).toContain("<<<<<<<");
  const result = f.resolve({ LOOM_TEST_CALLS: calls });

  expect(result.status).toBe(1);
  expect(NodeFS.readFileSync(calls, "utf8").split("\n").filter(Boolean).sort()).toEqual([
    "apps/a.ts",
    "apps/b.ts",
    "apps/b.ts",
  ]);
  expect(f.git("show", ":apps/a.ts")).toBe("export const a = 2; // loom change");
  expect(f.git("diff", "--name-only", "--diff-filter=U")).toBe("apps/b.ts");
  expect(result.stdout).toContain("git rerere reused its resolution:\n\n- `apps/a.ts`");
});

it("gives a binary conflict a session instead of taking it for an earlier resolution", () => {
  const f = conflictFixture(
    `
echo "$LOOM_RESOLVE_FILE" >> "$LOOM_TEST_CALLS"
git checkout -q --theirs -- "$LOOM_RESOLVE_FILE" 2>/dev/null || printf 'export const x = 2; // loom change\\n' > "$LOOM_RESOLVE_FILE"
printf 'RESOLVED\\n'`,
    { rerere: true, binary: true },
  );
  const calls = NodePath.join(f.logs, "..", `${NodePath.basename(f.root)}-calls`);
  roots.push(calls);

  const result = f.resolve({ LOOM_TEST_CALLS: calls });

  expect(result.status, result.stdout).toBe(0);
  expect(NodeFS.readFileSync(calls, "utf8").split("\n").filter(Boolean).sort()).toEqual([
    "apps/a.ts",
    "apps/b.ts",
    "apps/icon.bin",
  ]);
  expect(result.stdout).not.toContain("git rerere reused");
});

it("merges a resolution unattended only when the independent review passes it", () => {
  const f = conflictFixture("");
  NodeFS.writeFileSync(NodePath.join(f.root, "apps/a.ts"), "export const a = 2; // loom change\n");
  NodeFS.writeFileSync(NodePath.join(f.root, "apps/b.ts"), "export const b = 2; // loom change\n");
  f.git("add", "-A");
  f.git("commit", "--quiet", "--no-edit");
  f.git("update-ref", "refs/remotes/origin/main", "main");
  const reviewer = NodePath.join(f.logs, "..", `${NodePath.basename(f.root)}-reviewer.sh`);
  roots.push(reviewer);
  NodeFS.writeFileSync(
    reviewer,
    `#!/bin/bash
diff=$(grep -o '[^\`]*resolution.diff' | head -n 1)
grep -q 'apps/a.ts' "$diff" && grep -q '^-<<<<<<<' "$diff" || exit 1
printf 'Checked every hunk.\\n\\nVERDICT: %s\\n' "$LOOM_TEST_VERDICT"
`,
    { mode: 0o755 },
  );
  const review = (verdict: string) =>
    runSync(f.root, "cmd_review_integration", {
      LOOM_AGENT: reviewer,
      LOOM_RESOLVE_LOGS: f.logs,
      LOOM_TEST_VERDICT: verdict,
    });

  expect(review("pass").status).toBe(0);
  const failed = review("fail");
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain(`the review did not pass the resolution of ${NIGHTLY}`);
});

// A committed resolution pushed to a bare origin, and one agent that reviews or fixes by prompt.
function reviewFixFixture(reviewer: string) {
  const f = conflictFixture("");
  NodeFS.writeFileSync(NodePath.join(f.root, "apps/a.ts"), "export const a = 2; // loom change\n");
  NodeFS.writeFileSync(NodePath.join(f.root, "apps/b.ts"), "export const b = 2; // loom change\n");
  f.git("add", "-A");
  f.git("commit", "--quiet", "--no-edit");
  const origin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-review-origin-"));
  roots.push(origin);
  NodeChildProcess.execFileSync("git", ["init", "--quiet", "--bare", origin]);
  f.git("remote", "add", "origin", origin);
  f.git("push", "--quiet", "origin", "main", `integrate/${NIGHTLY}`);
  f.git("fetch", "--quiet", "origin");
  const calls = NodePath.join(f.logs, "..", `${NodePath.basename(f.root)}-calls`);
  roots.push(calls);
  const agent = agentScript(
    f.root,
    "review-agent",
    `case "$prompt" in
  "Fix what an independent review found"*)
    echo fix >> "$LOOM_TEST_CALLS"
    echo 'export const restored = true;' > apps/restored.ts
    printf 'Restored the line the resolution dropped.\\n\\nFIXED\\n' ;;
  *)
    echo review >> "$LOOM_TEST_CALLS"
    ${reviewer} ;;
esac`,
  );
  const review = () =>
    runSync(f.root, "run_checks() { echo checked; }; cmd_review_integration --fix", {
      LOOM_AGENT: agent,
      LOOM_RESOLVE_LOGS: f.logs,
      LOOM_TEST_CALLS: calls,
    });
  const sessions = () => NodeFS.readFileSync(calls, "utf8").split("\n").filter(Boolean);
  const pushed = () =>
    NodeChildProcess.execFileSync("git", ["log", "--format=%s", `integrate/${NIGHTLY}`], {
      cwd: origin,
      encoding: "utf8",
    });
  return { ...f, review, sessions, pushed };
}

it("fixes what a failed review found, checks and pushes the fix, and reviews again", () => {
  const f = reviewFixFixture(`if git show HEAD:apps/restored.ts >/dev/null 2>&1; then
      printf 'VERDICT: pass\\n'
    else
      printf 'apps/b.ts dropped an upstream line.\\n\\nVERDICT: fail\\n'
    fi`);

  const result = f.review();

  expect(result.status, result.stderr).toBe(0);
  expect(f.sessions()).toEqual(["review", "fix", "review"]);
  expect(result.stdout).toContain("==> Fixing what review 1 found");
  expect(result.stdout).toContain("checked");
  expect(f.git("log", "-1", "--format=%s")).toBe(
    `fix(fork): address review 1 of upstream ${NIGHTLY}`,
  );
  expect(f.git("log", "-1", "--format=%b")).toContain("Restored the line the resolution dropped.");
  expect(f.pushed()).toContain(`fix(fork): address review 1 of upstream ${NIGHTLY}`);
  expect(NodeFS.readFileSync(NodePath.join(f.logs, "review-fix.md"), "utf8")).toBe(
    "- Review 1: FIXED\n",
  );
});

it("stops after LOOM_REVIEW_ROUNDS reviews when the fix does not satisfy the reviewer", () => {
  const f = reviewFixFixture(`printf 'apps/b.ts dropped an upstream line.\\n\\nVERDICT: fail\\n'`);

  const result = f.review();

  expect(result.status).toBe(1);
  expect(f.sessions()).toEqual(["review", "fix", "review"]);
  expect(result.stderr).toContain(`the review did not pass the resolution of ${NIGHTLY}`);
});

it("shows the reviewer every merge and commit the branch adds to main, oldest first", () => {
  const f = conflictFixture("");
  f.git("update-ref", "refs/remotes/origin/main", "main");
  const write = (file: string, text: string) =>
    NodeFS.writeFileSync(NodePath.join(f.root, file), text);
  write("apps/a.ts", "export const a = 2; // loom change\n");
  write("apps/b.ts", "export const b = 2; // loom change\n");
  f.git("commit", "--quiet", "-am", "integrate upstream one");
  write("apps/repair.ts", "export const repaired = true;\n");
  f.git("add", "-A");
  f.git("commit", "--quiet", "-m", "repair after upstream one");
  f.git("switch", "--quiet", "upstream");
  write("apps/b.ts", "export const b = 4;\n");
  f.git("commit", "--quiet", "-am", "upstream again");
  f.git("tag", "v1.0.0-nightly.20261015.1");
  f.git("switch", "--quiet", `integrate/${NIGHTLY}`);
  const merge = NodeChildProcess.spawnSync("git", ["merge", "v1.0.0-nightly.20261015.1"], {
    cwd: f.root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(merge.status).not.toBe(0);
  write("apps/b.ts", "export const b = 4; // loom change\n");
  f.git("commit", "--quiet", "-am", "integrate upstream two");

  const diff = runSync(f.root, "resolution_diff").stdout;

  const order = ["integrate upstream one", "repair after upstream one", "integrate upstream two"];
  const at = order.map((subject) => diff.indexOf(subject));
  expect(at.every((index) => index >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(diff).toContain("+export const repaired = true;");
  expect(diff.match(/^-<<<<<<< /gm)?.length).toBe(3);
  expect(diff).not.toMatch(/^(Commit|Merge) \S+ fork changes$/m);
});

it("gives a resolution that dropped a seam one more session, told what it lost", () => {
  const f = conflictFixture(
    `
echo "$LOOM_RESOLVE_FILE" >> "$LOOM_TEST_CALLS"
case "$LOOM_RESOLVE_FILE:$prompt" in
  apps/a.ts:*"## Seams lost"*"has 0 of 1 'fork: demo' lines"*)
    printf 'export const a = 2; %s\\n' "$LOOM_TEST_SEAM" > apps/a.ts ;;
  apps/a.ts:*) printf 'export const a = 2;\\n' > apps/a.ts ;;
  apps/b.ts:*) printf 'export const b = 2; // loom change\\n' > apps/b.ts ;;
esac
printf 'RESOLVED\\n'`,
    { seam: true },
  );
  const calls = NodePath.join(f.logs, "..", `${NodePath.basename(f.root)}-calls`);
  roots.push(calls);

  const result = f.resolve({ LOOM_TEST_CALLS: calls, LOOM_TEST_SEAM: SEAM });

  expect(result.status).toBe(0);
  expect(f.git("show", ":apps/a.ts")).toBe(`export const a = 2; ${SEAM}`);
  expect(NodeFS.readFileSync(calls, "utf8").split("\n").filter(Boolean).sort()).toEqual([
    "apps/a.ts",
    "apps/a.ts",
    "apps/b.ts",
  ]);
});

function repairFixture(agent: string) {
  const f = repositoryFixture();
  NodeFS.mkdirSync(NodePath.join(f.root, "apps"));
  NodeFS.writeFileSync(NodePath.join(f.root, "apps/seam.ts"), "lost\n");
  NodeFS.writeFileSync(NodePath.join(f.root, "apps/test.ts"), "broken\n");
  f.git("add", "-A");
  f.git("commit", "--quiet", "-m", `chore(fork): integrate upstream ${NIGHTLY}`);
  f.git("switch", "--quiet", "-c", `integrate/${NIGHTLY}`);
  const agentPath = agentScript(f.root, "repair", agent);
  const logs = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-logs`);
  roots.push(logs);
  const calls = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-calls`);
  roots.push(calls);
  // Two checks reported through run_check, as run_checks reports its own.
  const checks = `run_checks() {
    FAILED_CHECKS=""
    run_check "Checking that every fork seam survived" bash -c 'grep -q kept apps/seam.ts || { echo "apps/seam.ts lost its seam"; exit 1; }'
    run_check "Running the fork's tests" bash -c 'grep -q passing apps/test.ts || { echo "apps/test.ts failed"; exit 1; }'
    report_failed_checks
  }`;
  const repair = (extraEnv: Record<string, string> = {}) =>
    runSync(f.root, `${checks}; checks_with_repair ${NIGHTLY}`, {
      LOOM_AGENT: agentPath,
      LOOM_RESOLVE_LOGS: logs,
      LOOM_TEST_CALLS: calls,
      ...extraEnv,
    });
  const report = () => NodeFS.readFileSync(NodePath.join(logs, "repair.md"), "utf8");
  const sessions = () =>
    NodeFS.existsSync(calls) ? NodeFS.readFileSync(calls, "utf8").split("\n").filter(Boolean) : [];
  return { ...f, repair, report, sessions };
}

// Each session sees only its own check's output, so it names the check it was given.
const SESSION_CHECK = `log=$(printf '%s' "$prompt" | grep -o '[^\`]*repair-[0-9]*-[0-9]*-check\\.log' | head -n 1)
case "$(cat "$log")" in
  *"lost its seam"*) check=seam ;;
  *"test.ts failed"*) check=test ;;
esac
echo "$check" >> "$LOOM_TEST_CALLS"`;

it("repairs every failing check in one round, one session and commit each", () => {
  const f = repairFixture(`${SESSION_CHECK}
case "$check" in
  seam) echo kept > apps/seam.ts; printf 'Reapplied the seam.\\n\\n**REPAIRED**\\n' ;;
  test) echo passing > apps/test.ts; printf 'Fixed the fork test.\\n\\nREPAIRED\\n' ;;
esac`);

  const result = f.repair();

  expect(result.status).toBe(0);
  expect(f.sessions()).toEqual(["seam", "test"]);
  expect(f.git("log", "--format=%s", "-2").split("\n")).toEqual([
    `fix(fork): repair round 1 after upstream ${NIGHTLY} (Running the fork's tests)`,
    `fix(fork): repair round 1 after upstream ${NIGHTLY} (Checking that every fork seam survived)`,
  ]);
  const last = f.git("log", "-1", "--format=%b");
  expect(last).toContain("Failing check: Running the fork's tests");
  expect(last).toContain("Fixed the fork test.");
  expect(last).not.toContain("REPAIRED");
  expect(f.git("status", "--porcelain")).toBe("");
  expect(f.report()).toContain("- Round 1, Checking that every fork seam survived: REPAIRED");
  expect(f.report()).toContain("- Round 1, Running the fork's tests: REPAIRED");
});

it("commits a session that stopped partway and gives its check another round", () => {
  const f = repairFixture(`${SESSION_CHECK}
case "$check" in
  seam) if grep -q half apps/seam.ts; then echo kept > apps/seam.ts; printf 'Finished it.\\nREPAIRED\\n'
    else echo half > apps/seam.ts; printf 'Ran out of turns.\\n'; fi ;;
  test) echo passing > apps/test.ts; printf 'REPAIRED\\n' ;;
esac`);

  const result = f.repair();

  expect(result.status).toBe(0);
  expect(f.sessions()).toEqual(["seam", "test", "seam"]);
  expect(f.git("log", "--reverse", "--format=%s", "-3").split("\n")).toEqual([
    `fix(fork): partial repair round 1 after upstream ${NIGHTLY} (Checking that every fork seam survived)`,
    `fix(fork): repair round 1 after upstream ${NIGHTLY} (Running the fork's tests)`,
    `fix(fork): repair round 2 after upstream ${NIGHTLY} (Checking that every fork seam survived)`,
  ]);
  expect(f.git("log", "-1", "--skip=2", "--format=%b")).toContain(
    "Stopped before the check passed: Ran out of turns.",
  );
});

it("gives a check no more sessions once one gives up, after the round repairs the rest", () => {
  const f = repairFixture(`${SESSION_CHECK}
case "$check" in
  seam) printf "UNREPAIRABLE: upstream's own seam moved\\n" ;;
  test) echo passing > apps/test.ts; printf 'REPAIRED\\n' ;;
esac`);

  const result = f.repair();

  expect(result.status).toBe(1);
  expect(f.sessions()).toEqual(["seam", "test"]);
  expect(result.stderr).toContain("loom: the fork's checks still fail after repair");
  expect(result.stderr).toContain(
    "- Still failing: Checking that every fork seam survived. Its session gave up.",
  );
  expect(f.git("log", "--format=%s", "-1")).toBe(
    `fix(fork): repair round 1 after upstream ${NIGHTLY} (Running the fork's tests)`,
  );
  expect(f.report()).toContain(
    "- Round 1, Checking that every fork seam survived: UNREPAIRABLE: upstream's own seam moved\n  The session changed nothing.",
  );
});

it("stops when a whole round changes nothing", () => {
  const f = repairFixture(`${SESSION_CHECK}
printf 'Looks fine.\\nREPAIRED\\n'`);

  const result = f.repair();

  expect(result.status).toBe(1);
  expect(f.sessions()).toEqual(["seam", "test"]);
  expect(result.stderr).toContain("loom: repair round 1 changed nothing");
  expect(f.git("log", "--format=%s", "-1")).toBe(`chore(fork): integrate upstream ${NIGHTLY}`);
});

it("gives each check at most LOOM_REPAIR_ATTEMPTS sessions", () => {
  const f = repairFixture(`${SESSION_CHECK}
echo "$check" >> apps/notes.txt; printf 'Tried again.\\nREPAIRED\\n'`);

  const result = f.repair({ LOOM_REPAIR_ATTEMPTS: "2" });

  expect(result.status).toBe(1);
  expect(f.sessions()).toEqual(["seam", "test", "seam", "test"]);
  expect(result.stderr).toContain(
    "- Still failing: Checking that every fork seam survived, after 2 repair sessions.",
  );
  expect(f.git("rev-list", "--count", "HEAD")).toBe("6");
});

it("starts no session once LOOM_REPAIR_DEADLINE has passed", () => {
  const f = repairFixture(`${SESSION_CHECK}
printf 'REPAIRED\\n'`);

  const result = f.repair({ LOOM_REPAIR_DEADLINE: "100", LOOM_NOW: "100" });

  expect(result.status).toBe(1);
  expect(f.sessions()).toEqual([]);
  expect(result.stderr).toContain(
    "- Still failing: Running the fork's tests. No time was left for another session.",
  );
});

const NEXT = "v1.0.0-nightly.20261015.1";

// Loom main, upstream's NIGHTLY and NEXT, a bare origin, and an open integration pull request
// that merged `draftTag` and committed a repair the day before. main gained a fork commit since.
function resumeFixture(draftTag: string) {
  const f = repositoryFixture();
  const origin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-upstream-origin-"));
  roots.push(origin);
  NodeChildProcess.execFileSync("git", ["init", "--quiet", "--bare", origin]);
  const write = (file: string, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(f.root, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(f.root, file), text);
    f.git("add", "-A");
  };
  write("apps/up.ts", "one\n");
  f.git("commit", "--quiet", "-m", "base");
  f.git("switch", "--quiet", "-c", "upstream");
  write("apps/up.ts", "two\n");
  commitAt(f.root, "2026-10-14T00:00:00Z", "upstream two");
  f.git("tag", NIGHTLY);
  write("apps/up.ts", "three\n");
  commitAt(f.root, "2026-10-15T00:00:00Z", "upstream three");
  f.git("tag", NEXT);
  f.git("switch", "--quiet", "main");
  write("apps/fork.ts", "fork\n");
  f.git("commit", "--quiet", "-m", "fork change");
  f.git("switch", "--quiet", "-c", `integrate/${draftTag}`);
  f.git(
    "merge",
    "--quiet",
    "--no-ff",
    "-m",
    `chore(fork): integrate upstream ${draftTag}`,
    draftTag,
  );
  write("apps/repair.ts", "repaired\n");
  f.git("commit", "--quiet", "-m", `fix(fork): repair round 1 after upstream ${draftTag}`);
  // A needs-Kyle draft whose merge stopped holds nothing main lacks.
  f.git("switch", "--quiet", "-c", "integrate/v0.9.0", "main");
  f.git("commit", "--quiet", "--allow-empty", "-m", "chore(fork): upstream v0.9.0 needs Kyle");
  f.git("switch", "--quiet", "main");
  write("apps/later.ts", "later\n");
  f.git("commit", "--quiet", "-m", "fork change after the draft");
  f.git("remote", "add", "origin", origin);
  f.git("remote", "add", "upstream", origin);
  f.git("push", "--quiet", "origin", "main", `integrate/${draftTag}`, "integrate/v0.9.0", "--tags");
  f.git("fetch", "--quiet", "origin");
  f.git("branch", "--quiet", "-D", `integrate/${draftTag}`, "integrate/v0.9.0");
  f.git("checkout", "--quiet", "--detach", "origin/main");

  const bin = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-bin`);
  roots.push(bin);
  NodeFS.mkdirSync(bin);
  const ghLog = NodePath.join(bin, "gh.log");
  // Answers each gh query loom.sh makes. --jq filtering is the real gh's job, except for the
  // open pull requests, whose filter picks the integrations among them.
  NodeFS.writeFileSync(
    NodePath.join(bin, "gh"),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$LOOM_TEST_GH_LOG"
case "$*" in
  "pr list --head"*) printf '%s' "$LOOM_TEST_HEAD_PR" ;;
  "pr list --state open --json headRefName --jq "*)
    printf '[{"headRefName":"integrate/%s"},{"headRefName":"integrate/v0.9.0"},{"headRefName":"integrate/v0.8.0"},{"headRefName":"feature/x"}]' "$LOOM_TEST_DRAFT_TAG" | jq -r "$8" ;;
  "pr list --state open --json number,headRefName"*)
    printf '7 integrate/%s\\n8 integrate/v0.9.0\\n9 integrate/%s\\n' "$LOOM_TEST_DRAFT_TAG" "$LOOM_TEST_NEXT" ;;
  "pr view"*) echo 9 ;;
esac
`,
    { mode: 0o755 },
  );
  const integrate = (headPr: string) =>
    runSync(f.root, `run_checks() { echo checked; }; cmd_integrate ${NEXT} --pr --resolve`, {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      LOOM_TEST_GH_LOG: ghLog,
      LOOM_TEST_HEAD_PR: headPr,
      LOOM_TEST_DRAFT_TAG: draftTag,
      LOOM_TEST_NEXT: NEXT,
      LOOM_RESOLVE_LOGS: NodePath.join(bin, "logs"),
    });
  const gh = () => NodeFS.readFileSync(ghLog, "utf8").split("\n").filter(Boolean);
  const pushed = () =>
    NodeChildProcess.execFileSync("git", ["log", "--format=%s", `integrate/${NEXT}`], {
      cwd: origin,
      encoding: "utf8",
    });
  return { ...f, integrate, gh, pushed };
}

it("continues yesterday's open integration pull request instead of starting over from main", () => {
  const f = resumeFixture(NIGHTLY);

  const result = f.integrate("");

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`==> Continuing the open integration integrate/${NIGHTLY}`);
  const pushed = f.pushed();
  for (const subject of [
    `chore(fork): integrate upstream ${NEXT}`,
    `chore(fork): merge main into integrate/${NEXT}`,
    `fix(fork): repair round 1 after upstream ${NIGHTLY}`,
    `chore(fork): integrate upstream ${NIGHTLY}`,
    "fork change after the draft",
  ]) {
    expect(pushed).toContain(subject);
  }
  const gh = f.gh();
  expect(gh.some((call) => call.startsWith("pr create --base main --head integrate/"))).toBe(true);
  expect(gh.find((call) => call.startsWith("pr close 7 "))).toContain("Superseded by #9");
  expect(gh.some((call) => call.startsWith("pr close 8 "))).toBe(false);
});

it("finishes its own draft when it reruns at the same upstream tag", () => {
  const f = resumeFixture(NEXT);

  const result = f.integrate("9");

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`==> Continuing the open integration integrate/${NEXT}`);
  expect(result.stdout).not.toContain("==> Merging upstream");
  expect(f.pushed()).toContain(`fix(fork): repair round 1 after upstream ${NEXT}`);
  const gh = f.gh();
  expect(gh).toContain("pr ready 9");
  expect(gh.some((call) => call.startsWith("pr edit 9 --title"))).toBe(true);
  expect(gh.some((call) => call.startsWith("pr create") || call.startsWith("pr close 9"))).toBe(
    false,
  );
});

// A quoting slip in a step's script fails here instead of silencing the step that alerts Kyle.
function workflowScripts(file: string) {
  const lines = NodeFS.readFileSync(file, "utf8").split("\n");
  const scripts: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[index] ?? "");
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const rest = match[2] ?? "";
    if (!/^[|>]-?$/.test(rest)) {
      scripts.push(rest);
      continue;
    }
    const body: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (next.trim() !== "" && next.search(/\S/) <= indent) break;
      body.push(next);
      index++;
    }
    scripts.push(body.join("\n"));
  }
  return scripts;
}

it("parses every shell script in the Loom workflows", () => {
  const dir = NodePath.join(import.meta.dirname, "../../.github/workflows");
  const files = NodeFS.readdirSync(dir).filter((name) => /^loom-.*\.yml$/.test(name));
  expect(files).toContain("loom-upstream.yml");
  for (const file of files) {
    const scripts = workflowScripts(NodePath.join(dir, file));
    expect(scripts.length, file).toBeGreaterThan(0);
    for (const script of scripts) {
      const parsed = NodeChildProcess.spawnSync("bash", ["-n"], {
        input: script.replaceAll(/\$\{\{.*?\}\}/g, "X"),
        encoding: "utf8",
      });
      expect({ file, stderr: parsed.stderr.trim() }).toEqual({ file, stderr: "" });
    }
  }
});
