import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const test = NodeTest.test;
const assert = NodeAssert;
import {
  buildRelease,
  verifyRelease,
  activateRelease,
  rollbackRelease,
  releaseStatus,
  formatReleaseStatus,
  main as releaseMain,
} from "./release.mjs";
import { collectCompatibility, install, paths, uninstall } from "./loom-os.mjs";

async function fixture(t, profile = "laptop") {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-pack-")),
  );
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = {
    HOME: NodePath.join(root, "home"),
    XDG_CONFIG_HOME: NodePath.join(root, "config"),
    XDG_DATA_HOME: NodePath.join(root, "data"),
    XDG_STATE_HOME: NodePath.join(root, "state"),
  };
  const p = paths(env);
  await NodeFSP.mkdir(NodePath.join(p.config, "hypr"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(p.config, "hypr/bindings.lua"), "-- personal keys\n");
  const config = {
    version: 1,
    profile,
    officeUrl: "https://office.example.test",
    loomExecutable: "/usr/bin/true",
  };
  await install(config, { env });
  const bundle = NodePath.join(root, "v1");
  const release = await buildRelease(bundle, "test-1");
  return { root, env, p, config, bundle, release };
}
test("verifies all release members and rejects tampering and extra bytes", async (t) => {
  const f = await fixture(t);
  assert.equal((await verifyRelease(f.bundle, f.release.sha256)).version, "test-1");
  await NodeFSP.writeFile(NodePath.join(f.bundle, "iris/extra"), "extra");
  await assert.rejects(verifyRelease(f.bundle, f.release.sha256), /extra files/);
  await NodeFSP.rm(NodePath.join(f.bundle, "iris/extra"));
  await NodeFSP.chmod(NodePath.join(f.bundle, "pack/health.mjs"), 0o600);
  await NodeFSP.writeFile(NodePath.join(f.bundle, "pack/health.mjs"), "changed");
  await assert.rejects(verifyRelease(f.bundle, f.release.sha256), /member changed/);
});
test("rejects symbolic link members and wrong reviewed manifest digest", async (t) => {
  const f = await fixture(t);
  await assert.rejects(verifyRelease(f.bundle, "0".repeat(64)), /reviewed SHA256/);
  const file = NodePath.join(f.bundle, "pack/ai.mjs");
  await NodeFSP.rm(file);
  await NodeFSP.symlink("/etc/passwd", file);
  await assert.rejects(verifyRelease(f.bundle, f.release.sha256), /ordinary file/);
});
for (const profile of ["laptop", "workstation"])
  test(`${profile} update and rollback preserve current config, skin, credentials, data and user bindings`, async (t) => {
    const f = await fixture(t, profile);
    const retained = ["browser-profiles/auth", "t3/userdata/state", "iris/personal"];
    for (const name of retained) {
      const p = NodePath.join(f.p.root, name);
      await NodeFSP.mkdir(NodePath.dirname(p), { recursive: true });
      await NodeFSP.writeFile(p, "preserve");
    }
    const before = await NodeFSP.readFile(f.p.configFile, "utf8");
    await activateRelease(f.bundle, f.release.sha256, { env: f.env, dryRun: true });
    await assert.rejects(
      NodeFSP.readFile(NodePath.join(f.p.state, "loom-os/pack-release.json")),
      /ENOENT/,
    );
    await activateRelease(f.bundle, f.release.sha256, { env: f.env });
    assert.equal((await rollbackRelease({ env: f.env })).version, "baseline");
    await activateRelease(f.bundle, f.release.sha256, { env: f.env });
    const changedSource = NodePath.join(f.root, "changed-source");
    await NodeFSP.cp(NodePath.join(f.bundle, "pack"), changedSource, { recursive: true });
    await NodeFSP.cp(NodePath.join(f.bundle, "iris"), NodePath.join(changedSource, "iris"), {
      recursive: true,
    });
    await NodeFSP.chmod(NodePath.join(changedSource, "health.mjs"), 0o600);
    await NodeFSP.writeFile(
      NodePath.join(changedSource, "health.mjs"),
      (await NodeFSP.readFile(NodePath.join(changedSource, "health.mjs"), "utf8")) +
        "\n// second release\n",
    );
    const second = NodePath.join(f.root, "v2"),
      r = await buildRelease(second, "test-2", changedSource);
    await activateRelease(second, r.sha256, { env: f.env });
    assert.match(
      await NodeFSP.readFile(NodePath.join(f.p.root, "health.mjs"), "utf8"),
      /second release/,
    );
    assert.equal((await rollbackRelease({ env: f.env })).version, "test-1");
    assert.doesNotMatch(
      await NodeFSP.readFile(NodePath.join(f.p.root, "health.mjs"), "utf8"),
      /second release/,
    );
    assert.equal(await NodeFSP.readFile(f.p.configFile, "utf8"), before);
    for (const name of retained)
      assert.equal(await NodeFSP.readFile(NodePath.join(f.p.root, name), "utf8"), "preserve");
    assert.match(
      await NodeFSP.readFile(NodePath.join(f.p.config, "hypr/bindings.lua"), "utf8"),
      /personal keys/,
    );
  });
test("refuses edited installed modules before creating a release record", async (t) => {
  const f = await fixture(t);
  await NodeFSP.writeFile(NodePath.join(f.p.root, "health.mjs"), "personal edits");
  await assert.rejects(activateRelease(f.bundle, f.release.sha256, { env: f.env }), /local edits/);
  await assert.rejects(
    NodeFSP.readFile(NodePath.join(f.p.state, "loom-os/pack-release.json")),
    /ENOENT/,
  );
  assert.equal(
    await NodeFSP.readFile(NodePath.join(f.p.root, "health.mjs"), "utf8"),
    "personal edits",
  );
});

test("interrupted activation refuses another bundle until the exact release is retried", async (t) => {
  const f = await fixture(t);
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const second = NodePath.join(f.root, "v2"),
    r = await buildRelease(second, "test-2");
  const pending = NodePath.join(f.p.state, "loom-os/pack-pending.json");
  await NodeFSP.writeFile(
    pending,
    JSON.stringify({ version: 1, next: { version: "test-2", sha256: r.sha256 } }),
  );
  await assert.rejects(
    activateRelease(f.bundle, f.release.sha256, { env: f.env, dryRun: true }),
    /interrupted activation/,
  );
  await assert.rejects(
    activateRelease(f.bundle, f.release.sha256, { env: f.env }),
    /interrupted activation/,
  );
  assert.equal(JSON.parse(await NodeFSP.readFile(pending, "utf8")).next.sha256, r.sha256);
  await activateRelease(second, r.sha256, { env: f.env });
  await assert.rejects(NodeFSP.readFile(pending), /ENOENT/);
  assert.equal(
    JSON.parse(
      await NodeFSP.readFile(NodePath.join(f.p.state, "loom-os/pack-release.json"), "utf8"),
    ).active.version,
    "test-2",
  );
});

test("release status uses the supplied XDG state and creates no release state for an unmanaged install", async (t) => {
  const f = await fixture(t, "workstation");
  const before = await NodeFSP.readFile(f.p.manifest, "utf8");
  const status = await releaseMain(["status"], f.env);
  assert.deepEqual(status, {
    profile: "workstation",
    theme: null,
    active: null,
    previous: null,
    pending: null,
  });
  assert.equal(await NodeFSP.readFile(f.p.manifest, "utf8"), before);
  await assert.rejects(
    NodeFSP.readFile(NodePath.join(f.p.state, "loom-os/pack-release.json")),
    /ENOENT/,
  );
  assert.match(await releaseMain(["status", "--human"], f.env), /unmanaged baseline/);
  await assert.rejects(releaseMain(["status", "--dry-run"], f.env), /Usage/);
  await assert.rejects(releaseMain(["status", "unexpected"], f.env), /Usage/);
});

test("release status distinguishes retained release integrity, installed edits and interrupted activation without repairing them", async (t) => {
  const f = await fixture(t);
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const themeFile = NodePath.join(f.p.home, ".local/state/omarchy/current/theme.name");
  await NodeFSP.mkdir(NodePath.dirname(themeFile), { recursive: true });
  await NodeFSP.writeFile(themeFile, "loom-iris-dark\n");
  const stateFile = NodePath.join(f.p.state, "loom-os/pack-release.json");
  const before = await NodeFSP.readFile(stateFile, "utf8");
  let status = await releaseStatus({ env: f.env });
  assert.equal(status.theme, "loom-iris-dark");
  assert.equal(status.active.version, "test-1");
  assert.equal(status.active.verified, true);
  assert.equal(status.active.matchesInstalled, true);
  assert.equal(status.previous.version, "baseline");
  assert.equal(status.previous.verified, true);
  await NodeFSP.writeFile(NodePath.join(f.p.root, "health.mjs"), "personal edits");
  status = await releaseStatus({ env: f.env });
  assert.equal(status.active.verified, true);
  assert.equal(status.active.matchesInstalled, false);
  assert.equal(
    await NodeFSP.readFile(NodePath.join(f.p.root, "health.mjs"), "utf8"),
    "personal edits",
  );
  await NodeFSP.rm(NodePath.join(f.p.root, "health.mjs"));
  status = await releaseStatus({ env: f.env });
  assert.equal(status.active.matchesInstalled, false);
  await assert.rejects(NodeFSP.readFile(NodePath.join(f.p.root, "health.mjs")), /ENOENT/);
  const pending = NodePath.join(f.p.state, "loom-os/pack-pending.json");
  const intent = JSON.stringify({
    version: 1,
    next: { version: "test-2", sha256: "0".repeat(64) },
  });
  await NodeFSP.writeFile(pending, intent);
  status = await releaseStatus({ env: f.env });
  assert.equal(status.pending.version, "test-2");
  assert.match(formatReleaseStatus(status), /Interrupted update.*test-2/);
  assert.equal(await NodeFSP.readFile(pending, "utf8"), intent);
  const activeFile = NodePath.join(JSON.parse(before).active.directory, "pack/health.mjs");
  await NodeFSP.chmod(activeFile, 0o600);
  await NodeFSP.writeFile(activeFile, "damaged bundle");
  status = await releaseStatus({ env: f.env });
  assert.equal(status.active.verified, false);
  assert.equal(await NodeFSP.readFile(activeFile, "utf8"), "damaged bundle");
  assert.equal(await NodeFSP.readFile(stateFile, "utf8"), before);
});

test("status refuses a release record outside the installer-owned directory", async (t) => {
  const f = await fixture(t);
  await NodeFSP.writeFile(
    NodePath.join(f.p.state, "loom-os/pack-release.json"),
    JSON.stringify({
      version: 1,
      active: { version: "test-1", directory: f.bundle, sha256: f.release.sha256 },
      previous: null,
    }),
  );
  await assert.rejects(releaseStatus({ env: f.env }), /Invalid owned release record/);
});

test("rollback pins the reviewed digest and refuses a changed target without mutating state", async (t) => {
  const f = await fixture(t);
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const file = NodePath.join(f.p.state, "loom-os/pack-release.json");
  const before = await NodeFSP.readFile(file, "utf8");
  const previous = JSON.parse(before).previous;
  await assert.rejects(
    rollbackRelease({ env: f.env, expectedSha256: "0".repeat(64) }),
    /changed after review/,
  );
  assert.equal(await NodeFSP.readFile(file, "utf8"), before);
  assert.equal(
    (await releaseMain(["rollback", "--dry-run", "--expected-sha256", previous.sha256], f.env))
      .sha256,
    previous.sha256,
  );
  assert.equal(await NodeFSP.readFile(file, "utf8"), before);
});

test("activation generates menus with the reviewed release's installer and rollback restores the previous behavior", async (t) => {
  const f = await fixture(t, "workstation");
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const source = NodePath.join(f.root, "next-source");
  await NodeFSP.cp(NodePath.join(f.bundle, "pack"), source, { recursive: true });
  await NodeFSP.cp(NodePath.join(f.bundle, "iris"), NodePath.join(source, "iris"), {
    recursive: true,
  });
  const launcher = NodePath.join(source, "loom-os.mjs");
  await NodeFSP.chmod(launcher, 0o600);
  const next = (await NodeFSP.readFile(launcher, "utf8")).replace(
    'label: "Maintenance"',
    'label: "Updated maintenance"',
  );
  await NodeFSP.writeFile(launcher, next);
  const bundle = NodePath.join(f.root, "next-release");
  const release = await buildRelease(bundle, "test-next", source);
  await activateRelease(bundle, release.sha256, { env: f.env });
  const menu = NodePath.join(f.p.config, "omarchy/extensions/omarchy-menu.jsonc");
  assert.match(await NodeFSP.readFile(menu, "utf8"), /Updated maintenance/);
  assert.equal(await NodeFSP.readFile(NodePath.join(f.p.root, "loom-os.mjs"), "utf8"), next);
  await rollbackRelease({ env: f.env });
  assert.doesNotMatch(await NodeFSP.readFile(menu, "utf8"), /Updated maintenance/);
  assert.match(await NodeFSP.readFile(menu, "utf8"), /Maintenance/);
});

test("release integrity includes native status assets and preserves local widget edits", async (t) => {
  const f = await fixture(t);
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const widget = NodePath.join(f.p.config, "omarchy/plugins/loom.status/LoomStatus.qml");
  assert.equal((await releaseStatus({ env: f.env })).active.matchesInstalled, true);
  await NodeFSP.writeFile(widget, "// personal widget edits\n");
  assert.equal((await releaseStatus({ env: f.env })).active.matchesInstalled, false);
  await assert.rejects(activateRelease(f.bundle, f.release.sha256, { env: f.env }), /local edits/);
  assert.equal(await NodeFSP.readFile(widget, "utf8"), "// personal widget edits\n");
});
test("retained releases without native status members remain verifiable", async (t) => {
  const f = await fixture(t);
  const manifestFile = NodePath.join(f.bundle, "release.json");
  const manifest = JSON.parse(await NodeFSP.readFile(manifestFile, "utf8"));
  for (const name of Object.keys(manifest.files))
    if (name.startsWith("pack/status/")) delete manifest.files[name];
  await NodeFSP.rm(NodePath.join(f.bundle, "pack/status"), { recursive: true });
  await NodeFSP.chmod(manifestFile, 0o600);
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  await NodeFSP.writeFile(manifestFile, bytes);
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal((await verifyRelease(f.bundle, hash)).version, "test-1");
});

test("partial contextual runtimes are refused while pre-feature releases remain valid", async (t) => {
  const f = await fixture(t);
  const manifestFile = NodePath.join(f.bundle, "release.json");
  const manifest = JSON.parse(await NodeFSP.readFile(manifestFile, "utf8"));
  const { createHash } = await import("node:crypto");
  async function removeMember(name) {
    delete manifest.files["pack/" + name];
    await NodeFSP.rm(NodePath.join(f.bundle, "pack", name));
    await NodeFSP.chmod(manifestFile, 0o600);
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    await NodeFSP.writeFile(manifestFile, bytes);
    return createHash("sha256").update(bytes).digest("hex");
  }
  let hash = await removeMember("loom-environment.mjs");
  await assert.rejects(verifyRelease(f.bundle, hash), /inventory is incomplete/);
  hash = await removeMember("workbench.mjs");
  hash = await removeMember("control-desk.mjs");
  hash = await removeMember("maintenance.mjs");
  hash = await removeMember("maintenance-ui.mjs");
  assert.equal((await verifyRelease(f.bundle, hash)).version, "test-1");
});

test("maintenance runtime must be complete and a retained pack rollback preserves its private review journal", async (t) => {
  const f = await fixture(t);
  const source = NodePath.join(f.root, "pre-maintenance-source");
  await NodeFSP.cp(NodePath.join(f.bundle, "pack"), source, { recursive: true });
  await NodeFSP.cp(NodePath.join(f.bundle, "iris"), NodePath.join(source, "iris"), {
    recursive: true,
  });
  await NodeFSP.rm(NodePath.join(source, "maintenance-ui.mjs"));
  await assert.rejects(
    buildRelease(NodePath.join(f.root, "incomplete"), "partial", source),
    /complete runtime dependencies/,
  );
  await NodeFSP.rm(NodePath.join(source, "maintenance.mjs"));
  const previous = await buildRelease(NodePath.join(f.root, "legacy"), "pre-maintenance", source);
  await activateRelease(previous.directory, previous.sha256, { env: f.env });
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const journal = NodePath.join(f.p.state, "loom-os/maintenance.json");
  await NodeFSP.writeFile(journal, "private retained review fixture", { mode: 0o600 });
  const menu = NodePath.join(f.p.config, "omarchy/extensions/omarchy-menu.jsonc");
  assert.match(await NodeFSP.readFile(menu, "utf8"), /loomos.maintenance.updates/);
  await rollbackRelease({ env: f.env, expectedSha256: previous.sha256 });
  assert.doesNotMatch(await NodeFSP.readFile(menu, "utf8"), /loomos.maintenance.updates/);
  await assert.rejects(NodeFSP.readFile(NodePath.join(f.p.root, "updates-terminal")), {
    code: "ENOENT",
  });
  await assert.rejects(
    NodeFSP.readFile(NodePath.join(f.p.data, "applications/loom-os-updates.desktop")),
    { code: "ENOENT" },
  );
  assert.equal(await NodeFSP.readFile(journal, "utf8"), "private retained review fixture");
  // The retained bundle's manager restores features even if the old installed manager predates them.
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  assert.match(await NodeFSP.readFile(menu, "utf8"), /loomos.maintenance.updates/);
  assert.equal(await NodeFSP.readFile(journal, "utf8"), "private retained review fixture");
});

async function legacyOwnershipRelease(f, { removeRequired = false } = {}) {
  const source = NodePath.join(f.root, "legacy-ownership-source");
  await NodeFSP.cp(NodePath.join(f.bundle, "pack"), source, { recursive: true });
  await NodeFSP.cp(NodePath.join(f.bundle, "iris"), NodePath.join(source, "iris"), {
    recursive: true,
  });
  for (const name of ["maintenance.mjs", "maintenance-ui.mjs"])
    await NodeFSP.rm(NodePath.join(source, name));
  const file = NodePath.join(source, "loom-os.mjs");
  const original = await NodeFSP.readFile(file, "utf8");
  // Reproduce the older installer's observable ownership merge after removed files were deleted.
  // Its reviewed installer and generated menu remain the target release's authority during rollback.
  const legacy =
    original.replace("export async function install(", "async function legacyUnderlyingInstall(") +
    String.raw`
export async function install(config, options = {}) {
  const p = paths(options.env), old = await readJson(p.manifest);
  const result = await legacyUnderlyingInstall(config, options);
  if (!options.dryRun) {
    ${removeRequired ? 'await NodeFSP.rm(NodePath.join(p.data, "applications/loom-os-office.desktop"), { force: true });' : ""}
    const current = await readJson(p.manifest);
    current.files = [...current.files, ...(old?.files ?? []).filter((entry) => !current.files.some((present) => present.file === entry.file))];
    await write(p.manifest, JSON.stringify(current, null, 2) + "\n");
  }
  return result;
}
`;
  assert.notEqual(legacy, original);
  await NodeFSP.chmod(file, 0o600);
  await NodeFSP.writeFile(file, legacy);
  return buildRelease(
    NodePath.join(f.root, "legacy-ownership-release"),
    "legacy-ownership",
    source,
  );
}
test("rollback through a legacy installer removes absent obsolete ownership records while preserving private state and exact target bytes", async (t) => {
  const f = await fixture(t),
    legacy = await legacyOwnershipRelease(f);
  await activateRelease(legacy.directory, legacy.sha256, { env: f.env });
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const config = await NodeFSP.readFile(f.p.configFile),
    journal = NodePath.join(f.p.state, "loom-os/updates/journal.json");
  await NodeFSP.mkdir(NodePath.dirname(journal), { recursive: true });
  await NodeFSP.writeFile(journal, "private recovery receipt\n", { mode: 0o600 });
  const ownedLegacy = await NodeFSP.readFile(NodePath.join(legacy.directory, "pack/loom-os.mjs"));
  await rollbackRelease({ env: f.env, expectedSha256: legacy.sha256 });
  const obsolete = [
    NodePath.join(f.p.root, "maintenance.mjs"),
    NodePath.join(f.p.root, "maintenance-ui.mjs"),
    NodePath.join(f.p.root, "updates-terminal"),
    NodePath.join(f.p.data, "applications/loom-os-updates.desktop"),
  ];
  const manifest = JSON.parse(await NodeFSP.readFile(f.p.manifest, "utf8"));
  for (const file of obsolete) {
    await assert.rejects(NodeFSP.access(file), { code: "ENOENT" });
    assert.ok(!manifest.files.some((entry) => entry.file === file));
  }
  assert.equal(
    (await collectCompatibility(f.config, f.env)).checks.find((entry) => entry.id === "ownership")
      .state,
    "ok",
  );
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), config);
  assert.equal(await NodeFSP.readFile(journal, "utf8"), "private recovery receipt\n");
  assert.deepEqual(await NodeFSP.readFile(NodePath.join(f.p.root, "loom-os.mjs")), ownedLegacy);
  assert.equal((await releaseStatus({ env: f.env })).active.matchesInstalled, true);
});
test("legacy rollback keeps edited obsolete records for uninstall and never hides a missing required target file", async (t) => {
  const f = await fixture(t),
    legacy = await legacyOwnershipRelease(f, { removeRequired: true });
  await activateRelease(legacy.directory, legacy.sha256, { env: f.env });
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const edited = NodePath.join(f.p.data, "applications/loom-os-updates.desktop");
  await NodeFSP.appendFile(edited, "# Personal retired launcher\n");
  await rollbackRelease({ env: f.env, expectedSha256: legacy.sha256 });
  const required = NodePath.join(f.p.data, "applications/loom-os-office.desktop"),
    manifest = JSON.parse(await NodeFSP.readFile(f.p.manifest, "utf8"));
  await assert.rejects(NodeFSP.access(required), { code: "ENOENT" });
  assert.ok(manifest.files.some((entry) => entry.file === required));
  assert.ok(manifest.files.some((entry) => entry.file === edited));
  assert.match(await NodeFSP.readFile(edited, "utf8"), /Personal retired launcher/);
  assert.equal(
    (await collectCompatibility(f.config, f.env)).checks.find((entry) => entry.id === "ownership")
      .state,
    "error",
  );
  const result = await uninstall({ env: f.env });
  assert.ok(result.preserved.includes(edited));
  assert.match(await NodeFSP.readFile(edited, "utf8"), /Personal retired launcher/);
});
