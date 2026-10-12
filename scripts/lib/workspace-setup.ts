/* eslint-disable t3code/no-global-process-runtime -- Bootstrap executes before dependencies exist and must check the native Node host. */
// @effect-diagnostics nodeBuiltinImport:off - bootstrap runs before dependencies are installed.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const STAMP_FILE = ".t3-workspace-setup.json";
const INPUT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
  "scripts/setup-worktree.ts",
  "scripts/lib/workspace-setup.ts",
];
const WORKSPACE_FOLDERS = ["apps", "infra", "packages"];

function filesUnder(root: string): string[] {
  if (!NodeFS.existsSync(root)) return [];
  return NodeFS.readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const file = NodePath.join(root, entry.name);
      return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
    })
    .sort();
}

function manifests(root: string): string[] {
  const files = [NodePath.join(root, "package.json")];
  for (const folder of WORKSPACE_FOLDERS) {
    const base = NodePath.join(root, folder);
    if (!NodeFS.existsSync(base)) continue;
    for (const entry of NodeFS.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(NodePath.join(base, entry.name, "package.json"));
    }
  }
  for (const folder of ["scripts", "oxlint-plugin-t3code"])
    files.push(NodePath.join(root, folder, "package.json"));
  return files.filter((file) => NodeFS.existsSync(file)).sort();
}

/** Content identity includes native-module compatibility and every workspace's dependencies. */
export function workspaceSetupIdentity(root: string): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(
    JSON.stringify({
      version: 1,
      node: process.version,
      abi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
    }),
  );
  const files = new Set([
    ...INPUT_FILES.map((file) => NodePath.join(root, file)),
    ...manifests(root),
    ...filesUnder(NodePath.join(root, "patches")),
  ]);
  for (const file of [...files].sort()) {
    hash.update(NodePath.relative(root, file));
    hash.update("\0");
    hash.update(NodeFS.existsSync(file) ? NodeFS.readFileSync(file) : "missing");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function installationIdentity(root: string): string | null {
  const hash = NodeCrypto.createHash("sha256");
  for (const file of [".modules.yaml", NodePath.join(".pnpm", "lock.yaml")]) {
    const target = NodePath.join(root, "node_modules", file);
    if (!NodeFS.existsSync(target)) return null;
    hash.update(NodeFS.readFileSync(target));
  }
  if (
    !NodeFS.existsSync(
      NodePath.join(root, "node_modules", ".bin", process.platform === "win32" ? "vp.cmd" : "vp"),
    )
  )
    return null;
  for (const file of manifests(root)) {
    const manifest = JSON.parse(NodeFS.readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (!NodeFS.existsSync(NodePath.join(NodePath.dirname(file), "node_modules", name)))
        return null;
    }
  }
  return hash.digest("hex");
}

/** A missing, damaged or stale installation takes the normal install path. */
export function workspaceInstallationReady(root: string): boolean {
  try {
    const stamp = JSON.parse(
      NodeFS.readFileSync(NodePath.join(root, "node_modules", STAMP_FILE), "utf8"),
    ) as { inputs?: string; installation?: string };
    const installation = installationIdentity(root);
    return (
      installation !== null &&
      stamp.inputs === workspaceSetupIdentity(root) &&
      stamp.installation === installation
    );
  } catch {
    return false;
  }
}

/** Only record readiness after install and its lifecycle scripts have succeeded. */
export function recordWorkspaceInstallation(root: string): void {
  const installation = installationIdentity(root);
  if (installation === null)
    throw new Error("Dependency installation is incomplete. Run vp i and retry workspace setup.");
  const file = NodePath.join(root, "node_modules", STAMP_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    NodeFS.writeFileSync(
      temporary,
      JSON.stringify({ inputs: workspaceSetupIdentity(root), installation }) + "\n",
    );
    NodeFS.renameSync(temporary, file);
  } finally {
    NodeFS.rmSync(temporary, { force: true });
  }
}

export function invalidateWorkspaceInstallation(root: string): void {
  NodeFS.rmSync(NodePath.join(root, "node_modules", STAMP_FILE), { force: true });
}
