// @effect-diagnostics nodeBuiltinImport:off - The hook and shim run in real shells.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  addProfileBlock,
  hasProfileBlock,
  removeProfileBlock,
  renderHook,
  renderIndex,
  renderShims,
} from "./shell.ts";

const hasZsh = NodeFS.existsSync("/bin/zsh");
const temporary: Array<string> = [];
const makeTemp = (base = NodeOS.tmpdir()) => {
  const dir = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(base, "loom-lanes-")));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temporary.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

/** A lanes root with one lane whose checkout is `<root>/repo`. */
const makeLanes = () => {
  const root = makeTemp();
  const checkout = NodePath.join(root, "repo");
  const space = NodePath.join(root, "lanes", "repo", "main", "space");
  NodeFS.mkdirSync(NodePath.join(checkout, "sub"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(space, "tmp"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(space, "build"), { recursive: true });
  const lanesRoot = NodePath.join(root, "lanes");
  const shims = NodePath.join(lanesRoot, ".loom", "shims");
  const slots = NodePath.join(lanesRoot, ".loom", "slots");
  NodeFS.mkdirSync(shims, { recursive: true });
  NodeFS.mkdirSync(slots, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(slots, "count"), "1\n");
  NodeFS.writeFileSync(NodePath.join(lanesRoot, ".loom", "lanes.zsh"), renderHook(lanesRoot));
  NodeFS.writeFileSync(
    NodePath.join(lanesRoot, ".loom", "lanes.tsv"),
    renderIndex([
      { checkoutPaths: [checkout], spacePath: space, laneId: "lane-1", portBase: 41020 },
    ]),
  );
  for (const [name, contents] of Object.entries(renderShims(lanesRoot)))
    NodeFS.writeFileSync(NodePath.join(shims, name), contents, { mode: 0o755 });
  const shim = NodePath.join(shims, "xcodebuild");
  const ledger = NodePath.join(NodePath.dirname(space), "leases.tsv");
  return { root, checkout, space, lanesRoot, shims, slots, shim, ledger };
};

/** A folder holding executable stubs that print their arguments. */
const makeStubs = (scripts: Record<string, string>) => {
  const dir = makeTemp();
  for (const [name, body] of Object.entries(scripts))
    NodeFS.writeFileSync(NodePath.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return dir;
};

const sh = (cwd: string, script: string, env: Record<string, string> = {}) =>
  NodeChildProcess.execFileSync("/bin/sh", ["-c", script], {
    cwd,
    env: { PATH: "/usr/bin:/bin", ...env },
    encoding: "utf8",
  }).trim();

const zsh = (cwd: string, lanesRoot: string, script: string) =>
  NodeChildProcess.execFileSync(
    "/bin/zsh",
    ["-f", "-c", `source ${NodePath.join(lanesRoot, ".loom", "lanes.zsh")}; ${script}`],
    {
      cwd,
      env: { PATH: "/usr/bin:/bin", TMPDIR: "/original/" },
      encoding: "utf8",
    },
  ).trim();

describe("profile block", () => {
  it("adds once, replaces in place and removes only its own lines", () => {
    const profile = 'export DEV_SCRATCH="$HOME/scratch"';
    const added = addProfileBlock(profile, "/lanes");
    expect(added.startsWith(`${profile}\n# >>> loom lanes >>>\n`)).toBe(true);
    expect(addProfileBlock(added, "/lanes")).toBe(added);
    const moved = addProfileBlock(`${added}export LATER=1\n`, "/other lanes");
    expect(moved).toContain("'/other lanes/.loom/lanes.zsh'");
    expect(moved.endsWith("export LATER=1\n")).toBe(true);
    expect(removeProfileBlock(moved)).toBe(`${profile}\nexport LATER=1\n`);
    expect(hasProfileBlock(removeProfileBlock(moved))).toBe(false);
    expect(removeProfileBlock("unrelated\n")).toBe("unrelated\n");
  });
});

describe("index", () => {
  it("skips paths that would break the tab-separated index", () => {
    expect(
      renderIndex([
        {
          checkoutPaths: ["/a", "/a", "/b\tc"],
          spacePath: "/lanes/a/space",
          laneId: "a",
          portBase: 41000,
        },
        { checkoutPaths: ["/d"], spacePath: "/lanes/bad\nspace", laneId: "d", portBase: 41020 },
      ]),
    ).toBe("/a\t/lanes/a/space\ta\t41000\n");
  });
});

describe.skipIf(!hasZsh)("zsh hook", () => {
  it("routes TMPDIR inside a lane checkout and restores it after leaving", () => {
    const lanes = makeLanes();
    const inside = zsh(
      NodePath.join(lanes.checkout, "sub"),
      lanes.lanesRoot,
      'print -r -- "$TMPDIR|$LOOM_LANE_BUILD|${path[1]}"',
    );
    expect(inside).toBe(
      `${lanes.space}/tmp/|${lanes.space}/build|${NodePath.join(lanes.lanesRoot, ".loom", "shims")}`,
    );
    const left = zsh(
      lanes.checkout,
      lanes.lanesRoot,
      'cd /; _loom_lane_apply; print -r -- "$TMPDIR|${LOOM_LANE_SPACE-none}|${path[1]}"',
    );
    expect(left).toBe("/original/|none|/usr/bin");
  });

  it("exports the lane id, its ports and its lease file", () => {
    const lanes = makeLanes();
    expect(
      zsh(
        lanes.checkout,
        lanes.lanesRoot,
        'print -r -- "$LOOM_LANE_ID|$LOOM_LANE_PORT|$LOOM_LANE_PORTS|$LOOM_LANE_LEASES"; cd /; _loom_lane_apply; print -r -- "${LOOM_LANE_PORT-none}"',
      ).split("\n"),
    ).toEqual([`lane-1|41020|41020-41039|${lanes.ledger}`, "none"]);
  });

  it("leaves the environment alone outside lanes and when a lane is not mounted", () => {
    const lanes = makeLanes();
    expect(zsh(lanes.root, lanes.lanesRoot, 'print -r -- "$TMPDIR"')).toBe("/original/");
    NodeFS.rmSync(NodePath.join(lanes.space, "tmp"), { recursive: true });
    expect(zsh(lanes.checkout, lanes.lanesRoot, 'print -r -- "$TMPDIR"')).toBe("/original/");
  });
});

describe.skipIf(!hasZsh)("xcodebuild shim", () => {
  const run = (lanes: ReturnType<typeof makeLanes>, args: ReadonlyArray<string>) => {
    const stub = makeStubs({ xcodebuild: 'printf "%s\\n" "$@"' });
    return NodeChildProcess.execFileSync(lanes.shim, args, {
      env: {
        PATH: `${lanes.shims}:${stub}:/usr/bin:/bin`,
        LOOM_LANE_BUILD: NodePath.join(lanes.space, "build"),
      },
      encoding: "utf8",
    })
      .trim()
      .split("\n");
  };

  it("adds lane paths to build actions only", () => {
    const lanes = makeLanes();
    const build = NodePath.join(lanes.space, "build");
    expect(run(lanes, ["-scheme", "App", "build"])).toEqual([
      "-derivedDataPath",
      `${build}/DerivedData`,
      "-clonedSourcePackagesDirPath",
      `${build}/SourcePackages`,
      "-scheme",
      "App",
      "build",
    ]);
    expect(run(lanes, ["-version"])).toEqual(["-version"]);
  });

  it("keeps explicit paths and links a new /tmp path into the lane", () => {
    const lanes = makeLanes();
    const parent = makeTemp("/tmp");
    const requested = NodePath.join(parent, "dd");
    const args = run(lanes, ["test", "-derivedDataPath", requested]);
    expect(args).toEqual([
      "-clonedSourcePackagesDirPath",
      `${lanes.space}/build/SourcePackages`,
      "test",
      "-derivedDataPath",
      requested,
    ]);
    expect(NodeFS.realpathSync(requested).startsWith(`${lanes.space}/build/redirect/`)).toBe(true);
  });
});

describe.skipIf(!hasZsh)("compiling in a build slot", () => {
  it("runs compiling actions in a slot and other actions directly", () => {
    const lanes = makeLanes();
    const stub = makeStubs({ xcodebuild: 'echo "slot=${LOOM_SLOT_HELD-none}"' });
    const env = {
      PATH: `${lanes.shims}:${stub}:/usr/bin:/bin`,
      LOOM_LANE_BUILD: NodePath.join(lanes.space, "build"),
      LOOM_LANE_SPACE: lanes.space,
    };
    expect(sh(lanes.checkout, `${lanes.shim} -scheme App build`, env)).toBe("slot=1");
    expect(sh(lanes.checkout, `${lanes.shim} -showBuildSettings`, env)).toBe("slot=none");
    expect(NodeFS.readFileSync(NodePath.join(lanes.slots, "1.holder"), "utf8")).toContain(
      `\t${lanes.space}\t${NodePath.join(stub, "xcodebuild")} -derivedDataPath`,
    );
  });
});

describe("lane-slot", () => {
  it("runs one job per slot and passes the command's exit status through", () => {
    const lanes = makeLanes();
    const log = NodePath.join(lanes.root, "log");
    const slot = NodePath.join(lanes.shims, "lane-slot");
    const job = (id: string) =>
      `${slot} sh -c 'echo start ${id} >> ${log}; sleep 1; echo end ${id} >> ${log}' 2>/dev/null`;
    sh(lanes.root, `${job("a")} & ${job("b")} & wait`);
    const lines = NodeFS.readFileSync(log, "utf8").trim().split("\n");
    expect(lines.map((line) => line.split(" ")[0])).toEqual(["start", "end", "start", "end"]);
    expect(lines[0]!.split(" ")[1]).toBe(lines[1]!.split(" ")[1]);
    // 75 is also what the lock tool returns when a slot is busy.
    expect(sh(lanes.root, `${slot} sh -c 'exit 75'; echo $?`)).toBe("75");
  }, 20_000);
});

describe("lane-run", () => {
  it("records the process in the lane of the current folder, then runs the command", () => {
    const lanes = makeLanes();
    const run = NodePath.join(lanes.shims, "lane-run");
    const out = sh(NodePath.join(lanes.checkout, "sub"), `${run} --name web sh -c 'echo $$'`);
    const [kind, pid, label, started] = NodeFS.readFileSync(lanes.ledger, "utf8")
      .trim()
      .split("\t");
    expect([kind, pid, label]).toEqual(["process", out, "web"]);
    expect(started).toMatch(/^\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4}$/);
  });

  it("still runs the command outside a lane", () => {
    const lanes = makeLanes();
    expect(sh(lanes.root, `${NodePath.join(lanes.shims, "lane-run")} echo ok 2>/dev/null`)).toBe(
      "ok",
    );
    expect(NodeFS.existsSync(lanes.ledger)).toBe(false);
  });
});

describe("xcrun shim", () => {
  it("records simulators made in the lane and passes everything else through", () => {
    const lanes = makeLanes();
    const stub = makeStubs({
      xcrun:
        'if [ "$2" = create ]; then echo 0A1B2C3D-0000-4000-8000-00000000ABCD; else echo "$@"; fi',
    });
    const env = { PATH: `${lanes.shims}:${stub}:/usr/bin:/bin` };
    const xcrun = NodePath.join(lanes.shims, "xcrun");
    expect(sh(lanes.checkout, `${xcrun} simctl create 'Test Phone' iPhone`, env)).toBe(
      "0A1B2C3D-0000-4000-8000-00000000ABCD",
    );
    expect(sh(lanes.checkout, `${xcrun} simctl list devices`, env)).toBe("simctl list devices");
    expect(sh(lanes.root, `${xcrun} simctl create Outside iPhone`, env)).toBe(
      "0A1B2C3D-0000-4000-8000-00000000ABCD",
    );
    const lines = NodeFS.readFileSync(lanes.ledger, "utf8").trim().split("\n");
    expect(lines.map((line) => line.split("\t").slice(0, 3))).toEqual([
      ["simulator", "0A1B2C3D-0000-4000-8000-00000000ABCD", "Test Phone"],
    ]);
  });
});
