import * as NodeTest from "node:test";
const test = NodeTest.test;
import * as NodeAssert from "node:assert/strict";
const assert = NodeAssert;
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import { collectCompatibility, install, paths, compileNativeMenu } from "./loom-os.mjs";
const model = compileNativeMenu(
  await NodeFSP.readFile(new URL("./fixtures/omarchy/MenuModel.js.txt", import.meta.url), "utf8"),
);
const fixtureRoot = new URL("./fixtures/omarchy/", import.meta.url);
async function fixture(t) {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-compat-")),
  );
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = { HOME: NodePath.join(root, "home"), OMARCHY_PATH: NodePath.join(root, "omarchy") };
  const p = paths(env);
  await NodeFSP.mkdir(NodePath.join(p.config, "hypr"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(p.config, "hypr/bindings.lua"), "-- personal\n");
  await NodeFSP.mkdir(NodePath.join(env.OMARCHY_PATH, "shell/plugins/menu"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(env.OMARCHY_PATH, "default/omarchy"), { recursive: true });
  await NodeFSP.copyFile(
    new URL("MenuModel.js.txt", fixtureRoot),
    NodePath.join(env.OMARCHY_PATH, "shell/plugins/menu/MenuModel.js"),
  );
  await NodeFSP.copyFile(
    new URL("omarchy-menu.jsonc.txt", fixtureRoot),
    NodePath.join(env.OMARCHY_PATH, "default/omarchy/omarchy-menu.jsonc"),
  );
  await NodeFSP.writeFile(NodePath.join(env.OMARCHY_PATH, "version"), "4.0.0.alpha\n");
  const config = {
    version: 1,
    profile: "laptop",
    officeUrl: "https://office.test",
    loomExecutable: "/usr/bin/true",
  };
  await install(config, { env });
  return { root, env, p, config };
}
test("pinned upstream sources retain their recorded provenance", async () => {
  const provenance = JSON.parse(
    await NodeFSP.readFile(new URL("provenance.json", fixtureRoot), "utf8"),
  );
  for (const [name, file] of Object.entries(provenance.files))
    assert.equal(
      NodeCrypto.createHash("sha256")
        .update(await NodeFSP.readFile(new URL(name, fixtureRoot)))
        .digest("hex"),
      file.sha256,
    );
});
test("real upstream parser reproduces label-only About action loss and obsolete theme-picker replacement", async () => {
  const native = model.parseMenuJsonc(
    await NodeFSP.readFile(new URL("omarchy-menu.jsonc.txt", fixtureRoot), "utf8"),
  );
  const broken = model.mergeMenuSources(
    native,
    model.parseMenuJsonc(
      '{"about":{"label":"LoomOS"},"style.theme":{"action":"omarchy-shell themebook pick"}}',
    ),
  );
  assert.equal(model.item(broken.items, "about").action, "");
  assert.equal(model.item(broken.items, "style.theme").action, "omarchy-shell themebook pick");
});
test("generated integration passes the actual upstream parser while preserving native theme and About semantics", async (t) => {
  const f = await fixture(t);
  const report = await collectCompatibility(f.config, f.env);
  assert.equal(report.errors, 0, JSON.stringify(report));
  for (const id of [
    "native-menu",
    "theme-picker",
    "loom-actions",
    "shortcuts",
    "readability",
    "about",
    "ownership",
  ])
    assert.equal(report.checks.find((v) => v.id === id).state, "ok", id);
});
test("stale personal theme overrides, malformed menu sources and edited pack files are diagnosed without mutation", async (t) => {
  const f = await fixture(t),
    menu = NodePath.join(f.p.config, "omarchy/extensions/omarchy-menu.jsonc");
  let before = await NodeFSP.readFile(menu, "utf8");
  before = before.replace(/^\s*\{/, '{\n"style.theme":{"action":"omarchy-shell themebook pick"},');
  await NodeFSP.writeFile(menu, before);
  let report = await collectCompatibility(f.config, f.env);
  assert.equal(report.checks.find((v) => v.id === "theme-picker").state, "error");
  assert.equal(await NodeFSP.readFile(menu, "utf8"), before);
  await NodeFSP.writeFile(menu, "{ malformed");
  report = await collectCompatibility(f.config, f.env);
  assert.equal(report.checks.find((v) => v.id === "native-menu").state, "error");
  assert.equal(await NodeFSP.readFile(menu, "utf8"), "{ malformed");
  await NodeFSP.writeFile(NodePath.join(f.p.root, "health.mjs"), "personal edit");
  report = await collectCompatibility(f.config, f.env);
  assert.equal(report.checks.find((v) => v.id === "ownership").state, "error");
});
test("unknown versions and interrupted activation are explicit, and no network or provider operation is needed", async (t) => {
  const f = await fixture(t);
  await NodeFSP.writeFile(NodePath.join(f.env.OMARCHY_PATH, "version"), "5.0.0");
  let report = await collectCompatibility(f.config, f.env);
  assert.equal(report.checks.find((v) => v.id === "version").state, "warning");
  await NodeFSP.writeFile(
    NodePath.join(f.p.state, "loom-os/pack-pending.json"),
    JSON.stringify({ version: 1, next: { sha256: "0".repeat(64) } }),
  );
  report = await collectCompatibility(f.config, f.env);
  assert.equal(report.checks.find((v) => v.id === "activation").state, "error");
});
