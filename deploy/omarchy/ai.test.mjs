import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  aiAction,
  aiBin,
  aiFiles,
  aiPath,
  agentArgs,
  defaultAgent,
  routedEnvironment,
  updateUsage,
  usageRecords,
} from "./ai.mjs";
import { install, paths, uninstall } from "./loom-os.mjs";
const test = NodeTest.test,
  assert = NodeAssert;
const { mkdtemp, mkdir, writeFile, readFile, rm, realpath } = NodeFSP;
const { tmpdir } = NodeOS;
const { join } = NodePath;
async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "loom-ai-")));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { HOME: home, PATH: "/usr/bin:/bin" },
    p = paths(env);
  const config = {
    version: 1,
    profile: "laptop",
    officeUrl: "https://office.test",
    loomExecutable: process.execPath,
    switchboardUrl: "http://100.64.0.1:8317",
    switchboardCli: process.execPath,
  };
  await mkdir(join(home, ".config/switchboard"), { recursive: true });
  await writeFile(
    join(home, ".config/switchboard/client.json"),
    JSON.stringify({ version: 1, baseUrl: config.switchboardUrl }),
  );
  return { home, env, p, config };
}
test("OS launches use Switchboard with literal prompts and preserve the native terminal class", async (t) => {
  const f = await fixture(t),
    calls = [],
    run = async (...args) => calls.push(args);
  await aiAction(
    "agent",
    ["--inline", "--prompt", "--settings $(do not execute)"],
    f.config,
    f.env,
    f.p,
    run,
    { connections: async () => ({ aiReady: true }) },
  );
  assert.equal(calls[0][0], f.config.switchboardCli);
  assert.deepEqual(calls[0][1], ["run", "claude", "--", "--settings $(do not execute)"]);
  assert.equal(calls[0][2].env.PATH, aiPath(f.p, f.env.PATH));
  await aiAction("agent", ["--pick", "--prompt", "literal prompt"], f.config, f.env, f.p, run, {
    connections: async () => ({ aiReady: true }),
  });
  assert.equal(calls[1][0], "omarchy-launch-tui");
  assert.deepEqual(calls[1][1], [
    "--app-id=org.omarchy.agent",
    join(aiBin(f.p), "loom-ai-terminal"),
    "--prompt",
    "literal prompt",
  ]);
  await aiAction("default-agent", ["codex"], f.config, f.env, f.p, run, {
    connections: async () => ({ aiReady: true }),
  });
  await aiAction("agent", ["--inline"], f.config, f.env, f.p, run, {
    connections: async () => ({ aiReady: true }),
  });
  assert.deepEqual(calls[2][1], ["run", "codex"]);
});
test("unsupported providers and missing or mismatched hubs never start a CLI", async (t) => {
  const f = await fixture(t),
    run = () => assert.fail("must not launch");
  await assert.rejects(
    aiAction("default-agent", ["gemini"], f.config, f.env, f.p, run),
    /routing adapter/,
  );
  await writeFile(join(f.p.config, "omarchy/defaults/agent"), "gemini\n").catch(async () => {
    await mkdir(join(f.p.config, "omarchy/defaults"), { recursive: true });
    await writeFile(join(f.p.config, "omarchy/defaults/agent"), "gemini\n");
  });
  await assert.rejects(defaultAgent(f.p), /no Switchboard route/);
  await assert.rejects(
    routedEnvironment({ ...f.config, switchboardUrl: "http://127.0.0.1:8317" }, f.env, f.p),
    /disagree/,
  );
  await rm(join(f.home, ".config/switchboard/client.json"));
  await assert.rejects(
    aiAction("ai", ["codex", "--version"], f.config, f.env, f.p, run),
    /endpoint is unavailable/,
  );
  assert.throws(() => agentArgs(["--prompt"]));
});
test("AI install preserves personal config, restores it on removal, and refuses edited adapters", async (t) => {
  const f = await fixture(t),
    bashrc = join(f.home, ".bashrc"),
    personal = "# personal shell\nalias hello='echo hello'\n";
  await writeFile(bashrc, personal);
  await mkdir(join(f.p.config, "hypr"), { recursive: true });
  await writeFile(join(f.p.config, "hypr/bindings.lua"), "-- personal binding\n");
  await install(f.config, { env: f.env });
  assert.ok((await readFile(bashrc, "utf8")).endsWith(personal));
  assert.ok(
    (await readFile(join(f.p.config, "hypr/bindings.lua"), "utf8")).includes(
      'hl.unbind("SUPER + SHIFT + A")',
    ),
  );
  await install(f.config, { env: f.env });
  await uninstall({ env: f.env });
  assert.equal(await readFile(bashrc, "utf8"), personal);
  await install(f.config, { env: f.env });
  const adapter = join(aiBin(f.p), "omarchy-agent");
  await writeFile(adapter, "# personal change\n");
  await assert.rejects(install(f.config, { env: f.env }), /local edits/);
  assert.equal(await readFile(adapter, "utf8"), "# personal change\n");
});
test("cached usage follows the routed account and omits stale or reset windows", () => {
  const now = Date.now(),
    status = {
      updatedAt: new Date(now).toISOString(),
      accounts: [
        {
          provider: "claude",
          priority: 100,
          state: "ready",
          usageAt: new Date(now).toISOString(),
          usage: {
            session: { usedPercent: 20, resetsAt: now + 10000 },
            weekly: { usedPercent: 40, resetsAt: now + 20000 },
          },
        },
        {
          provider: "claude",
          priority: -100,
          state: "exhausted",
          usageAt: new Date(now).toISOString(),
          usage: { session: { usedPercent: 100, resetsAt: now + 10000 } },
        },
      ],
    };
  assert.deepEqual(
    usageRecords(status, now)[0].limits.map((x) => x.percent),
    [0.2, 0.4],
  );
  const healthy = usageRecords(status, now)[0];
  assert.equal(healthy.authHelpText, "");
  // Omarchy renders a warning whenever usageStatusText is nonempty.
  assert.equal(healthy.usageStatusText, "");
  assert.equal(healthy.tierLabel, "Switchboard cached limits");
  status.accounts[0].usage.session.resetsAt = now - 1;
  assert.equal(usageRecords(status, now)[0].limits.length, 1);
  status.accounts[0].usageAt = new Date(now - 16 * 60000).toISOString();
  assert.equal(usageRecords(status, now)[0].limits.length, 0);
  assert.equal(usageRecords(undefined, now)[0].retryAdvised, true);
});
test("usage refresh only reads the cached hub and replaces limits with unavailable state after failure", async (t) => {
  const f = await fixture(t),
    url = "https://hub.example.ts.net:8443/status";
  await updateUsage({ ...f.config, switchboardStatusUrl: url }, f.p, [], async (actual) => {
    assert.equal(actual, url);
    throw Error("offline");
  });
  const record = JSON.parse(
    await readFile(join(f.p.state, "omarchy/agents/usage/claude.json"), "utf8"),
  );
  assert.equal(record.usageStatusText, "Switchboard limits unavailable");
  assert.deepEqual(record.limits, []);
  assert.equal(record.hasLocalStats, false);
});

test("the Omarchy dispatcher intercepts AI commands and passes ordinary commands to the native binary", async (t) => {
  const f = await fixture(t),
    { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util");
  const fixtureBin = join(f.home, "fixtures");
  await mkdir(fixtureBin);
  const marker = join(f.home, "omarchy-call.json");
  const fake = join(fixtureBin, "loom-os");
  await writeFile(
    fake,
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
  const shim = aiFiles({ ...f.p, bin: fake }).get(join(aiBin(f.p), "omarchy")).content;
  const path = join(fixtureBin, "omarchy");
  await writeFile(path, shim, { mode: 0o755 });
  await promisify(execFile)("/bin/bash", [
    path,
    "agent",
    "--inline",
    "--prompt",
    "--settings hello",
  ]);
  assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), [
    "agent",
    "--inline",
    "--prompt",
    "--settings hello",
  ]);
  await promisify(execFile)("/bin/bash", [path, "default", "agent", "codex"]);
  assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), ["default-agent", "codex"]);
  await promisify(execFile)("/bin/bash", [path, "agent", "usage-codex", "--limits-only"]);
  assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), [
    "ai-usage-record",
    "codex",
    "--limits-only",
  ]);
  await assert.rejects(
    promisify(execFile)("/bin/bash", [path, "agent", "usage-fireworks"]),
    /Switchboard adapter/,
  );
});

test("disabled provider filters are cumulative and a fully disabled panel makes no hub request", async (t) => {
  const f = await fixture(t);
  await updateUsage(
    { ...f.config, switchboardStatusUrl: "https://hub.test/status" },
    f.p,
    ["--except", "claude", "--except", "codex"],
    async () => assert.fail("disabled panel must not fetch"),
  );
  await assert.rejects(readFile(join(f.p.state, "omarchy/agents/usage/claude.json")), {
    code: "ENOENT",
  });
  await updateUsage(f.config, f.p, ["--except", "claude", "--except", "fireworks"]);
  await assert.rejects(readFile(join(f.p.state, "omarchy/agents/usage/claude.json")), {
    code: "ENOENT",
  });
  assert.equal(
    JSON.parse(await readFile(join(f.p.state, "omarchy/agents/usage/codex.json"), "utf8")).id,
    "codex",
  );
});

test("AI preflight blocks offline routes before launching and a fresh retry retains the literal prompt", async (t) => {
  const f = await fixture(t),
    calls = [];
  let connected = false;
  const options = {
    connections: async (config, env, settings) => {
      assert.equal(config, f.config);
      assert.equal(env, f.env);
      assert.equal(settings.includeServer, false);
      return {
        aiReady: connected,
        components: [
          {
            id: "tailscale",
            title: "Tailscale",
            state: connected ? "ok" : "error",
            detail: connected ? "Connected" : "Disconnected",
            repair: connected ? null : "Open Tailscale.",
          },
        ],
      };
    },
  };
  const run = async (...args) => calls.push(args);
  await assert.rejects(
    aiAction(
      "agent",
      ["--inline", "--prompt", "literal $(prompt)"],
      f.config,
      f.env,
      f.p,
      run,
      options,
    ),
    /Private AI is unavailable.*[\s\S]*Open Tailscale/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    aiAction("ai", ["codex", "--version"], f.config, f.env, f.p, run, options),
    /Private AI is unavailable/,
  );
  assert.equal(calls.length, 0);
  connected = true;
  await aiAction(
    "agent",
    ["--inline", "--prompt", "literal $(prompt)"],
    f.config,
    f.env,
    f.p,
    run,
    options,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["run", "claude", "--", "literal $(prompt)"]);
});

test("Ask AI recovery retries only by explicit choice and retains the original prompt", async (t) => {
  const f = await fixture(t);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const fakeBin = join(f.home, "fake-bin"),
    calls = join(f.home, "calls.jsonl"),
    count = join(f.home, "attempts");
  await mkdir(fakeBin);
  const launcher = join(fakeBin, "loom-os");
  await writeFile(
    launcher,
    `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');const count=${JSON.stringify(count)};let n=fs.existsSync(count)?Number(fs.readFileSync(count,'utf8')):0;fs.writeFileSync(count,String(n+1));process.exit(n===0?1:0);\n`,
    { mode: 0o755 },
  );
  await writeFile(join(fakeBin, "gum"), '#!/bin/sh\nprintf "%s\\n" "Retry Ask AI"\n', {
    mode: 0o755,
  });
  const p = { ...f.p, bin: launcher };
  const script = aiFiles(p).get(join(aiBin(p), "loom-ai-terminal")).content;
  const terminal = join(fakeBin, "terminal.sh");
  await writeFile(terminal, script, { mode: 0o755 });
  await promisify(execFile)("/bin/bash", [terminal, "--prompt", "$(literal prompt)"], {
    env: { ...f.env, PATH: fakeBin + ":" + f.env.PATH },
  });
  assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse), [
    ["agent", "--inline", "--prompt", "$(literal prompt)"],
    ["agent", "--inline", "--prompt", "$(literal prompt)"],
  ]);
  await rm(count);
  await rm(calls);
  await writeFile(join(fakeBin, "gum"), '#!/bin/sh\nprintf "%s\\n" "Close"\n', { mode: 0o755 });
  await assert.rejects(
    promisify(execFile)("/bin/bash", [terminal], {
      env: { ...f.env, PATH: fakeBin + ":" + f.env.PATH },
    }),
  );
  assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse), [
    ["agent", "--inline"],
  ]);
});
