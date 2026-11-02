#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Shared by CI and the standalone Mac publisher, which has only Node built-ins.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";
import { validateRuntimeRelease } from "./runtime-release.ts";

const BUILD_INPUTS = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
  "pnpm-lock.yaml",
];
const PUBLIC_CONFIG = [
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_JWT_TEMPLATE",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "T3CODE_RELAY_URL",
  "T3CODE_RELEASE_PUBLIC_CONFIG",
  "LOOM_CONNECT_RETIRED",
];

async function sha256(path: string) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function buildRuntimeArchive(input: {
  readonly version: string;
  readonly sourceSha: string;
  readonly sourceDir: string;
  readonly outputDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly target?: string;
}) {
  validateRuntimeRelease(input.version, input.sourceSha);
  const target = `${NodeProcess.platform}-${NodeProcess.arch}`;
  if (
    !["darwin-arm64", "linux-arm64", "linux-x64"].includes(target) ||
    (input.target && input.target !== target)
  )
    throw new Error(
      `Runtime target ${input.target ?? target} does not match a supported build host.`,
    );
  const manifest = JSON.parse(
    await NodeFSP.readFile(NodePath.join(input.sourceDir, "package.json"), "utf8"),
  ) as { engines?: { node?: string } };
  if (manifest.engines?.node !== NodeProcess.versions.node)
    throw new Error("Runtime builds require the exact Node version pinned by their source.");
  const run = (command: string, args: string[], capture = false) => {
    const result = NodeChildProcess.spawnSync(command, args, {
      cwd: input.sourceDir,
      env: { ...input.env, GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Runtime build ${command} ${args[0] ?? ""} failed (${result.status ?? result.signal}).`,
      );
    return result.stdout?.trim() ?? "";
  };
  if (run("git", ["rev-parse", "HEAD"], true) !== input.sourceSha)
    throw new Error("Runtime build checkout belongs to a different source commit.");
  if (run("git", ["status", "--porcelain", "--untracked-files=no"], true))
    throw new Error("Runtime builds require a clean isolated checkout.");
  const fingerprint = NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify({
        version: input.version,
        sourceSha: input.sourceSha,
        node: NodeProcess.versions.node,
        target,
        publicConfig: PUBLIC_CONFIG.map((key) => [key, input.env[key] ?? ""]),
      }),
    )
    .digest("hex");
  const output = NodePath.resolve(input.sourceDir, input.outputDir);
  const archive = NodePath.join(output, `t3-${input.version}-${target}.tar.gz`);
  const receiptPath = NodePath.join(output, `${target}.json`);
  const receiptText = await NodeFSP.readFile(receiptPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (receiptText !== null) {
    const receipt: unknown = JSON.parse(receiptText);
    const digest = await sha256(archive);
    if (
      !receipt ||
      typeof receipt !== "object" ||
      !("schemaVersion" in receipt) ||
      receipt.schemaVersion !== 1 ||
      !("fingerprint" in receipt) ||
      !("sha256" in receipt) ||
      receipt.fingerprint !== fingerprint ||
      receipt.sha256 !== digest
    )
      throw new Error("Prepared runtime archive does not match its checked build receipt.");
    return { archive, sha256: digest };
  }
  await NodeFSP.mkdir(output, { recursive: true });
  const monitor = NodePath.join(output, "resource-monitor", target);
  let digest: string;
  try {
    run("pnpm", ["install", "--frozen-lockfile"]);
    run(NodeProcess.execPath, ["scripts/update-release-package-versions.ts", input.version]);
    run("vp", ["run", "--filter", "t3", "build"]);
    run("cargo", [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      "native/resource-monitor/Cargo.toml",
    ]);
    await NodeFSP.mkdir(monitor, { recursive: true });
    await NodeFSP.copyFile(
      NodePath.join(input.sourceDir, "native/resource-monitor/target/release/t3-resource-monitor"),
      NodePath.join(monitor, "t3-resource-monitor"),
    );
    run(NodeProcess.execPath, ["apps/server/scripts/cli.ts", "build-exe", "--verbose"]);
    run(NodeProcess.execPath, [
      "scripts/build-cli-archive.ts",
      "--platform",
      NodeProcess.platform === "darwin" ? "mac" : "linux",
      "--arch",
      NodeProcess.arch,
      "--version",
      input.version,
      "--resource-monitor-dir",
      NodePath.dirname(monitor),
      "--output-dir",
      output,
    ]);
    run(NodeProcess.execPath, [
      "scripts/smoke-cli-archive.ts",
      "--archive",
      archive,
      "--expect-version",
      input.version,
    ]);
    digest = await sha256(archive);
  } finally {
    run("git", ["restore", "--", ...BUILD_INPUTS]);
  }
  await NodeFSP.writeFile(
    `${receiptPath}.tmp`,
    `${JSON.stringify({ schemaVersion: 1, version: input.version, sourceSha: input.sourceSha, target, fingerprint, sha256: digest }, null, 2)}\n`,
  );
  await NodeFSP.rename(`${receiptPath}.tmp`, receiptPath);
  return { archive, sha256: digest };
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      version: { type: "string" },
      "source-sha": { type: "string" },
      "output-dir": { type: "string", default: "release-cli" },
    },
  });
  await buildRuntimeArchive({
    version: values.version ?? "",
    sourceSha: values["source-sha"] ?? "",
    sourceDir: NodeProcess.cwd(),
    outputDir: values["output-dir"],
    env: NodeProcess.env,
    ...(NodeProcess.env.LOOM_RUNTIME_TARGET ? { target: NodeProcess.env.LOOM_RUNTIME_TARGET } : {}),
  }).then((result) => console.log(`Checked runtime: ${result.archive} (sha256:${result.sha256})`));
}
