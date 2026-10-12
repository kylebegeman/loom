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
  resolveExactItem,
} from "./loom-os.mjs";

// Validate the actual Go producer outputs, not independently maintained JSON copies.
const args = process.argv.slice(2);
if (args.length !== 2) throw Error("Usage: node verify-app-integration.mjs OFFICE_ROOT ATLAS_ROOT");
const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const execute = (file, args, options = {}) => execFile(file, args, { timeout: 120000, ...options });
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
      NodeAssert.equal(capture.reviewed, true);
      NodeAssert.equal(manifest.capabilities.links.supported, true);
      const reference =
        app === "office"
          ? { kind: "note", id: "saved & literal" }
          : { kind: "source", id: "saved", revision: 1, versionId: "immutable-original" };
      const itemPath = `/app/?${new URLSearchParams({
        item: reference.kind,
        id: reference.id,
        ...(app === "atlas" ? { revision: "1", version: reference.versionId } : {}),
      })}`;
      const item = await resolveExactItem(
        app,
        reference,
        config,
        {},
        {
          ...dependencies,
          resolve: async (spec) => {
            NodeAssert.deepEqual(
              spec.args.slice(0, 2),
              manifest.capabilities.links.operation.command,
            );
            NodeAssert.deepEqual(JSON.parse(spec.args[3]), reference);
            return app === "office"
              ? { items: [{ reference, status: "live", canonicalURL: itemPath }] }
              : { reference, path: itemPath };
          },
        },
      );
      NodeAssert.equal(item.pathname + item.search, itemPath);
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
        `#!${process.execPath}
import * as FS from 'node:fs';
const args = process.argv.slice(2);
FS.writeFileSync(process.env.LOOM_CONTRACT_RECORD, JSON.stringify({ args, origin: process.env.API_URL }));
if (args[1] === 'items-resolve') {
  const ref = args[0] === 'office' ? JSON.parse(args[args.indexOf('--references') + 1]) : JSON.parse(args[args.indexOf('--reference') + 1]);
  const path = '/app/?' + new URLSearchParams({item:ref.kind,id:ref.id,...(ref.versionId ? {revision:String(ref.revision),version:ref.versionId} : {})});
  console.log(JSON.stringify(args[0] === 'office' ? {items:[{reference:ref,status:'live',canonicalURL:path}]} : {reference:ref,path}));
}
if (args.some(arg => arg.startsWith('--app='))) FS.writeFileSync(process.env.LOOM_CONTRACT_BROWSER_RECORD, JSON.stringify({args}));
`,
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
        LOOM_CONTRACT_BROWSER_RECORD: NodePath.join(root, "browser.json"),
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
        await execute(paths(env).bin, ["open-item", app, JSON.stringify(reference)], { env });
        const itemInvocation = JSON.parse(await NodeFSP.readFile(record, "utf8"));
        if (itemInvocation.args[1] === "items-resolve") {
          NodeAssert.deepEqual(JSON.parse(itemInvocation.args[3]), reference);
        } else {
          const target = new URL(
            itemInvocation.args.find((arg) => arg.startsWith("--app=")).slice(6),
          );
          NodeAssert.equal(target.searchParams.get("id"), reference.id);
        }
        // The detached synthetic browser records its own completed launch, separately
        // from the resolver. Await that file without relying on a launch-time sleep.
        const deadline = Date.now() + 5000;
        let browser;
        while (!browser) {
          try {
            browser = JSON.parse(await NodeFSP.readFile(env.LOOM_CONTRACT_BROWSER_RECORD, "utf8"));
          } catch (error) {
            if (error.code !== "ENOENT" || Date.now() > deadline) throw error;
          }
        }
        const destination = new URL(browser.args.find((arg) => arg.startsWith("--app=")).slice(6));
        NodeAssert.equal(destination.origin, invocation.origin);
        NodeAssert.equal(destination.searchParams.get("id"), reference.id);
        NodeAssert.ok(destination.searchParams.get("loomHandoff"));
        const gum = NodePath.join(root, "gum");
        await NodeFSP.writeFile(
          gum,
          `#!${process.execPath}
const header=process.argv[process.argv.indexOf('--header')+1];
console.log(header === 'Capture' ? 'Choose destination' : ${JSON.stringify(app === "office" ? "Office Note" : "Atlas Research source")});
`,
          { mode: 0o755 },
        );
        await NodeFSP.rm(env.LOOM_CONTRACT_BROWSER_RECORD);
        await execute(
          "python3",
          [
            "-c",
            "import os,pty,sys,select,time,signal\npid,fd=pty.fork()\nif pid==0: os.execvpe(sys.argv[1],sys.argv[1:],os.environ)\ndeadline=time.monotonic()+20\nwhile time.monotonic()<deadline:\n ready,_,_=select.select([fd],[],[],0.1)\n if ready:\n  try: data=os.read(fd,4096)\n  except OSError: data=b''\n  if data: os.write(1,data)\n done,status=os.waitpid(pid,os.WNOHANG)\n if done: os.close(fd); sys.exit(os.waitstatus_to_exitcode(status))\nos.kill(pid,signal.SIGTERM); os.waitpid(pid,0); os.close(fd); sys.exit(124)",
            paths(env).bin,
            "capture",
            app,
            "--inline",
            "--title",
            "Synthetic",
            "--text",
            "Literal $(text)",
          ],
          { env: { ...env, PATH: root + NodePath.delimiter + env.PATH } },
        );
        let reviewed;
        const captureDeadline = Date.now() + 5000;
        while (!reviewed) {
          try {
            reviewed = JSON.parse(await NodeFSP.readFile(env.LOOM_CONTRACT_BROWSER_RECORD, "utf8"));
          } catch (error) {
            if (error.code !== "ENOENT" || Date.now() > captureDeadline) throw error;
          }
        }
        const reviewURL = new URL(reviewed.args.find((arg) => arg.startsWith("--app=")).slice(6));
        NodeAssert.equal(reviewURL.pathname, "/app/share");
        NodeAssert.equal(reviewURL.search, "");
        NodeAssert.ok(reviewURL.hash.startsWith("#loomCapture=v1."));
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }

      return {
        app,
        version: manifest.version,
        search: search.args.slice(0, 2),
        capture: "in-app review",
        offline: manifest.offline,
        installedDispatchVerified: true,
        exactItemResolutionAndLaunchVerified: true,
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
