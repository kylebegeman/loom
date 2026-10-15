import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { paths } from "./loom-os.mjs";
import {
  planCleanup,
  applyCleanup,
  validateSelection,
  defaultSelection,
  saveSelection,
  planSystem,
  applySystem,
  pauseDictation,
  restoreUtilities,
  nativeHousekeeping,
} from "./housekeeping.mjs";
const test = NodeTest.test,
  assert = NodeAssert,
  hash = (s) => NodeCrypto.createHash("sha256").update(s).digest("hex");
async function fixture(t) {
  const home = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-cleanup-")),
  );
  t.after(() => NodeFSP.rm(home, { recursive: true, force: true }));
  const env = { HOME: home },
    p = paths(env),
    state = NodePath.join(p.state, "loom-os");
  async function put(file, data) {
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
    await NodeFSP.writeFile(file, typeof data === "string" ? data : JSON.stringify(data));
  }
  const recipe = JSON.stringify({ components: {} }),
    digest = hash(recipe),
    kits = NodePath.join(state, "updates/candidates");
  const kit = NodePath.join(kits, "kit-" + digest);
  await put(NodePath.join(kit, "recipe.json"), recipe);
  await put(NodePath.join(state, "commission.json"), { phase: "complete", kit, sha256: digest });
  await put(NodePath.join(state, "updates/journal.json"), {
    phase: "complete",
    baseline: { recipe: digest },
  });
  const current = NodePath.join(p.root, "pack-releases/current"),
    previous = NodePath.join(p.root, "pack-releases/previous");
  await put(NodePath.join(state, "pack-release.json"), {
    active: { directory: current },
    previous: { directory: previous },
  });
  await put(NodePath.join(current, "asset"), "current");
  await put(NodePath.join(previous, "asset"), "previous");
  const active = NodePath.join(p.root, "components/app-active");
  await put(NodePath.join(active, "bin"), "active");
  await put(p.configFile, { loomExecutable: NodePath.join(active, "bin") });
  const deps = { processReferences: async () => [], verifyRecovery: async () => {} };
  return { env, p, state, put, deps, kit, current, previous, active };
}
test("reviewed cleanup retains active/previous recovery, CLI aliases, unknown workspaces and app data", async (t) => {
  const f = await fixture(t),
    old = NodePath.join(f.p.root, "build/20261010");
  await f.put(NodePath.join(old, "nested/file"), "old");
  const user = NodePath.join(f.p.root, "build/personal-project");
  await f.put(NodePath.join(user, "source"), "mine");
  const legacy = NodePath.join(f.p.root, "releases/legacy-cli");
  await f.put(NodePath.join(legacy, "bin"), "cli");
  await NodeFSP.mkdir(NodePath.join(f.env.HOME, ".local/bin"), { recursive: true });
  await NodeFSP.symlink(
    NodePath.join(legacy, "bin"),
    NodePath.join(f.env.HOME, ".local/bin/custom-app"),
  );
  const data = NodePath.join(f.p.root, "browser-profiles/atlas/data");
  await f.put(data, "personal");
  const plan = await planCleanup(f.env, f.deps);
  assert.deepEqual(
    plan.candidates.map((c) => c.directory),
    [old],
  );
  await applyCleanup(plan.reviewHash, f.env, f.deps);
  await assert.rejects(NodeFSP.stat(old), { code: "ENOENT" });
  for (const file of [
    NodePath.join(f.current, "asset"),
    NodePath.join(f.previous, "asset"),
    NodePath.join(f.active, "bin"),
    NodePath.join(legacy, "bin"),
    NodePath.join(user, "source"),
    data,
    NodePath.join(f.kit, "recipe.json"),
  ])
    assert.ok((await NodeFSP.stat(file)).isFile());
});
test("nested changes invalidate review before any candidate is removed", async (t) => {
  const f = await fixture(t),
    a = NodePath.join(f.p.root, "build/20261010"),
    b = NodePath.join(f.p.root, "build/20261011");
  await f.put(NodePath.join(a, "child"), "a");
  await f.put(NodePath.join(b, "child"), "b");
  const plan = await planCleanup(f.env, f.deps);
  await f.put(NodePath.join(b, "child"), "edited");
  await assert.rejects(applyCleanup(plan.reviewHash, f.env, f.deps), /changed/);
  assert.equal(await NodeFSP.readFile(NodePath.join(a, "child"), "utf8"), "a");
  assert.equal(await NodeFSP.readFile(NodePath.join(b, "child"), "utf8"), "edited");
});
test("active processes and newly introduced process references prevent deletion", async (t) => {
  const f = await fixture(t),
    old = NodePath.join(f.p.root, "build/20261010");
  await f.put(NodePath.join(old, "source"), "active");
  let refs = [old + "/source"];
  const deps = { ...f.deps, processReferences: async () => refs };
  assert.equal((await planCleanup(f.env, deps)).candidates.length, 0);
  refs = [];
  const plan = await planCleanup(f.env, deps);
  refs = [old + "/source"];
  await assert.rejects(applyCleanup(plan.reviewHash, f.env, deps), /changed/);
  assert.ok(await NodeFSP.stat(old));
});
test("root symlinks are preserved and member symlinks never delete external data", async (t) => {
  const f = await fixture(t),
    outside = NodePath.join(f.env.HOME, "personal"),
    old = NodePath.join(f.p.root, "build/20261010");
  await f.put(outside, "mine");
  await NodeFSP.mkdir(old, { recursive: true });
  await NodeFSP.symlink(outside, NodePath.join(old, "link"));
  await NodeFSP.symlink(NodePath.dirname(outside), NodePath.join(f.p.root, "build/20261011"));
  const plan = await planCleanup(f.env, f.deps);
  assert.equal(plan.candidates.length, 1);
  await applyCleanup(plan.reviewHash, f.env, f.deps);
  assert.equal(await NodeFSP.readFile(outside, "utf8"), "mine");
});
test("incomplete updates, missing recovery and an existing operation refuse cleanup", async (t) => {
  const f = await fixture(t);
  await f.put(NodePath.join(f.state, "updates/journal.json"), { phase: "applying" });
  await assert.rejects(planCleanup(f.env, f.deps), /Finish/);
  await f.put(NodePath.join(f.state, "updates/journal.json"), {
    phase: "complete",
    baseline: { recipe: "0".repeat(64) },
  });
  await assert.rejects(planCleanup(f.env, f.deps), /missing or changed/);
});
test("protected applications and unsafe or conflicting selections are rejected", () => {
  for (const name of [
    "libreoffice-fresh",
    "openai-codex-desktop",
    "claude-desktop",
    "claude-code",
    "hyprland",
    "tailscale",
    "linux",
    "nvidia-utils",
  ])
    assert.throws(
      () => validateSelection({ ...defaultSelection, removePackages: [name] }),
      /protected/,
    );
  for (const value of [
    { ...defaultSelection, removePackages: ["$(bad)"] },
    { ...defaultSelection, keepPackages: ["my-app"], removePackages: ["my-app"] },
    { ...defaultSelection, removePackages: ["firefox", "firefox"] },
  ])
    assert.throws(() => validateSelection(value));
});
function packageRunner(calls, closure = "firefox\nobsidian\nelectron43\n") {
  return async (command, args) => {
    calls.push([command, args]);
    if (command === "sudo") return "";
    if (command === "systemctl")
      return "LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\n";
    if (command === "lpstat") return "";
    if (command === "voxtype") return '{"alt":"idle"}';
    if (command === "pacman")
      return args[0] === "-Q"
        ? "firefox 1\nobsidian 1\nelectron43 1\nlibreoffice-fresh 1\nopenai-codex-desktop 1\nclaude-desktop 1\n"
        : closure;
    if (command === "paccache") return "Retain two versions; 3 old packages can be removed.";
    throw Error("Unexpected command");
  };
}
test("system cleanup uses the reviewed complete package set and preserves Codex, LibreOffice and Claude", async (t) => {
  const f = await fixture(t),
    calls = [],
    deps = { run: packageRunner(calls) };
  const plan = await planSystem(f.env, deps);
  assert.ok(plan.protectedInstalled.includes("claude-desktop"));
  await applySystem(plan.reviewHash, f.env, deps);
  const command = calls.find((c) => c[0] === "sudo" && c[1][0] === "/usr/bin/pacman");
  assert.deepEqual(command[1], [
    "/usr/bin/pacman",
    "-R",
    "--noconfirm",
    "--",
    "electron43",
    "firefox",
    "obsidian",
  ]);
  assert.ok(
    calls.some((c) => c[0] === "sudo" && c[1][0] === "/usr/bin/paccache" && c[1].includes("2")),
  );
});
test("future selected apps and protected dependencies block expanded removals before sudo", async (t) => {
  const f = await fixture(t),
    calls = [];
  await saveSelection(
    { ...defaultSelection, keepPackages: [...defaultSelection.keepPackages, "my-new-app"] },
    f.env,
  );
  for (const closure of ["firefox\nmy-new-app\n", "firefox\nchromium\n"])
    await assert.rejects(
      planSystem(f.env, { run: packageRunner(calls, closure) }),
      /protected or selected/,
    );
  assert.ok(!calls.some((c) => c[0] === "sudo"));
});
test("package changes after review refuse system cleanup before authentication", async (t) => {
  const f = await fixture(t),
    calls = [],
    plan = await planSystem(f.env, { run: packageRunner(calls) });
  const runner = packageRunner(calls);
  await assert.rejects(
    applySystem(plan.reviewHash, f.env, {
      run: async (c, a) => (c === "pacman" && a[0] === "-Q" ? "firefox 2\n" : runner(c, a)),
    }),
    /changed/,
  );
  assert.ok(!calls.some((c) => c[0] === "sudo"));
});

test("busy dictation refuses pause and preserves original startup preferences", async (t) => {
  const f = await fixture(t),
    calls = [];
  await assert.rejects(
    pauseDictation(f.env, {
      run: async (c, a) => {
        calls.push([c, a]);
        return c === "systemctl"
          ? "LoadState=loaded\nActiveState=active\nUnitFileState=enabled\n"
          : '{"alt":"recording"}';
      },
    }),
    /Finish the active dictation/,
  );
  assert.ok(!calls.some(([, a]) => a.includes("disable")));
});
test("dictation pause records original startup and restores it without touching Bluetooth", async (t) => {
  const f = await fixture(t),
    calls = [];
  let paused = false;
  const run = async (c, a) => {
    calls.push([c, a]);
    if (c === "voxtype") return '{"alt":"idle"}';
    if (a.includes("disable")) {
      paused = true;
      return "";
    }
    if (a.includes("show"))
      return (
        "LoadState=loaded\nActiveState=" +
        (paused ? "inactive" : "active") +
        "\nUnitFileState=" +
        (paused ? "disabled" : "enabled") +
        "\n"
      );
    return "";
  };
  await pauseDictation(f.env, { run });
  await restoreUtilities(f.env, { run });
  assert.ok(calls.some(([, a]) => a.includes("enable") && a.includes("voxtype.service")));
  assert.ok(calls.some(([, a]) => a.includes("start") && a.includes("voxtype.service")));
  assert.ok(!calls.some(([, a]) => a.some((s) => s.includes("bluetooth"))));
});

test("native restore reaches recorded utility recovery without a cleanup review", async (t) => {
  const f = await fixture(t),
    calls = [];
  await f.put(NodePath.join(f.state, "housekeeping/optional-utilities.json"), {
    version: 1,
    dictation: { paused: true, original: { UnitFileState: "enabled", ActiveState: "active" } },
  });
  const choices = ["Restore printing and dictation", "Close"];
  await nativeHousekeeping(f.env, {
    choose: async () => choices.shift(),
    show: () => {},
    run: async (c, a) => {
      calls.push([c, a]);
      return a.includes("show")
        ? "LoadState=loaded\nActiveState=active\nUnitFileState=enabled\n"
        : "";
    },
  });
  assert.ok(calls.some(([, a]) => a.includes("start") && a.includes("voxtype.service")));
});

test("ordinary executable launchers retain their referenced release", async (t) => {
  const f = await fixture(t),
    release = NodePath.join(f.p.root, "releases/old-launcher");
  await f.put(NodePath.join(release, "AppRun"), "binary");
  const bin = NodePath.join(f.env.HOME, ".local/bin/another-product");
  await f.put(bin, '#!/bin/sh\nexec "' + release + '/AppRun" "$@"\n');
  await NodeFSP.chmod(bin, 0o755);
  const plan = await planCleanup(f.env, f.deps);
  assert.ok(!plan.candidates.some((c) => c.directory === release));
  assert.ok(
    plan.retained.some(
      (c) => c.directory === release && c.reason === "Active or recovery reference",
    ),
  );
});

test("edited stored cleanup reviews cannot redirect deletion to personal data", async (t) => {
  const f = await fixture(t),
    old = NodePath.join(f.p.root, "build/20261010"),
    personal = NodePath.join(f.env.HOME, "personal-files");
  await f.put(NodePath.join(old, "data"), "old");
  await f.put(NodePath.join(personal, "data"), "mine");
  const plan = await planCleanup(f.env, f.deps),
    file = NodePath.join(f.state, "housekeeping/cleanup-plan.json");
  const edited = JSON.parse(await NodeFSP.readFile(file, "utf8"));
  edited.candidates[0].directory = personal;
  await f.put(file, edited);
  await assert.rejects(applyCleanup(plan.reviewHash, f.env, f.deps), /exact cleanup plan/);
  assert.equal(await NodeFSP.readFile(NodePath.join(personal, "data"), "utf8"), "mine");
  assert.ok(await NodeFSP.stat(old));
});
test("edited stored package reviews cannot introduce protected removal targets", async (t) => {
  const f = await fixture(t),
    calls = [],
    deps = { run: packageRunner(calls) };
  const plan = await planSystem(f.env, deps);
  const file = NodePath.join(f.state, "housekeeping/system-plan.json"),
    edited = JSON.parse(await NodeFSP.readFile(file, "utf8"));
  edited.removePackages.push("openai-codex-desktop");
  await f.put(file, edited);
  await assert.rejects(applySystem(plan.reviewHash, f.env, deps), /exact system cleanup plan/);
  assert.ok(!calls.some((c) => c[0] === "sudo"));
});

test("removing one reviewed hardlinked tree does not invalidate another unchanged tree", async (t) => {
  const f = await fixture(t),
    a = NodePath.join(f.p.root, "build/20261010"),
    b = NodePath.join(f.p.root, "build/20261011");
  await f.put(NodePath.join(a, "shared"), "shared bytes");
  await NodeFSP.mkdir(b, { recursive: true });
  await NodeFSP.link(NodePath.join(a, "shared"), NodePath.join(b, "shared"));
  const plan = await planCleanup(f.env, f.deps);
  const result = await applyCleanup(plan.reviewHash, f.env, f.deps);
  assert.equal(result.removed.length, 2);
  assert.equal(result.complete, true);
});
