import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import { collectHubStatus, validateHubStatus, nativeHub } from "./hub.mjs";
import { collectPrivateConnections } from "./health.mjs";
const test = NodeTest.test,
  assert = NodeAssert;
const now = Date.now();
const config = {
  switchboardDashboardUrl: "https://dorothy.test:8443",
  switchboardStatusUrl: "https://dorothy.test:8443/status",
  switchboardUrl: "http://100.64.0.1:8317",
  switchboardCli: "/private/switchboard",
  profile: "laptop",
};
const model = {
  id: "gpt-6-luna",
  provider: "codex",
  state: "ready",
  creditUse: "none",
  reason: "Applied plan allowance",
  eligibleRoutes: 1,
  resetAt: null,
};
function status(overrides = {}) {
  return {
    version: 1,
    service: "switchboard",
    kind: "hub-readiness-v1",
    evaluatedAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    client: "kyle",
    provider: null,
    state: "ready",
    health: { state: "ok", stale: false },
    selected: null,
    models: [model],
    summary: { readyModels: 1, creditModels: 0, unavailableModels: 0, unknownModels: 0 },
    ...overrides,
  };
}
test("the hub consumes one central read with no credential, inference or provider usage request", async () => {
  const calls = [];
  const report = await collectHubStatus(
    config,
    {},
    {
      now,
      request: async (url, options) => {
        calls.push(url);
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers, undefined);
        return Response.json(status());
      },
    },
  );
  assert.deepEqual(calls, [config.switchboardDashboardUrl + "/api/v1/readiness?client=kyle"]);
  assert.equal(report.state, "ready");
  assert.equal(report.summary.readyModels, 1);
});
test("invalid, stale and contradictory model readiness never becomes ready", async () => {
  for (const value of [
    status({ evaluatedAt: new Date(now - 60_000).toISOString() }),
    status({ health: { state: "ok", stale: true } }),
    status({
      summary: { readyModels: 2, creditModels: 0, unavailableModels: 0, unknownModels: 0 },
    }),
    status({ models: [{ ...model, eligibleRoutes: 0 }] }),
    status({ models: [{ ...model, reason: "bad\ntext" }] }),
  ]) {
    assert.throws(() => validateHubStatus(value, now));
    const report = await collectHubStatus(
      config,
      {},
      { now, request: async () => Response.json(value) },
    );
    assert.equal(report.reachable, false);
    assert.match(report.detail, /Sleep is not confirmed/);
  }
});
test("a valid catalog with exhausted or disallowed accounts is attention, not AI readiness", async () => {
  const blocked = status({
    state: "unavailable",
    models: [
      {
        ...model,
        state: "unavailable",
        eligibleRoutes: 0,
        reason: "Client request budget exhausted",
      },
    ],
    summary: { readyModels: 0, creditModels: 0, unavailableModels: 1, unknownModels: 0 },
  });
  const report = await collectPrivateConnections(
    config,
    {},
    {
      now,
      command: async () => ({
        exit: 0,
        stdout: JSON.stringify({
          checks: [
            {
              id: "client-tailnet",
              title: "Network",
              state: "ok",
              detail: "Connected",
              repair: null,
            },
            {
              id: "client-catalog",
              title: "Catalog",
              state: "ok",
              detail: "Models visible",
              repair: null,
            },
          ],
        }),
      }),
      request: async () => Response.json(blocked),
    },
  );
  assert.equal(report.aiReady, false);
  assert.equal(report.state, "attention");
  assert.equal(report.components.find((c) => c.id === "switchboard").state, "warning");
});
test("selected models and provider restrictions are validated and never replaced", async () => {
  const selected = status({
    provider: "codex",
    selected: {
      version: 1,
      client: "kyle",
      provider: "codex",
      model: model.id,
      state: "ready",
      creditUse: "none",
      reason: "Applied",
    },
  });
  const urls = [];
  const report = await collectHubStatus(
    config,
    {},
    {
      now,
      provider: "codex",
      model: model.id,
      request: async (url) => {
        urls.push(url);
        return Response.json(selected);
      },
    },
  );
  assert.equal(report.selected.model, model.id);
  assert.match(urls[0], /provider=codex&model=gpt-6-luna/);
  assert.throws(() =>
    validateHubStatus(selected, now, { provider: "codex", model: "gpt-6-astra" }),
  );
  for (const changes of [
    { reason: "bad\nreason" },
    { client: "office" },
    { creditUse: "required" },
    { provider: "claude" },
  ])
    assert.throws(() =>
      validateHubStatus({ ...selected, selected: { ...selected.selected, ...changes } }, now, {
        provider: "codex",
        model: model.id,
      }),
    );
  assert.throws(() =>
    validateHubStatus(
      status({ client: "office", models: [{ ...model, provider: "claude" }] }),
      now,
      { client: "office" },
    ),
  );
});
test("wake is cancel-first and absent unless the Switchboard owner advertises a reviewed capability", async () => {
  for (const supported of [true, false]) {
    const commands = [],
      choices = [
        supported ? "Wake dorothy on the local network" : "Close",
        "Keep current state",
        "Close",
      ];
    await nativeHub(
      config,
      {},
      {
        collect: async () => validateHubStatus(status(), now),
        recovery: async () => ({ supported, hub: "dorothy", reviewSHA256: "a".repeat(64) }),
        choose: async (_, items) => {
          const choice = choices.shift();
          assert.ok(items.includes(choice));
          return choice;
        },
        show: () => {},
        command: async (_, args) => {
          commands.push(args);
          return { exit: 0, stdout: "{}" };
        },
      },
    );
    assert.deepEqual(commands, []);
  }
});
test("a reviewed wake calls only Switchboard and does not start AI or claim readiness", async () => {
  const choices = ["Wake dorothy on the local network", "Send wake request", "Close"],
    calls = [],
    messages = [];
  await nativeHub(
    config,
    {},
    {
      collect: async () => validateHubStatus(status(), now),
      recovery: async () => ({ supported: true, hub: "dorothy", reviewSHA256: "a".repeat(64) }),
      show: (text) => messages.push(text),
      choose: async () => choices.shift(),
      command: async (file, args) => {
        calls.push([file, args]);
        return { exit: 0, stdout: "{}" };
      },
      dispatch: async () => assert.fail("Wake must not launch work"),
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], config.switchboardCli);
  assert.deepEqual(calls[0][1].slice(0, 2), ["client", "wake"]);
  assert.ok(messages.some((text) => /does not confirm readiness/.test(text)));
});
test("readiness waiting is bounded through Switchboard and timeout starts no work", async () => {
  const choices = ["Wait for hub readiness", "Close"],
    calls = [],
    messages = [];
  await nativeHub(
    config,
    {},
    {
      collect: async () => validateHubStatus(status(), now),
      recovery: async () => ({ supported: false }),
      choose: async () => choices.shift(),
      show: (value) => messages.push(value),
      command: async (file, args, env, signal, timeout) => {
        calls.push([file, args, signal, timeout]);
        return { exit: 0, stdout: '{"state":"timed-out"}' };
      },
      dispatch: async () => assert.fail("Waiting starts no work"),
    },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 2), ["client", "wait"]);
  assert.equal(calls[0][3], 95_000);
  assert.ok(messages.some((value) => /timed out/.test(value)));
});
