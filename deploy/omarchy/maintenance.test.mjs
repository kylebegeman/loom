import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { paths } from "./loom-os.mjs";
import { applyCommission, buildKit } from "./commission.mjs";
import { activateRelease, buildRelease, releaseStatus } from "./release.mjs";
import {
  applyMaintenance,
  formatMaintenanceReport,
  main,
  maintenanceCandidates,
  maintenanceReport,
  recoverMaintenance,
  stageMaintenance,
  verifyMaintenance,
} from "./maintenance.mjs";
const assert = NodeAssert,
  test = NodeTest.test;
async function fixture(t, profile = "laptop") {
  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-maintenance-")),
  );
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const env = {
      HOME: NodePath.join(root, "home"),
      OMARCHY_PATH: NodePath.join(root, "omarchy"),
      PATH: "/usr/bin:/bin",
    },
    p = paths(env);
  await NodeFSP.mkdir(NodePath.join(p.config, "hypr"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(p.config, "hypr/bindings.lua"), "-- personal bindings\n");
  for (const [from, to] of [
    ["MenuModel.js.txt", "shell/plugins/menu/MenuModel.js"],
    ["omarchy-menu.jsonc.txt", "default/omarchy/omarchy-menu.jsonc"],
  ]) {
    const target = NodePath.join(env.OMARCHY_PATH, to);
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
    await NodeFSP.copyFile(new URL("./fixtures/omarchy/" + from, import.meta.url), target);
  }
  await NodeFSP.writeFile(NodePath.join(env.OMARCHY_PATH, "version"), "4.0.0.alpha\n");
  const inputs = NodePath.join(root, "inputs");
  await NodeFSP.mkdir(inputs);
  const first = await buildRelease(NodePath.join(inputs, "integration"), "maintenance-1");
  const spec = {
    format: "loom-os-recipe",
    version: 1,
    name: "personal",
    profile,
    target: { platform: "linux", arch: "x64", omarchy: ["4.0.0.alpha"] },
    pack: { version: first.version, sha256: first.sha256 },
    components: {
      loom: { version: "client-1", commands: { loomExecutable: "loom" } },
      office: { version: "cli-1", commands: { officeCli: "office" } },
      ...(profile === "workstation"
        ? { server: { version: "server-1", commands: { serverExecutable: "t3" } } }
        : {}),
    },
    apps: { office: "https://office.example.test" },
    ...(profile === "workstation"
      ? {
          server: {
            releaseBaseUrl: "https://private.example.test/custom-fork/releases",
            port: 3774,
          },
        }
      : {}),
    preferences: {
      appearance: "preserve",
      shortcuts: "preserve",
      textSize: "preserve",
      statusWidget: false,
      branding: false,
    },
  };
  for (const [name, component] of Object.entries(spec.components)) {
    const directory = NodePath.join(inputs, "components", name);
    await NodeFSP.mkdir(directory, { recursive: true });
    for (const file of Object.values(component.commands))
      await NodeFSP.writeFile(
        NodePath.join(directory, file),
        name === "server" ? "#!/bin/sh\nprintf 't3 vserver-1\\n'\n" : "#!/bin/sh\nexit 0\n",
        { mode: 0o755 },
      );
  }
  const kit = NodePath.join(root, "kit-1"),
    built = await buildKit(spec, inputs, kit),
    calls = [];
  const deps = {
    platform: "linux",
    arch: "x64",
    resolve: async () => "/usr/bin/true",
    connections: async () => ({ steps: [] }),
    command: async (file, args) => {
      calls.push([file, args]);
      return {
        exit: 0,
        stdout: args.includes("MainPID") ? "ActiveState=active\nMainPID=123\n" : "active\n",
      };
    },
    compatibility: async () => ({
      errors: 0,
      checks: [{ id: "native", state: "ready", detail: "Native owner checks passed." }],
    }),
    work: async () => ({
      sources: [
        {
          id: "office.health.overview",
          owner: "office",
          state: "connected",
          jobs: { queued: 11, running: 3, retry: 1, dead: 96 },
        },
      ],
      rows: [
        { title: "private-title-omitted", prompt: "private-prompt-omitted", state: "running" },
      ],
      truncated: false,
    }),
    request: async () =>
      new Response(JSON.stringify({ version: "0123456789abcdef0123" }), {
        headers: { "content-type": "application/json" },
      }),
  };
  await applyCommission(kit, { env, expected: built.sha256, profile, ...deps });
  const config = JSON.parse(await NodeFSP.readFile(p.configFile, "utf8"));
  const next = NodePath.join(root, "pack-2"),
    second = await buildRelease(next, "maintenance-2");
  return { root, env, p, inputs, spec, kit, built, config, next, second, deps, calls };
}
const stagePack = (f, more = {}) =>
  stageMaintenance(
    { kind: "pack", directory: f.next, expected: f.second.sha256 },
    f.config,
    f.env,
    { ...f.deps, ...more },
  );
async function nextKit(f, mutate = () => {}) {
  const inputs = NodePath.join(f.root, "next-inputs");
  await NodeFSP.mkdir(inputs);
  await NodeFSP.cp(f.next, NodePath.join(inputs, "integration"), { recursive: true });
  await NodeFSP.cp(NodePath.join(f.inputs, "components"), NodePath.join(inputs, "components"), {
    recursive: true,
  });
  const spec = structuredClone(f.spec);
  spec.pack = { version: f.second.version, sha256: f.second.sha256 };
  await mutate(spec, inputs);
  const directory = NodePath.join(f.root, "kit-2"),
    built = await buildKit(spec, inputs, directory);
  return { directory, built, spec };
}
async function stagedKit(f, mutate = () => {}, more = {}) {
  const candidate = await nextKit(f, mutate);
  const staged = await stageMaintenance(
    { kind: "kit", directory: candidate.directory, expected: candidate.built.sha256 },
    f.config,
    f.env,
    { ...f.deps, ...more },
  );
  return { ...candidate, staged };
}
const journalFile = (f) => NodePath.join(f.p.state, "loom-os/updates/journal.json");
const savedJournal = async (f) => JSON.parse(await NodeFSP.readFile(journalFile(f), "utf8"));

test("status is read-only, bounded, separates pinned/running versions, and omits personal context", async (t) => {
  const f = await fixture(t, "workstation"),
    before = await NodeFSP.readFile(f.p.configFile);
  const report = await maintenanceReport(f.config, f.env, f.deps);
  assert.equal(report.readOnly, true);
  assert.equal(report.commissioned.components.find((v) => v.name === "server").version, "server-1");
  assert.equal(report.runningServer.pid, 123);
  assert.equal(report.runningServer.version, undefined);
  assert.equal(report.ownerMetadata.sources[0].jobs.dead, 96);
  assert.equal(report.apps[0].version, "0123456789abcdef0123");
  assert.equal(report.apps[0].channel, "unknown");
  assert.doesNotMatch(
    JSON.stringify(report),
    /private-title|private-prompt|"token"|"credential"|userdata/,
  );
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), before);
  await assert.rejects(NodeFSP.access(journalFile(f)), /ENOENT/);
  assert.match(formatMaintenanceReport(report), /pinned server-1/);
});
test("offline/rejected app metadata remains unavailable and never grants update authority", async (t) => {
  const f = await fixture(t);
  for (const request of [
    async () => {
      throw Error("offline");
    },
    async () => new Response("authorization", { status: 403 }),
    async () =>
      new Response(JSON.stringify({ version: "token-secret", token: "do-not-output" }), {
        headers: { "content-type": "application/json" },
      }),
    async () => new Response("x".repeat(5000), { headers: { "content-type": "application/json" } }),
  ]) {
    const report = await maintenanceReport(f.config, f.env, { ...f.deps, request });
    assert.equal(report.apps[0].state, "unavailable");
    assert.doesNotMatch(JSON.stringify(report), /do-not-output|token-secret/);
  }
});
test("staging freezes private verified bytes without install, restart or owner changes", async (t) => {
  const f = await fixture(t),
    before = await NodeFSP.readFile(f.p.manifest),
    state = await releaseStatus({ env: f.env }),
    calls = f.calls.length;
  const staged = await stagePack(f);
  assert.equal(staged.phase, "staged");
  assert.equal(staged.attempts, 0);
  assert.match(staged.reviewHash, /^[a-f0-9]{64}$/);
  assert.notEqual(staged.reviewHash, staged.sha256);
  assert.equal(staged.rollbackSha256, f.spec.pack.sha256);
  assert.deepEqual(await NodeFSP.readFile(f.p.manifest), before);
  assert.deepEqual(await releaseStatus({ env: f.env }), state);
  assert.equal(f.calls.length, calls);
  assert.equal((await NodeFSP.stat(journalFile(f))).mode & 0o777, 0o600);
  assert.equal((await NodeFSP.stat(NodePath.dirname(journalFile(f)))).mode & 0o777, 0o700);
  const retained = NodePath.join(
    f.p.state,
    "loom-os/updates/candidates/pack-" + staged.sha256,
    "release.json",
  );
  assert.equal((await NodeFSP.stat(retained)).mode & 0o777, 0o400);
  await NodeFSP.rm(f.next, { recursive: true });
  assert.equal(
    (await applyMaintenance(staged.reviewHash, f.config, f.env, f.deps)).phase,
    "complete",
  );
});
test("no-restart pack apply permits active/unknown remote work, preserves data, and verifies rollback", async (t) => {
  const f = await fixture(t, "workstation"),
    staged = await stagePack(f),
    before = await NodeFSP.readFile(f.p.configFile),
    marker = NodePath.join(f.p.root, "t3/userdata/private");
  await NodeFSP.mkdir(NodePath.dirname(marker), { recursive: true });
  await NodeFSP.writeFile(marker, "personal-data");
  const calls = f.calls.length;
  const applied = await applyMaintenance(staged.reviewHash, f.config, f.env, {
    ...f.deps,
    localWork: async () => {
      throw Error("Pack updates cannot consult a restart gate.");
    },
  });
  assert.equal(applied.phase, "complete");
  assert.equal(f.calls.length, calls);
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), before);
  assert.equal(await NodeFSP.readFile(marker, "utf8"), "personal-data");
  assert.equal((await verifyMaintenance(undefined, f.env, f.deps)).verified, true);
  const restored = await recoverMaintenance(
    "rollback",
    staged.reviewHash,
    undefined,
    f.env,
    f.deps,
  );
  assert.equal(restored.phase, "discarded");
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
  assert.equal(await NodeFSP.readFile(marker, "utf8"), "personal-data");
});
test("candidate SHA is not a plan review receipt; wrong digest and stale config fail before mutation", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  await assert.rejects(
    applyMaintenance(staged.sha256, f.config, f.env, f.deps),
    /changed after review/,
  );
  await NodeFSP.appendFile(f.p.configFile, "\n");
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, f.deps),
    /changed after staging/,
  );
  assert.equal((await savedJournal(f)).attempts, 0);
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
});
test("stale owner release and tampered frozen candidate are fenced before apply", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  const candidate = NodePath.join(
    f.p.state,
    "loom-os/updates/candidates/pack-" + staged.sha256,
    "pack/health.mjs",
  );
  await NodeFSP.chmod(candidate, 0o600);
  await NodeFSP.appendFile(candidate, "// changed\n");
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, f.deps),
    /member changed/,
  );
  assert.equal((await savedJournal(f)).attempts, 0);
  await recoverMaintenance("discard", staged.reviewHash, f.config, f.env, f.deps);
  const fresh = await stagePack(f);
  await activateRelease(f.next, f.second.sha256, { env: f.env });
  await assert.rejects(
    applyMaintenance(fresh.reviewHash, f.config, f.env, f.deps),
    /release changed after staging/,
  );
});
test("stage rejects unreviewed, symbolic and installed sources, detecting concurrent source changes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    stageMaintenance(
      { kind: "pack", directory: f.next, expected: "0".repeat(64) },
      f.config,
      f.env,
      f.deps,
    ),
    /reviewed SHA256/,
  );
  const link = NodePath.join(f.root, "linked-pack");
  await NodeFSP.symlink(f.next, link);
  await assert.rejects(
    stageMaintenance(
      { kind: "pack", directory: link, expected: f.second.sha256 },
      f.config,
      f.env,
      f.deps,
    ),
    /symbolic link/,
  );
  await assert.rejects(
    stageMaintenance(
      { kind: "pack", directory: f.p.root, expected: f.second.sha256 },
      f.config,
      f.env,
      f.deps,
    ),
    /installed or maintenance/,
  );
  let checks = 0;
  await assert.rejects(
    stagePack(f, {
      activateRelease: async (directory, expected, options) => {
        const result = await activateRelease(directory, expected, options);
        if (++checks === 2) await NodeFSP.writeFile(NodePath.join(f.next, "extra"), "concurrent");
        return result;
      },
    }),
    /extra files/,
  );
  await assert.rejects(NodeFSP.access(journalFile(f)), /ENOENT/);
});
test("feature removal is rejected instead of silently degrading the installed pack", async (t) => {
  const f = await fixture(t),
    source = NodePath.join(f.root, "smaller-source");
  await NodeFSP.cp(NodePath.join(f.next, "pack"), source, { recursive: true });
  await NodeFSP.cp(NodePath.join(f.next, "iris"), NodePath.join(source, "iris"), {
    recursive: true,
  });
  await NodeFSP.rm(NodePath.join(source, "availability.mjs"));
  const target = NodePath.join(f.root, "smaller"),
    built = await buildRelease(target, "smaller-1", source);
  await assert.rejects(
    stageMaintenance(
      { kind: "pack", directory: target, expected: built.sha256 },
      f.config,
      f.env,
      f.deps,
    ),
    /removes installed integration features/,
  );
});
test("interrupted activation retains exact owner intent and retry finishes without selecting another candidate", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  let installs = 0;
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, {
      ...f.deps,
      activateRelease: async (directory, expected, options) => {
        if (options.dryRun) return activateRelease(directory, expected, options);
        installs++;
        throw Error("fixture interruption");
      },
    }),
    /fixture interruption/,
  );
  assert.equal((await savedJournal(f)).phase, "failed");
  assert.equal((await savedJournal(f)).attempts, 1);
  await assert.rejects(stagePack(f), /recover or discard/);
  await assert.rejects(
    recoverMaintenance("discard", staged.reviewHash, f.config, f.env, f.deps),
    /Only an unapplied/,
  );
  assert.equal(
    (await recoverMaintenance("retry", staged.reviewHash, f.config, f.env, f.deps)).phase,
    "complete",
  );
  assert.equal(installs, 1);
});
test("crash after owner activation verifies completed bytes without reinstalling or restarting", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, {
      ...f.deps,
      afterPhase: async (phase) => {
        if (phase === "verifying") throw Error("lost session");
      },
    }),
    /lost session/,
  );
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.second.sha256);
  assert.equal(
    (
      await recoverMaintenance("retry", staged.reviewHash, undefined, f.env, {
        ...f.deps,
        activateRelease: async () => {
          throw Error("No duplicate install");
        },
      })
    ).phase,
    "complete",
  );
});
test("interrupted rollback has its own exact durable recovery action and never toggles twice", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  await applyMaintenance(staged.reviewHash, f.config, f.env, f.deps);
  await assert.rejects(
    recoverMaintenance("rollback", staged.reviewHash, f.config, f.env, {
      ...f.deps,
      afterPhase: async () => {
        throw Error("rollback interruption");
      },
    }),
    /rollback interruption/,
  );
  assert.equal((await savedJournal(f)).recoveryAction, "rollback");
  assert.equal(
    (await recoverMaintenance("retry", staged.reviewHash, f.config, f.env, f.deps)).phase,
    "discarded",
  );
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
  assert.equal(
    (await recoverMaintenance("retry", staged.reviewHash, f.config, f.env, f.deps)).phase,
    "discarded",
  );
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
});
test("discard is reversible staging only and restaging has a fresh baseline receipt", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  assert.equal(
    (await recoverMaintenance("discard", staged.reviewHash, f.config, f.env, f.deps)).phase,
    "discarded",
  );
  await assert.rejects(applyMaintenance(staged.reviewHash, f.config, f.env, f.deps), /discarded/);
  await NodeFSP.appendFile(f.p.configFile, "\n");
  const fresh = await stagePack(f);
  assert.notEqual(fresh.reviewHash, staged.reviewHash);
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, f.deps),
    /changed after review/,
  );
});
test("new-pack-only kit uses the existing commissioner and preserves active owning work", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f);
  assert.deepEqual(staged.changedComponents, []);
  const before = await NodeFSP.readFile(f.p.configFile);
  const applied = await applyMaintenance(staged.reviewHash, f.config, f.env, {
    ...f.deps,
    localWork: async () => {
      throw Error("No component change gate.");
    },
  });
  assert.equal(applied.phase, "complete");
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), before);
  assert.equal(
    (await maintenanceReport(undefined, f.env, f.deps)).commissioned.sha256,
    staged.sha256,
  );
});
for (const state of ["active", "unknown"])
  test(`changed components fail closed for ${state} local owning work before commissioner mutation`, async (t) => {
    const f = await fixture(t, "workstation"),
      { staged } = await stagedKit(f, (spec) => {
        spec.components.loom.version = "client-2";
      });
    assert.deepEqual(staged.changedComponents, ["loom"]);
    await assert.rejects(
      applyMaintenance(staged.reviewHash, f.config, f.env, {
        ...f.deps,
        localWork: async () => ({ state, active: state === "active" ? 1 : null }),
        applyCommission: async () => {
          throw Error("must not mutate");
        },
      }),
      state === "active" ? /Local Loom work is active/ : /fully authorized and confirmed/,
    );
    assert.equal((await savedJournal(f)).phase, "staged");
    assert.equal((await savedJournal(f)).attempts, 0);
  });
test("full native activity scan includes archived/late threads and running schedules; authorization cannot be inferred", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f, (spec) => {
      spec.components.office.version = "cli-2";
    });
  const idleThreads = Array.from({ length: 150 }, (_, index) => ({
    id: "thread-" + index,
    status: "idle",
  }));
  for (const [session, shell, tasks] of [
    [
      { authenticated: true, permissions: ["orchestration:read"] },
      { threads: [...idleThreads, { status: "running" }], archivedThreads: [] },
      [],
    ],
    [
      { authenticated: true, permissions: ["orchestration:read"] },
      { threads: idleThreads, archivedThreads: [{ status: "running" }] },
      [],
    ],
    [
      { authenticated: true, permissions: ["orchestration:read"] },
      { threads: [], archivedThreads: [] },
      [{ lastRunStatus: "running" }],
    ],
    [
      { authenticated: false, permissions: ["orchestration:read"] },
      { threads: [], archivedThreads: [] },
      [],
    ],
    [{ authenticated: true, permissions: [] }, { threads: [], archivedThreads: [] }, []],
    [
      { authenticated: true, permissions: ["orchestration:read"] },
      { threads: [], archivedThreads: [], truncated: true },
      [],
    ],
    [
      { authenticated: true, permissions: ["orchestration:read"] },
      { threads: [{ status: "new-unknown-status" }], archivedThreads: [] },
      [],
    ],
  ]) {
    await assert.rejects(
      applyMaintenance(staged.reviewHash, f.config, f.env, {
        ...f.deps,
        loomRequest: async (_, __, path) => (path === "/api/auth/session" ? session : shell),
        loomCall: async () => ({ tasks }),
        applyCommission: async () => {
          throw Error("must not mutate");
        },
      }),
      /Local Loom work is active|fully authorized and confirmed/,
    );
  }
  assert.equal((await savedJournal(f)).attempts, 0);
});
test("idle native authorization permits immutable client commissioning, remote queues remain informational", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f, (spec) => {
      spec.components.office.version = "cli-2";
    });
  const report = await applyMaintenance(staged.reviewHash, f.config, f.env, {
    ...f.deps,
    loomRequest: async (_, __, path) =>
      path === "/api/auth/session"
        ? { authenticated: true, permissions: ["orchestration:read"] }
        : { threads: [], archivedThreads: [] },
    loomCall: async () => ({ tasks: [{ lastRunStatus: "failed" }] }),
  });
  assert.equal(report.phase, "complete");
  const current = await maintenanceReport(undefined, f.env, f.deps);
  assert.equal(current.commissioned.components.find((v) => v.name === "office").version, "cli-2");
  assert.equal(current.ownerMetadata.sources[0].jobs.running, 3);
});
test("server kit pins a checked payload but does not restart or claim it is running", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f, async (spec, inputs) => {
      spec.components.server.version = "server-2";
      await NodeFSP.writeFile(
        NodePath.join(inputs, "components/server/t3"),
        "#!/bin/sh\nprintf 't3 vserver-2\\n'\n",
        { mode: 0o755 },
      );
    });
  assert.equal(staged.activationPending, true);
  const count = f.calls.length;
  await applyMaintenance(staged.reviewHash, f.config, f.env, {
    ...f.deps,
    localWork: async () => ({ state: "idle", active: 0 }),
  });
  const current = await maintenanceReport(undefined, f.env, f.deps);
  assert.equal(
    current.commissioned.components.find((v) => v.name === "server").version,
    "server-2",
  );
  assert.equal(current.runningServer.pid, 123);
  assert.equal(current.runningServer.version, undefined);
  assert.ok(
    f.calls
      .slice(count)
      .every(([, args]) => !args.some((arg) => ["restart", "start", "stop"].includes(arg))),
  );
});
test("kits reject profile, platform, custom origin, component inventory and personal configuration rewrites", async (t) => {
  for (const [label, mutate, match, profile] of [
    [
      "profile",
      (spec) => {
        spec.profile = "workstation";
      },
      /preserve this machine's profile/,
      "laptop",
    ],
    [
      "platform",
      (spec) => {
        spec.target.arch = "arm64";
      },
      /needs Linux arm64/,
      "laptop",
    ],
    [
      "origin",
      (spec) => {
        spec.server.releaseBaseUrl = "https://upstream.example.test/releases";
      },
      /custom fork origins/,
      "workstation",
    ],
    [
      "inventory",
      (spec) => {
        delete spec.components.office;
      },
      /component inventory/,
      "laptop",
    ],
  ]) {
    await t.test(label, async (st) => {
      const f = await fixture(st, profile);
      await assert.rejects(stagedKit(f, mutate), match);
    });
  }
  await t.test("personal setting", async (st) => {
    const f = await fixture(st);
    f.config.browserExecutable = "/bin/false";
    await NodeFSP.writeFile(f.p.configFile, JSON.stringify(f.config, null, 2) + "\n");
    await assert.rejects(
      stagedKit(f),
      /personal configuration setting|native compatibility\/ownership errors/,
    );
  });
});
test("concurrent configuration mutation during work checks is detected before installation", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f, (spec) => {
      spec.components.loom.version = "client-2";
    });
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, {
      ...f.deps,
      localWork: async () => {
        await NodeFSP.appendFile(f.p.configFile, "\n");
        return { state: "idle", active: 0 };
      },
      applyCommission: async () => {
        throw Error("must not mutate");
      },
    }),
    /ownership changed while checking/,
  );
  assert.equal((await savedJournal(f)).attempts, 0);
});
test("private ownership, concurrent operations and journal identity are not silently repaired", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f),
    root = NodePath.dirname(journalFile(f));
  await NodeFSP.chmod(root, 0o755);
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, f.deps),
    /private directory/,
  );
  await NodeFSP.chmod(root, 0o700);
  const lock = NodePath.join(root, "operation.json");
  await NodeFSP.writeFile(
    lock,
    JSON.stringify({
      format: "loom-os-maintenance-lock",
      pid: process.pid,
      nonce: "existing-operation",
    }),
  );
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, f.deps),
    /still active/,
  );
  await NodeFSP.rm(lock);
  const saved = await savedJournal(f);
  saved.id = "foreign";
  await NodeFSP.writeFile(journalFile(f), JSON.stringify(saved));
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, f.deps),
    /outside its owned identity/,
  );
});
test("native candidates include only verified owned retained bundles and kits; CLI performs exact stage/apply", async (t) => {
  const f = await fixture(t),
    retained = NodePath.join(f.p.root, "recovery-kits/personal-2");
  await NodeFSP.mkdir(NodePath.dirname(retained), { recursive: true });
  await NodeFSP.cp(f.kit, retained, { recursive: true });
  await NodeFSP.symlink(f.next, NodePath.join(f.p.root, "pack-releases/foreign-link"));
  const candidates = await maintenanceCandidates(f.env);
  assert.ok(candidates.some((value) => value.kind === "kit" && value.sha256 === f.built.sha256));
  assert.ok(
    candidates.some((value) => value.kind === "pack" && value.sha256 === f.spec.pack.sha256),
  );
  assert.ok(candidates.every((value) => !value.directory.endsWith("foreign-link")));
  const staged = await main(["stage", "pack", f.next, f.second.sha256], f.env, f.deps);
  assert.equal((await main(["apply", staged.reviewHash], f.env, f.deps)).phase, "complete");
  assert.equal((await main(["verify"], f.env, f.deps)).verified, true);
  assert.match(await main(["status", "--human"], f.env, f.deps), /maintenance-2/);
  await assert.rejects(main(["stage", "pack", f.next], f.env, f.deps), /Usage/);
});

test("interrupted commissioner resumes its original private kit and preserves existing records", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f);
  const originalConfig = await NodeFSP.readFile(f.p.configFile);
  await assert.rejects(
    applyMaintenance(staged.reviewHash, f.config, f.env, {
      ...f.deps,
      afterStep: async (name) => {
        if (name === "components") throw Error("commission interrupted");
      },
    }),
    /commission interrupted/,
  );
  assert.equal((await savedJournal(f)).phase, "failed");
  const owner = JSON.parse(
    await NodeFSP.readFile(NodePath.join(f.p.state, "loom-os/commission.json"), "utf8"),
  );
  assert.equal(owner.phase, "components");
  assert.equal(owner.sha256, staged.sha256);
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), originalConfig);
  assert.equal(
    (await recoverMaintenance("retry", staged.reviewHash, undefined, f.env, f.deps)).phase,
    "complete",
  );
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), originalConfig);
  assert.equal((await verifyMaintenance(undefined, f.env, f.deps)).verified, true);
});
test("pack apply is Linux-only and foreign retained pointers are preserved", async (t) => {
  const f = await fixture(t);
  await assert.rejects(stagePack(f, { platform: "darwin" }), /installed Linux machine/);
  const recordFile = NodePath.join(f.p.state, "loom-os/pack-release.json");
  const record = JSON.parse(await NodeFSP.readFile(recordFile, "utf8"));
  record.active.directory = f.next;
  await NodeFSP.writeFile(recordFile, JSON.stringify(record));
  await assert.rejects(stagePack(f), /Invalid owned release record/);
});

test("native inbox prioritizes incoming pack and kit before retained recovery candidates without installing", async (t) => {
  const f = await fixture(t),
    kit = await nextKit(f);
  const packs = NodePath.join(f.p.root, "maintenance/inbox/packs"),
    kits = NodePath.join(f.p.root, "maintenance/inbox/kits");
  await NodeFSP.mkdir(packs, { recursive: true });
  await NodeFSP.mkdir(kits, { recursive: true });
  await NodeFSP.cp(f.next, NodePath.join(packs, "incoming-2"), { recursive: true });
  await NodeFSP.cp(kit.directory, NodePath.join(kits, "personal-2"), { recursive: true });
  const candidates = await maintenanceCandidates(f.env);
  assert.deepEqual(
    candidates.slice(0, 2).map((candidate) => [candidate.kind, candidate.sha256]),
    [
      ["pack", f.second.sha256],
      ["kit", kit.built.sha256],
    ],
  );
  assert.ok(
    candidates
      .slice(2)
      .some((candidate) => candidate.kind === "pack" && candidate.sha256 === f.spec.pack.sha256),
  );
  assert.ok(
    candidates.some(
      (candidate) => candidate.kind === "pack" && candidate.sha256 === f.second.sha256,
    ),
  );
  assert.ok(
    candidates.some(
      (candidate) => candidate.kind === "kit" && candidate.sha256 === kit.built.sha256,
    ),
  );
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
  await assert.rejects(NodeFSP.access(journalFile(f)), /ENOENT/);
});
test("release identities distinguish live Loom, cached Switchboard controller, and Omarchy without usage or update calls", async (t) => {
  const f = await fixture(t, "workstation"),
    addresses = [];
  f.config.switchboardDashboardUrl = "https://controller.example.test/dashboard";
  await NodeFSP.writeFile(f.p.configFile, JSON.stringify(f.config, null, 2) + "\n");
  const report = await maintenanceReport(f.config, f.env, {
    ...f.deps,
    loomRequest: async (_, __, path) => {
      assert.equal(path, "/.well-known/t3/environment");
      return { serverVersion: "0.0.45-custom.2" };
    },
    request: async (address, options) => {
      addresses.push(address);
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "omit");
      return new Response(
        JSON.stringify(
          address.endsWith("/api/v1/health")
            ? {
                version: 1,
                service: "switchboard",
                controllerVersion: "controller-2",
                stale: false,
                inFlight: true,
                accountSecret: "omitted-secret",
              }
            : { version: "0123456789abcdef0123" },
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(report.identities.loom.serverVersion, "0.0.45-custom.2");
  assert.equal(report.identities.switchboard.controllerVersion, "controller-2");
  assert.equal(report.identities.switchboard.inferenceActivity, "unknown");
  assert.equal(report.identities.omarchy.version, "4.0.0.alpha");
  assert.equal(report.identities.omarchy.channel, "unknown");
  assert.deepEqual(addresses.sort(), [
    "https://controller.example.test/api/v1/health",
    "https://office.example.test/app/install-version.json",
  ]);
  assert.doesNotMatch(JSON.stringify(report), /omitted-secret|accountSecret|inFlight/);
});

test("stock Omarchy channel discovery accepts only owner channel names and never changes them", async (t) => {
  const f = await fixture(t),
    helper = NodePath.join(f.env.OMARCHY_PATH, "bin/omarchy-channel-current"),
    calls = [];
  await NodeFSP.mkdir(NodePath.dirname(helper));
  await NodeFSP.writeFile(helper, "#!/bin/sh\nprintf 'edge\\n'\n", { mode: 0o755 });
  for (const [stdout, channel] of [
    ["edge\n", "edge"],
    ["rc\n", "rc"],
    ["switch me now\n", "unknown"],
  ]) {
    const report = await maintenanceReport(f.config, f.env, {
      ...f.deps,
      command: async (file, args) => {
        calls.push([file, args]);
        return { exit: 0, stdout };
      },
    });
    assert.equal(report.identities.omarchy.channel, channel);
  }
  assert.deepEqual(
    calls,
    Array.from({ length: 3 }, () => [helper, []]),
  );
});

test("recovery handles the commission owner's pre-snapshot components crash window using only its exact staged kit", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f);
  const maintenance = await savedJournal(f);
  maintenance.phase = "applying";
  maintenance.attempts = 1;
  await NodeFSP.writeFile(journalFile(f), JSON.stringify(maintenance));
  const ownerFile = NodePath.join(f.p.state, "loom-os/commission.json"),
    owner = JSON.parse(await NodeFSP.readFile(ownerFile, "utf8"));
  owner.sha256 = staged.sha256;
  owner.phase = "components";
  owner.completed = [];
  owner.kit = NodePath.join(f.p.state, "loom-os/updates/candidates", maintenance.id);
  await NodeFSP.writeFile(ownerFile, JSON.stringify(owner));
  const snapshot = NodePath.join(f.p.root, "commission/recipes", staged.sha256 + ".json");
  await assert.rejects(NodeFSP.access(snapshot), /ENOENT/);
  const report = await maintenanceReport(undefined, f.env, f.deps);
  const before = await NodeFSP.readFile(f.p.configFile);
  const result = await recoverMaintenance("retry", staged.reviewHash, undefined, f.env, f.deps);
  assert.equal(result.phase, "complete");
  assert.equal(report.commissioned.state, "interrupted");
  assert.match(report.commissioned.detail, /snapshot|components/);
  assert.deepEqual(await NodeFSP.readFile(f.p.configFile), before);
  assert.ok((await NodeFSP.stat(snapshot)).isFile());
  assert.equal((await verifyMaintenance(undefined, f.env, f.deps)).verified, true);
});
test("retry preserves a separately activated owner release instead of overwriting it with a stale reviewed candidate", async (t) => {
  const f = await fixture(t),
    staged = await stagePack(f);
  await assert.rejects(
    applyMaintenance(staged.reviewHash, undefined, f.env, {
      ...f.deps,
      afterPhase: async () => {
        throw Error("crash before owner");
      },
    }),
    /crash before owner/,
  );
  const third = await buildRelease(NodePath.join(f.root, "pack-3"), "maintenance-external");
  await activateRelease(third.directory, third.sha256, { env: f.env });
  await assert.rejects(
    recoverMaintenance("retry", staged.reviewHash, undefined, f.env, f.deps),
    /owner|baseline|outside this update/,
  );
  assert.equal((await releaseStatus({ env: f.env })).active.sha256, third.sha256);
  assert.equal((await savedJournal(f)).phase, "failed");
});
test("the review receipt binds displayed kit names and old/new component pins", async (t) => {
  for (const [label, mutate] of [
    [
      "target version",
      (saved) => {
        saved.components[0].version = "unreviewed-2";
      },
    ],
    [
      "previous version",
      (saved) => {
        saved.components[0].previousVersion = "unreviewed-0";
      },
    ],
    [
      "pin",
      (saved) => {
        saved.components[0].sha256 = "0".repeat(64);
      },
    ],
    [
      "name",
      (saved) => {
        saved.name = "unreviewed-personal";
      },
    ],
  ]) {
    await t.test(label, async (st) => {
      const f = await fixture(st),
        { staged } = await stagedKit(f),
        saved = await savedJournal(f);
      mutate(saved);
      await NodeFSP.writeFile(journalFile(f), JSON.stringify(saved));
      await assert.rejects(
        applyMaintenance(staged.reviewHash, undefined, f.env, f.deps),
        /review receipt changed/,
      );
      assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
    });
  }
});

test("missing or tampered recipe snapshots never authorize completed, foreign or mismatched owner recovery", async (t) => {
  for (const [label, mutate] of [
    [
      "completed",
      async (owner) => {
        owner.phase = "complete";
      },
    ],
    [
      "later phase",
      async (owner) => {
        owner.phase = "integration";
      },
    ],
    [
      "foreign kit",
      async (owner, f) => {
        owner.kit = f.kit;
      },
    ],
    [
      "profile",
      async (owner) => {
        owner.profile = "laptop";
      },
    ],
    [
      "digest",
      async (owner) => {
        owner.sha256 = "0".repeat(64);
      },
    ],
    [
      "completed components",
      async (owner) => {
        owner.completed = ["components"];
      },
    ],
    [
      "tampered snapshot",
      async (owner, f) => {
        await NodeFSP.writeFile(
          NodePath.join(f.p.root, "commission/recipes", owner.sha256 + ".json"),
          "altered",
        );
      },
    ],
    [
      "tampered frozen recipe",
      async (owner) => {
        const file = NodePath.join(owner.kit, "recipe.json");
        await NodeFSP.chmod(file, 0o600);
        await NodeFSP.appendFile(file, "\n");
      },
    ],
  ]) {
    await t.test(label, async (st) => {
      const f = await fixture(st, "workstation"),
        { staged } = await stagedKit(f),
        maintenance = await savedJournal(f);
      maintenance.phase = "failed";
      maintenance.attempts = 1;
      await NodeFSP.writeFile(journalFile(f), JSON.stringify(maintenance));
      const file = NodePath.join(f.p.state, "loom-os/commission.json"),
        owner = JSON.parse(await NodeFSP.readFile(file, "utf8"));
      owner.sha256 = staged.sha256;
      owner.phase = "components";
      owner.completed = [];
      owner.kit = NodePath.join(f.p.state, "loom-os/updates/candidates", maintenance.id);
      await mutate(owner, f);
      await NodeFSP.writeFile(file, JSON.stringify(owner));
      await assert.rejects(
        recoverMaintenance("retry", staged.reviewHash, undefined, f.env, {
          ...f.deps,
          applyCommission: async () => {
            throw Error("owner must not replay");
          },
        }),
        /differs|changed|outside this update/,
      );
      assert.equal((await releaseStatus({ env: f.env })).active.sha256, f.spec.pack.sha256);
      assert.equal(
        (await maintenanceReport(undefined, f.env, f.deps)).commissioned.state,
        "unavailable",
      );
    });
  }
});
test("changed component recovery rechecks the original old-to-new plan after the owner published its target snapshot", async (t) => {
  const f = await fixture(t, "workstation"),
    { staged } = await stagedKit(f, (spec) => {
      spec.components.office.version = "cli-2";
    });
  const deps = { ...f.deps, localWork: async () => ({ state: "idle", active: 0 }) };
  await assert.rejects(
    applyMaintenance(staged.reviewHash, undefined, f.env, {
      ...deps,
      afterStep: async (phase) => {
        if (phase === "components") throw Error("after target snapshot");
      },
    }),
    /after target snapshot/,
  );
  assert.equal(
    (await recoverMaintenance("retry", staged.reviewHash, undefined, f.env, deps)).phase,
    "complete",
  );
  const receipt = (await maintenanceReport(undefined, f.env, f.deps)).update;
  const pin = receipt.plan.components.find((component) => component.name === "office");
  assert.equal(pin.previousVersion, "cli-1");
  assert.equal(pin.version, "cli-2");
  assert.equal(receipt.reviewHash, staged.reviewHash);
});
