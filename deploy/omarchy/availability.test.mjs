import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  appAvailability,
  collectAvailability,
  nativeAvailability,
  declarationMaxAgeMs,
  formatAvailability,
} from "./availability.mjs";
import { validateAppIntegration } from "./loom-os.mjs";
const test = NodeTest.test,
  assert = NodeAssert;
const now = Date.parse("2026-10-12T20:00:00Z");
const config = {
  officeUrl: "https://office.test",
  atlasUrl: "https://atlas.test",
  officeCli: "/office",
  atlasCli: "/atlas",
};
const unavailable = { version: 1, supported: false, reason: "Owned by the app, not exposed." };
function manifest(app) {
  return validateAppIntegration(
    {
      format: "loom-app-integration",
      version: { major: 1, minor: 2 },
      app,
      name: app,
      actions: [],
      capabilities: {
        launch: { version: 1, supported: true, path: "/app/" },
        search: {
          version: 1,
          supported: true,
          format: app === "office" ? "office-search-v1" : "atlas-workspace-search-v1",
          queryLimit: 200,
          queryUnit: "characters",
          operation: {
            id: app === "office" ? "office.search" : "atlas.workspace.search",
            method: "GET",
            path: `/api/${app}/search`,
            command: [app, app === "office" ? "search" : "workspace-search"],
            scopes: [app + ":read"],
            surfaces: ["api", "cli"],
            effect: "read",
            mutation: "read-only",
            approval: "none",
          },
        },
        capture: unavailable,
        links: unavailable,
        notifications: unavailable,
        availability: unavailable,
      },
      offline: {
        savedReading: app === "office",
        supportedWriting: app === "office",
        requiresPriorUse: app === "office",
        detail: "Build support; device data is unconfirmed.",
      },
    },
    app,
  );
}
const privateReady = () => ({
  state: "ok",
  aiReady: true,
  components: ["tailscale", "switchboard", "loom"].map((id) => ({
    id,
    title: id,
    state: "ok",
    detail: "Ready",
  })),
});
const probe = async (app) => ({
  step: { state: "connected" },
  declaration: { state: "available", manifest: manifest(app) },
});
async function fixture(t) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-availability-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  return {
    root,
    env: { HOME: root },
    deps: { now, probe, privateReport: async () => privateReady() },
  };
}

test("uses producer support without inventing cached data, pending zero or broader permissions", async (t) => {
  const f = await fixture(t);
  const report = await collectAvailability(config, f.env, f.deps);
  assert.equal(report.state, "ok");
  assert.equal(report.aiReady, true);
  assert.equal(report.apps[0].reading.state, "conditional");
  assert.equal(report.apps[0].writing.state, "conditional");
  assert.equal(report.apps[1].reading.state, "unsupported");
  assert.equal(report.apps[1].writing.state, "unsupported");
  assert.ok(
    report.apps.every((app) => app.pendingCount === null && app.pending.state === "unknown"),
  );
  assert.match(formatAvailability(report), /Unknown pending changes does not mean zero/);
});

test("disconnection retains only origin-bound declarations; reconnect replaces them with current support", async (t) => {
  const f = await fixture(t);
  await collectAvailability(config, f.env, f.deps);
  const disconnected = {
    ...f.deps,
    probe: async () => ({ step: { state: "unavailable" }, declaration: { state: "unavailable" } }),
    privateReport: async () => ({
      aiReady: false,
      components: [
        { id: "tailscale", title: "Network", state: "error", detail: "Disconnected" },
        { id: "switchboard", title: "AI", state: "error", detail: "Unavailable" },
      ],
    }),
  };
  const offline = await collectAvailability(config, f.env, disconnected);
  assert.equal(offline.state, "offline");
  assert.equal(offline.apps[0].declaration, "retained");
  assert.equal(offline.apps[0].reading.state, "conditional");
  assert.equal(offline.apps[0].search.state, "unavailable");
  const moved = await collectAvailability(
    { ...config, officeUrl: "https://other.test" },
    f.env,
    disconnected,
  );
  assert.equal(moved.apps[0].declaration, "unknown");
  assert.equal(moved.apps[0].reading.state, "unknown");
  const reconnected = await collectAvailability(config, f.env, {
    ...f.deps,
    now: now + 1000,
    probe: async (app) => ({
      ...(await probe(app)),
      declaration: {
        state: "available",
        manifest: {
          ...manifest(app),
          offline: { ...manifest(app).offline, savedReading: false, supportedWriting: false },
        },
      },
    }),
  });
  assert.equal(reconnected.state, "ok");
  assert.equal(reconnected.apps[0].reading.state, "unsupported");
});

test("stale, future, malformed and symlinked retained metadata cannot promise offline support", async (t) => {
  const f = await fixture(t);
  await collectAvailability(config, f.env, f.deps);
  const offline = {
    ...f.deps,
    probe: async () => ({ step: { state: "unavailable" }, declaration: { state: "unavailable" } }),
  };
  for (const age of [declarationMaxAgeMs + 1, -60001]) {
    const report = await collectAvailability(config, f.env, { ...offline, now: now + age });
    assert.ok(report.apps.every((app) => app.reading.state === "unknown"));
  }
  const directory = NodePath.join(f.root, ".local/state/loom-os/capabilities");
  const files = (await NodeFSP.readdir(directory)).filter((file) => file.endsWith(".json"));
  await NodeFSP.writeFile(NodePath.join(directory, files[0]), "{}");
  const other = NodePath.join(directory, files[1]);
  const content = await NodeFSP.readFile(other);
  await NodeFSP.unlink(other);
  await NodeFSP.writeFile(other + ".elsewhere", content);
  await NodeFSP.symlink(other + ".elsewhere", other);
  const report = await collectAvailability(config, f.env, offline);
  assert.ok(report.apps.every((app) => app.declaration === "unknown"));
});

test("partial and revoked CLI access leave offline support distinct from live search", async (t) => {
  const f = await fixture(t);
  const report = await collectAvailability(config, f.env, {
    ...f.deps,
    probe: async (app) => ({
      ...(await probe(app)),
      step: { state: app === "office" ? "approval-needed" : "connected" },
    }),
  });
  assert.equal(report.state, "attention");
  assert.equal(report.apps[0].search.state, "approval-needed");
  assert.equal(report.apps[0].reading.state, "conditional");
  assert.equal(report.apps[1].search.state, "available");
  assert.equal(report.aiReady, true);
  const aiOutage = await collectAvailability(config, f.env, {
    ...f.deps,
    privateReport: async () => ({
      ...privateReady(),
      aiReady: false,
      components: privateReady().components.map((part) => ({
        ...part,
        state: part.id === "switchboard" ? "error" : "ok",
      })),
    }),
  });
  assert.equal(aiOutage.state, "attention");
  assert.equal(aiOutage.apps[0].search.state, "available");
});

test("supported search still requires both a live declaration and connected CLI", () => {
  const app = appAvailability(
    "office",
    { step: { state: "connected" }, declaration: { state: "unavailable" } },
    manifest("office"),
  );
  assert.equal(app.search.state, "unavailable");
  assert.equal(app.pendingCount, null);
  assert.equal(app.declaration, "retained");
});

test("recovery dispatches only explicit existing actions, never replay, restart or inference", async (t) => {
  const f = await fixture(t);
  const report = await collectAvailability(config, f.env, f.deps);
  const choices = [
    "Check again",
    "Open Office",
    "Set up connections",
    "Loom service status",
    "Close",
  ];
  let checks = 0;
  const calls = [];
  await nativeAvailability(config, f.env, {
    collect: async () => {
      checks++;
      return report;
    },
    show: () => {},
    choose: async () => choices.shift(),
    dispatch: async (args) => calls.push(args),
  });
  assert.equal(checks, 5);
  assert.deepEqual(calls, [
    ["open", "office"],
    ["setup", "--inline"],
    ["service", "status"],
  ]);
});
