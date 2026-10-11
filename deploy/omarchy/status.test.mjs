import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeVM from "node:vm";
const test = NodeTest.test,
  assert = NodeAssert;
const { view } = NodeVM.runInNewContext(
  NodeFS.readFileSync(new URL("./status/StatusModel.js", import.meta.url), "utf8") + "\n({ view })",
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
