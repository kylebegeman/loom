#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeProcess from "node:process";
import { paths } from "./loom-os.mjs";
const args = NodeProcess.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== "--native"))
  throw Error("Usage: node deploy/omarchy/check.mjs [--native]");
const root = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const tests = (await NodeFSP.readdir(root))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => NodePath.join(root, name));
NodeChildProcess.execFileSync(NodeProcess.execPath, ["--test", "--test-reporter=dot", ...tests], {
  stdio: "inherit",
});
NodeChildProcess.execFileSync(
  NodeProcess.execPath,
  [NodePath.join(root, "packets/render.mjs"), "--check"],
  { stdio: "inherit" },
);
if (args.length) {
  const report = JSON.parse(
    NodeChildProcess.execFileSync(paths().bin, ["compatibility"], { encoding: "utf8" }),
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.errors)
    throw Error(
      "Native compatibility checks failed. Review the reported integration controls before rollout.",
    );
}
console.log(
  args.length
    ? "Pack and native compatibility checks passed. Physical UI acceptance remains separate."
    : "Pack checks passed. Native verification was not requested.",
);
