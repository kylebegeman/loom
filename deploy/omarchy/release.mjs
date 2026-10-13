#!/usr/bin/env node
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { paths, validateConfig } from "./loom-os.mjs";

const source = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const digest = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const requiredPackFiles = ["loom-os.mjs", "ai.mjs", "health.mjs", "install.sh", "release.mjs"];
const packFiles = [
  ...requiredPackFiles,
  "capture.mjs",
  "connections.mjs",
  "availability.mjs",
  "notifications.mjs",
  "commission.mjs",
  "workbench.mjs",
  "control-desk.mjs",
  "loom-environment.mjs",
];
const contextualFiles = ["workbench.mjs", "control-desk.mjs", "loom-environment.mjs"];
const contextualDependencies = [...contextualFiles, "capture.mjs", "connections.mjs"];
const statusFiles = ["manifest.json", "LoomStatus.qml", "StatusModel.js"];
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
async function ordinary(path, directory = false) {
  const info = await NodeFSP.lstat(path);
  if (info.isSymbolicLink() || !(directory ? info.isDirectory() : info.isFile()))
    throw new Error(`Expected an ordinary ${directory ? "directory" : "file"}: ${path}`);
  return info;
}
async function tree(root, prefix = "") {
  await ordinary(root, true);
  const result = [];
  for (const entry of (await NodeFSP.readdir(root)).sort()) {
    const name = prefix + entry,
      path = NodePath.join(root, entry),
      info = await NodeFSP.lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Bundle symlinks are not supported: ${path}`);
    if (info.isDirectory()) result.push(...(await tree(path, name + "/")));
    else if (info.isFile()) result.push(name);
    else throw new Error(`Unsupported bundle member: ${path}`);
  }
  return result;
}
async function atomicJSON(path, value) {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + NodeCrypto.randomUUID();
  await NodeFSP.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await NodeFSP.rename(temp, path);
}
export async function buildRelease(output, version, sourceDir = source) {
  if (!idPattern.test(version)) throw new Error("Choose a simple release version.");
  await NodeFSP.mkdir(output, { mode: 0o700 }); // A release is always built into a fresh directory.
  const files = {};
  try {
    let statusEntries = [];
    try {
      statusEntries = (await tree(NodePath.join(sourceDir, "status"))).map((name) => [
        "pack/status/" + name,
        NodePath.join(sourceDir, "status", name),
      ]);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const includedPackFiles = [];
    for (const name of packFiles) {
      try {
        await ordinary(NodePath.join(sourceDir, name));
        includedPackFiles.push(name);
      } catch (error) {
        if (
          ![
            "capture.mjs",
            "connections.mjs",
            "availability.mjs",
            "notifications.mjs",
            "commission.mjs",
            "workbench.mjs",
            "control-desk.mjs",
            "loom-environment.mjs",
          ].includes(name) ||
          error.code !== "ENOENT"
        )
          throw error;
      }
    }
    if (
      contextualFiles.some((name) => includedPackFiles.includes(name)) &&
      !contextualDependencies.every((name) => includedPackFiles.includes(name))
    )
      throw Error("The contextual utilities need their complete runtime dependencies.");
    const entries = [
      ...includedPackFiles.map((name) => ["pack/" + name, NodePath.join(sourceDir, name)]),
      ...statusEntries,
      ...(await tree(NodePath.join(sourceDir, "iris"))).map((name) => [
        "iris/" + name,
        NodePath.join(sourceDir, "iris", name),
      ]),
    ];
    for (const [name, origin] of entries) {
      await ordinary(origin);
      const bytes = await NodeFSP.readFile(origin),
        target = NodePath.join(output, name);
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      await NodeFSP.writeFile(target, bytes, { mode: 0o400, flag: "wx" });
      files[name] = digest(bytes);
    }
    const manifest = { format: "loom-os-pack-v1", version, files };
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    await NodeFSP.writeFile(NodePath.join(output, "release.json"), bytes, {
      mode: 0o400,
      flag: "wx",
    });
    return {
      version,
      directory: NodePath.resolve(output),
      sha256: digest(bytes),
      files: entries.length,
    };
  } catch (error) {
    await NodeFSP.rm(output, { recursive: true, force: true });
    throw error;
  }
}
export async function verifyRelease(directory, expected) {
  await ordinary(directory, true);
  await ordinary(NodePath.join(directory, "release.json"));
  const bytes = await NodeFSP.readFile(NodePath.join(directory, "release.json"));
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
      !(
        packFiles.some((file) => name === "pack/" + file) ||
        statusFiles.some((file) => name === "pack/status/" + file) ||
        name.startsWith("iris/")
      )
    )
      throw new Error("Invalid release member.");
    const file = NodePath.join(directory, name);
    await ordinary(file);
    if (digest(await NodeFSP.readFile(file)) !== hash)
      throw new Error(`Release member changed: ${name}`);
  }
  const actual = (await tree(directory)).filter((name) => name !== "release.json").sort();
  const expectedFiles = Object.keys(manifest.files).sort();
  if (
    JSON.stringify(actual) !== JSON.stringify(expectedFiles) ||
    !requiredPackFiles.every((file) => manifest.files["pack/" + file]) ||
    !manifest.files["iris/manifest.json"] ||
    (contextualFiles.some((file) => manifest.files["pack/" + file]) &&
      !contextualDependencies.every((file) => manifest.files["pack/" + file])) ||
    (statusFiles.some((file) => manifest.files["pack/status/" + file]) &&
      !statusFiles.every((file) => manifest.files["pack/status/" + file]))
  )
    throw new Error("Release member inventory is incomplete or contains extra files.");
  return manifest;
}
async function savedState(p) {
  try {
    await ordinary(NodePath.join(p.state, "loom-os/pack-release.json"));
    return JSON.parse(
      await NodeFSP.readFile(NodePath.join(p.state, "loom-os/pack-release.json"), "utf8"),
    );
  } catch (e) {
    if (e.code === "ENOENT") return { version: 1, active: null, previous: null };
    throw e;
  }
}
/** Inspect owned release records and retained bytes without activating or repairing them. */
export async function releaseStatus({ env = process.env } = {}) {
  const p = paths(env),
    state = await savedState(p);
  if (state.version !== 1) throw new Error("Unknown installed release state.");
  const releases = NodePath.resolve(p.root, "pack-releases");
  async function inspect(record, installed = false) {
    if (record == null) return null;
    if (
      typeof record.version !== "string" ||
      !idPattern.test(record.version) ||
      !/^[a-f0-9]{64}$/.test(record.sha256 ?? "") ||
      typeof record.directory !== "string" ||
      NodePath.dirname(NodePath.resolve(record.directory)) !== releases
    )
      throw new Error("Invalid owned release record.");
    let verified = false,
      matchesInstalled = false;
    try {
      const manifest = await verifyRelease(record.directory, record.sha256);
      verified = manifest.version === record.version;
      if (installed && verified) {
        matchesInstalled = true;
        for (const name of packFiles.filter(
          (name) => name !== "install.sh" && manifest.files["pack/" + name],
        )) {
          await ordinary(NodePath.join(p.root, name));
          if (
            digest(await NodeFSP.readFile(NodePath.join(p.root, name))) !==
            manifest.files["pack/" + name]
          )
            matchesInstalled = false;
        }
        for (const name of statusFiles) {
          const expectedAsset = manifest.files["pack/status/" + name];
          if (!expectedAsset) continue;
          const file = NodePath.join(p.config, "omarchy/plugins/loom.status", name);
          try {
            await ordinary(file);
            if (digest(await NodeFSP.readFile(file)) !== expectedAsset) matchesInstalled = false;
          } catch {
            matchesInstalled = false;
          }
        }
      }
    } catch {
      // A missing installed member must not inherit a successful retained-bundle check.
      matchesInstalled = false;
    }
    return {
      version: record.version,
      sha256: record.sha256,
      verified,
      ...(installed ? { matchesInstalled } : {}),
    };
  }
  let profile = null;
  try {
    await ordinary(p.configFile);
    profile = validateConfig(JSON.parse(await NodeFSP.readFile(p.configFile, "utf8"))).profile;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let theme = null;
  try {
    const value = (
      await NodeFSP.readFile(
        NodePath.join(p.home, ".local/state/omarchy/current/theme.name"),
        "utf8",
      )
    ).trim();
    if (
      value.length <= 128 &&
      [...value].every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
    )
      theme = value;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let pending = null;
  try {
    const file = NodePath.join(p.state, "loom-os/pack-pending.json");
    await ordinary(file);
    const intent = JSON.parse(await NodeFSP.readFile(file, "utf8"));
    if (
      intent.version !== 1 ||
      !idPattern.test(intent.next?.version ?? "") ||
      !/^[a-f0-9]{64}$/.test(intent.next?.sha256 ?? "")
    )
      throw new Error("Invalid pending release record.");
    pending = { version: intent.next.version, sha256: intent.next.sha256 };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    profile,
    theme,
    active: await inspect(state.active, true),
    previous: await inspect(state.previous),
    pending,
  };
}
export function formatReleaseStatus(status) {
  const release = (record) =>
    record
      ? `${record.version} (${record.verified ? "retained bundle verified" : "verification failed"})`
      : "none";
  return [
    `Profile: ${status.profile ?? "not configured"}`,
    `Theme: ${status.theme ?? "unknown"}`,
    `Installed integration: ${status.active ? release(status.active) : "unmanaged baseline"}`,
    `Previous integration: ${release(status.previous)}`,
    ...(status.active
      ? [
          `Installed runtime: ${status.active.matchesInstalled ? "matches the retained release" : "changed or unavailable; review before updating"}`,
        ]
      : []),
    ...(status.pending
      ? [
          `Interrupted update: ${status.pending.version}. Retry its exact reviewed bundle before changing versions.`,
        ]
      : []),
    "Application data, appearance and background services are managed separately from integration updates.",
  ].join("\n");
}

async function adoptInstalled(p, directory, releases) {
  try {
    await ordinary(p.manifest);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const snapshot = NodePath.join(releases, ".baseline-source-" + NodeCrypto.randomUUID());
  const output = NodePath.join(releases, "baseline-" + NodeCrypto.randomUUID());
  await NodeFSP.mkdir(snapshot, { mode: 0o700 });
  try {
    for (const name of packFiles) {
      let bytes;
      try {
        await ordinary(NodePath.join(p.root, name));
        bytes = await NodeFSP.readFile(NodePath.join(p.root, name));
      } catch (e) {
        if (
          e.code === "ENOENT" &&
          [
            "capture.mjs",
            "connections.mjs",
            "availability.mjs",
            "notifications.mjs",
            "commission.mjs",
            "workbench.mjs",
            "control-desk.mjs",
            "loom-environment.mjs",
          ].includes(name)
        )
          continue;
        if (e.code !== "ENOENT" || !["install.sh", "release.mjs"].includes(name)) throw e;
        bytes = await NodeFSP.readFile(NodePath.join(directory, "pack", name));
      }
      await NodeFSP.writeFile(NodePath.join(snapshot, name), bytes, { mode: 0o600 });
    }
    const installedStatus = NodePath.join(p.config, "omarchy/plugins/loom.status");
    if (
      (
        await Promise.all(
          statusFiles.map(async (name) => {
            try {
              await ordinary(NodePath.join(installedStatus, name));
              return true;
            } catch (error) {
              if (error.code === "ENOENT") return false;
              throw error;
            }
          }),
        )
      ).every(Boolean)
    ) {
      await NodeFSP.mkdir(NodePath.join(snapshot, "status"));
      for (const name of statusFiles)
        await NodeFSP.copyFile(
          NodePath.join(installedStatus, name),
          NodePath.join(snapshot, "status", name),
        );
    }
    for (const name of await tree(NodePath.join(directory, "iris"))) {
      const target = NodePath.join(snapshot, "iris", name);
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      await NodeFSP.writeFile(
        target,
        await NodeFSP.readFile(NodePath.join(directory, "iris", name)),
      );
    }
    const result = await buildRelease(output, "baseline", snapshot);
    return { version: "baseline", directory: result.directory, sha256: result.sha256 };
  } finally {
    await NodeFSP.rm(snapshot, { recursive: true, force: true });
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
  const config = validateConfig(JSON.parse(await NodeFSP.readFile(p.configFile, "utf8")));
  const state = await savedState(p);
  if (state.version !== 1) throw new Error("Unknown installed release state.");
  const pending = NodePath.join(p.state, "loom-os/pack-pending.json");
  try {
    await ordinary(pending);
    const intent = JSON.parse(await NodeFSP.readFile(pending, "utf8"));
    if (intent.version !== 1 || intent.next?.sha256 !== expected)
      throw new Error(
        "Retry the exact bundle from the interrupted activation before selecting another release.",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Generate integration with the reviewed release, including when restoring an older menu/CLI contract.
  const targetInstaller = await import(
    NodeURL.pathToFileURL(NodePath.join(directory, "pack/loom-os.mjs")).href
  );
  if (typeof targetInstaller.install !== "function")
    throw new Error("Release has no supported integration installer.");
  const plan = await targetInstaller.install(config, {
    env,
    dryRun: true,
    packDir: NodePath.join(directory, "pack"),
  });
  if (dryRun)
    return {
      ...plan,
      version: manifest.version,
      sha256: expected,
      iris: "preserved",
      service: "preserved",
    };
  const releases = NodePath.join(p.root, "pack-releases");
  const target = NodePath.join(releases, manifest.version + "-" + expected.slice(0, 12));
  await NodeFSP.mkdir(releases, { recursive: true, mode: 0o700 });
  await ordinary(releases, true);
  if (!state.active) {
    state.active = await adoptInstalled(p, directory, releases);
    if (state.active) await atomicJSON(NodePath.join(p.state, "loom-os/pack-release.json"), state);
  }
  try {
    await verifyRelease(target, expected);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const staging = NodePath.join(releases, ".stage-" + NodeCrypto.randomUUID());
    await NodeFSP.mkdir(staging, { mode: 0o700 });
    try {
      for (const name of ["release.json", ...Object.keys(manifest.files)]) {
        const destination = NodePath.join(staging, name);
        await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
        await NodeFSP.writeFile(
          destination,
          await NodeFSP.readFile(NodePath.join(directory, name)),
          {
            mode: 0o400,
            flag: "wx",
          },
        );
      }
      await verifyRelease(staging, expected);
      await NodeFSP.rename(staging, target);
    } catch (error) {
      await NodeFSP.rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  const active = { version: manifest.version, directory: target, sha256: expected };
  // Record intent first so an interrupted activation remains recoverable and reviewable.
  await atomicJSON(pending, { version: 1, previous: state.active, next: active });
  await targetInstaller.install(config, { env, packDir: NodePath.join(target, "pack") });
  await atomicJSON(NodePath.join(p.state, "loom-os/pack-release.json"), {
    version: 1,
    active,
    previous: state.active?.sha256 === expected ? state.previous : state.active,
  });
  await NodeFSP.rm(pending);
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
  if (options.expectedSha256 && options.expectedSha256 !== state.previous.sha256)
    throw new Error("Previous integration changed after review. Review rollback again.");
  const directory = state.previous.directory;
  const parent = NodePath.resolve(p.root, "pack-releases");
  if (NodePath.dirname(NodePath.resolve(directory)) !== parent)
    throw new Error("Previous release is outside the owned release directory.");
  return activateRelease(directory, state.previous.sha256, options);
}
export async function main(args, env = process.env) {
  const [action, ...rest] = args;
  const dryRun = rest.includes("--dry-run"),
    values = rest.filter((x) => x !== "--dry-run");
  if (action === "status") {
    if ((values.length && (values.length !== 1 || values[0] !== "--human")) || dryRun)
      throw new Error("Usage: loom-os pack status [--human]");
    const status = await releaseStatus({ env });
    return values[0] === "--human" ? formatReleaseStatus(status) : status;
  }
  if (action === "build" && values.length === 2)
    return buildRelease(NodePath.resolve(values[0]), values[1]);
  if (action === "verify" && values.length === 2)
    return verifyRelease(NodePath.resolve(values[0]), values[1]);
  if (action === "install" && values.length === 2) {
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Portable standalone CLI has no Effect runtime dependency.
    if (process.platform !== "linux" && !dryRun)
      throw new Error("Install LoomOS on Linux; use --dry-run to prepare elsewhere.");
    return activateRelease(NodePath.resolve(values[0]), values[1], { dryRun, env });
  }
  if (action === "rollback") {
    let expectedSha256;
    if (values.length) {
      if (
        values.length !== 2 ||
        values[0] !== "--expected-sha256" ||
        !/^[a-f0-9]{64}$/.test(values[1])
      )
        throw new Error("Usage: loom-os pack rollback [--dry-run] [--expected-sha256 SHA256]");
      expectedSha256 = values[1];
    }
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Portable standalone CLI has no Effect runtime dependency.
    if (process.platform !== "linux" && !dryRun) throw new Error("Roll back LoomOS on Linux.");
    return rollbackRelease({ dryRun, env, expectedSha256 });
  }
  throw new Error(
    "Usage: node release.mjs build DIRECTORY VERSION | verify DIRECTORY SHA256 | install DIRECTORY SHA256 [--dry-run] | rollback [--dry-run] | status [--human]",
  );
}
if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2))
    .then((value) =>
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2)),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
