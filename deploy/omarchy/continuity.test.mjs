import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  workstationOrigin,
  inspectWorkstation,
  readTarget,
  saveTarget,
  forgetTarget,
  verifyTarget,
  threadLink,
  nativeHandoff,
  continuityStatus,
  nativeContinuity,
  setPowerMode,
  powerStatus,
} from "./continuity.mjs";
const test = NodeTest.test,
  assert = NodeAssert;
const origin = "https://workstation.example.ts.net";
const descriptor = {
  environmentId: "host-1",
  label: "Workstation",
  serverVersion: "0.0.45",
  capabilities: {},
};
const request = async (_, options) => {
  assert.equal(options.method, "GET");
  assert.equal(options.headers, undefined);
  assert.equal(options.redirect, "error");
  return Response.json(descriptor);
};
const config = { profile: "laptop" };
async function fixture(t) {
  const home = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-continuity-")),
  );
  t.after(() => NodeFSP.rm(home, { recursive: true, force: true }));
  const env = { HOME: home };
  return { home, env };
}
test("workstation targets accept only credential-free private HTTPS origins", () => {
  assert.equal(workstationOrigin(origin + "/"), origin);
  for (const value of [
    "https://example.com",
    "http://workstation.example.ts.net",
    origin + "/pair?token=secret",
    origin + "/?credential=secret",
    "https://user:secret@workstation.example.ts.net",
    "http://127.0.0.1:3774",
    origin + "#secret",
  ])
    assert.throws(() => workstationOrigin(value));
});
test("review pins identity, retains no grant and forget delegates revocation to the owner", async (t) => {
  const f = await fixture(t);
  await assert.rejects(saveTarget(origin, "wrong", f.env, { request }), /identity changed/);
  assert.equal(await readTarget(f.env), null);
  const saved = await saveTarget(origin, descriptor.environmentId, f.env, { request });
  assert.deepEqual(Object.keys(saved), ["version", "origin", "environmentId", "label"]);
  assert.equal((await verifyTarget(f.env, { request })).environmentId, "host-1");
  await assert.rejects(forgetTarget(f.env, "wrong"), /changed/);
  const result = await forgetTarget(f.env, "host-1");
  assert.equal(result.grantsRevoked, false);
  assert.equal(await readTarget(f.env), null);
});
test("a replaced host and outages refuse open/handoff without fallback or saved-identity replacement", async (t) => {
  const f = await fixture(t);
  await saveTarget(origin, "host-1", f.env, { request });
  const changed = {
    request: async () => Response.json({ ...descriptor, environmentId: "host-2" }),
  };
  await assert.rejects(verifyTarget(f.env, changed), /different Loom environment/);
  await assert.rejects(saveTarget(origin, "host-2", f.env, changed), /identity changed/);
  await assert.rejects(
    verifyTarget(f.env, {
      request: async () => {
        throw Error("offline");
      },
    }),
    /offline/,
  );
  assert.equal((await readTarget(f.env)).environmentId, "host-1");
});
test("malformed, oversized or refused metadata cannot commission a host", async () => {
  for (const response of [
    Response.json({}),
    Response.json({ ...descriptor, label: "bad\nlabel" }),
    Response.json(descriptor, { status: 403 }),
    new Response("x".repeat(65 * 1024), { headers: { "content-type": "application/json" } }),
  ])
    await assert.rejects(inspectWorkstation(origin, { request: async () => response }));
});
test("continuity settings preserve symbolic links and refuse public files", async (t) => {
  const f = await fixture(t);
  const directory = NodePath.join(f.home, ".config/loom-os");
  await NodeFSP.mkdir(directory, { recursive: true });
  const file = NodePath.join(directory, "continuity.json");
  await NodeFSP.symlink("elsewhere", file);
  await assert.rejects(readTarget(f.env), /symbolic link/);
  await NodeFSP.unlink(file);
  await NodeFSP.writeFile(
    file,
    JSON.stringify({ version: 1, origin, environmentId: "host-1", label: "Workstation" }),
    { mode: 0o644 },
  );
  await assert.rejects(readTarget(f.env), /private file/);
});
test("exact thread handoff binds to its existing owning environment and grants nothing", () => {
  const target = { version: 1, origin, environmentId: "host-1", label: "Workstation" };
  assert.equal(
    threadLink(target, { type: "loom-thread", environmentId: "host-1", threadId: "thread:1" }),
    origin + "/host-1/thread%3A1",
  );
  for (const destination of [
    { type: "loom-thread", environmentId: "host-2", threadId: "thread-1" },
    { type: "loom-thread", environmentId: "host-1", threadId: "../other" },
  ])
    assert.throws(() => threadLink(target, destination));
});
test("native handoff is cancel-first and copies only the reviewed canonical link over stdin", async (t) => {
  const f = await fixture(t);
  await saveTarget(origin, "host-1", f.env, { request });
  const calls = [],
    destination = { type: "loom-thread", environmentId: "host-1", threadId: "thread-1" };
  for (const choice of ["Keep on this device", "Copy reviewed link"]) {
    const result = await nativeHandoff("loom", destination, config, f.env, {
      request,
      show: () => {},
      choose: async () => choice,
      command: async (...args) => {
        calls.push(args);
        return { exit: 0, stdout: "" };
      },
    });
    assert.equal(result.state, choice === "Copy reviewed link" ? "copied" : "cancelled");
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "wl-copy");
  assert.equal(calls[0][3], origin + "/host-1/thread-1");
});
test("unsupported power tools and laptop reporting do not install, start or mutate services", async (t) => {
  const f = await fixture(t),
    calls = [];
  const deps = {
    connections: async () => ({ state: "offline", aiReady: false }),
    command: async (file, args) => {
      calls.push([file, args]);
      return { exit: null, stdout: "" };
    },
  };
  const report = await continuityStatus(config, f.env, deps);
  assert.equal(report.power.supported, false);
  assert.equal(report.remote.state, "not-configured");
  assert.match(report.hosting, /no background Loom host/);
  assert.deepEqual(calls, [
    ["powerprofilesctl", ["get"]],
    ["powerprofilesctl", ["list"]],
  ]);
});
test("power changes are bounded to advertised modes, reviewed state and an unlocked session", async () => {
  let current = "balanced",
    locked = false;
  const mutations = [];
  const command = async (file, args) => {
    if (file === "omarchy-hyprland-session-locked") return { exit: locked ? 0 : 1, stdout: "" };
    if (args[0] === "get") return { exit: 0, stdout: current + "\n" };
    if (args[0] === "list")
      return { exit: 0, stdout: "* balanced:\n    Driver: platform_profile\n  power-saver:\n" };
    mutations.push(args);
    current = args[1];
    return { exit: 0, stdout: "" };
  };
  assert.equal((await powerStatus({}, { command })).supported, true);
  await assert.rejects(setPowerMode("performance", "balanced", {}, { command }), /unsupported/);
  await assert.rejects(setPowerMode("power-saver", "performance", {}, { command }), /changed/);
  locked = true;
  await assert.rejects(setPowerMode("power-saver", "balanced", {}, { command }), /Unlock/);
  assert.equal(mutations.length, 0);
  locked = false;
  assert.equal(
    (await setPowerMode("power-saver", "balanced", {}, { command })).current,
    "power-saver",
  );
  assert.deepEqual(mutations, [["set", "power-saver"]]);
});
test("native laptop controls omit workstation pairing and never replay work after refresh", async (t) => {
  const f = await fixture(t),
    choices = ["Refresh after reconnect", "Close"],
    dispatches = [],
    commands = [];
  await nativeContinuity(config, f.env, {
    status: async () => ({
      profile: "laptop",
      target: null,
      remote: { state: "not-configured" },
      power: { supported: false },
      hosting: "No background hosting",
      caveat: "No replay",
    }),
    choose: async (_, items) => {
      assert.ok(!items.some((item) => item.startsWith("Pair")));
      return choices.shift();
    },
    show: () => {},
    dispatch: async (args) => dispatches.push(args),
    command: async (...args) => {
      commands.push(args);
    },
  });
  assert.deepEqual(dispatches, []);
  assert.deepEqual(commands, []);
});

test("app handoff copies a canonical string and preserves owner permission refusal", async (t) => {
  const f = await fixture(t),
    reference = { kind: "note", id: "saved-note" },
    copies = [];
  const config = { officeUrl: "https://office.test", officeCli: "/fixture/office" };
  const deps = {
    discover: async () => ({
      state: "available",
      manifest: {
        capabilities: {
          links: { supported: true, operation: { command: ["office", "items-resolve"] } },
        },
      },
    }),
    resolve: async () => ({
      items: [{ reference, canonicalURL: "/app/?item=note&id=saved-note", status: "live" }],
    }),
    choose: async () => "Copy reviewed link",
    show: () => {},
    command: async (_, __, ___, input) => {
      assert.equal(typeof input, "string");
      copies.push(input);
      return { exit: 0, stdout: "" };
    },
  };
  await nativeHandoff("office", reference, config, f.env, deps);
  assert.deepEqual(copies, ["https://office.test/app/?item=note&id=saved-note"]);
  await assert.rejects(
    nativeHandoff("office", reference, config, f.env, {
      ...deps,
      resolve: async () => {
        throw Error("Owner permission refused");
      },
    }),
    /permission refused/,
  );
  assert.equal(copies.length, 1);
});
