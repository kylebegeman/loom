import * as NodeTest from "node:test";
const test = NodeTest.test;
import * as NodeAssert from "node:assert/strict";
import {
  guidedConnectionReport,
  nativeGuidedConnections,
  connectionCommand,
} from "./connections.mjs";
import { validateAppIntegration } from "./loom-os.mjs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const config = {
  officeUrl: "https://office.test",
  atlasUrl: "https://atlas.test",
  officeCli: "/office",
  atlasCli: "/atlas",
  switchboardUrl: "http://100.64.0.1:8317",
  switchboardCli: "/switchboard",
};
const check = (id, state = "ok") => ({ id, state, detail: "Owner check", repair: null });
const healthy = {
  diagnostics: [
    check("client-tailnet"),
    check("client-endpoint"),
    check("client-credential"),
    check("client-catalog"),
  ],
};
function manifest(app) {
  const unsupported = { version: 1, supported: false, reason: "Not needed by this fixture." };
  return {
    format: "loom-app-integration",
    version: { major: 1, minor: 0 },
    app,
    name: app,
    actions: [{ id: "open", label: "Open", capability: "launch" }],
    capabilities: {
      launch: { version: 1, supported: true, path: "/app/" },
      search: unsupported,
      capture: unsupported,
      links: unsupported,
      notifications: unsupported,
      availability: unsupported,
    },
    offline: {
      savedReading: false,
      supportedWriting: false,
      requiresPriorUse: false,
      detail: "No offline claims.",
    },
  };
}
const dependencies = {
  health: async () => healthy,
  discover: async (app) => ({ state: "available", manifest: manifest(app) }),
  appEnvironment: async (_app, _origin, env) => env,
  command: async (_file, args) => ({ exit: 0, stdout: JSON.stringify(manifest(args[0])) }),
};
const report = (states = {}) => ({
  ready: false,
  steps: ["tailscale", "switchboard", "office", "atlas"].map((id) => ({
    id,
    title: id,
    state: states[id] ?? "connected",
    detail: "Owner state",
  })),
});

test("reports existing owner sessions without credentials, browser probing or repeated approvals", async () => {
  for (const app of ["office", "atlas"]) validateAppIntegration(manifest(app), app);
  const result = await guidedConnectionReport(config, {}, dependencies);
  NodeAssert.equal(result.ready, true);
  NodeAssert.ok(result.steps.every((step) => step.state === "connected"));
  NodeAssert.deepEqual(
    result.steps.map((step) => step.id),
    ["tailscale", "switchboard", "office", "atlas"],
  );
});

test("revoked/denied access differs from outages, invalid output and missing configuration", async () => {
  for (const [exit, stdout, expected] of [
    [3, "private rejected detail", "approval-needed"],
    [4, "private approval payload", "approval-needed"],
    [1, "private failure", "unavailable"],
    [0, "invalid secret output", "unavailable"],
  ]) {
    const result = await guidedConnectionReport(
      config,
      {},
      { ...dependencies, command: async () => ({ exit, stdout }) },
    );
    NodeAssert.equal(result.steps[2].state, expected);
    NodeAssert.ok(!JSON.stringify(result).includes(stdout));
  }
  const unavailable = await guidedConnectionReport(
    { ...config, atlasCli: undefined },
    {},
    { ...dependencies, discover: async () => ({ state: "unavailable" }) },
  );
  NodeAssert.equal(unavailable.steps[2].state, "unavailable");
  NodeAssert.equal(unavailable.steps[3].state, "setup-needed");
});

test("secret store failure preserves app device authorization and network checks survive endpoint mismatch", async () => {
  const result = await guidedConnectionReport(
    config,
    {},
    {
      ...dependencies,
      health: async () => ({
        diagnostics: [check("client-endpoint", "error"), check("client-credential", "error")],
      }),
      command: async (file, args) =>
        file === "tailscale"
          ? { exit: 0, stdout: JSON.stringify({ BackendState: "Running", Self: { Online: true } }) }
          : dependencies.command(file, args),
    },
  );
  NodeAssert.equal(result.steps[0].state, "connected");
  NodeAssert.equal(result.steps[1].state, "setup-needed");
  NodeAssert.equal(result.steps[2].state, "connected");
  const locked = await guidedConnectionReport(
    config,
    {},
    {
      ...dependencies,
      health: async () => ({
        diagnostics: [check("client-tailnet"), check("client-credential", "error")],
      }),
    },
  );
  NodeAssert.equal(locked.steps[1].state, "approval-needed");
  NodeAssert.match(locked.steps[1].detail, /Unlock/);
});

test("cancellation and reopening resume from owner sessions; expired approval retries only its app", async () => {
  const states = { office: "approval-needed", atlas: "approval-needed" };
  let attempts = 0;
  const choices = ["Continue setup", "Sign in to CLI", "Continue setup", "Sign in to CLI", "Close"];
  const shown = [];
  const options = {
    report: async () => report(states),
    show: (text) => shown.push(text),
    choose: async (_header, values) => {
      const value = choices.shift();
      NodeAssert.ok(values.includes(value));
      return value;
    },
    login: async (app) => {
      NodeAssert.equal(app, "office");
      if (++attempts === 1) throw Error("expired_token");
      states.office = "connected";
    },
  };
  await nativeGuidedConnections(config, {}, options);
  NodeAssert.equal(attempts, 2);
  NodeAssert.ok(shown.some((text) => text.includes("expired")));
  const next = ["Continue setup", "Sign in to CLI", "Close"];
  await nativeGuidedConnections(
    config,
    {},
    {
      ...options,
      choose: async (_h, values) => {
        const value = next.shift();
        NodeAssert.ok(values.includes(value));
        return value;
      },
      login: async (app) => {
        NodeAssert.equal(app, "atlas");
        states.atlas = "connected";
      },
    },
  );
  NodeAssert.deepEqual(states, { office: "connected", atlas: "connected" });
});

test("connected app offers management without login; disconnect requires explicit confirmation", async () => {
  const choices = ["office · connected", "Disconnect CLI access", "Keep connected", "Close"];
  const calls = [];
  await nativeGuidedConnections(
    config,
    {},
    {
      report: async () => report(),
      show: () => {},
      choose: async (header, values) => {
        if (header.startsWith("Office:")) NodeAssert.ok(!values.includes("Sign in to CLI"));
        return choices.shift();
      },
      command: async (...args) => calls.push(args),
      secret: async (...args) => calls.push(args),
      login: async () => NodeAssert.fail("Existing authorization must not repeat"),
    },
  );
  NodeAssert.deepEqual(calls, []);
  const confirmed = ["office · connected", "Disconnect CLI access", "Disconnect CLI", "Close"];
  await nativeGuidedConnections(
    config,
    { API_TOKEN: "ambient-secret" },
    {
      report: async () => report(),
      show: () => {},
      choose: async () => confirmed.shift(),
      command: async (file, args, env) => {
        NodeAssert.equal(env.API_TOKEN, undefined);
        calls.push([file, args]);
        return { exit: 0 };
      },
      secret: async (...args) => calls.push(args.slice(0, 3)),
    },
  );
  NodeAssert.deepEqual(calls, [
    ["/office", ["logout"]],
    ["clear", "office", config.officeUrl],
  ]);
});

test("AI import stays on stdin, requires confirmation and offers secret-store recovery without replacing access", async () => {
  const key = "a".repeat(64);
  const choices = [
    "Continue setup",
    "Retry after unlocking secret store",
    "Continue setup",
    "Import personal client key",
    "Enter client key",
    "Close",
  ];
  const output = [],
    calls = [];
  await nativeGuidedConnections(
    config,
    {},
    {
      report: async () => report({ switchboard: "approval-needed" }),
      show: (text) => output.push(text),
      choose: async (_header, values) => {
        const next = choices.shift();
        NodeAssert.ok(values.includes(next));
        return next;
      },
      password: async () => key,
      command: async (file, args, env, input) => {
        calls.push([file, args]);
        NodeAssert.equal(input, key);
        return { exit: 1, stdout: key };
      },
    },
  );
  NodeAssert.deepEqual(calls, [["/switchboard", ["client", "import-key"]]]);
  NodeAssert.ok(!JSON.stringify(output).includes(key));
  NodeAssert.ok(output.some((text) => text.includes("Unlock Secret Service")));
});

test("bounded subprocess wrapper withholds stderr and passes secrets over stdin", async (t) => {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-connect-"));
  t.after(() => NodeFSP.rm(dir, { recursive: true, force: true }));
  const script = NodePath.join(dir, "command.mjs");
  await NodeFSP.writeFile(
    script,
    "let input=''; for await(const chunk of process.stdin) input+=chunk; console.error(input); console.log('done');",
  );
  NodeAssert.deepEqual(
    await connectionCommand(process.execPath, [script], process.env, "fixture-private-key"),
    { exit: 0, stdout: "done\n" },
  );
});
