import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeZlib from "node:zlib";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { paths, shellQuote } from "./loom-os.mjs";
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
NodeTest.test(
  "literal Unicode round trips in a bounded fragment, with app limits and credential URL rejection",
  () => {
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
      NodeAssert.equal(u.pathname, "/app/share");
      NodeAssert.equal(u.search, "");
      NodeAssert.deepEqual(
        JSON.parse(
          NodeZlib.inflateSync(
            Buffer.from(u.hash.slice("#loomCapture=v1.".length), "base64url"),
          ).toString(),
        ),
        e,
      );
      NodeAssert.throws(() =>
        captureEnvelope(app, c.destinations[0], { title: "é".repeat(201), text: "ok" }, c),
      );
      NodeAssert.throws(() =>
        captureEnvelope(
          app,
          c.destinations[0],
          { text: "ok", url: "https://user:secret@example.test" },
          c,
        ),
      );
    }
    NodeAssert.throws(
      () => captureEnvelope("atlas", "source", { text: "🙂".repeat(16385) }, cap("atlas")),
      /65536/,
    );
  },
);
NodeTest.test(
  "preview cancellation does not discover apps, launch, fetch URLs or write records",
  async () => {
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
    NodeAssert.deepEqual(result, { state: "cancelled" });
    NodeAssert.equal(calls, 0);
  },
);
NodeTest.test(
  "all four destinations launch owning-app review; old direct Atlas declarations are refused",
  async () => {
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
      NodeAssert.equal(result.state, "reviewing");
      NodeAssert.equal(launches.length, 1);
      NodeAssert.equal(watches.length, 1);
      NodeAssert.ok(launches[0].args.some((arg) => arg.includes("/app/share#loomCapture=v1.")));
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
          if (header.startsWith("Where")) NodeAssert.ok(!options.includes("Atlas Research source"));
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
    NodeAssert.equal(result.state, "cancelled");
    NodeAssert.equal(launched, false);
  },
);
NodeTest.test(
  "default capture watcher executes the installed JavaScript entrypoint behind its shell launcher",
  { timeout: 5000 },
  async (t) => {
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-capture-watcher-"));
    t.after(() => NodeFSP.rm(home, { recursive: true, force: true }));
    const preload = NodePath.join(home, "watcher-exit.mjs"),
      report = NodePath.join(home, "watcher-exit.json");
    await NodeFSP.writeFile(
      preload,
      `import fs from "node:fs";
process.once("exit", (code) => {
  fs.writeFileSync(${JSON.stringify(report + ".tmp")}, JSON.stringify({ code, args: process.captureWatcherArgs ?? null }));
  fs.renameSync(${JSON.stringify(report + ".tmp")}, ${JSON.stringify(report)});
});
`,
    );
    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: NodePath.join(home, "config"),
      XDG_DATA_HOME: NodePath.join(home, "data"),
      XDG_STATE_HOME: NodePath.join(home, "state"),
      NODE_OPTIONS: `--import=${NodeURL.pathToFileURL(preload).href}`,
    };
    const p = paths(env),
      entrypoint = NodePath.join(p.root, "loom-os.mjs");
    await NodeFSP.mkdir(p.root, { recursive: true });
    await NodeFSP.mkdir(NodePath.join(home, ".local/bin"), { recursive: true });
    await NodeFSP.writeFile(entrypoint, "process.captureWatcherArgs = process.argv.slice(2);\n");
    await NodeFSP.writeFile(p.bin, `#!/bin/sh\nexec node ${shellQuote(entrypoint)} "$@"\n`, {
      mode: 0o755,
    });
    let watcher;
    const completion = new Promise((resolve, reject) => {
      watcher = NodeFS.watch(home, (_event, file) => {
        if (file === "watcher-exit.json")
          NodeFSP.readFile(report, "utf8").then((value) => resolve(JSON.parse(value)), reject);
      });
      watcher.once("error", reject);
    });
    t.after(() => watcher.close());
    const choices = ["Choose destination", "Office Note"],
      result = await nativeCapture(config, env, {
        initialApp: "office",
        payload: { text: "Selected context" },
        choose: async () => choices.shift(),
        show: () => {},
        capabilities,
        focus: async () => false,
        launch: async () => {},
      }),
      exit = await completion;
    NodeAssert.equal(result.state, "reviewing");
    NodeAssert.equal(exit.code, 0);
    NodeAssert.deepEqual(exit.args.slice(0, 2), ["capture-watch", "office"]);
    NodeAssert.match(
      exit.args[2],
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    NodeAssert.equal(exit.args.length, 3);
  },
);
NodeTest.test(
  "watcher closes only its nonce-labelled completed review, leaving other business/review windows alone",
  async () => {
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
    NodeAssert.deepEqual(
      calls.filter((args) => args[0] === "eval"),
      [["eval", 'hl.dispatch(hl.dsp.window.close({window="address:0x111"}))']],
    );
  },
);
