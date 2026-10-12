#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - This CLI owns and forwards signals to its child runner.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { runSeedDevDb } from "../apps/server/scripts/seed-dev-db.ts";

const extraArgs = process.argv.slice(2);
const help = extraArgs.includes("--help") || extraArgs.includes("-h");
const parsedHome = NodeUtil.parseArgs({
  args: extraArgs,
  strict: false,
  allowPositionals: true,
  options: { "home-dir": { type: "string" } },
}).values["home-dir"];
const explicitHome = typeof parsedHome === "string" ? parsedHome.trim() || undefined : undefined;
const result = help
  ? null
  : await Effect.runPromise(
      runSeedDevDb({ baseDir: explicitHome }).pipe(Effect.provide(NodeServices.layer)),
    );
const homeArgs =
  result && explicitHome === undefined
    ? ["--home-dir", NodePath.dirname(NodePath.dirname(result.databasePath))]
    : [];
const child = NodeChildProcess.spawn(
  process.execPath,
  [NodePath.join(import.meta.dirname, "dev-runner.ts"), "dev", ...homeArgs, ...extraArgs],
  { stdio: "inherit" },
);
const forward = (signal: NodeJS.Signals) => child.kill(signal);
const interrupt = () => forward("SIGINT");
const terminate = () => forward("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
child.on("error", (cause) => {
  process.stderr.write(`Could not start development: ${cause.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
