/* eslint-disable t3code/no-global-process-runtime -- Bootstrap executes before dependencies exist and must check the native Node host. */
// @effect-diagnostics nodeBuiltinImport:off - exercises bootstrap state against temporary files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  invalidateWorkspaceInstallation,
  recordWorkspaceInstallation,
  workspaceInstallationReady,
  workspaceSetupIdentity,
} from "./workspace-setup.ts";

const roots: string[] = [];
function fixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-workspace-setup-"));
  roots.push(root);
  for (const folder of [
    ".pnpm-store",
    "node_modules/.bin",
    "node_modules/.pnpm",
    "node_modules/example",
    "apps/test/node_modules/example",
  ])
    NodeFS.mkdirSync(NodePath.join(root, folder), { recursive: true });
  for (const [file, content] of Object.entries({
    "package.json": JSON.stringify({ type: "module", dependencies: { example: "1.0.0" } }),
    "apps/test/package.json": JSON.stringify({ devDependencies: { example: "1.0.0" } }),
    "pnpm-lock.yaml": "lockfileVersion: 9.0\n",
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    // pnpm writes this file as JSON, and setup stats its storeDir.
    "node_modules/.modules.yaml": JSON.stringify({ storeDir: NodePath.join(root, ".pnpm-store") }),
    "node_modules/.pnpm/lock.yaml": "lockfileVersion: 9.0\n",
    [`node_modules/.bin/${process.platform === "win32" ? "vp.cmd" : "vp"}`]: "installed",
  }))
    NodeFS.writeFileSync(NodePath.join(root, file), content);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("workspace installation reuse", () => {
  it("reuses a complete, recorded installation without sharing mutable checkout files", () => {
    const root = fixture();
    expect(workspaceInstallationReady(root)).toBe(false);
    recordWorkspaceInstallation(root);
    expect(workspaceInstallationReady(root)).toBe(true);
    NodeFS.mkdirSync(NodePath.join(root, "apps/test/src"));
    NodeFS.writeFileSync(NodePath.join(root, "apps/test/src/file.ts"), "changed source");
    expect(workspaceInstallationReady(root)).toBe(true);
  });
  it.each([
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/test/package.json",
    ".npmrc",
    "patches/example.patch",
  ])("invalidates when %s changes", (file) => {
    const root = fixture();
    recordWorkspaceInstallation(root);
    const before = workspaceSetupIdentity(root);
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, file),
      file.endsWith("package.json") ? '{"dependencies":{"example":"2.0.0"}}' : "changed",
    );
    expect(workspaceSetupIdentity(root)).not.toBe(before);
    expect(workspaceInstallationReady(root)).toBe(false);
  });
  it("detects removed workspace dependency links", () => {
    const root = fixture();
    recordWorkspaceInstallation(root);
    NodeFS.rmSync(NodePath.join(root, "apps/test/node_modules/example"), { recursive: true });
    expect(workspaceInstallationReady(root)).toBe(false);
    expect(() => recordWorkspaceInstallation(root)).toThrow("incomplete");
  });
  it("does not reuse stale stamps after failed preparation or changed installation metadata", () => {
    const root = fixture();
    recordWorkspaceInstallation(root);
    invalidateWorkspaceInstallation(root);
    expect(workspaceInstallationReady(root)).toBe(false);
    recordWorkspaceInstallation(root);
    NodeFS.appendFileSync(NodePath.join(root, "node_modules/.modules.yaml"), "changed\n");
    expect(workspaceInstallationReady(root)).toBe(false);
  });
  it("ignores corrupt readiness records and notices newly added workspaces", () => {
    const root = fixture();
    NodeFS.writeFileSync(NodePath.join(root, "node_modules/.t3-workspace-setup.json"), "broken");
    expect(workspaceInstallationReady(root)).toBe(false);
    recordWorkspaceInstallation(root);
    NodeFS.mkdirSync(NodePath.join(root, "packages/new"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, "packages/new/package.json"), "{}");
    expect(workspaceInstallationReady(root)).toBe(false);
  });
});

it("runs the setup CLI end-to-end and skips only installation on a valid repeat", () => {
  const root = fixture();
  NodeFS.mkdirSync(NodePath.join(root, "scripts/lib"), { recursive: true });
  NodeFS.copyFileSync(
    NodePath.join(import.meta.dirname, "workspace-setup.ts"),
    NodePath.join(root, "scripts/lib/workspace-setup.ts"),
  );
  NodeFS.copyFileSync(
    NodePath.join(import.meta.dirname, "../setup-worktree.ts"),
    NodePath.join(root, "scripts/setup-worktree.ts"),
  );
  const bin = NodePath.join(root, "node_modules/.bin/vp");
  NodeFS.writeFileSync(
    bin,
    '#!/usr/bin/env node\nconst fs = require("node:fs"); const file = "install-count"; fs.writeFileSync(file, String(Number(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : 0) + 1));\n',
  );
  NodeFS.chmodSync(bin, 0o755);
  for (const [folder, file, marker] of [
    ["apps/server/scripts", "seed-dev-db.ts", "fixture-count"],
  ]) {
    NodeFS.mkdirSync(NodePath.join(root, folder!), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, folder!, file!),
      `import * as fs from "node:fs"; const file = "${marker}"; fs.writeFileSync(file, String(Number(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : 0) + 1));`,
    );
  }
  const run = () =>
    NodeChildProcess.execFileSync(
      process.execPath,
      [NodePath.join(root, "scripts/setup-worktree.ts")],
      { cwd: root, env: { ...process.env, T3CODE_PROJECT_ROOT: root }, encoding: "utf8" },
    );
  expect(run()).toContain("Installing dependencies from the shared package cache");
  expect(run()).toContain("Using prepared dependencies");
  expect(NodeFS.readFileSync(NodePath.join(root, "install-count"), "utf8")).toBe("1");
  expect(NodeFS.readFileSync(NodePath.join(root, "fixture-count"), "utf8")).toBe("2");
  NodeFS.appendFileSync(NodePath.join(root, "pnpm-lock.yaml"), "changed\n");
  expect(run()).toContain("Installing dependencies from the shared package cache");
  expect(NodeFS.readFileSync(NodePath.join(root, "install-count"), "utf8")).toBe("2");
});
