import * as NodeProcess from "node:process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import { paths, finderChoice } from "./loom-os.mjs";
import { releaseStatus } from "./release.mjs";
import { verifyKit } from "./commission.mjs";

const sha = (v) => NodeCrypto.createHash("sha256").update(v).digest("hex");
const packageName = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9@._+-]*$/.test(v);
const protectedPackage = (name) =>
  /^(?:libreoffice|openai-codex|codex|claude|linux|nvidia)(?:$|-)/.test(name) ||
  [
    "base",
    "base-devel",
    "omarchy",
    "omarchy-settings",
    "omarchy-keyring",
    "hyprland",
    "quickshell",
    "uwsm",
    "sddm",
    "limine",
    "snapper",
    "foot",
    "chromium",
    "1password",
    "1password-cli",
    "tailscale",
    "networkmanager",
    "pipewire",
    "wireplumber",
    "gnome-keyring",
    "cups",
    "bluez",
    "voxtype-bin",
    "qrencode",
    "grim",
    "slurp",
    "wtype",
    "imagemagick",
    "librsvg",
    "gum",
    "mise-bin",
    "pacman-contrib",
  ].includes(name);
export const defaultSelection = {
  format: "loom-os-app-selection",
  version: 1,
  keepPackages: ["libreoffice-fresh", "openai-codex-desktop"],
  removePackages: ["firefox", "obsidian", "kdenlive", "obs-studio", "pinta", "xournalpp"],
};
export function validateSelection(value) {
  if (
    !value ||
    value.format !== defaultSelection.format ||
    value.version !== 1 ||
    Object.keys(value).some(
      (k) => !["format", "version", "keepPackages", "removePackages"].includes(k),
    )
  )
    throw Error("Invalid app selection.");
  for (const key of ["keepPackages", "removePackages"]) {
    if (
      !Array.isArray(value[key]) ||
      value[key].length > 200 ||
      value[key].some((p) => !packageName(p)) ||
      new Set(value[key]).size !== value[key].length
    )
      throw Error("Use unique package names in the app selection.");
  }
  if (value.removePackages.some((p) => protectedPackage(p) || value.keepPackages.includes(p)))
    throw Error("App selection would remove a protected or selected app.");
  return value;
}
function intactReview(saved, expected) {
  if (!saved || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const { reviewHash, ...body } = saved;
  return reviewHash === expected && sha(JSON.stringify(body)) === expected;
}
function locations(env) {
  const p = paths(env);
  return {
    ...p,
    stateRoot: NodePath.join(p.state, "loom-os/housekeeping"),
    selection: NodePath.join(p.config, "loom-os/apps.json"),
  };
}
async function ordinaryPath(file) {
  for (let p = NodePath.resolve(file); ; p = NodePath.dirname(p)) {
    try {
      if ((await NodeFSP.lstat(p)).isSymbolicLink())
        throw Error("Preserving a symlink in the cleanup path.");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (p === NodePath.dirname(p)) break;
  }
}
async function read(file) {
  await ordinaryPath(file);
  try {
    const s = await NodeFSP.stat(file);
    if (!s.isFile() || s.size > 2 * 1024 * 1024)
      throw Error("Cleanup metadata must be a bounded ordinary file.");
    return await NodeFSP.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function save(file, value) {
  await ordinaryPath(file);
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + NodeCrypto.randomUUID();
  try {
    await NodeFSP.writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await NodeFSP.rename(temp, file);
  } finally {
    await NodeFSP.rm(temp, { force: true });
  }
}
export async function appSelection(env = NodeProcess.env) {
  const raw = await read(locations(env).selection);
  return validateSelection(raw ? JSON.parse(raw) : structuredClone(defaultSelection));
}
export async function saveSelection(value, env = NodeProcess.env) {
  const selection = validateSelection(value);
  await save(locations(env).selection, selection);
  return selection;
}
export async function run(command, args, { env = NodeProcess.env, interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      env,
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (b) => {
      stdout += b;
      if (stdout.length > 16 * 1024 * 1024) child.kill();
    });
    child.stderr?.on("data", (b) => (stderr += b));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(Error(command + " failed (" + code + "): " + stderr.slice(0, 500))),
    );
  });
}
// /proc inspection returns only paths, never environment variables or command output.
export async function processReferences() {
  if (!(await NodeFSP.stat("/proc/self").catch(() => null)))
    throw Error("Native cleanup requires Linux process inspection.");
  const references = [];
  for (const name of await NodeFSP.readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const root = "/proc/" + name;
    try {
      if ((await NodeFSP.stat(root)).uid !== NodeProcess.getuid()) continue;
      references.push(
        (await NodeFSP.readFile(root + "/cmdline")).toString().replaceAll("\0", "\n"),
      );
      for (const field of ["cwd", "exe"])
        references.push(await NodeFSP.readlink(root + "/" + field).catch(() => ""));
      const fds = await NodeFSP.readdir(root + "/fd").catch(() => []);
      for (const fd of fds)
        references.push(await NodeFSP.readlink(root + "/fd/" + fd).catch(() => ""));
      references.push(await NodeFSP.readFile(root + "/maps", "utf8").catch(() => ""));
    } catch (e) {
      if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(e.code)) throw e;
    }
  }
  return references;
}
async function children(directory) {
  await ordinaryPath(directory);
  try {
    return (await NodeFSP.readdir(directory)).sort();
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
async function metadata(env) {
  const p = locations(env),
    texts = [],
    fingerprints = [];
  const files = [
    p.configFile,
    p.manifest,
    NodePath.join(p.state, "loom-os/pack-release.json"),
    NodePath.join(p.state, "loom-os/commission.json"),
    NodePath.join(p.state, "loom-os/updates/journal.json"),
    NodePath.join(p.state, "loom-os/service-environment.json"),
    NodePath.join(p.home, ".config/systemd/user/t3code.service"),
  ];
  const journal = JSON.parse(
    (await read(NodePath.join(p.state, "loom-os/updates/journal.json"))) ?? "null",
  );
  if (journal && !["complete", "discarded"].includes(journal.phase))
    throw Error("Finish or recover the active update before cleanup.");
  const commission = JSON.parse(
    (await read(NodePath.join(p.state, "loom-os/commission.json"))) ?? "null",
  );
  if (commission && commission.phase !== "complete")
    throw Error("Finish commissioning before cleanup.");
  const pack = JSON.parse(
    (await read(NodePath.join(p.state, "loom-os/pack-release.json"))) ?? "null",
  );
  if (
    !pack?.active?.directory ||
    !pack?.previous?.directory ||
    !commission?.kit ||
    !/^[a-f0-9]{64}$/.test(journal?.baseline?.recipe ?? "")
  )
    throw Error("Cleanup needs recorded current and previous pack and recovery-kit targets.");
  const kitRoot = NodePath.join(p.state, "loom-os/updates/candidates");
  texts.push(commission.kit, NodePath.join(kitRoot, "kit-" + journal.baseline.recipe));
  for (const digest of [commission.sha256, journal.baseline.recipe]) {
    files.push(NodePath.join(p.root, "commission/recipes", digest + ".json"));
    const kit = NodePath.join(kitRoot, "kit-" + digest);
    const recipe = await read(NodePath.join(kit, "recipe.json"));
    if (!recipe || sha(recipe) !== digest)
      throw Error("Retained recovery recipe is missing or changed.");
    fingerprints.push([kit, sha(recipe)]);
    for (const [name, component] of Object.entries(JSON.parse(recipe).components ?? {}))
      texts.push(
        NodePath.join(
          p.root,
          "components",
          name + "-" + sha(JSON.stringify(component)).slice(0, 16),
        ),
      );
  }
  for (const dir of [NodePath.join(p.root, "commission/launchers"), NodePath.join(p.root, "ai")]) {
    for (const name of await children(dir)) {
      const file = NodePath.join(dir, name);
      if ((await NodeFSP.lstat(file)).isFile()) files.push(file);
    }
  }
  for (const name of await children(NodePath.join(p.data, "applications")))
    if (name.endsWith(".desktop")) files.push(NodePath.join(p.data, "applications", name));
  for (const file of files) {
    const raw = await read(file);
    fingerprints.push([file, raw === null ? null : sha(raw)]);
    if (raw) texts.push(raw);
  }
  for (const dir of [NodePath.join(p.home, ".local/bin"), NodePath.join(p.root, "desktop")]) {
    for (const name of await children(dir)) {
      const file = NodePath.join(dir, name);
      const stat = await NodeFSP.lstat(file);
      if (stat.isFile() && stat.size <= 64 * 1024 && (stat.mode & 0o111 || name.endsWith(".sh"))) {
        const raw = await read(file);
        if (raw?.startsWith("#!")) {
          fingerprints.push([file, sha(raw)]);
          texts.push(raw);
        }
      }
      if (stat.isSymbolicLink()) {
        const target = await NodeFSP.realpath(file).catch(() => null);
        fingerprints.push([file, target]);
        if (target) texts.push(target);
      }
    }
  }
  return {
    texts,
    fingerprint: sha(JSON.stringify(fingerprints)),
    kits: [
      { directory: commission.kit, sha256: commission.sha256 },
      {
        directory: NodePath.join(kitRoot, "kit-" + journal.baseline.recipe),
        sha256: journal.baseline.recipe,
      },
    ],
  };
}
async function treeSnapshot(root) {
  const digest = NodeCrypto.createHash("sha256");
  let bytes = 0,
    files = 0;
  async function walk(file, relative = "") {
    const stat = await NodeFSP.lstat(file);
    if (++files > 500000) throw Error("Cleanup tree exceeds its review bound.");
    if (!stat.isDirectory() && !stat.isFile() && !stat.isSymbolicLink())
      throw Error("Special files are preserved during cleanup.");
    // Unlinking another hardlink changes ctime, not this reviewed file content.
    digest.update(
      JSON.stringify([
        relative,
        stat.dev,
        stat.ino,
        stat.mode,
        stat.uid,
        stat.gid,
        stat.size,
        stat.mtimeMs,
        stat.isSymbolicLink() ? await NodeFSP.readlink(file) : null,
      ]),
    );
    if (stat.isDirectory())
      for (const name of (await NodeFSP.readdir(file)).sort())
        await walk(NodePath.join(file, name), relative + "/" + name);
    else if (stat.isFile()) bytes += stat.size;
  }
  await walk(root);
  const stat = await NodeFSP.lstat(root);
  return { fingerprint: digest.digest("hex"), bytes, files, dev: stat.dev, ino: stat.ino };
}
export async function planCleanup(env = NodeProcess.env, deps = {}) {
  const p = locations(env),
    meta = await metadata(env),
    refs = await (deps.processReferences ?? processReferences)();
  if (deps.verifyRecovery) await deps.verifyRecovery(meta);
  else {
    const pack = await releaseStatus({ env });
    if (!pack.active?.verified || !pack.active.matchesInstalled || !pack.previous?.verified)
      throw Error("Verify the current and previous integration before cleanup.");
    for (const kit of meta.kits) await verifyKit(kit.directory, kit.sha256);
  }
  const roots = [
    ["build", NodePath.join(p.root, "build")],
    ["packs", NodePath.join(p.root, "pack-releases")],
    ["kits", NodePath.join(p.root, "recovery-kits")],
    ["candidates", NodePath.join(p.state, "loom-os/updates/candidates")],
    ["components", NodePath.join(p.root, "components")],
    ["releases", NodePath.join(p.root, "releases")],
  ];
  const candidates = [],
    retained = [];
  for (const [kind, root] of roots)
    for (const name of await children(root)) {
      if (name.startsWith(".")) continue;
      const directory = NodePath.join(root, name),
        stat = await NodeFSP.lstat(directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (NodeProcess.getuid && stat.uid !== NodeProcess.getuid())
      ) {
        retained.push({ directory, reason: "Not an ordinary owned directory" });
        continue;
      }
      if (
        kind === "build" &&
        !/^(?:\d{8}(?:\.\d+)?|packet\d+[-\w.]*|pack-\d{8}\.\d+|reproducible-setup)$/.test(name)
      ) {
        retained.push({ directory, reason: "Unrecognized build workspace" });
        continue;
      }
      const reason = meta.texts.some((t) => t.includes(directory))
        ? "Active or recovery reference"
        : refs.some((t) => t.includes(directory))
          ? "Running process reference"
          : null;
      if (reason) {
        retained.push({ directory, reason });
        continue;
      }
      candidates.push({ directory, kind, ...(await treeSnapshot(directory)) });
    }
  const value = {
    format: "loom-os-cleanup-plan",
    version: 1,
    metadata: meta.fingerprint,
    candidates,
    retained,
  };
  value.reviewHash = sha(JSON.stringify(value));
  await save(NodePath.join(p.stateRoot, "cleanup-plan.json"), value);
  return value;
}
export async function applyCleanup(expected, env = NodeProcess.env, deps = {}) {
  const p = locations(env),
    file = NodePath.join(p.stateRoot, "cleanup-plan.json"),
    saved = JSON.parse((await read(file)) ?? "null");
  if (!intactReview(saved, expected)) throw Error("Review the exact cleanup plan first.");
  const lock = NodePath.join(p.stateRoot, "operation.json");
  await ordinaryPath(lock);
  const handle = await NodeFSP.open(lock, "wx", 0o600);
  await handle.close();
  const receipt = {
    format: "loom-os-cleanup-receipt",
    version: 1,
    reviewHash: expected,
    removed: [],
  };
  try {
    const current = await planCleanup(env, deps);
    if (current.reviewHash !== expected)
      throw Error("Cleanup candidates or references changed after review. Review again.");
    for (const candidate of saved.candidates) {
      await ordinaryPath(candidate.directory);
      if ((await treeSnapshot(candidate.directory)).fingerprint !== candidate.fingerprint)
        throw Error("Cleanup candidate changed after review.");
      const refs = await (deps.processReferences ?? processReferences)();
      if (refs.some((t) => t.includes(candidate.directory)))
        throw Error("A running process now uses the cleanup candidate.");
      // Only a reviewed ordinary root is removed; recursive rm does not follow member symlinks.
      await NodeFSP.rm(candidate.directory, { recursive: true });
      receipt.removed.push(candidate.directory);
      await save(NodePath.join(p.stateRoot, "last-cleanup.json"), receipt);
    }
    receipt.complete = true;
    await save(NodePath.join(p.stateRoot, "last-cleanup.json"), receipt);
    return receipt;
  } finally {
    await NodeFSP.unlink(lock);
  }
}
const printingUnits = ["cups.path", "cups.socket", "cups.service"];
async function unitState(unit, user, env, execute) {
  const text = await execute(
    "systemctl",
    [
      ...(user ? ["--user"] : []),
      "show",
      unit,
      "-p",
      "LoadState",
      "-p",
      "ActiveState",
      "-p",
      "UnitFileState",
    ],
    { env },
  );
  return Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
}
export async function utilityStatus(env = NodeProcess.env, deps = {}) {
  const execute = deps.run ?? run;
  const dictation = await unitState("voxtype.service", true, env, execute);
  const printing = {};
  for (const unit of printingUnits) printing[unit] = await unitState(unit, false, env, execute);
  return { dictation, printing, bluetooth: "Preserved" };
}
export async function pauseDictation(env = NodeProcess.env, deps = {}) {
  const execute = deps.run ?? run,
    p = locations(env);
  const file = NodePath.join(p.stateRoot, "optional-utilities.json");
  const saved = JSON.parse((await read(file)) ?? '{"version":1}');
  if (saved.version !== 1) throw Error("Unknown optional-utility recovery record.");
  const state = await unitState("voxtype.service", true, env, execute);
  if (state.LoadState === "not-found") return { available: false };
  if (state.ActiveState === "active") {
    const status = JSON.parse(await execute("voxtype", ["status", "--format", "json"], { env }));
    if (status.alt !== "idle")
      throw Error("Finish the active dictation before pausing its background service.");
  }
  if (!saved.dictation) {
    saved.dictation = { original: state, paused: false };
    await save(file, saved);
  }
  await execute("systemctl", ["--user", "disable", "--now", "voxtype.service"], { env });
  const after = await unitState("voxtype.service", true, env, execute);
  if (after.ActiveState !== "inactive" || after.UnitFileState !== "disabled")
    throw Error("Dictation pause did not complete. Its original startup state is saved.");
  saved.dictation.paused = true;
  await save(file, saved);
  return { dictation: "on-demand", installed: true, bluetooth: "Preserved" };
}
async function pausePrinting(env, execute) {
  const p = locations(env),
    file = NodePath.join(p.stateRoot, "optional-utilities.json");
  const saved = JSON.parse((await read(file)) ?? '{"version":1}');
  const states = {};
  for (const unit of printingUnits) states[unit] = await unitState(unit, false, env, execute);
  if (
    states["cups.service"].ActiveState === "active" &&
    (await execute("lpstat", ["-o"], { env })).trim()
  )
    throw Error("Finish queued print jobs before pausing printing.");
  if (!saved.printing) {
    saved.printing = { original: states, paused: false };
    await save(file, saved);
  }
  await execute("sudo", ["/usr/bin/systemctl", "disable", "--now", ...printingUnits], {
    env,
    interactive: true,
  });
  for (const unit of printingUnits) {
    const after = await unitState(unit, false, env, execute);
    if (after.ActiveState !== "inactive" || after.UnitFileState !== "disabled")
      throw Error("Printing pause did not complete. Its original startup state is saved.");
  }
  saved.printing.paused = true;
  await save(file, saved);
}
export async function restoreUtilities(env = NodeProcess.env, deps = {}) {
  const p = locations(env),
    file = NodePath.join(p.stateRoot, "optional-utilities.json");
  const saved = JSON.parse((await read(file)) ?? "null");
  if (!saved || saved.version !== 1) throw Error("No recorded optional utilities to restore.");
  const execute = deps.run ?? run;
  if (saved.printing?.paused) {
    if (!deps.run && !NodeProcess.stdin.isTTY)
      throw Error("Restore printing from a normal terminal for local sudo authentication.");
    await execute("sudo", ["-v"], { env, interactive: true });
    for (const unit of printingUnits) {
      const original = saved.printing.original[unit];
      if (original.UnitFileState === "enabled")
        await execute("sudo", ["/usr/bin/systemctl", "enable", unit], { env, interactive: true });
      if (original.ActiveState === "active")
        await execute("sudo", ["/usr/bin/systemctl", "start", unit], { env, interactive: true });
    }
    saved.printing.paused = false;
    await save(file, saved);
  }
  if (saved.dictation?.paused) {
    const original = saved.dictation.original;
    if (original.UnitFileState === "enabled")
      await execute("systemctl", ["--user", "enable", "voxtype.service"], { env });
    if (original.ActiveState === "active")
      await execute("systemctl", ["--user", "start", "voxtype.service"], { env });
    saved.dictation.paused = false;
    await save(file, saved);
  }
  return utilityStatus(env, deps);
}
export async function planSystem(env = NodeProcess.env, deps = {}) {
  const execute = deps.run ?? run,
    p = locations(env),
    selection = await appSelection(env);
  const installed = await execute("pacman", ["-Q"], { env });
  const names = installed
    .trim()
    .split("\n")
    .map((line) => line.split(" ")[0]);
  const targets = selection.removePackages.filter((name) => names.includes(name));
  const closure = targets.length
    ? (await execute("pacman", ["-Rs", "--print-format", "%n", "--", ...targets], { env }))
        .trim()
        .split("\n")
        .filter(Boolean)
        .sort()
    : [];
  if (
    closure.some(
      (name) =>
        !packageName(name) || protectedPackage(name) || selection.keepPackages.includes(name),
    )
  )
    throw Error("Package removal would affect a protected or selected app.");
  const cachePreview = await execute("paccache", ["--dryrun", "--keep", "2", "--nocolor"], { env });
  const value = {
    format: "loom-os-system-cleanup",
    version: 1,
    installed: sha(installed),
    selection,
    targets,
    removePackages: closure,
    cacheKeepVersions: 2,
    cachePreview,
    protectedInstalled: names.filter(protectedPackage),
    optionalUtilities: await utilityStatus(env, deps),
  };
  value.reviewHash = sha(JSON.stringify(value));
  await save(NodePath.join(p.stateRoot, "system-plan.json"), value);
  return value;
}
export async function applySystem(expected, env = NodeProcess.env, deps = {}) {
  const p = locations(env),
    saved = JSON.parse((await read(NodePath.join(p.stateRoot, "system-plan.json"))) ?? "null");
  if (!intactReview(saved, expected)) throw Error("Review the exact system cleanup plan first.");
  if ((await planSystem(env, deps)).reviewHash !== expected)
    throw Error("Packages, cache or app selection changed after review. Review again.");
  if (!deps.run && !NodeProcess.stdin.isTTY)
    throw Error("System cleanup needs a normal terminal for local sudo authentication.");
  const execute = deps.run ?? run;
  await execute("sudo", ["-v"], { env, interactive: true });
  if ((await planSystem(env, deps)).reviewHash !== expected)
    throw Error("Packages, cache or app selection changed while authenticating. Review again.");
  await pauseDictation(env, deps);
  await pausePrinting(env, execute);
  // Use the already-reviewed complete package set, without recursive target expansion at execution.
  if (saved.removePackages.length)
    await execute("sudo", ["/usr/bin/pacman", "-R", "--noconfirm", "--", ...saved.removePackages], {
      env,
      interactive: true,
    });
  await execute("sudo", ["/usr/bin/paccache", "--remove", "--keep", "2", "--nocolor"], {
    env,
    interactive: true,
  });
  const result = { complete: true, removedPackages: saved.removePackages, cacheKeepVersions: 2 };
  await save(NodePath.join(p.stateRoot, "last-system-cleanup.json"), result);
  return result;
}
export async function nativeHousekeeping(env = NodeProcess.env, deps = {}) {
  const choose = deps.choose ?? ((args) => finderChoice(args, env)),
    show = deps.show ?? console.log;
  let storage = null,
    system = null;
  for (;;) {
    const choice = await choose(
      [
        "choose",
        "--header",
        "Storage and optional apps",
        "--",
        "Review storage cleanup",
        "Review optional apps and package cache",
        "Apply reviewed storage cleanup",
        "Apply reviewed system cleanup",
        "Restore printing and dictation",
        "Close",
      ],
      env,
    );
    if (choice === null || choice === "Close") return;
    try {
      if (choice === "Review storage cleanup") {
        storage = await planCleanup(env, deps);
        show(
          storage.candidates.length +
            " unreferenced directories. Current/previous recovery and running processes are protected.",
        );
        for (const item of storage.candidates) show(item.directory);
      } else if (choice === "Review optional apps and package cache") {
        system = await planSystem(env, deps);
        show(
          "Remove apps: " +
            (system.targets.join(", ") || "none") +
            "\nFull dependency removal: " +
            system.removePackages.join(", ") +
            "\n" +
            system.cachePreview,
        );
      } else if (choice === "Restore printing and dictation") {
        show(JSON.stringify(await restoreUtilities(env, deps), null, 2));
      } else {
        const plan = choice === "Apply reviewed storage cleanup" ? storage : system;
        if (!plan) {
          show("Review this cleanup first.");
          continue;
        }
        const confirm = await choose(
          [
            "choose",
            "--header",
            "Apply the exact reviewed cleanup?",
            "--",
            "Cancel",
            "Apply reviewed cleanup",
          ],
          env,
        );
        if (confirm !== "Apply reviewed cleanup") continue;
        show(
          JSON.stringify(
            choice === "Apply reviewed storage cleanup"
              ? await applyCleanup(plan.reviewHash, env, deps)
              : await applySystem(plan.reviewHash, env, deps),
            null,
            2,
          ),
        );
        storage = null;
        system = null;
      }
    } catch (e) {
      show(e.message);
    }
  }
}
export async function main(args, env = NodeProcess.env) {
  if (args.length === 1 && args[0] === "--inline") {
    if (!NodeProcess.stdin.isTTY) throw Error("Housekeeping needs an interactive terminal.");
    return nativeHousekeeping(env);
  }
  let result;
  if (args.length === 2 && args[0] === "utilities") {
    if (args[1] === "status") result = await utilityStatus(env);
    else if (args[1] === "pause-dictation") result = await pauseDictation(env);
    else if (args[1] === "restore") result = await restoreUtilities(env);
    else throw Error("Usage: housekeeping utilities status|pause-dictation|restore");
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.length === 1 && args[0] === "plan") result = await planCleanup(env);
  else if (args.length === 2 && args[0] === "apply") result = await applyCleanup(args[1], env);
  else if (args.length === 1 && args[0] === "apps") result = await appSelection(env);
  else if (args.length === 2 && args[0] === "save-apps")
    result = await saveSelection(JSON.parse(await read(args[1])), env);
  else if (args.length === 1 && args[0] === "system-plan") result = await planSystem(env);
  else if (args.length === 2 && args[0] === "system-apply")
    result = await applySystem(args[1], env);
  else
    throw Error(
      "Usage: housekeeping plan|apply REVIEW_HASH|apps|save-apps FILE|system-plan|system-apply REVIEW_HASH",
    );
  console.log(JSON.stringify(result, null, 2));
}
