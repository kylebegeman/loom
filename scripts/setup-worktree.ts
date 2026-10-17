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

const projectRoot = process.env.T3CODE_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error("T3CODE_PROJECT_ROOT is not set. Run this through the t3.json setup action.");
}
const worktree = NodePath.dirname(import.meta.dirname);

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
  const install = NodeChildProcess.spawnSync(
    NodeFS.existsSync(localVp) ? localVp : "vp",
    ["i", "--", "--yes", "--frozen-lockfile", "--prefer-offline"],
    {
      cwd: worktree,
      shell: process.platform === "win32",
      // Setup has no one answering prompts. Confirm dependency relinking and close stdin.
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
  recordWorkspaceInstallation(worktree);
  process.stdout.write(
    `Dependencies ready (${Math.round(performance.now() - installStarted)} ms).\n`,
  );
}

// Env files live as real files in the main checkout; worktrees only get
// symlinks to them. Only a symlink is ever replaced, so a real env file is
// never deleted, including when this runs in the main checkout itself.
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
