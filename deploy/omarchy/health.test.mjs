import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { collectConnections, collectPrivateConnections, formatConnections } from "./health.mjs";

const test = NodeTest.test,
  assert = NodeAssert;
const config = {
  profile: "workstation",
  officeUrl: "https://office.test",
  atlasUrl: "https://atlas.test",
  switchboardUrl: "http://100.64.0.1:8317",
  switchboardCli: "/private/switchboard",
  switchboardStatusUrl: "https://dorothy.test/status",
  serverExecutable: "/private/t3",
  serverBaseDir: "/private/state",
};
const env = { HOME: "/private/home" };
const now = Date.now();
function freshHubStatus(at = now) {
  return {
    version: 1,
    service: "switchboard",
    kind: "hub-readiness-v1",
    evaluatedAt: new Date(at).toISOString(),
    updatedAt: new Date(at).toISOString(),
    client: "kyle",
    provider: null,
    state: "ready",
    health: { state: "ok", stale: false },
    selected: null,
    models: [
      {
        id: "gpt-6-luna",
        provider: "codex",
        state: "ready",
        creditUse: "none",
        reason: "Applied plan allowance",
        eligibleRoutes: 1,
        resetAt: null,
      },
    ],
    summary: { readyModels: 1, creditModels: 0, unavailableModels: 0, unknownModels: 0 },
  };
}
const readyHub = async () => ({
  state: "ready",
  reachable: true,
  detail: "Applied plan allowance",
  models: [],
});
const clientReport = {
  baseUrl: config.switchboardUrl,
  checks: [
    {
      id: "client-catalog",
      title: "Private model catalog",
      state: "ok",
      detail: "Models are available.",
      repair: null,
    },
  ],
};
async function command(file, args) {
  if (file === config.switchboardCli) return { exit: 0, stdout: JSON.stringify(clientReport) };
  assert.equal(file, "systemctl");
  assert.deepEqual(args, ["--user", "is-active", "t3code.service"]);
  return { exit: 0, stdout: "active\n" };
}
function request(url, options) {
  if (url.includes("/api/v1/readiness")) {
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    return Promise.resolve(Response.json(freshHubStatus()));
  }
  assert.equal(options.redirect, "manual");
  assert.equal(options.method, "GET");
  assert.equal(options.headers, undefined);
  return Promise.resolve(
    url.endsWith("/status")
      ? Response.json({ updatedAt: new Date(now).toISOString(), accounts: [] })
      : new Response(null, { status: 303, headers: { location: "/login" } }),
  );
}
test("connection checks accept app sign-in redirects and delegate credential health to Switchboard", async () => {
  const calls = [];
  const report = await collectConnections(config, env, {
    request,
    command: async (file, args, childEnv) => {
      calls.push([file, args]);
      assert.equal(childEnv, env);
      return command(file, args);
    },
    now,
  });
  assert.deepEqual(report.endpoints, { office: 303, atlas: 303, switchboard: 200 });
  assert.ok(report.diagnostics.every((check) => check.state === "ok"));
  assert.deepEqual(calls[0], [
    config.switchboardCli,
    ["client", "doctor", "--json", "--expected-url", config.switchboardUrl],
  ]);
});
test("failed app responses get useful recovery guidance without exposing response bodies or errors", async () => {
  const report = await collectConnections(config, env, {
    now,
    command,
    request: async (url) => {
      if (url.startsWith(config.officeUrl)) throw new Error("SYNTHETIC_PRIVATE_ERROR");
      return new Response("SYNTHETIC_PRIVATE_BODY", { status: 500 });
    },
  });
  assert.equal(report.endpoints.office, "unreachable");
  assert.equal(report.diagnostics.find((check) => check.id === "office")?.state, "error");
  assert.match(formatConnections(report), /retry/i);
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PRIVATE/);
});
test("stale or malformed cached status is distinct from network failure", async () => {
  for (const status of [
    { updatedAt: new Date(now - 16 * 60_000).toISOString(), accounts: [] },
    { updatedAt: "invalid", accounts: [] },
    { updatedAt: new Date(now + 120_000).toISOString(), accounts: [] },
    { updatedAt: new Date(now).toISOString() },
  ]) {
    const report = await collectConnections(config, env, {
      now,
      command,
      request: async (url) =>
        url.endsWith("/status") ? Response.json(status) : new Response(null, { status: 200 }),
    });
    const cache = report.diagnostics.find((check) => check.id === "switchboard-cache");
    assert.equal(cache?.state, "warning");
    assert.match(cache?.detail, /stale|invalid/i);
  }
});
test("Switchboard errors retain their repairs even with a nonzero command exit", async () => {
  const report = await collectConnections(config, env, {
    now,
    request,
    command: async (file) =>
      file === config.switchboardCli
        ? {
            exit: 1,
            stdout: JSON.stringify({
              baseUrl: config.switchboardUrl,
              checks: [
                {
                  id: "client-tailnet",
                  title: "Tailscale",
                  state: "error",
                  detail: "Disconnected",
                  repair: "Connect to the private network.",
                },
              ],
            }),
          }
        : { exit: 3, stdout: "inactive" },
  });
  assert.equal(
    report.diagnostics.find((check) => check.id === "client-tailnet")?.repair,
    "Connect to the private network.",
  );
  assert.equal(report.diagnostics.find((check) => check.id === "workstation")?.state, "error");
});
test("a laptop never touches workstation service controls and malformed client output is suppressed", async () => {
  const calls = [];
  const report = await collectConnections({ ...config, profile: "laptop" }, env, {
    now,
    request,
    command: async (file, args) => {
      calls.push([file, args]);
      return { exit: 1, stdout: "SYNTHETIC_PRIVATE_OUTPUT" };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], config.switchboardCli);
  assert.equal(
    report.diagnostics.find((check) => check.id === "switchboard-client")?.state,
    "error",
  );
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PRIVATE/);
  assert.ok(!report.diagnostics.some((check) => check.id === "workstation"));
});

test("doctor CLI preserves JSON and human reports, returns failure for broken routes and writes no state", async (t) => {
  const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const home = await mkdtemp(join(tmpdir(), "loom-health-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    if (req.url === "/status") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ updatedAt: new Date().toISOString(), accounts: [] }));
    } else if (req.url.startsWith("/api/v1/readiness")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(freshHubStatus(Date.now())));
    } else {
      res.writeHead(303, { location: "/login" });
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fake = join(home, "switchboard.mjs");
  await writeFile(
    fake,
    `#!${process.execPath}\nconst broken=process.env.LOOM_HEALTH_TEST_BROKEN==='1';console.log(JSON.stringify({checks:[{id:'client-tailnet',title:'Tailscale',state:broken?'error':'ok',detail:broken?'Disconnected':'Connected',repair:broken?'Connect to your private network.':null}]}));process.exitCode=broken?1:0;\n`,
    { mode: 0o755 },
  );
  const folder = join(home, ".config/loom-os");
  await mkdir(folder, { recursive: true });
  const cfg = JSON.stringify({
    version: 1,
    profile: "laptop",
    officeUrl: origin,
    loomExecutable: process.execPath,
    browserExecutable: process.execPath,
    switchboardUrl: origin,
    switchboardCli: fake,
    switchboardStatusUrl: origin + "/status",
  });
  await writeFile(join(folder, "config.json"), cfg);
  const cli = fileURLToPath(new URL("./loom-os.mjs", import.meta.url));
  const run = (args, broken = false) =>
    new Promise((resolve) =>
      execFile(
        process.execPath,
        [cli, "doctor", ...args],
        {
          env: { HOME: home, PATH: process.env.PATH, LOOM_HEALTH_TEST_BROKEN: broken ? "1" : "0" },
        },
        (error, stdout, stderr) => resolve({ exit: error?.code ?? 0, stdout, stderr }),
      ),
    );
  const healthy = await run([]);
  assert.equal(healthy.exit, 0, healthy.stderr);
  assert.equal(JSON.parse(healthy.stdout).summary.errors, 0);
  const broken = await run(["--human"], true);
  assert.equal(broken.exit, 1);
  assert.match(broken.stdout, /Disconnected/);
  assert.match(broken.stdout, /Connect to your private network/);
  assert.equal(await readFile(join(folder, "config.json"), "utf8"), cfg);
  assert.deepEqual((await readdir(home)).sort(), [".config", "switchboard.mjs"]);
});

const healthyClientChecks = [
  { id: "client-endpoint", title: "Gateway", state: "ok", detail: "Configured", repair: null },
  { id: "client-tailnet", title: "Tailscale", state: "ok", detail: "Connected", repair: null },
  { id: "client-credential", title: "Credential", state: "ok", detail: "Available", repair: null },
  { id: "client-catalog", title: "Models", state: "ok", detail: "33 models", repair: null },
];
test("private connection status requires a usable catalog and checks the running Loom server", async () => {
  const urls = [],
    calls = [];
  const report = await collectPrivateConnections(
    { ...config, serverHost: "0.0.0.0", serverPort: 3774 },
    env,
    {
      now,
      command: async (file, args) => {
        calls.push([file, args]);
        return file === config.switchboardCli
          ? { exit: 0, stdout: JSON.stringify({ checks: healthyClientChecks }) }
          : { exit: 0, stdout: "active\n" };
      },
      request: async (url, options) => {
        urls.push(url);
        if (url.includes("/api/v1/readiness")) {
          assert.equal(options.redirect, "error");
          return Response.json(freshHubStatus());
        }
        assert.equal(options.redirect, "manual");
        return new Response(null, { status: 401 });
      },
    },
  );
  assert.equal(report.aiReady, true);
  assert.equal(report.state, "ok");
  assert.deepEqual(
    report.components.map((c) => [c.id, c.state]),
    [
      ["tailscale", "ok"],
      ["switchboard", "ok"],
      ["loom", "ok"],
    ],
  );
  assert.deepEqual(
    urls.sort(),
    ["http://127.0.0.1:3774/", "https://dorothy.test/api/v1/readiness?client=kyle"].sort(),
  );
  assert.ok(
    calls.every(
      ([, args]) => !args.some((arg) => ["run", "restart", "install", "up"].includes(arg)),
    ),
  );
});
test("private status recovers after an unavailable hub without restarting an agent or service", async () => {
  let connected = false;
  const deps = {
    now,
    includeServer: false,
    hub: readyHub,
    command: async () => ({
      exit: connected ? 0 : 1,
      stdout: JSON.stringify({
        checks: connected
          ? healthyClientChecks
          : [
              {
                id: "client-tailnet",
                title: "Tailscale",
                state: "error",
                detail: "Disconnected",
                repair: "Connect to your private network.",
              },
            ],
      }),
    }),
    request: async () => assert.fail("AI-only preflight makes no app/server requests"),
  };
  const offline = await collectPrivateConnections(config, env, deps);
  assert.equal(offline.aiReady, false);
  assert.equal(offline.state, "offline");
  assert.equal(offline.components.find((c) => c.id === "tailscale").state, "error");
  connected = true;
  const recovered = await collectPrivateConnections(config, env, deps);
  assert.equal(recovered.aiReady, true);
  assert.equal(recovered.state, "ok");
});
test("no visible models, unreadable diagnostics and endpoint errors never report AI ready", async () => {
  for (const checks of [
    healthyClientChecks.map((c) =>
      c.id === "client-catalog" ? { ...c, state: "warning", detail: "No models" } : c,
    ),
    [
      {
        id: "client-endpoint",
        title: "Gateway",
        state: "error",
        detail: "Endpoint mismatch",
        repair: "Restore the commissioned origin.",
      },
    ],
    [
      {
        id: "client-catalog",
        title: "Models",
        state: "ok",
        detail: "SYNTHETIC_PRIVATE\nOUTPUT",
        repair: null,
      },
    ],
  ]) {
    const report = await collectPrivateConnections(config, env, {
      includeServer: false,
      hub: readyHub,
      now,
      command: async () => ({ exit: 1, stdout: JSON.stringify({ checks }) }),
    });
    assert.equal(report.aiReady, false);
    assert.notEqual(report.state, "ok");
    assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PRIVATE/);
  }
});
test("laptop private status omits background service and a stopped workstation service is distinct from AI health", async () => {
  for (const profile of ["laptop", "workstation"]) {
    const report = await collectPrivateConnections({ ...config, profile }, env, {
      now,
      hub: readyHub,
      command: async (file) =>
        file === config.switchboardCli
          ? { exit: 0, stdout: JSON.stringify({ checks: healthyClientChecks }) }
          : { exit: 3, stdout: "inactive" },
      request: async () => assert.fail("stopped or absent server must not be probed"),
    });
    assert.equal(report.aiReady, true);
    assert.equal(
      report.components.some((c) => c.id === "loom"),
      profile === "workstation",
    );
    assert.equal(report.state, profile === "workstation" ? "attention" : "ok");
  }
});
