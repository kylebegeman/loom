import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { buildRelease, releaseStatus, activateRelease } from "./release.mjs";
import { paths, loomActionCatalog } from "./loom-os.mjs";
import {
  buildKit,
  verifyKit,
  validateRecipe,
  planCommission,
  applyCommission,
  commissioningStatus,
  nativeCommission,
  abandonCommission,
  withServerRuntimeMirror,
} from "./commission.mjs";
const test = NodeTest.test,
  assert = NodeAssert;
async function fixture(t, components = ["loom", "office", "server", "switchboard"]) {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-commission-")),
  );
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const inputs = NodePath.join(root, "inputs");
  await NodeFSP.mkdir(inputs);
  const pack = await buildRelease(NodePath.join(inputs, "integration"), "setup-test-1");
  const env = {
    HOME: NodePath.join(root, "home"),
    OMARCHY_PATH: NodePath.join(root, "omarchy"),
    PATH: "/usr/bin:/bin",
  };
  await prepareHome(env);
  const mapping = {
    loom: { loomExecutable: "loom" },
    office: { officeCli: "office" },
    server: { serverExecutable: "t3" },
    switchboard: { switchboardCli: "bin/switchboard", switchboardKeyHelper: "bin/credential" },
  };
  const spec = {
    format: "loom-os-recipe",
    version: 1,
    name: "personal",
    profile: "laptop",
    target: { platform: "linux", arch: "x64", omarchy: ["4.0.0.alpha"] },
    pack: { version: pack.version, sha256: pack.sha256 },
    components: {},
    apps: { office: "https://office.example.test" },
    ...(components.includes("switchboard")
      ? {
          switchboard: {
            gateway: "https://ai.example.test",
            status: "https://hub.example.test/status",
          },
        }
      : {}),
    ...(components.includes("server")
      ? { server: { releaseBaseUrl: "https://example.test/fork/releases", port: 3774 } }
      : {}),
    preferences: {
      appearance: "preserve",
      shortcuts: "preserve",
      textSize: "larger",
      statusWidget: false,
      branding: false,
    },
  };
  for (const name of components) {
    spec.components[name] = { version: "fixture-1", commands: mapping[name] };
    for (const command of Object.values(mapping[name])) {
      const path = NodePath.join(inputs, "components", name, command);
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      await NodeFSP.writeFile(
        path,
        name === "server" ? "#!/bin/sh\nprintf 't3 vfixture-1\\n'\n" : "#!/bin/sh\nexit 0\n",
        { mode: 0o755 },
      );
    }
  }
  const kit = NodePath.join(root, "kit"),
    built = await buildKit(spec, inputs, kit);
  const calls = [];
  const dependencies = {
    platform: "linux",
    arch: "x64",
    resolve: async () => "/usr/bin/true",
    connections: async () => ({
      steps: ["office", "atlas", "switchboard", "tailscale"].map((id) => ({
        id,
        state: "connected",
        detail: "Fixture session exists.",
      })),
    }),
    command: async (command, args) => {
      calls.push([command, args]);
      return {
        exit: 0,
        stdout: args[0] === "lock" ? '{"locked":false,"secure":false}' : "active\n",
      };
    },
    shortcutDependencies: { query: async () => ({ stdout: "[]" }) },
  };
  return { root, env, inputs, spec, kit, built, dependencies, calls, p: paths(env) };
}
async function prepareHome(env) {
  const p = paths(env);
  await NodeFSP.mkdir(NodePath.join(p.config, "hypr"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(p.config, "hypr/bindings.lua"), "-- personal binding\n");
  await NodeFSP.mkdir(NodePath.join(env.OMARCHY_PATH, "shell/plugins/menu"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(env.OMARCHY_PATH, "default/omarchy"), { recursive: true });
  for (const [from, to] of [
    ["MenuModel.js.txt", "shell/plugins/menu/MenuModel.js"],
    ["omarchy-menu.jsonc.txt", "default/omarchy/omarchy-menu.jsonc"],
  ])
    await NodeFSP.copyFile(
      new URL("./fixtures/omarchy/" + from, import.meta.url),
      NodePath.join(env.OMARCHY_PATH, to),
    );
  await NodeFSP.writeFile(NodePath.join(env.OMARCHY_PATH, "version"), "4.0.0.alpha\n");
}
function options(f, more = {}) {
  return { env: f.env, expected: f.built.sha256, ...f.dependencies, ...more };
}
test("one verified kit commissions both profiles on clean homes without starting or restarting services", async (t) => {
  const f = await fixture(t);
  for (const profile of ["laptop", "workstation"]) {
    const env = { ...f.env, HOME: NodePath.join(f.root, profile) };
    await prepareHome(env);
    const plan = await planCommission(f.kit, options(f, { env, profile }));
    assert.equal(plan.profile, profile);
    await assert.rejects(NodeFSP.access(paths(env).manifest), /ENOENT/);
    const report = await applyCommission(f.kit, options(f, { env, profile }));
    assert.equal(report.commissioned, true);
    assert.equal(report.profile, profile);
    assert.ok(
      report.steps.filter((v) => v.id.startsWith("component")).every((v) => v.state === "ready"),
    );
    assert.equal((await releaseStatus({ env })).active.matchesInstalled, true);
    const config = JSON.parse(await NodeFSP.readFile(paths(env).configFile, "utf8"));
    assert.ok(config.loomExecutable.startsWith(paths(env).root));
    assert.equal(
      config.serverBaseDir,
      profile === "workstation" ? NodePath.join(paths(env).root, "t3") : undefined,
    );
    if (profile === "laptop") {
      assert.equal(config.serverExecutable, undefined);
      assert.ok(!report.steps.some((v) => v.id === "component-server"));
    }
    await assert.rejects(
      NodeFSP.access(NodePath.join(env.HOME, ".config/systemd/user/t3code.service")),
      /ENOENT/,
    );
  }
  assert.ok(f.calls.every((v) => v[0] === "systemctl" && v[1][0] === "--user"));
});
test("plan is read-only and wrong recipe, component bytes, extra members or executable modes fail before mutation", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    applyCommission(f.kit, options(f, { expected: "0".repeat(64) })),
    /reviewed SHA256/,
  );
  const binary = NodePath.join(f.kit, "components/office/office");
  await NodeFSP.appendFile(binary, "# altered\n");
  await assert.rejects(planCommission(f.kit, options(f)), /payload changed/);
  await assert.rejects(NodeFSP.access(f.p.manifest), /ENOENT/);
  await NodeFSP.copyFile(NodePath.join(f.inputs, "components/office/office"), binary);
  await NodeFSP.chmod(binary, 0o644);
  await assert.rejects(verifyKit(f.kit, f.built.sha256), /payload changed/);
  await NodeFSP.chmod(binary, 0o755);
  await NodeFSP.writeFile(NodePath.join(f.kit, "extra"), "unreviewed");
  await assert.rejects(verifyKit(f.kit, f.built.sha256), /extra files/);
});
test("recipe is portable and rejects credentials, arbitrary paths, unsupported version and component mismatch", async (t) => {
  const f = await fixture(t),
    recipe = (await verifyKit(f.kit, f.built.sha256)).recipe;
  for (const mutate of [
    (v) => {
      v.token = "secret";
    },
    (v) => {
      v.components.loom.commands.loomExecutable = "/home/alice/loom";
    },
    (v) => {
      v.apps.office = "https://user:password@example.test";
    },
    (v) => {
      v.target.deviceId = "machine";
    },
    (v) => {
      v.version = 2;
    },
    (v) => {
      v.components.loom.files = {};
    },
  ]) {
    const v = structuredClone(recipe);
    mutate(v);
    assert.throws(() => validateRecipe(v));
  }
  await assert.rejects(planCommission(f.kit, options(f, { arch: "arm64" })), /Linux x64/);
  await NodeFSP.writeFile(NodePath.join(f.env.OMARCHY_PATH, "version"), "5.0.0");
  await assert.rejects(planCommission(f.kit, options(f)), /checked versions/);
  await assert.rejects(NodeFSP.access(f.p.manifest), /ENOENT/);
});
test("interrupted commissioning resumes the exact kit and profile; another recipe cannot take over", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    applyCommission(
      f.kit,
      options(f, {
        afterStep: (name) => {
          if (name === "integration") throw Error("fixture interruption");
        },
      }),
    ),
    /fixture interruption/,
  );
  const journal = NodePath.join(f.p.state, "loom-os/commission.json");
  assert.equal(JSON.parse(await NodeFSP.readFile(journal)).phase, "integration");
  await assert.rejects(
    planCommission(f.kit, options(f, { profile: "workstation" })),
    /exact recipe and profile/,
  );
  const result = await applyCommission(f.kit, options(f));
  assert.equal(result.commissioned, true);
  assert.equal(JSON.parse(await NodeFSP.readFile(journal)).phase, "complete");
  await assert.rejects(
    applyCommission(f.kit, { env: f.env, ...f.dependencies }),
    /reviewed recipe/,
  );
});
test("rerun preserves personalized shortcuts, utility text, shell, profiles, credentials and server data", async (t) => {
  const f = await fixture(t);
  await applyCommission(f.kit, options(f));
  const keep = [
    [
      NodePath.join(f.p.config, "loom-os/shortcuts.json"),
      '{"version":1,"preset":"none","bindings":{}}\n',
    ],
    [NodePath.join(f.p.config, "loom-os/readability.json"), '{"version":1,"size":"system"}\n'],
    [
      NodePath.join(f.p.home, ".config/omarchy/shell.json"),
      '{"version":1,"bar":{"layout":{"right":[{"id":"custom"}]}}}\n',
    ],
    [NodePath.join(f.p.root, "browser-profiles/office/state"), "private fixture profile"],
    [NodePath.join(f.p.root, "t3/userdata/state"), "private fixture data"],
    [NodePath.join(f.p.config, "private-fixture-key"), "fixture secret"],
  ];
  for (const [file, content] of keep) {
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
    await NodeFSP.writeFile(file, content);
  }
  await NodeFSP.appendFile(
    NodePath.join(f.p.config, "hypr/bindings.lua"),
    "-- another personal binding\n",
  );
  await applyCommission(f.kit, options(f));
  for (const [file, content] of keep) assert.equal(await NodeFSP.readFile(file, "utf8"), content);
  assert.match(
    await NodeFSP.readFile(NodePath.join(f.p.config, "hypr/bindings.lua"), "utf8"),
    /another personal/,
  );
});
test("changed installed component and foreign service home are preserved and reported", async (t) => {
  const f = await fixture(t);
  await applyCommission(f.kit, options(f));
  const config = JSON.parse(await NodeFSP.readFile(f.p.configFile));
  await NodeFSP.appendFile(config.loomExecutable, "# personal\n");
  await assert.rejects(applyCommission(f.kit, options(f)), /edited installed component/);
  const report = await commissioningStatus(options(f));
  assert.equal(report.steps.find((v) => v.id === "component-loom").state, "attention");
  config.serverBaseDir = NodePath.join(f.root, "foreign-state");
  await NodeFSP.writeFile(f.p.configFile, JSON.stringify(config));
  await assert.rejects(
    planCommission(f.kit, options(f, { profile: "workstation" })),
    /server data directory/,
  );
});
test("internal release symlinks survive the kit; external links and accidental personal files are refused", async (t) => {
  const f = await fixture(t);
  const root = NodePath.join(f.inputs, "components/loom");
  await NodeFSP.symlink("loom", NodePath.join(root, "alias"));
  const output = NodePath.join(f.root, "links");
  const built = await buildKit(f.spec, f.inputs, output);
  await verifyKit(output, built.sha256);
  await NodeFSP.symlink("/etc/passwd", NodePath.join(root, "outside"));
  await assert.rejects(buildKit(f.spec, f.inputs, NodePath.join(f.root, "unsafe")), /Nonportable/);
  await NodeFSP.rm(NodePath.join(root, "outside"));
  await NodeFSP.writeFile(NodePath.join(root, ".env"), "fixture only");
  await assert.rejects(buildKit(f.spec, f.inputs, NodePath.join(f.root, "private")), /credential/);
});
test("native continuation never installs a laptop server, bypasses lock or replaces an existing service", async (t) => {
  const f = await fixture(t);
  await applyCommission(f.kit, options(f, { profile: "workstation" }));
  const unit = NodePath.join(f.p.home, ".config/systemd/user/t3code.service");
  await NodeFSP.mkdir(NodePath.dirname(unit), { recursive: true });
  await NodeFSP.writeFile(unit, "foreign existing unit");
  const actions = ["Install workstation hosting", "Enable status widget", "Done"],
    invocations = [];
  await nativeCommission(f.env, {
    ...f.dependencies,
    choose: async () => actions.shift(),
    command: async (file, args) => ({
      exit: 0,
      stdout: args[0] === "lock" ? '{"locked":true,"secure":true}' : "active",
    }),
    loomMain: async (...args) => invocations.push(args),
  });
  assert.deepEqual(invocations, []);
  assert.equal(await NodeFSP.readFile(unit, "utf8"), "foreign existing unit");
  assert.ok(
    loomActionCatalog({ officeUrl: "https://office.test", loomExecutable: "/usr/bin/true" }).some(
      (v) => v.id === "commission",
    ),
  );
});
test("missing system prerequisites stop before installing and bootstrap command handles a clean uncommissioned home", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    planCommission(
      f.kit,
      options(f, {
        resolve: async () => {
          throw Error("Install chromium");
        },
      }),
    ),
    /Install chromium/,
  );
  assert.equal((await commissioningStatus({ env: f.env })).commissioned, false);
  await assert.rejects(NodeFSP.access(f.p.manifest), /ENOENT/);
});
test("native setup resumes an interruption before initial configuration without relying on stale completion marks", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    applyCommission(
      f.kit,
      options(f, {
        afterStep: (name) => {
          if (name === "components") throw Error("interrupted before config");
        },
      }),
    ),
    /before config/,
  );
  const before = await commissioningStatus({ env: f.env });
  assert.equal(before.phase, "components");
  assert.equal(before.commissioned, false);
  const choices = ["Resume reviewed setup", "Done"];
  await nativeCommission(f.env, { ...f.dependencies, choose: async () => choices.shift() });
  assert.equal((await commissioningStatus(options(f))).commissioned, true);
});
test("after an ordinary pack update, setup distinguishes the newer release from the original pinned recipe", async (t) => {
  const f = await fixture(t);
  await applyCommission(f.kit, options(f));
  const newer = NodePath.join(f.root, "newer");
  const pack = await buildRelease(newer, "setup-test-2");
  await activateRelease(newer, pack.sha256, { env: f.env });
  const report = await commissioningStatus(options(f));
  assert.equal(report.steps.find((v) => v.id === "integration").state, "attention");
  assert.match(report.steps.find((v) => v.id === "integration").detail, /active pack differs/);
});
test("existing native Lua shortcuts stay implicit when no preferences file has been written", async (t) => {
  const f = await fixture(t);
  const module = await import("./loom-os.mjs");
  await module.install(
    {
      version: 1,
      profile: "laptop",
      officeUrl: f.spec.apps.office,
      loomExecutable: "/usr/bin/true",
    },
    { env: f.env },
  );
  f.spec.preferences.shortcuts = "standard";
  const kit = NodePath.join(f.root, "standard-kit");
  const built = await buildKit(f.spec, f.inputs, kit);
  const before = await NodeFSP.readFile(NodePath.join(f.p.config, "hypr/bindings.lua"), "utf8");
  let queried = false;
  await applyCommission(
    kit,
    options(f, {
      expected: built.sha256,
      shortcutDependencies: {
        query: async () => {
          queried = true;
          return {
            stdout: JSON.stringify([{ modmask: 76, key: "L", dispatcher: "__lua", arg: "57" }]),
          };
        },
      },
    }),
  );
  assert.equal(queried, false);
  await assert.rejects(
    NodeFSP.access(NodePath.join(f.p.config, "loom-os/shortcuts.json")),
    /ENOENT/,
  );
  assert.match(
    await NodeFSP.readFile(NodePath.join(f.p.config, "hypr/bindings.lua"), "utf8"),
    /personal binding/,
  );
  assert.ok(before.includes("SUPER"));
});
test("retiring a failed journal preserves installed state and permits a deliberately amended recipe", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    applyCommission(
      f.kit,
      options(f, {
        afterStep: (name) => {
          if (name === "integration") throw Error("failed candidate");
        },
      }),
    ),
    /failed candidate/,
  );
  const before = await NodeFSP.readFile(f.p.manifest, "utf8");
  await assert.rejects(abandonCommission("0".repeat(64), f.env), /exact reviewed/);
  const result = await abandonCommission(f.built.sha256, f.env);
  assert.equal(result.abandoned, true);
  assert.equal(JSON.parse(await NodeFSP.readFile(result.archive)).phase, "integration");
  assert.equal(await NodeFSP.readFile(f.p.manifest, "utf8"), before);
  await assert.rejects(
    NodeFSP.access(NodePath.join(f.p.state, "loom-os/commission.json")),
    /ENOENT/,
  );
  await applyCommission(f.kit, options(f));
  await assert.rejects(abandonCommission(f.built.sha256, f.env), /interrupted/);
});
test("offline workstation installation serves only its pinned runtime and closes its loopback mirror after failure", async (t) => {
  const f = await fixture(t);
  f.spec.components.server.runtimeDirectory = "runtime";
  const kit = NodePath.join(f.root, "offline");
  const built = await buildKit(f.spec, f.inputs, kit);
  await applyCommission(kit, options(f, { expected: built.sha256, profile: "workstation" }));
  const { recipe } = await verifyKit(kit, built.sha256);
  let address;
  await assert.rejects(
    withServerRuntimeMirror(recipe, f.env, async (origin) => {
      address = origin;
      const sums = await fetch(origin + "/vfixture-1/SHA256SUMS").then((r) => r.text());
      assert.match(sums, /^[a-f0-9]{64}  t3-fixture-1-linux-x64.tar.gz/);
      const archive = await fetch(origin + "/vfixture-1/t3-fixture-1-linux-x64.tar.gz");
      assert.equal(archive.status, 200);
      const data = new Uint8Array(await archive.arrayBuffer());
      assert.ok(data.length > 0);
      assert.equal((await fetch(origin + "/private-file")).status, 404);
      throw Error("fixture installer stopped");
    }),
    /fixture installer stopped/,
  );
  await assert.rejects(fetch(address + "/vfixture-1/SHA256SUMS"));
});
test("a checksum-valid but unlaunchable server release cannot complete setup or replace configuration", async (t) => {
  const f = await fixture(t);
  await NodeFSP.writeFile(NodePath.join(f.inputs, "components/server/t3"), "#!/bin/sh\nexit 1\n", {
    mode: 0o755,
  });
  const kit = NodePath.join(f.root, "broken-runtime"),
    built = await buildKit(f.spec, f.inputs, kit);
  await assert.rejects(
    applyCommission(kit, options(f, { expected: built.sha256, profile: "workstation" })),
    /complete checked distribution/,
  );
  await assert.rejects(NodeFSP.access(f.p.configFile), /ENOENT/);
  const status = await commissioningStatus({ env: f.env });
  assert.equal(status.ready, false);
  assert.equal(status.phase, "components");
  assert.deepEqual(f.calls, []);
});
