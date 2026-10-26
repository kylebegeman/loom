// @effect-diagnostics nodeBuiltinImport:off - Exercises maintenance checks and database backups against isolated fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";

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
check_omarchy_pack() { printf 'omarchy-pack\\n' >> "$LOOM_TEST_LOG"; }
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
    ["omarchy-pack"],
    ["exec", "vp", "build"],
    ["exec", "vp", "run", "typecheck"],
    ["exec", "tsc", "--noEmit", "-p", "benchmarks/loom/tsconfig.json"],
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
          if [ "$LOOM_TEST_FAILURE" = state-copy ] && [ "$1" = "$LOOM_TEST_PREVIOUS/state/statev2.sqlite" ]; then return 1; fi
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

  expect(status("2026-10-14T12:00:00Z")).toMatchObject({
    state: "behind",
    newest: "v0.1.0-nightly.20261014.2",
    main: "v0.1.0-nightly.20261013.1",
    oldest_missing: "v0.1.0-nightly.20261014.2",
    waited_hours: "12",
    behind_commits: "1",
  });
  expect(status("2026-10-15T12:00:00Z")).toMatchObject({ state: "stale", waited_hours: "36" });

  f.git("update-ref", "refs/remotes/origin/main", "v0.1.0-nightly.20261014.2");
  expect(status("2026-10-20T00:00:00Z")).toMatchObject({
    state: "in-sync",
    oldest_missing: "",
    behind_commits: "0",
  });
});

const NIGHTLY = "v1.0.0-nightly.20261014.1";

function conflictFixture(agent: string) {
  const f = repositoryFixture();
  const write = (file: string, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(f.root, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(f.root, file), text);
  };
  write("apps/a.ts", "export const a = 1;\n");
  write("apps/b.ts", "export const b = 1;\n");
  write("apps/clean.ts", "export const clean = 1;\n");
  f.git("add", "-A");
  f.git("commit", "--quiet", "-m", "base");
  f.git("switch", "--quiet", "-c", "upstream");
  write("apps/a.ts", "export const a = 2;\n");
  write("apps/b.ts", "export const b = 2;\n");
  write("apps/clean.ts", "export const clean = 2;\n");
  f.git("commit", "--quiet", "-am", "upstream changes");
  f.git("tag", NIGHTLY);
  f.git("switch", "--quiet", "main");
  write("apps/a.ts", "export const a = 3; // loom change\n");
  write("apps/b.ts", "export const b = 3; // loom change\n");
  f.git("commit", "--quiet", "-am", "fork changes");
  f.git("switch", "--quiet", "-c", `integrate/${NIGHTLY}`);
  const merge = NodeChildProcess.spawnSync("git", ["merge", "--no-edit", NIGHTLY], {
    cwd: f.root,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(merge.status).not.toBe(0);
  const agentPath = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-agent.sh`);
  roots.push(agentPath);
  NodeFS.writeFileSync(agentPath, `#!/bin/bash\ncat >/dev/null\n${agent}\n`, { mode: 0o755 });
  const logs = NodePath.join(f.root, "..", `${NodePath.basename(f.root)}-logs`);
  roots.push(logs);
  const resolve = () =>
    runSync(f.root, `resolve_conflicts ${NIGHTLY}`, {
      LOOM_AGENT: agentPath,
      LOOM_RESOLVE_LOGS: logs,
      LOOM_RESOLVE_JOBS: "2",
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

it("merges a resolution unattended only when the independent review passes it", () => {
  const f = conflictFixture("");
  NodeFS.writeFileSync(
    NodePath.join(f.root, "apps/a.ts"),
    "export const a = 2; // loom change\n",
  );
  NodeFS.writeFileSync(
    NodePath.join(f.root, "apps/b.ts"),
    "export const b = 2; // loom change\n",
  );
  f.git("add", "-A");
  f.git("commit", "--quiet", "--no-edit");
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
