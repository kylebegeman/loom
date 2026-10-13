import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
const test = NodeTest.test,
  assert = NodeAssert;
const { view, freshness } = NodeVM.runInNewContext(
  NodeFS.readFileSync(new URL("./status/StatusModel.js", import.meta.url), "utf8") +
    "\n({ view, freshness })",
);
const now = Date.now();
const report = {
  version: 1,
  generatedAt: new Date(now).toISOString(),
  state: "ok",
  aiReady: true,
  components: [
    { id: "tailscale", state: "ok" },
    { id: "switchboard", state: "ok" },
    { id: "loom", state: "ok" },
  ],
};
test("status displays separate private network, gateway and Loom availability", () => {
  const ready = view(JSON.stringify(report), now);
  assert.equal(ready.aiReady, true);
  assert.match(ready.tooltip, /Tailscale: Ready[\s\S]*Switchboard: Ready[\s\S]*Loom server: Ready/);
  const offline = {
    ...report,
    state: "offline",
    aiReady: false,
    components: report.components.map((c) => ({ ...c, state: "error" })),
  };
  assert.equal(view(JSON.stringify(offline), now).state, "offline");
  assert.equal(view(JSON.stringify(report), now).state, "ok");
});
test("stale, malformed and inconsistent status cannot retain a ready indicator after resume", () => {
  const inputs = [
    "invalid",
    JSON.stringify({ ...report, version: 2 }),
    JSON.stringify({ ...report, components: [] }),
    JSON.stringify({ ...report, generatedAt: new Date(now + 120000).toISOString() }),
    JSON.stringify({
      ...report,
      components: [
        { id: "tailscale", state: "ok" },
        { id: "switchboard", state: "error" },
      ],
    }),
  ];
  for (const input of inputs) assert.equal(view(input, now).aiReady, false);
  assert.equal(view(JSON.stringify(report), now + 90001).aiReady, false);
  assert.equal(view(JSON.stringify(report), now).aiReady, true);
});

test("resume and backwards clock changes reject every pre-gap sample until a new check", () => {
  const gap = freshness(now, now + 6000, now - 1000);
  assert.equal(gap.refresh, true);
  assert.equal(view(JSON.stringify(report), now + 6000, gap.minimum).aiReady, false);
  const fresh = { ...report, generatedAt: new Date(now + 6001).toISOString() };
  assert.equal(view(JSON.stringify(fresh), now + 6001, gap.minimum).aiReady, true);
  assert.equal(freshness(now, now + 1000, now - 1000).refresh, false);
  assert.equal(freshness(now, now - 1000, now - 2000).refresh, true);
});

test("capability status distinguishes offline support, live search and unknown pending changes", () => {
  const conditional = { state: "conditional", detail: "Supported after prior use." };
  const app = {
    id: "office",
    title: "Office",
    server: "reachable",
    cli: "connected",
    declaration: "live",
    reading: conditional,
    writing: conditional,
    search: { state: "available", detail: "Permissions apply." },
    pending: { state: "unknown", detail: "Open app." },
    pendingCount: null,
  };
  const ecosystem = { ...report, version: 2, apps: [app] };
  const result = view(JSON.stringify(ecosystem), now);
  assert.equal(result.state, "ok");
  assert.match(result.tooltip, /Saved reading: Supported after prior use/);
  assert.match(result.tooltip, /Pending changes: not reported by app/);
  for (const invalid of [
    { ...ecosystem, apps: [{ ...app, pendingCount: 0 }] },
    { ...ecosystem, apps: [{ ...app, cli: "approval-needed" }] },
    {
      ...ecosystem,
      state: "attention",
      apps: [{ ...app, declaration: "retained", server: "unavailable" }],
    },
    { ...ecosystem, apps: [app, app] },
    { ...ecosystem, apps: [{ ...app, writing: { state: "available", detail: "bad\u001btext" } }] },
  ])
    assert.equal(view(JSON.stringify(invalid), now).aiReady, false);
  const partial = {
    ...ecosystem,
    state: "attention",
    apps: [
      {
        ...app,
        cli: "approval-needed",
        search: { state: "approval-needed", detail: "Connect the CLI." },
      },
    ],
  };
  assert.equal(view(JSON.stringify(partial), now).state, "attention");
  assert.equal(view(JSON.stringify(partial), now).aiReady, true);
});

test("device review is an owner handoff, never a fresh queue observation", () => {
  const conditional = { state: "conditional", detail: "Check the installed profile." };
  const app = {
    id: "office",
    server: "reachable",
    cli: "connected",
    declaration: "live",
    reading: conditional,
    writing: conditional,
    search: { state: "available", detail: "App permissions apply." },
    pending: { state: "unknown", detail: "Review in Office." },
    pendingCount: null,
    deviceReview: { state: "available", detail: "The app owns device status." },
  };
  const ecosystem = { ...report, version: 2, apps: [app] };
  const ready = view(JSON.stringify(ecosystem), now);
  assert.equal(ready.aiReady, true);
  assert.match(
    ready.tooltip,
    /Device status: review saved copies, conflicts and storage in Office/,
  );
  assert.match(ready.tooltip, /Pending changes: not reported/);
  for (const review of [
    { state: "current", detail: "Invented device state." },
    { state: "available", detail: "bad\u001btext" },
  ])
    assert.equal(
      view(JSON.stringify({ ...ecosystem, apps: [{ ...app, deviceReview: review }] }), now).aiReady,
      false,
    );
  assert.equal(view(JSON.stringify(ecosystem), now + 90001).aiReady, false);
});
