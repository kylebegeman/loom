// @effect-diagnostics nodeBuiltinImport:off - The hook and shim run in real shells.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  addProfileBlock,
  hasProfileBlock,
  removeProfileBlock,
  renderHook,
  renderIndex,
  renderXcodebuildShim,
} from "./shell.ts";

const hasZsh = fs.existsSync("/bin/zsh");
const temporary: Array<string> = [];
const makeTemp = (base = os.tmpdir()) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(base, "loom-lanes-")));
  temporary.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A lanes root with one lane whose checkout is `<root>/repo`. */
const makeLanes = () => {
  const root = makeTemp();
  const checkout = path.join(root, "repo");
  const space = path.join(root, "lanes", "repo", "main", "space");
  fs.mkdirSync(path.join(checkout, "sub"), { recursive: true });
  fs.mkdirSync(path.join(space, "tmp"), { recursive: true });
  fs.mkdirSync(path.join(space, "build"), { recursive: true });
  const lanesRoot = path.join(root, "lanes");
  fs.mkdirSync(path.join(lanesRoot, ".loom", "shims"), { recursive: true });
  fs.writeFileSync(path.join(lanesRoot, ".loom", "lanes.zsh"), renderHook(lanesRoot));
  fs.writeFileSync(
    path.join(lanesRoot, ".loom", "lanes.tsv"),
    renderIndex([{ checkoutPaths: [checkout], spacePath: space }]),
  );
  const shim = path.join(lanesRoot, ".loom", "shims", "xcodebuild");
  fs.writeFileSync(shim, renderXcodebuildShim(lanesRoot), { mode: 0o755 });
  return { root, checkout, space, lanesRoot, shim };
};

const zsh = (cwd: string, lanesRoot: string, script: string) =>
  execFileSync(
    "/bin/zsh",
    ["-f", "-c", `source ${path.join(lanesRoot, ".loom", "lanes.zsh")}; ${script}`],
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
        { checkoutPaths: ["/a", "/a", "/b\tc"], spacePath: "/lanes/a/space" },
        { checkoutPaths: ["/d"], spacePath: "/lanes/bad\nspace" },
      ]),
    ).toBe("/a\t/lanes/a/space\n");
  });
});

describe.skipIf(!hasZsh)("zsh hook", () => {
  it("routes TMPDIR inside a lane checkout and restores it after leaving", () => {
    const lanes = makeLanes();
    const inside = zsh(
      path.join(lanes.checkout, "sub"),
      lanes.lanesRoot,
      'print -r -- "$TMPDIR|$LOOM_LANE_BUILD|${path[1]}"',
    );
    expect(inside).toBe(
      `${lanes.space}/tmp/|${lanes.space}/build|${path.join(lanes.lanesRoot, ".loom", "shims")}`,
    );
    const left = zsh(
      lanes.checkout,
      lanes.lanesRoot,
      'cd /; _loom_lane_apply; print -r -- "$TMPDIR|${LOOM_LANE_SPACE-none}|${path[1]}"',
    );
    expect(left).toBe("/original/|none|/usr/bin");
  });

  it("leaves the environment alone outside lanes and when a lane is not mounted", () => {
    const lanes = makeLanes();
    expect(zsh(lanes.root, lanes.lanesRoot, 'print -r -- "$TMPDIR"')).toBe("/original/");
    fs.rmSync(path.join(lanes.space, "tmp"), { recursive: true });
    expect(zsh(lanes.checkout, lanes.lanesRoot, 'print -r -- "$TMPDIR"')).toBe("/original/");
  });
});

describe.skipIf(!hasZsh)("xcodebuild shim", () => {
  const run = (lanes: ReturnType<typeof makeLanes>, args: ReadonlyArray<string>) => {
    const stub = makeTemp();
    fs.writeFileSync(path.join(stub, "xcodebuild"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
      mode: 0o755,
    });
    return execFileSync(lanes.shim, args, {
      env: {
        PATH: `${path.join(lanes.lanesRoot, ".loom", "shims")}:${stub}:/usr/bin:/bin`,
        LOOM_LANE_BUILD: path.join(lanes.space, "build"),
      },
      encoding: "utf8",
    })
      .trim()
      .split("\n");
  };

  it("adds lane paths to build actions only", () => {
    const lanes = makeLanes();
    const build = path.join(lanes.space, "build");
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
    const requested = path.join(parent, "dd");
    const args = run(lanes, ["test", "-derivedDataPath", requested]);
    expect(args).toEqual([
      "-clonedSourcePackagesDirPath",
      `${lanes.space}/build/SourcePackages`,
      "test",
      "-derivedDataPath",
      requested,
    ]);
    expect(fs.realpathSync(requested).startsWith(`${lanes.space}/build/redirect/`)).toBe(true);
  });
});
