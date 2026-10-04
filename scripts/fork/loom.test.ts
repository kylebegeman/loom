// @effect-diagnostics nodeBuiltinImport:off - Exercises the maintenance shell script against isolated SQLite fixtures.
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
  NodeChildProcess.execFileSync(
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
