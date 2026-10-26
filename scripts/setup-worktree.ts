/* eslint-disable t3code/no-global-process-runtime -- Bootstrap executes before dependencies exist and must check the native Node host. */
// @effect-diagnostics nodeBuiltinImport:off - runs before `vp i`, so only Node built-ins exist.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
// fork: setup-reuse
import {
  invalidateWorkspaceInstallation,
  recordWorkspaceInstallation,
  workspaceInstallationReady,
} from "./lib/workspace-setup.ts";

const ENV_FILES = [".env", NodePath.join("infra", "relay", ".env")];

const worktree = NodePath.dirname(import.meta.dirname);

// T3 runs setup in the background, so agents can start before it ends.
// `setup-running` holds this PID until setup ends with `setup-done` or
// `setup-failed`, so agents wait instead of racing it with their own `vp i`.
const markerDir = NodePath.join(worktree, ".t3");
const runningMarker = NodePath.join(markerDir, "setup-running");
const doneMarker = NodePath.join(markerDir, "setup-done");
const failedMarker = NodePath.join(markerDir, "setup-failed");
NodeFS.rmSync(doneMarker, { force: true });
NodeFS.rmSync(failedMarker, { force: true });
NodeFS.mkdirSync(markerDir, { recursive: true });
NodeFS.writeFileSync(runningMarker, `${process.pid}\n`);
let failureDetail = "";
process.on("uncaughtExceptionMonitor", (error) => {
  failureDetail = error.stack ?? String(error);
});
process.on("exit", (code) => {
  if (code === 0) NodeFS.writeFileSync(doneMarker, "");
  else NodeFS.writeFileSync(failedMarker, `Setup exited with code ${code}.\n${failureDetail}\n`);
  NodeFS.rmSync(runningMarker, { force: true });
});
// A cancelled setup must still leave a marker, or agents would wait forever.
// During install, the signal goes on to the installer and setup exits when the
// install output closes. Any child the shell leaves behind holds that output
// open, so no marker appears while `vp i` can still write node_modules.
let cancelSignal: NodeJS.Signals | undefined;
let activeInstall: NodeChildProcess.ChildProcess | undefined;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cancelSignal = signal;
    if (activeInstall) activeInstall.kill(signal);
    else process.exit(1);
  });
}

const projectRoot = process.env.T3CODE_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error("T3CODE_PROJECT_ROOT is not set. Run this through the t3.json setup action.");
}

// fork: setup-reuse -- reuse a prepared installation; otherwise install exactly the
// locked dependencies so setup never rewrites the lockfile.
const setupStarted = performance.now();
const installStarted = performance.now();
if (!process.argv.includes("--force-install") && workspaceInstallationReady(worktree)) {
  process.stdout.write(
    `Using prepared dependencies (${Math.round(performance.now() - installStarted)} ms).\n`,
  );
} else {
  invalidateWorkspaceInstallation(worktree);
  process.stdout.write("Installing dependencies from the shared package cache...\n");
  // The package manager keeps immutable packages in its existing shared store.
  // Each checkout retains its own links and native build outputs.
  const localVp = NodePath.join(
    worktree,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vp.cmd" : "vp",
  );
  // Use the shell for Windows vp shims. Unattended installs need pnpm's confirmation
  // flag and closed stdin so other prompts fail. A stale lockfile must fail, not be rewritten.
  // Pipe output so the failure marker can keep its tail.
  const install = NodeChildProcess.spawn(
    NodeFS.existsSync(localVp) ? localVp : "vp",
    ["i", "--", "--yes", "--frozen-lockfile", "--prefer-offline"],
    {
      cwd: worktree,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeInstall = install;
  let installOutput = "";
  for (const [source, target] of [
    [install.stdout, process.stdout],
    [install.stderr, process.stderr],
  ] as const) {
    source.setEncoding("utf8");
    source.on("data", (chunk: string) => {
      target.write(chunk);
      installOutput = (installOutput + chunk).slice(-8_000);
    });
  }
  const installStatus = await new Promise<number | null>((resolve) => install.on("close", resolve));
  activeInstall = undefined;
  if (installStatus !== 0 || cancelSignal) {
    failureDetail = cancelSignal
      ? `Cancelled by ${cancelSignal}.`
      : installOutput.trimEnd().split("\n").slice(-30).join("\n");
    process.exit(installStatus || 1);
  }
  recordWorkspaceInstallation(worktree);
  process.stdout.write(
    `Dependencies ready (${Math.round(performance.now() - installStarted)} ms).\n`,
  );
}

// pnpm cannot clone or hardlink across filesystems, so a store on another
// device silently turns every worktree install into a full copy.
const storeDir: unknown = JSON.parse(
  NodeFS.readFileSync(NodePath.join(worktree, "node_modules", ".modules.yaml"), "utf8"),
).storeDir;
if (
  typeof storeDir === "string" &&
  NodeFS.statSync(storeDir).dev !== NodeFS.statSync(NodePath.join(worktree, "node_modules")).dev
) {
  process.stderr.write(
    [
      "",
      "WARNING: the pnpm store is on a different filesystem than this worktree.",
      `  store:    ${storeDir}`,
      `  worktree: ${worktree}`,
      "pnpm cannot hardlink or clone across filesystems, so it copied every package into node_modules.",
      "Fix: put the store on the worktree's filesystem, for example:",
      `  pnpm config set store-dir ${JSON.stringify(NodePath.join(NodePath.dirname(worktree), ".pnpm-store"))} --global`,
      "",
      "",
    ].join("\n"),
  );
}

// Worktrees link main-checkout env files; replace only symlinks so real files always survive.
for (const file of ENV_FILES) {
  const source = NodePath.join(projectRoot, file);
  const sourceStat = NodeFS.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat) continue;
  if (!sourceStat.isFile()) {
    process.stderr.write(`Skipping ${file}: ${source} is not a regular file.\n`);
    continue;
  }
  const target = NodePath.join(worktree, file);
  const existing = NodeFS.lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) continue;
  if (existing) NodeFS.rmSync(target);
  NodeFS.symlinkSync(source, target);
}

// fork: dev-db
const dataStarted = performance.now();
process.stdout.write("Preparing development data...\n");
const seed = NodeChildProcess.spawnSync(
  process.execPath,
  [NodePath.join(worktree, "apps", "server", "scripts", "seed-dev-db.ts")],
  { cwd: worktree, stdio: "inherit" },
);
if (seed.status !== 0) process.exit(seed.status ?? 1);
process.stdout.write(
  `Development data ready (${Math.round(performance.now() - dataStarted)} ms).\n`,
);

const warmStarted = performance.now(); // fork: setup-reuse
process.stdout.write("Warming web dependencies...\n");
const warm = NodeChildProcess.spawnSync(
  process.execPath,
  [NodePath.join(worktree, "apps", "web", "scripts", "warm-dep-cache.ts")],
  { cwd: worktree, stdio: "inherit" },
);
// fork: setup-reuse
if (warm.status !== 0) process.exit(warm.status ?? 1);
process.stdout.write(
  `Web dependencies ready (${Math.round(performance.now() - warmStarted)} ms).\n`,
);

process.stdout.write(
  `Workspace ready (${Math.round(performance.now() - setupStarted)} ms total).\n`,
);
