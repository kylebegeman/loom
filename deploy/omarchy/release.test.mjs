import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  realpath,
  chmod,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildRelease, verifyRelease, activateRelease, rollbackRelease } from "./release.mjs";
import { install, paths } from "./loom-os.mjs";

async function fixture(t, profile = "laptop") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "loom-pack-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
  };
  const p = paths(env);
  await mkdir(join(p.config, "hypr"), { recursive: true });
  await writeFile(join(p.config, "hypr/bindings.lua"), "-- personal keys\n");
  const config = {
    version: 1,
    profile,
    officeUrl: "https://office.example.test",
    loomExecutable: "/usr/bin/true",
  };
  await install(config, { env });
  const bundle = join(root, "v1");
  const release = await buildRelease(bundle, "test-1");
  return { root, env, p, config, bundle, release };
}
test("verifies all release members and rejects tampering and extra bytes", async (t) => {
  const f = await fixture(t);
  assert.equal((await verifyRelease(f.bundle, f.release.sha256)).version, "test-1");
  await writeFile(join(f.bundle, "iris/extra"), "extra");
  await assert.rejects(verifyRelease(f.bundle, f.release.sha256), /extra files/);
  await rm(join(f.bundle, "iris/extra"));
  await chmod(join(f.bundle, "pack/health.mjs"), 0o600);
  await writeFile(join(f.bundle, "pack/health.mjs"), "changed");
  await assert.rejects(verifyRelease(f.bundle, f.release.sha256), /member changed/);
});
test("rejects symlink members and wrong reviewed manifest digest", async (t) => {
  const f = await fixture(t);
  await assert.rejects(verifyRelease(f.bundle, "0".repeat(64)), /reviewed SHA256/);
  const file = join(f.bundle, "pack/ai.mjs");
  await rm(file);
  await symlink("/etc/passwd", file);
  await assert.rejects(verifyRelease(f.bundle, f.release.sha256), /ordinary file/);
});
for (const profile of ["laptop", "workstation"])
  test(`${profile} update and rollback preserve current config, skin, credentials, data and user bindings`, async (t) => {
    const f = await fixture(t, profile);
    const retained = ["browser-profiles/auth", "t3/userdata/state", "iris/personal"];
    for (const name of retained) {
      const p = join(f.p.root, name);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, "preserve");
    }
    const before = await readFile(f.p.configFile, "utf8");
    await activateRelease(f.bundle, f.release.sha256, { env: f.env, dryRun: true });
    await assert.rejects(readFile(join(f.p.state, "loom-os/pack-release.json")), /ENOENT/);
    await activateRelease(f.bundle, f.release.sha256, { env: f.env });
    assert.equal((await rollbackRelease({ env: f.env })).version, "baseline");
    await activateRelease(f.bundle, f.release.sha256, { env: f.env });
    const changedSource = join(f.root, "changed-source");
    await cp(join(f.bundle, "pack"), changedSource, { recursive: true });
    await cp(join(f.bundle, "iris"), join(changedSource, "iris"), { recursive: true });
    await chmod(join(changedSource, "health.mjs"), 0o600);
    await writeFile(
      join(changedSource, "health.mjs"),
      (await readFile(join(changedSource, "health.mjs"), "utf8")) + "\n// second release\n",
    );
    const second = join(f.root, "v2"),
      r = await buildRelease(second, "test-2", changedSource);
    await activateRelease(second, r.sha256, { env: f.env });
    assert.match(await readFile(join(f.p.root, "health.mjs"), "utf8"), /second release/);
    assert.equal((await rollbackRelease({ env: f.env })).version, "test-1");
    assert.doesNotMatch(await readFile(join(f.p.root, "health.mjs"), "utf8"), /second release/);
    assert.equal(await readFile(f.p.configFile, "utf8"), before);
    for (const name of retained)
      assert.equal(await readFile(join(f.p.root, name), "utf8"), "preserve");
    assert.match(await readFile(join(f.p.config, "hypr/bindings.lua"), "utf8"), /personal keys/);
  });
test("refuses edited installed modules before creating a release record", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.p.root, "health.mjs"), "personal edits");
  await assert.rejects(activateRelease(f.bundle, f.release.sha256, { env: f.env }), /local edits/);
  await assert.rejects(readFile(join(f.p.state, "loom-os/pack-release.json")), /ENOENT/);
  assert.equal(await readFile(join(f.p.root, "health.mjs"), "utf8"), "personal edits");
});

test("interrupted activation refuses another bundle until the exact release is retried", async (t) => {
  const f = await fixture(t);
  await activateRelease(f.bundle, f.release.sha256, { env: f.env });
  const second = join(f.root, "v2"),
    r = await buildRelease(second, "test-2");
  const pending = join(f.p.state, "loom-os/pack-pending.json");
  await writeFile(
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
  assert.equal(JSON.parse(await readFile(pending, "utf8")).next.sha256, r.sha256);
  await activateRelease(second, r.sha256, { env: f.env });
  await assert.rejects(readFile(pending), /ENOENT/);
  assert.equal(
    JSON.parse(await readFile(join(f.p.state, "loom-os/pack-release.json"), "utf8")).active.version,
    "test-2",
  );
});
