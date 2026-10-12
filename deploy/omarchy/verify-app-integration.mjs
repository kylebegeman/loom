#!/usr/bin/env node
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  install,
  paths,
  validateAppIntegration,
  discoverAppIntegration,
  integratedSearchCommand,
  integratedCaptureCommand,
} from "./loom-os.mjs";

// Validate the actual Go producer outputs, not independently maintained JSON copies.
const args = process.argv.slice(2);
if (args.length !== 2) throw Error("Usage: node verify-app-integration.mjs OFFICE_ROOT ATLAS_ROOT");
const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const temporary = await NodeFSP.realpath(
  await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-app-contract-")),
);
try {
  const results = await Promise.allSettled(
    ["office", "atlas"].map(async (app, index) => {
      const output = NodePath.join(temporary, `${app}.json`);
      await execute(
        "go",
        ["test", "./internal/web", "-run", "^TestLoomAppIntegration", "-count=1"],
        {
          cwd: NodePath.join(NodePath.resolve(args[index]), "server"),
          env: { ...process.env, LOOM_APP_MANIFEST_OUTPUT: output },
          timeout: 120000,
        },
      );
      const raw = JSON.parse(await NodeFSP.readFile(output, "utf8"));
      const manifest = validateAppIntegration(raw, app);
      const config = {
        [`${app}Url`]: `https://${app}.example.test`,
        [`${app}Cli`]: `/tools/${app}`,
        browserExecutable: "/tools/chromium",
      };
      const report = await discoverAppIntegration(app, config, {
        request: async () =>
          new Response(JSON.stringify(raw), { headers: { "Content-Type": "application/json" } }),
      });
      NodeAssert.equal(report.state, "available");
      const dependencies = { discover: async () => report };
      const search = await integratedSearchCommand(
        app,
        "literal & research",
        config,
        {},
        dependencies,
      );
      NodeAssert.equal(search.env.API_URL, config[`${app}Url`]);
      NodeAssert.equal(search.args[1], app === "office" ? "search" : "workspace-search");
      const capture = await integratedCaptureCommand(
        app,
        { title: "Synthetic capture", text: "Literal text" },
        config,
        { HOME: temporary },
        dependencies,
      );
      NodeAssert.equal(capture.reviewed, app === "office");
      NodeAssert.equal(manifest.capabilities.links.supported, false);
      NodeAssert.equal(manifest.capabilities.notifications.supported, false);
      NodeAssert.equal(manifest.capabilities.availability.supported, false);
      // Exercise the installed command against real producer metadata on loopback.
      // Only the executable is synthetic; no records, browser or model are touched.
      const root = NodePath.join(temporary, app);
      await NodeFSP.mkdir(root);
      const record = NodePath.join(root, "invocation.json");
      const executable = NodePath.join(root, "record.mjs");
      await NodeFSP.writeFile(
        executable,
        `#!${process.execPath}\nimport * as FS from 'node:fs';\nFS.writeFileSync(process.env.LOOM_CONTRACT_RECORD, JSON.stringify({ args: process.argv.slice(2), origin: process.env.API_URL }));\n`,
        { mode: 0o755 },
      );
      const server = NodeHttp.createServer((req, res) => {
        if (req.url !== "/.well-known/loom-app") {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(raw));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const env = {
        HOME: NodePath.join(root, "home"),
        XDG_CONFIG_HOME: NodePath.join(root, "config"),
        XDG_DATA_HOME: NodePath.join(root, "data"),
        XDG_STATE_HOME: NodePath.join(root, "state"),
        PATH: `${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
        LOOM_CONTRACT_RECORD: record,
      };
      try {
        await install(
          {
            version: 1,
            officeUrl: "https://office.example.test",
            profile: "laptop",
            loomExecutable: executable,
            browserExecutable: executable,
            [`${app}Cli`]: executable,
            [`${app}Url`]: `http://127.0.0.1:${server.address().port}`,
          },
          { env },
        );
        await execute(paths(env).bin, ["search", app, "literal & research"], { env });
        const invocation = JSON.parse(await NodeFSP.readFile(record, "utf8"));
        NodeAssert.equal(invocation.args[1], app === "office" ? "search" : "workspace-search");
        NodeAssert.equal(invocation.origin, `http://127.0.0.1:${server.address().port}`);
        if (app === "atlas") {
          await execute(
            paths(env).bin,
            ["capture", app, "--title", "Synthetic", "--text", "Literal $(text)"],
            { env },
          );
          const saved = JSON.parse(await NodeFSP.readFile(record, "utf8"));
          NodeAssert.equal(saved.args[1], "sources-capture");
          NodeAssert.equal(saved.args[5], "Literal $(text)");
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }

      return {
        app,
        version: manifest.version,
        search: search.args.slice(0, 2),
        capture: app === "office" ? "in-app review" : capture.args.slice(0, 2),
        offline: manifest.offline,
        installedDispatchVerified: true,
        verified: true,
      };
    }),
  );
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const reports = results.map((result) => result.value);
  console.log(JSON.stringify({ format: "loom-app-interoperability-proof-v1", reports }, null, 2));
} finally {
  await NodeFSP.rm(temporary, { recursive: true, force: true });
}
