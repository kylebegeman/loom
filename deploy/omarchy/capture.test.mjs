import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureEnvelope,
  reviewedCaptureCommand,
  nativeCapture,
  watchCapture,
} from "./capture.mjs";
const config = {
  officeUrl: "https://office.example.test",
  atlasUrl: "https://atlas.example.test",
  browserExecutable: "/tools/chromium",
};
const cap = (app) => ({
  supported: true,
  handoff: "loom-capture-review-v1",
  format: "review-in-app-v1",
  reviewed: true,
  path: "/app/share",
  captureUnit: app === "office" ? "utf16-units" : "utf8-bytes",
  titleLimit: 200,
  textLimit: app === "office" ? 4000 : 65536,
  urlLimit: app === "office" ? 2048 : 2000,
  destinations: app === "office" ? ["note", "reminder", "conversation"] : ["source"],
});
const capabilities = async (app) => ({
  state: "available",
  manifest: { capabilities: { capture: cap(app) } },
});
test("literal Unicode round trips in a bounded fragment, with app limits and credential URL rejection", () => {
  for (const app of ["office", "atlas"]) {
    const c = cap(app),
      e = captureEnvelope(
        app,
        c.destinations[0],
        {
          title: "café",
          text: "<script>bad()</script> $(secret) 🙂",
          url: "https://source.example.test",
        },
        c,
      );
    const spec = reviewedCaptureCommand(e, c, config, { HOME: "/tmp/loom-capture" });
    const u = new URL(spec.args.find((arg) => arg.startsWith("--app=")).slice(6));
    assert.equal(u.pathname, "/app/share");
    assert.equal(u.search, "");
    assert.deepEqual(
      JSON.parse(
        inflateSync(Buffer.from(u.hash.slice("#loomCapture=v1.".length), "base64url")).toString(),
      ),
      e,
    );
    assert.throws(() =>
      captureEnvelope(app, c.destinations[0], { title: "é".repeat(201), text: "ok" }, c),
    );
    assert.throws(() =>
      captureEnvelope(
        app,
        c.destinations[0],
        { text: "ok", url: "https://user:secret@example.test" },
        c,
      ),
    );
  }
  assert.throws(
    () => captureEnvelope("atlas", "source", { text: "🙂".repeat(16385) }, cap("atlas")),
    /65536/,
  );
});
test("preview cancellation does not discover apps, launch, fetch URLs or write records", async () => {
  let calls = 0;
  const result = await nativeCapture(
    config,
    {},
    {
      payload: { text: "https://never-fetch.example.test" },
      show: () => {},
      choose: async () => "Cancel",
      capabilities: async () => {
        calls++;
      },
      launch: async () => {
        calls++;
      },
    },
  );
  assert.deepEqual(result, { state: "cancelled" });
  assert.equal(calls, 0);
});
test("all four destinations launch owning-app review; old direct Atlas declarations are refused", async () => {
  for (const label of [
    "Office Note",
    "Office Reminder",
    "Office Desk draft",
    "Atlas Research source",
  ]) {
    const choices = ["Choose destination", label],
      launches = [],
      watches = [];
    const result = await nativeCapture(
      config,
      { HOME: "/tmp/loom-capture" },
      {
        payload: { text: "Literal $(text)" },
        show: () => {},
        choose: async () => choices.shift(),
        capabilities,
        focus: async () => true,
        launch: async (spec) => launches.push(spec),
        watch: async (e) => watches.push(e),
      },
    );
    assert.equal(result.state, "reviewing");
    assert.equal(launches.length, 1);
    assert.equal(watches.length, 1);
    assert.ok(launches[0].args.some((arg) => arg.includes("/app/share#loomCapture=v1.")));
  }
  const choices = ["Choose destination", "Cancel"];
  let launched = false;
  const result = await nativeCapture(
    config,
    {},
    {
      payload: { text: "keep" },
      show: () => {},
      choose: async (header, options) => {
        if (header.startsWith("Where")) assert.ok(!options.includes("Atlas Research source"));
        return choices.shift();
      },
      capabilities: async (app) =>
        app === "office"
          ? capabilities(app)
          : {
              state: "available",
              manifest: {
                capabilities: { capture: { ...cap(app), handoff: undefined, reviewed: false } },
              },
            },
      launch: async () => {
        launched = true;
      },
    },
  );
  assert.equal(result.state, "cancelled");
  assert.equal(launched, false);
});
test("watcher closes only its nonce-labelled completed review, leaving other business/review windows alone", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    calls = [];
  let n = 0;
  const identity = "chrome-office.example.test__app_share-Default";
  const query = async (args) => {
    calls.push(args);
    if (args[0] === "clients")
      return JSON.stringify([
        {
          address: "0x111",
          class: identity,
          title: `Loom capture ${id}: ${n++ ? "complete" : "review"}`,
        },
        {
          address: "0x222",
          class: "chrome-office.example.test__app_-Default",
          title: `Loom capture ${id}: complete`,
        },
        { address: "0x333", class: identity, title: "Loom capture another: complete" },
      ]);
    return "";
  };
  await watchCapture(
    "office",
    id,
    config,
    { PATH: "/nonexistent" },
    { query, pause: async () => {} },
  );
  assert.deepEqual(
    calls.filter((args) => args[0] === "eval"),
    [["eval", 'hl.dispatch(hl.dsp.window.close({window="address:0x111"}))']],
  );
});
