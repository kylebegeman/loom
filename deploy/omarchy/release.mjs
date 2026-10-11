#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { install, paths, validateConfig } from "./loom-os.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const packFiles = ["loom-os.mjs", "ai.mjs", "health.mjs", "install.sh", "release.mjs"];
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
async function ordinary(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !(directory ? info.isDirectory() : info.isFile()))
    throw new Error(`Expected an ordinary ${directory ? "directory" : "file"}: ${path}`);
  return info;
}
async function tree(root, prefix = "") {
  await ordinary(root, true);
  const result = [];
  for (const entry of (await readdir(root)).sort()) {
    const name = prefix + entry,
      path = join(root, entry),
      info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Bundle symlinks are not supported: ${path}`);
    if (info.isDirectory()) result.push(...(await tree(path, name + "/")));
    else if (info.isFile()) result.push(name);
    else throw new Error(`Unsupported bundle member: ${path}`);
  }
  return result;
}
async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + randomUUID();
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
export async function buildRelease(output, version, sourceDir = source) {
  if (!idPattern.test(version)) throw new Error("Choose a simple release version.");
  await mkdir(output, { mode: 0o700 }); // A release is always built into a fresh directory.
  const files = {};
  try {
    const entries = [
      ...packFiles.map((name) => ["pack/" + name, join(sourceDir, name)]),
      ...(await tree(join(sourceDir, "iris"))).map((name) => [
        "iris/" + name,
        join(sourceDir, "iris", name),
      ]),
    ];
    for (const [name, origin] of entries) {
      await ordinary(origin);
      const bytes = await readFile(origin),
        target = join(output, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o400, flag: "wx" });
      files[name] = digest(bytes);
    }
    const manifest = { format: "loom-os-pack-v1", version, files };
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(join(output, "release.json"), bytes, { mode: 0o400, flag: "wx" });
    return { version, directory: resolve(output), sha256: digest(bytes), files: entries.length };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
export async function verifyRelease(directory, expected) {
  await ordinary(directory, true);
  await ordinary(join(directory, "release.json"));
  const bytes = await readFile(join(directory, "release.json"));
  if (!/^[a-f0-9]{64}$/.test(expected ?? "") || digest(bytes) !== expected)
    throw new Error("The release manifest does not match its reviewed SHA256.");
  const manifest = JSON.parse(bytes);
  if (
    manifest.format !== "loom-os-pack-v1" ||
    !idPattern.test(manifest.version ?? "") ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files)
  )
    throw new Error("Invalid LoomOS release manifest.");
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      name.includes("\\") ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      !(packFiles.some((file) => name === "pack/" + file) || name.startsWith("iris/"))
    )
      throw new Error("Invalid release member.");
    const file = join(directory, name);
    await ordinary(file);
    if (digest(await readFile(file)) !== hash) throw new Error(`Release member changed: ${name}`);
  }
  const actual = (await tree(directory)).filter((name) => name !== "release.json").sort();
  const expectedFiles = Object.keys(manifest.files).sort();
  if (
    JSON.stringify(actual) !== JSON.stringify(expectedFiles) ||
    !packFiles.every((file) => manifest.files["pack/" + file]) ||
    !manifest.files["iris/manifest.json"]
  )
    throw new Error("Release member inventory is incomplete or contains extra files.");
  return manifest;
}
async function savedState(p) {
  try {
    await ordinary(join(p.state, "loom-os/pack-release.json"));
    return JSON.parse(await readFile(join(p.state, "loom-os/pack-release.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { version: 1, active: null, previous: null };
    throw e;
  }
}
async function adoptInstalled(p, directory, releases) {
  try {
    await ordinary(p.manifest);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const snapshot = join(releases, ".baseline-source-" + randomUUID());
  const output = join(releases, "baseline-" + randomUUID());
  await mkdir(snapshot, { mode: 0o700 });
  try {
    for (const name of packFiles) {
      let bytes;
      try {
        await ordinary(join(p.root, name));
        bytes = await readFile(join(p.root, name));
      } catch (e) {
        if (e.code !== "ENOENT" || !["install.sh", "release.mjs"].includes(name)) throw e;
        bytes = await readFile(join(directory, "pack", name));
      }
      await writeFile(join(snapshot, name), bytes, { mode: 0o600 });
    }
    for (const name of await tree(join(directory, "iris"))) {
      const target = join(snapshot, "iris", name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(join(directory, "iris", name)));
    }
    const result = await buildRelease(output, "baseline", snapshot);
    return { version: "baseline", directory: result.directory, sha256: result.sha256 };
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

/** Update user integration only. App servers, credentials, service state and skin stay owned by their existing installers. */
export async function activateRelease(
  directory,
  expected,
  { env = process.env, dryRun = false } = {},
) {
  const manifest = await verifyRelease(directory, expected),
    p = paths(env);
  const config = validateConfig(JSON.parse(await readFile(p.configFile, "utf8")));
  const state = await savedState(p);
  if (state.version !== 1) throw new Error("Unknown installed release state.");
  const pending = join(p.state, "loom-os/pack-pending.json");
  try {
    await ordinary(pending);
    const intent = JSON.parse(await readFile(pending, "utf8"));
    if (intent.version !== 1 || intent.next?.sha256 !== expected)
      throw new Error(
        "Retry the exact bundle from the interrupted activation before selecting another release.",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Check the whole update before copying or changing the installed pack.
  const plan = await install(config, { env, dryRun: true, packDir: join(directory, "pack") });
  if (dryRun)
    return {
      ...plan,
      version: manifest.version,
      sha256: expected,
      iris: "preserved",
      service: "preserved",
    };
  const releases = join(p.root, "pack-releases");
  const target = join(releases, manifest.version + "-" + expected.slice(0, 12));
  await mkdir(releases, { recursive: true, mode: 0o700 });
  await ordinary(releases, true);
  if (!state.active) {
    state.active = await adoptInstalled(p, directory, releases);
    if (state.active) await atomicJSON(join(p.state, "loom-os/pack-release.json"), state);
  }
  try {
    await verifyRelease(target, expected);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const staging = join(releases, ".stage-" + randomUUID());
    await mkdir(staging, { mode: 0o700 });
    try {
      for (const name of ["release.json", ...Object.keys(manifest.files)]) {
        const destination = join(staging, name);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, await readFile(join(directory, name)), {
          mode: 0o400,
          flag: "wx",
        });
      }
      await verifyRelease(staging, expected);
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  const active = { version: manifest.version, directory: target, sha256: expected };
  // Record intent first so an interrupted activation remains recoverable and reviewable.
  await atomicJSON(pending, { version: 1, previous: state.active, next: active });
  await install(config, { env, packDir: join(target, "pack") });
  await atomicJSON(join(p.state, "loom-os/pack-release.json"), {
    version: 1,
    active,
    previous: state.active?.sha256 === expected ? state.previous : state.active,
  });
  await rm(pending);
  return {
    version: manifest.version,
    sha256: expected,
    installed: true,
    iris: "preserved",
    service: "preserved",
  };
}
export async function rollbackRelease(options = {}) {
  const p = paths(options.env),
    state = await savedState(p);
  if (!state.previous) throw new Error("No previous pack release is recorded.");
  const directory = state.previous.directory;
  const parent = resolve(p.root, "pack-releases");
  if (dirname(resolve(directory)) !== parent)
    throw new Error("Previous release is outside the owned release directory.");
  return activateRelease(directory, state.previous.sha256, options);
}
export async function main(args) {
  const [action, ...rest] = args;
  const dryRun = rest.includes("--dry-run"),
    values = rest.filter((x) => x !== "--dry-run");
  if (action === "build" && values.length === 2) return buildRelease(resolve(values[0]), values[1]);
  if (action === "verify" && values.length === 2)
    return verifyRelease(resolve(values[0]), values[1]);
  if (action === "install" && values.length === 2) {
    if (process.platform !== "linux" && !dryRun)
      throw new Error("Install LoomOS on Linux; use --dry-run to prepare elsewhere.");
    return activateRelease(resolve(values[0]), values[1], { dryRun });
  }
  if (action === "rollback" && !values.length) {
    if (process.platform !== "linux" && !dryRun) throw new Error("Roll back LoomOS on Linux.");
    return rollbackRelease({ dryRun });
  }
  throw new Error(
    "Usage: node release.mjs build DIRECTORY VERSION | verify DIRECTORY SHA256 | install DIRECTORY SHA256 [--dry-run] | rollback [--dry-run]",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2))
    .then((value) => console.log(JSON.stringify(value, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
