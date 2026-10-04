#!/usr/bin/env node

// Local publisher for the existing desktop updater. The signing key stays on this Mac.
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - The installed launchd publisher runs outside the repository with only Node built-ins.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { serializeUpdateManifest } from "../lib/update-manifest.ts";

const REPOSITORY = "kylebegeman/loom";
const SIGNING_IDENTITY = "Loom Local Code Signing";
const LABEL = "com.kylebegeman.loom-updates";
const APP_PATH = "/Applications/Loom.app";
const STATE_DIR = NodePath.join(NodeOS.homedir(), "Library/Application Support/Loom Updates");
const BUILDS_DIR = NodePath.join(NodeOS.homedir(), "Library/Application Support/Loom Builds");
const SOURCE_DIR = NodePath.join(STATE_DIR, "source");
const PLIST_PATH = NodePath.join(NodeOS.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const LOG_PATH = NodePath.join(NodeOS.homedir(), "Library/Logs/Loom Updates.log");
const STAMPED_PACKAGES = ["apps/server", "apps/desktop", "apps/web", "packages/contracts"].map(
  (directory) => `${directory}/package.json`,
);

export function releaseForTag(tag: string, commit: string) {
  const match = /^loom-v(\d+\.\d+\.\d+(?:-nightly\.\d{8}\.\d+)?)$/.exec(tag);
  if (!match?.[1] || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Invalid Loom integration tag or commit: ${tag}`);
  }
  const version = match[1];
  return {
    tag,
    commit,
    version,
    // electron-updater ignores non-semver release tags such as loom-v… .
    // No leading v: the sync scripts reserve v* tags for upstream releases.
    // Avoid +metadata too: GitHub encodes + in Atom URLs, which the updater
    // does not decode before checking whether a tag is a semantic version.
    releaseTag: version,
    channel: version.includes("-nightly.") ? "nightly" : "latest",
    filename: `Loom-${version}-arm64.zip`,
    recordName: `${version}-${commit.slice(0, 10)}`,
  };
}

type Release = ReturnType<typeof releaseForTag>;

export function validateFeedConfig(raw: string) {
  const entries = new Map(
    raw.split(/\r?\n/).flatMap((line) => {
      const match = /^(provider|owner|repo):\s*([^\s]+)\s*$/.exec(line);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  if (
    entries.get("provider") !== "github" ||
    `${entries.get("owner")}/${entries.get("repo")}` !== REPOSITORY
  ) {
    throw new Error("The built app must use the kylebegeman/loom update feed.");
  }
}

export function buildEnvironment(sourceDir: string, env: NodeJS.ProcessEnv) {
  const result = { ...env };
  delete result.ELECTRON_RUN_AS_NODE;
  delete result.VITE_HTTP_URL;
  delete result.VITE_WS_URL;
  // Do not inherit build overrides or a mock feed from a running dev instance.
  for (const key of Object.keys(result)) {
    if (key.startsWith("T3CODE_DESKTOP_")) delete result[key];
  }
  return {
    ...result,
    PATH: [
      NodePath.join(sourceDir, "node_modules/.bin"),
      NodePath.dirname(NodeProcess.execPath),
      "/opt/homebrew/opt/rustup/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(NodePath.delimiter),
    T3CODE_DESKTOP_UPDATE_REPOSITORY: REPOSITORY,
    T3CODE_DESKTOP_SIGNED: "false",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function run(command: string, args: string[], options: { cwd?: string; stream?: boolean } = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: buildEnvironment(options.cwd ?? SOURCE_DIR, NodeProcess.env),
    encoding: "utf8",
    stdio: options.stream ? "inherit" : "pipe",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ""} failed (${result.status ?? result.signal}): ${result.stderr ?? "See the build log."}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

async function exists(filename: string) {
  try {
    await NodeFSP.stat(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function updateManifest(zipPath: string, release: Release) {
  const hash = NodeCrypto.createHash("sha512");
  for await (const chunk of NodeFS.createReadStream(zipPath)) hash.update(chunk);
  return serializeUpdateManifest(
    {
      version: release.version,
      releaseDate: new Date().toISOString(),
      files: [
        {
          url: NodePath.basename(zipPath),
          sha512: hash.digest("base64"),
          size: (await NodeFSP.stat(zipPath)).size,
        },
      ],
      extras: {},
    },
    { platformLabel: "macOS" },
  );
}

// Only prune this publisher's completed records. Preserve the installed build,
// including when Squirrel installed it without updating the legacy marker.
export async function prunePublishedBuilds(directory: string, installed: string) {
  const records: { name: string; built: string }[] = [];
  for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
    const record = NodePath.join(directory, entry.name);
    if (!entry.isDirectory() || !(await exists(NodePath.join(record, "updates/ready")))) continue;
    const metadata = await NodeFSP.readFile(NodePath.join(record, "build.env"), "utf8");
    const built = /^built=(.+)$/m.exec(metadata)?.[1];
    if (built) records.push({ name: entry.name, built });
  }
  records.sort((a, b) => b.built.localeCompare(a.built));
  for (const record of records.slice(3)) {
    if (record.name !== installed)
      await NodeFSP.rm(NodePath.join(directory, record.name), { recursive: true });
  }
}

async function installedRecordName() {
  const embedded = NodePath.join(APP_PATH, "Contents/Resources/loom-build.env");
  if (await exists(embedded)) {
    const raw = await NodeFSP.readFile(embedded, "utf8");
    const version = /^upstream=(.+)$/m.exec(raw)?.[1];
    const commit = /^commit=([a-f0-9]{40})$/m.exec(raw)?.[1];
    if (version && commit) return `${version}-${commit.slice(0, 10)}`;
  }
  const marker = NodePath.join(BUILDS_DIR, "installed");
  return (await exists(marker)) ? (await NodeFSP.readFile(marker, "utf8")).trim() : "";
}

async function latestIntegration() {
  await NodeFSP.mkdir(STATE_DIR, { recursive: true });
  if (!(await exists(SOURCE_DIR))) {
    run(
      "git",
      [
        "clone",
        "--no-checkout",
        "--no-tags",
        "--single-branch",
        "--branch",
        "main",
        `https://github.com/${REPOSITORY}.git`,
        SOURCE_DIR,
      ],
      { stream: true },
    );
    run("git", ["sparse-checkout", "set", "--no-cone", "/*", "!/.repos/"], { cwd: SOURCE_DIR });
  }
  if (
    run("git", ["remote", "get-url", "origin"], { cwd: SOURCE_DIR }) !==
    `https://github.com/${REPOSITORY}.git`
  ) {
    throw new Error(`Unexpected repository in ${SOURCE_DIR}`);
  }
  run(
    "git",
    [
      "fetch",
      "--quiet",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
      "refs/tags/loom-*:refs/tags/loom-*",
    ],
    { cwd: SOURCE_DIR },
  );
  const tag = run(
    "git",
    [
      "for-each-ref",
      "--sort=-creatordate",
      "--merged=refs/remotes/origin/main",
      "--format=%(refname:short)",
      "refs/tags/loom-v*",
    ],
    { cwd: SOURCE_DIR },
  ).split("\n")[0];
  if (!tag) throw new Error("No merged Loom integration tag is available.");
  return releaseForTag(tag, run("git", ["rev-parse", `${tag}^{commit}`], { cwd: SOURCE_DIR }));
}

async function releaseState(release: Release) {
  // A successful list distinguishes a missing release from auth/network failures.
  const raw = run("gh", [
    "release",
    "list",
    "--repo",
    REPOSITORY,
    "--limit",
    "100",
    "--json",
    "tagName,isDraft",
    "--jq",
    `.[] | select(.tagName == "${release.releaseTag}") | .isDraft`,
  ]);
  return raw === "false" ? "published" : raw === "true" ? "draft" : "missing";
}

function ensureBlockmap(zip: string) {
  // Reuse the pinned packager's block-map implementation after signing changes
  // the ZIP. The map electron-builder made for the unsigned ZIP is no longer valid.
  run(
    NodeProcess.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const builder = createRequire(require.resolve("electron-builder", { paths: ["./apps/desktop"] }));
    const { buildBlockMap } = builder("app-builder-lib/out/targets/blockmap/blockmap.js");
    await buildBlockMap(process.argv[1], "gzip", process.argv[1] + ".blockmap");
  `,
      zip,
    ],
    { cwd: SOURCE_DIR },
  );
}

async function prepare(release: Release) {
  const record = NodePath.join(BUILDS_DIR, release.recordName);
  const artifacts = NodePath.join(record, "updates");
  const zip = NodePath.join(artifacts, release.filename);
  const manifest = NodePath.join(artifacts, `${release.channel}-mac.yml`);
  if (await exists(NodePath.join(artifacts, "ready"))) {
    if (!(await exists(`${zip}.blockmap`))) ensureBlockmap(zip);
    return { record, zip, manifest };
  }

  const identities = run("security", [
    "find-identity",
    "-p",
    "codesigning",
    NodePath.join(NodeOS.homedir(), "Library/Keychains/login.keychain-db"),
  ]);
  if (!identities.includes(`"${SIGNING_IDENTITY}"`))
    throw new Error(`Missing ${SIGNING_IDENTITY}; run scripts/fork/loom.sh signing-setup first.`);
  if (await exists(record))
    throw new Error(
      `An incomplete or older build already exists at ${record}; inspect it before retrying.`,
    );

  run("git", ["checkout", "--quiet", "--detach", release.commit], { cwd: SOURCE_DIR });
  if (run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: SOURCE_DIR })) {
    throw new Error(`The isolated build checkout has changes: ${SOURCE_DIR}`);
  }
  const staging = await NodeFSP.mkdtemp(NodePath.join(STATE_DIR, "build-"));
  try {
    console.log(`Building Loom ${release.version} (${release.commit.slice(0, 10)}).`);
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: SOURCE_DIR, stream: true });
    run(NodeProcess.execPath, ["scripts/update-release-package-versions.ts", release.version], {
      cwd: SOURCE_DIR,
      stream: true,
    });
    run(
      NodeProcess.execPath,
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "mac",
        "--target",
        "zip",
        "--arch",
        "arm64",
        "--build-version",
        release.version,
        "--output-dir",
        staging,
      ],
      { cwd: SOURCE_DIR, stream: true },
    );
    const zipNames = (await NodeFSP.readdir(staging)).filter((filename) =>
      filename.endsWith("-arm64.zip"),
    );
    if (zipNames.length !== 1) throw new Error("Expected exactly one macOS arm64 ZIP.");
    const unpacked = NodePath.join(staging, "unpacked");
    run("ditto", ["-x", "-k", NodePath.join(staging, zipNames[0]!), unpacked]);
    const apps = (await NodeFSP.readdir(unpacked)).filter((filename) => filename.endsWith(".app"));
    if (apps.length !== 1 || !/^Loom(?: \(Nightly\))?\.app$/.test(apps[0]!))
      throw new Error("The build did not produce Loom.app.");
    const app = NodePath.join(unpacked, "Loom.app");
    if (apps[0] !== "Loom.app") await NodeFSP.rename(NodePath.join(unpacked, apps[0]!), app);
    const resources = NodePath.join(app, "Contents/Resources");
    validateFeedConfig(await NodeFSP.readFile(NodePath.join(resources, "app-update.yml"), "utf8"));
    const buildRecord = `upstream=${release.version}\ncommit=${release.commit}\nbuilt=${new Date().toISOString()}\n`;
    await NodeFSP.writeFile(NodePath.join(resources, "loom-build.env"), buildRecord);
    run("codesign", ["--force", "--deep", "--sign", SIGNING_IDENTITY, app], { stream: true });
    run("codesign", ["--verify", "--deep", "--strict", app], { stream: true });
    if (await exists(APP_PATH)) {
      // Squirrel validates the new bundle against the installed app's requirement.
      const requirement = NodeChildProcess.spawnSync("codesign", ["-d", "-r-", APP_PATH], {
        encoding: "utf8",
      });
      const expression = /^designated => (.+)$/m.exec(requirement.stdout)?.[1];
      if (requirement.status !== 0 || !expression)
        throw new Error("Cannot read the installed Loom signing requirement.");
      run("codesign", ["--verify", "--deep", "--strict", "-R", `=${expression}`, app], {
        stream: true,
      });
    }
    const stagedRecord = NodePath.join(staging, "record");
    await NodeFSP.mkdir(NodePath.join(stagedRecord, "updates"), { recursive: true });
    await NodeFSP.rename(app, NodePath.join(stagedRecord, "Loom.app"));
    await NodeFSP.writeFile(NodePath.join(stagedRecord, "build.env"), buildRecord);
    const stagedZip = NodePath.join(stagedRecord, "updates", release.filename);
    run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      NodePath.join(stagedRecord, "Loom.app"),
      stagedZip,
    ]);
    ensureBlockmap(stagedZip);
    await NodeFSP.writeFile(
      NodePath.join(stagedRecord, "updates", NodePath.basename(manifest)),
      await updateManifest(stagedZip, release),
    );
    await NodeFSP.writeFile(NodePath.join(stagedRecord, "updates", "ready"), `${release.commit}\n`);
    await NodeFSP.mkdir(BUILDS_DIR, { recursive: true });
    await NodeFSP.rename(stagedRecord, record);
    return { record, zip, manifest };
  } finally {
    run("git", ["restore", "--", ...STAMPED_PACKAGES, "pnpm-lock.yaml"], { cwd: SOURCE_DIR });
    await NodeFSP.rm(staging, { recursive: true, force: true });
  }
}

async function publish(release: Release, prepared: Awaited<ReturnType<typeof prepare>>) {
  const state = await releaseState(release);
  if (state === "published") return;
  const notes = NodePath.join(prepared.record, "updates/release-notes.md");
  await NodeFSP.writeFile(
    notes,
    `Loom built from the checked integration [${release.tag}](https://github.com/${REPOSITORY}/tree/${release.tag}).\n\nIncludes upstream T3 Code [v${release.version}](https://github.com/pingdotgg/t3code/releases/tag/v${release.version}).\n\nUse Loom's update button to download, then restart and install when ready.\n\nSource commit: ${release.commit}. macOS Apple Silicon; signed with Kyle's local Loom certificate.\n`,
  );
  if (state === "missing") {
    run(
      "gh",
      [
        "release",
        "create",
        release.releaseTag,
        "--repo",
        REPOSITORY,
        "--target",
        release.commit,
        "--title",
        `Loom ${release.version}`,
        "--notes-file",
        notes,
        "--draft",
        "--latest=false",
        ...(release.channel === "nightly" ? ["--prerelease"] : []),
      ],
      { stream: true },
    );
  }
  // A draft keeps an incomplete upload out of the app's feed; retries finish it.
  run(
    "gh",
    [
      "release",
      "upload",
      release.releaseTag,
      prepared.zip,
      `${prepared.zip}.blockmap`,
      prepared.manifest,
      "--repo",
      REPOSITORY,
      "--clobber",
    ],
    { stream: true },
  );
  run(
    "gh",
    [
      "release",
      "edit",
      release.releaseTag,
      "--repo",
      REPOSITORY,
      "--draft=false",
      `--latest=${release.channel === "latest"}`,
    ],
    { stream: true },
  );
  console.log(`Published https://github.com/${REPOSITORY}/releases/tag/${release.releaseTag}`);
  await prunePublishedBuilds(BUILDS_DIR, await installedRecordName());
}

export function launchAgent(node: string, script: string, logPath: string) {
  const xml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>publish</string></array>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>1800</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(logPath)}</string>
<key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>
`;
}

async function enable() {
  const tools = NodePath.join(STATE_DIR, "tools/scripts");
  await NodeFSP.mkdir(NodePath.join(tools, "fork"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(tools, "lib"), { recursive: true });
  const script = NodePath.join(tools, "fork/updates.ts");
  if (NodeURL.fileURLToPath(import.meta.url) !== script) {
    await NodeFSP.copyFile(NodeURL.fileURLToPath(import.meta.url), script);
    await NodeFSP.copyFile(
      NodeURL.fileURLToPath(new URL("../lib/update-manifest.ts", import.meta.url)),
      NodePath.join(tools, "lib/update-manifest.ts"),
    );
  }
  await NodeFSP.mkdir(NodePath.dirname(PLIST_PATH), { recursive: true });
  await NodeFSP.mkdir(NodePath.dirname(LOG_PATH), { recursive: true });
  if (await exists(PLIST_PATH))
    run("launchctl", ["bootout", `gui/${NodeProcess.getuid!()}`, PLIST_PATH]);
  await NodeFSP.writeFile(PLIST_PATH, launchAgent(NodeProcess.execPath, script, LOG_PATH));
  run("plutil", ["-lint", PLIST_PATH]);
  run("launchctl", ["bootstrap", `gui/${NodeProcess.getuid!()}`, PLIST_PATH]);
  console.log(
    `Loom will check for a merged integration every 30 minutes while you are logged in.\nLog: ${LOG_PATH}`,
  );
}

async function withLock(body: () => Promise<void>) {
  await NodeFSP.mkdir(STATE_DIR, { recursive: true });
  const lock = NodePath.join(STATE_DIR, "publisher.lock");
  try {
    await NodeFSP.mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await NodeFSP.readFile(NodePath.join(lock, "pid"), "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error(`Inspect the incomplete lock at ${lock}`, { cause: error });
    try {
      NodeProcess.kill(pid, 0);
      console.log(`A publisher is already running (PID ${pid}).`);
      return;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
    await NodeFSP.rm(lock, { recursive: true });
    await NodeFSP.mkdir(lock);
  }
  await NodeFSP.writeFile(NodePath.join(lock, "pid"), String(NodeProcess.pid));
  try {
    await body();
  } finally {
    await NodeFSP.rm(lock, { recursive: true, force: true });
  }
}

async function main(command: string | undefined) {
  if (!NodeProcess.versions.node.startsWith("24."))
    throw new Error(
      "Run the Loom publisher with Node 24, matching the repository's engine requirement.",
    );
  if (NodeProcess.platform !== "darwin" || NodeProcess.arch !== "arm64")
    throw new Error("The local Loom publisher requires an Apple Silicon Mac.");
  if (command === "enable") return enable();
  if (command === "disable") {
    if (await exists(PLIST_PATH)) {
      run("launchctl", ["bootout", `gui/${NodeProcess.getuid!()}`, PLIST_PATH]);
      await NodeFSP.rm(PLIST_PATH);
    }
    console.log("Automatic Loom publishing is disabled.");
    return;
  }
  if (command === "status") {
    console.log(
      `Scheduler: ${(await exists(PLIST_PATH)) ? "installed" : "not installed"}\nBuilds: ${BUILDS_DIR}\nLog: ${LOG_PATH}`,
    );
    return;
  }
  if (command !== "prepare" && command !== "publish" && command !== "check") {
    throw new Error(
      "Usage: node scripts/fork/updates.ts <check|prepare|publish|enable|disable|status>",
    );
  }
  await withLock(async () => {
    const release = await latestIntegration();
    const state = await releaseState(release);
    console.log(`${new Date().toISOString()} ${release.tag}: ${state}`);
    if (command === "check" || (command === "publish" && state === "published")) return;
    const prepared = await prepare(release);
    console.log(`Prepared ${prepared.record}/Loom.app`);
    if (command === "publish") await publish(release, prepared);
  });
}

if (import.meta.main) {
  await main(NodeProcess.argv[2]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
