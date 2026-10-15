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
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

import { serializeUpdateManifest } from "../lib/update-manifest.ts";
import { ensureRuntimeReleaseAssets } from "./runtime-release.ts";
import {
  loomConnectBuildEnvironment,
  parseLoomConnectConfig,
  type LoomConnectConfig,
} from "./connect-config.ts";

const REPOSITORY = "kylebegeman/loom";
const OFFICIAL_UPSTREAM = "https://github.com/pingdotgg/t3code.git";
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

const LOOM_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.([1-9]\d{7})\.(0|[1-9]\d*))?$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/;

type PublicationTag = { readonly tag: string; readonly commit: string };
type ReleaseContext = {
  readonly publications?: readonly PublicationTag[];
  readonly annotation?: string;
  /** Genuine upstream tags already verified as ancestors of the selected source. */
  readonly upstreamTags?: readonly string[];
};

const parsedVersion = (version: string) => {
  const match = LOOM_VERSION.exec(version);
  if (!match) throw new Error(`Invalid Loom publication version: ${version}`);
  return {
    core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)] as const,
    nightly: match[4] === undefined ? null : ([match[4], BigInt(match[5]!)] as const),
  };
};

const compareVersions = (left: string, right: string) => {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index]! !== b.core[index]!) return a.core[index]! > b.core[index]! ? 1 : -1;
  }
  if (a.nightly === null || b.nightly === null)
    return a.nightly === b.nightly ? 0 : a.nightly === null ? 1 : -1;
  const date = a.nightly[0].localeCompare(b.nightly[0]);
  if (date) return date;
  return a.nightly[1] === b.nightly[1] ? 0 : a.nightly[1] > b.nightly[1] ? 1 : -1;
};

const annotationValue = (annotation: string, key: string) => {
  const values = annotation.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
  if (values.length > 1) throw new Error(`Repeated ${key} in Loom integration annotation.`);
  return values[0]?.slice(key.length + 1).trim();
};

const annotatedUpstream = (annotation: string) => {
  const tag =
    annotationValue(annotation, "upstream") ??
    /^Loom built from upstream (v[^\s]+)$/m.exec(annotation)?.[1];
  if (tag !== undefined && (!tag.startsWith("v") || !LOOM_VERSION.test(tag.slice(1))))
    throw new Error("Invalid annotated upstream tag; use an exact stable or nightly v* tag.");
  return tag;
};

const repositoryIntegration = (sourceDir: string, tag: string) => {
  if (!tag.startsWith("loom-v") || !LOOM_VERSION.test(tag.slice("loom-v".length)))
    throw new Error(`Invalid Loom integration tag: ${tag}`);
  const ref = `refs/tags/${tag}`;
  const commit = run("git", ["rev-parse", `${ref}^{commit}`], { cwd: sourceDir });
  const annotation =
    run("git", ["cat-file", "-t", ref], { cwd: sourceDir }) === "tag"
      ? run("git", ["for-each-ref", "--format=%(contents)", ref], { cwd: sourceDir })
      : "";
  return { commit, annotation };
};

/** Fork origin need not mirror upstream tags. Fetch only the claimed official ref, never moving an existing one. */
export function ensureUpstreamProvenance(
  sourceDir: string,
  tag: string,
  upstream = OFFICIAL_UPSTREAM,
) {
  const integration = repositoryIntegration(sourceDir, tag);
  const claimed = annotatedUpstream(integration.annotation);
  if (claimed === undefined) return;
  const ref = `refs/tags/${claimed}`;
  if (run("git", ["tag", "--list", claimed], { cwd: sourceDir }) === "")
    run("git", ["fetch", "--quiet", "--no-tags", upstream, `${ref}:${ref}`], { cwd: sourceDir });
  try {
    run("git", ["merge-base", "--is-ancestor", `${ref}^{commit}`, integration.commit], {
      cwd: sourceDir,
    });
  } catch (cause) {
    throw new Error("The annotated upstream tag is not an ancestor of the selected source.", {
      cause,
    });
  }
}

// Upstream owns its version train. Loom stays within its last approved major/minor
// and advances one patch for each newly published source, keeping the nightly
// coordinates of the upstream build it carries.
const nextPatch = (latest: string, nightlyFrom: string) => {
  const { core } = parsedVersion(latest);
  const nightly = nightlyFrom.includes("-nightly.")
    ? nightlyFrom.slice(nightlyFrom.indexOf("-nightly."))
    : "";
  return `${core[0]}.${core[1]}.${core[2] + 1n}${nightly}`;
};

/** The release version for fork changes on main that no integration tag covers yet. */
export function nextLoomVersion(publications: readonly string[], upstreamTag = "") {
  const latest = publications
    .filter((tag) => LOOM_VERSION.test(tag))
    .toSorted((a, b) => compareVersions(b, a))[0];
  if (!latest) throw new Error("No Loom publication exists to continue from.");
  return nextPatch(latest, upstreamTag);
}

export function releaseForTag(tag: string, commit: string, context: ReleaseContext = {}) {
  const requested = tag.startsWith("loom-v") ? tag.slice("loom-v".length) : "";
  if (!LOOM_VERSION.test(requested) || !SOURCE_COMMIT.test(commit)) {
    throw new Error(`Invalid Loom integration tag or commit: ${tag}`);
  }
  const annotation = context.annotation ?? "";
  const explicit = annotationValue(annotation, "loom-release");
  if (explicit !== undefined && explicit !== requested)
    throw new Error("The annotated Loom release version must match its integration tag.");
  const publications = (context.publications ?? [])
    .filter((item) => LOOM_VERSION.test(item.tag))
    .map((item) => {
      if (!SOURCE_COMMIT.test(item.commit))
        throw new Error(`Loom publication tag does not identify a commit: ${item.tag}`);
      return item;
    })
    .toSorted((a, b) => compareVersions(b.tag, a.tag));
  const channel = requested.includes("-nightly.") ? "nightly" : "latest";
  const existing = publications.find(
    (item) =>
      item.commit === commit && (item.tag.includes("-nightly.") ? "nightly" : "latest") === channel,
  );
  let version = existing?.tag ?? requested;
  const latest = publications[0]?.tag;
  if (!existing && latest) {
    if (explicit !== undefined) {
      if (compareVersions(explicit, latest) <= 0)
        throw new Error(`The explicit Loom release must be newer than ${latest}.`);
      version = explicit;
    } else {
      version = nextPatch(latest, requested);
    }
  }
  const upstreamTags = (context.upstreamTags ?? []).filter(
    (item) => item.startsWith("v") && LOOM_VERSION.test(item.slice(1)),
  );
  const claimed = annotatedUpstream(annotation);
  if (claimed !== undefined && !upstreamTags.includes(claimed))
    throw new Error("The annotated upstream tag is not present in this source history.");
  const upstreamTag = claimed ?? upstreamTags[0];
  return {
    tag,
    commit,
    version,
    upstreamTag,
    // Bare-version tags belong to Loom publication; v* tags remain upstream's.
    releaseTag: version,
    channel,
    filename: `Loom-${version}-arm64.zip`,
    recordName: `${version}-${commit.slice(0, 10)}`,
  };
}

/** Bare-version tags reserved or published by Loom, with the commit each one released. */
function publicationTags(sourceDir: string) {
  return run(
    "git",
    [
      "for-each-ref",
      "--format=%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)",
      "refs/tags",
    ],
    { cwd: sourceDir },
  )
    .split("\n")
    .flatMap((line) => {
      const [name, kind, object, peeledKind, peeled] = line.split("\t");
      if (!name || !LOOM_VERSION.test(name)) return [];
      const sha = kind === "commit" ? object : peeledKind === "commit" ? peeled : undefined;
      if (!sha) throw new Error(`Loom publication tag does not identify a commit: ${name}`);
      return [{ tag: name, commit: sha }];
    });
}

/** Read immutable version state from Git, including reserved and draft publications. */
export function releaseFromRepository(sourceDir: string, tag: string) {
  const { commit, annotation } = repositoryIntegration(sourceDir, tag);
  const publications = publicationTags(sourceDir);
  const upstreamTags = run(
    "git",
    ["tag", "--list", "v[0-9]*", "--merged", commit, "--sort=-creatordate"],
    { cwd: sourceDir },
  ).split("\n");
  return releaseForTag(tag, commit, { publications, annotation, upstreamTags });
}

/** Reserve the publication identity before building; failed runs retry the same immutable tag. */
export function reservePublicationTag(release: Release, sourceDir = SOURCE_DIR) {
  const exists = run("git", ["tag", "--list", release.releaseTag], { cwd: sourceDir }) !== "";
  if (
    exists &&
    run("git", ["rev-parse", `${release.releaseTag}^{commit}`], { cwd: sourceDir }) !==
      release.commit
  )
    throw new Error("The Loom publication tag already belongs to a different source.");
  if (!exists) run("git", ["tag", release.releaseTag, release.commit], { cwd: sourceDir });
  try {
    run("git", ["push", "--quiet", "origin", `refs/tags/${release.releaseTag}`], {
      cwd: sourceDir,
    });
  } catch (cause) {
    // Only this attempt's local reservation can be removed. Remote and preexisting
    // tags stay immutable; a concurrent host's winning reservation is fetched next time.
    if (!exists) run("git", ["tag", "-d", release.releaseTag], { cwd: sourceDir });
    throw cause;
  }
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

function publisherConnectConfig() {
  const connectPath = NodePath.join(STATE_DIR, "connect.json");
  return NodeFS.existsSync(connectPath)
    ? parseLoomConnectConfig(JSON.parse(NodeFS.readFileSync(connectPath, "utf8")))
    : undefined;
}

export function buildEnvironment(
  sourceDir: string,
  env: NodeJS.ProcessEnv,
  connect?: LoomConnectConfig | null,
) {
  const result = { ...env };
  delete result.ELECTRON_RUN_AS_NODE;
  delete result.CLERK_SECRET_KEY;
  delete result.VITE_HTTP_URL;
  delete result.VITE_WS_URL;
  // Do not inherit build overrides or a mock feed from a running dev instance.
  for (const key of Object.keys(result)) {
    if (key.startsWith("T3CODE_DESKTOP_")) delete result[key];
  }
  if (connect !== undefined) {
    for (const key of [
      "T3CODE_CLERK_PUBLISHABLE_KEY",
      "T3CODE_CLERK_JWT_TEMPLATE",
      "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
      "T3CODE_RELAY_URL",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_T3CODE_RELAY_URL",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
      "LOOM_MOBILE_AUTH_DOMAIN",
      "LOOM_MOBILE_ACCOUNT_PORTAL_URL",
    ])
      delete result[key];
  }
  return {
    ...result,
    ...(connect !== undefined ? loomConnectBuildEnvironment(connect) : {}),
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
    T3CODE_RELEASE_PUBLIC_CONFIG: "1",
    T3CODE_DESKTOP_UPDATE_REPOSITORY: REPOSITORY,
    T3CODE_DESKTOP_SIGNED: "false",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; stream?: boolean; connect?: LoomConnectConfig | null } = {},
) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: buildEnvironment(
      options.cwd ?? SOURCE_DIR,
      NodeProcess.env,
      options.connect !== undefined ? options.connect : publisherConnectConfig(),
    ),
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
    const version = /^version=(.+)$/m.exec(raw)?.[1] ?? /^upstream=(.+)$/m.exec(raw)?.[1];
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
      // Include bare Loom publication state; missing annotated upstream refs are fetched below.
      "refs/tags/*:refs/tags/*",
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
  ensureUpstreamProvenance(SOURCE_DIR, tag);
  return releaseFromRepository(SOURCE_DIR, tag);
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

export function restoreBuildInputs(sourceDir: string) {
  // The desktop build regenerates this tracked CSS module. Leaving it dirty
  // prevents a later integration from checking out in the publisher's private clone.
  run(
    "git",
    [
      "restore",
      "--",
      ...STAMPED_PACKAGES,
      "pnpm-lock.yaml",
      "apps/desktop/src/preview/AnnotationStyles.generated.ts",
    ],
    { cwd: sourceDir },
  );
}

/** Old records predate public configuration receipts and retain disabled Connect on replay. */
export async function preparedConnectConfig(record: string, sourceSha: string) {
  const path = NodePath.join(record, "connect-config.json");
  if (!(await exists(path))) return null;
  const value: unknown = JSON.parse(await NodeFSP.readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prepared Connect configuration must be an object.");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.schemaVersion !== 1 || receipt.sourceSha !== sourceSha) {
    throw new Error("Prepared Connect configuration belongs to a different source.");
  }
  return receipt.connectConfig === null ? null : parseLoomConnectConfig(receipt.connectConfig);
}

async function prepare(release: Release) {
  const record = NodePath.join(BUILDS_DIR, release.recordName);
  const artifacts = NodePath.join(record, "updates");
  const zip = NodePath.join(artifacts, release.filename);
  const manifest = NodePath.join(artifacts, `${release.channel}-mac.yml`);
  if (await exists(NodePath.join(artifacts, "ready"))) {
    if (!(await exists(`${zip}.blockmap`))) ensureBlockmap(zip);
    return {
      record,
      zip,
      manifest,
      connectConfig: await preparedConnectConfig(record, release.commit),
    };
  }
  const connectConfig = publisherConnectConfig() ?? null;

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
    run("pnpm", ["install", "--frozen-lockfile"], {
      cwd: SOURCE_DIR,
      stream: true,
      connect: connectConfig,
    });
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
      { cwd: SOURCE_DIR, stream: true, connect: connectConfig },
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
    const buildRecord = `version=${release.version}\nintegration=${release.tag}\nupstream=${release.upstreamTag ?? ""}\ncommit=${release.commit}\nbuilt=${new Date().toISOString()}\n`;
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
    await NodeFSP.writeFile(
      NodePath.join(stagedRecord, "connect-config.json"),
      `${JSON.stringify({ schemaVersion: 1, sourceSha: release.commit, connectConfig }, null, 2)}\n`,
      { mode: 0o600 },
    );
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
    return { record, zip, manifest, connectConfig };
  } finally {
    try {
      restoreBuildInputs(SOURCE_DIR);
    } finally {
      await NodeFSP.rm(staging, { recursive: true, force: true });
    }
  }
}

async function publish(release: Release, prepared: Awaited<ReturnType<typeof prepare>>) {
  const state = await releaseState(release);
  if (state === "published") return;
  const notes = NodePath.join(prepared.record, "updates/release-notes.md");
  await NodeFSP.writeFile(
    notes,
    `Loom built from the checked integration [${release.tag}](https://github.com/${REPOSITORY}/tree/${release.tag}).

${release.upstreamTag ? `Includes upstream T3 Code [${release.upstreamTag}](https://github.com/pingdotgg/t3code/releases/tag/${release.upstreamTag}).` : ""}

Use Loom's update button to download, then restart and install when ready.

Source commit: ${release.commit}. macOS Apple Silicon; signed with Kyle's local Loom certificate.
`,
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
  await ensureRuntimeReleaseAssets({
    version: release.version,
    sourceSha: release.commit,
    env: buildEnvironment(SOURCE_DIR, NodeProcess.env, prepared.connectConfig),
    log: (message) => console.log(message),
  });
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
      NodeURL.fileURLToPath(new URL("./connect-config.ts", import.meta.url)),
      NodePath.join(tools, "fork/connect-config.ts"),
    );
    await NodeFSP.copyFile(
      NodeURL.fileURLToPath(new URL("./runtime-release.ts", import.meta.url)),
      NodePath.join(tools, "fork/runtime-release.ts"),
    );
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

// The scheduled run skips while another publisher works; `land` waits its turn instead,
// because it installs the build the run produces.
async function withLock(body: () => Promise<void>, wait = false) {
  await NodeFSP.mkdir(STATE_DIR, { recursive: true });
  const lock = NodePath.join(STATE_DIR, "publisher.lock");
  let waiting = false;
  for (;;) {
    try {
      await NodeFSP.mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await NodeFSP.readFile(NodePath.join(lock, "pid"), "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error(`Inspect the incomplete lock at ${lock}`, { cause: error });
      let running = true;
      try {
        NodeProcess.kill(pid, 0);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
        running = false;
      }
      if (!running) {
        await NodeFSP.rm(lock, { recursive: true });
        continue;
      }
      if (!wait) {
        console.log(`A publisher is already running (PID ${pid}).`);
        return;
      }
      if (!waiting) console.log(`Waiting for the running publisher (PID ${pid}) to finish.`);
      waiting = true;
      await NodeTimersPromises.setTimeout(10_000);
    }
  }
  await NodeFSP.writeFile(NodePath.join(lock, "pid"), String(NodeProcess.pid));
  try {
    await body();
  } finally {
    await NodeFSP.rm(lock, { recursive: true, force: true });
  }
}

/** Optional local iOS delivery uses the same already-published source as desktop. */
export function iosPublishConfig(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Loom iOS publishing configuration must be an object.");
  }
  const value = raw as Record<string, unknown>;
  if (value.enabled === false) return null;
  if (value.enabled !== true)
    throw new Error("Loom iOS publishing requires an explicit enabled setting.");
  const teamId = value.teamId;
  const appId = value.appId;
  const profile = value.profile;
  const groups = value.groups;
  const exportOptions = value.exportOptions;
  const signingKeychain = value.signingKeychain;
  const signingKeychainPasswordFile = value.signingKeychainPasswordFile;
  if (typeof teamId !== "string" || !/^[A-Z0-9]{10}$/.test(teamId) || teamId === "ARK85ZXQ4Z") {
    throw new Error("Configure your own Apple team for Loom iOS publishing.");
  }
  if (typeof appId !== "string" || !/^[1-9][0-9]+$/.test(appId) || appId === "6787819824") {
    throw new Error("Configure your own App Store Connect app for Loom iOS publishing.");
  }
  if (typeof profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(profile)) {
    throw new Error("Configure a named asc authentication profile for Loom iOS publishing.");
  }
  if (
    groups !== undefined &&
    (!Array.isArray(groups) ||
      !groups.every(
        (group) => typeof group === "string" && group.trim() !== "" && !/[\r\n,]/.test(group),
      ))
  ) {
    throw new Error("Loom iOS TestFlight groups must be an array of nonempty names or IDs.");
  }
  if (
    exportOptions !== undefined &&
    (typeof exportOptions !== "string" || !NodePath.isAbsolute(exportOptions))
  ) {
    throw new Error("Loom iOS export options must be an absolute plist path.");
  }
  if (
    (signingKeychain !== undefined || signingKeychainPasswordFile !== undefined) &&
    (typeof signingKeychain !== "string" ||
      !NodePath.isAbsolute(signingKeychain) ||
      typeof signingKeychainPasswordFile !== "string" ||
      !NodePath.isAbsolute(signingKeychainPasswordFile))
  ) {
    throw new Error(
      "Loom iOS signing keychain and protected password file require paired absolute paths.",
    );
  }
  return {
    teamId,
    appId,
    profile,
    signingKeychain: signingKeychain as string | undefined,
    signingKeychainPasswordFile: signingKeychainPasswordFile as string | undefined,
    groups: groups as string[] | undefined,
    exportOptions: exportOptions as string | undefined,
  };
}

/** Unlock only the configured signing keychain without putting its password in process arguments. */
export function unlockIosSigningKeychain(keychain: string, passwordFile: string) {
  run("/usr/bin/python3", [
    "-c",
    `import ctypes, os, stat, sys
fd = os.open(sys.argv[2], os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(fd, "rb") as source:
    info = os.fstat(source.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise SystemExit("Signing keychain password must be a private file owned by this user.")
    password = source.read(4097).rstrip(b"\\r\\n")
if not password or len(password) > 4096 or b"\\0" in password:
    raise SystemExit("Signing keychain password file has invalid contents.")
security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
security.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
security.SecKeychainUnlock.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_bool]
keychain = ctypes.c_void_p()
status = security.SecKeychainOpen(os.fsencode(sys.argv[1]), ctypes.byref(keychain))
if status == 0:
    status = security.SecKeychainUnlock(keychain, len(password), password, True)
if status != 0:
    raise SystemExit("Cannot unlock configured signing keychain (OSStatus %s)." % status)
`,
    keychain,
    passwordFile,
  ]);
}

/** Use the newest verification attempt for this exact source, including reruns. */
export function iosSourceQualification(
  runs: readonly {
    headSha: string;
    path: string;
    status: string;
    conclusion: string | null;
    databaseId: number;
  }[],
  commit: string,
) {
  const latest = runs
    .filter(
      (item) =>
        item.headSha === commit && item.path === ".github/workflows/loom-ios-testflight.yml",
    )
    .sort((a, b) => b.databaseId - a.databaseId)[0];
  return latest?.status === "completed" && latest.conclusion === "success"
    ? "qualified"
    : "pending";
}

export function automaticIosEnvironment(env: NodeJS.ProcessEnv) {
  const result = { ...env };
  for (const key of ["LOOM_IOS_BUILD_NUMBER", "LOOM_IOS_SOURCE_SHA", "LOOM_IOS_EXPORT_OPTIONS"])
    delete result[key];
  return result;
}

async function publishIos(release: Release) {
  const configPath = NodePath.join(STATE_DIR, "ios.json");
  if (!(await exists(configPath))) return;
  const config = iosPublishConfig(JSON.parse(await NodeFSP.readFile(configPath, "utf8")));
  if (!config) return;
  const runs = JSON.parse(
    run("gh", [
      "run",
      "list",
      "--repo",
      REPOSITORY,
      "--workflow",
      "loom-ios-testflight.yml",
      "--commit",
      release.commit,
      "--limit",
      "20",
      "--json",
      "headSha,workflowName,status,conclusion,databaseId",
    ]),
  ) as {
    headSha: string;
    workflowName: string;
    status: string;
    conclusion: string | null;
    databaseId: number;
  }[];
  const qualification = iosSourceQualification(
    runs.map((item) => ({ ...item, path: ".github/workflows/loom-ios-testflight.yml" })),
    release.commit,
  );
  if (qualification !== "qualified") {
    console.log(
      "Desktop is published; waiting for successful Loom iOS verification of this exact source before TestFlight delivery.",
    );
    return;
  }
  if (run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: SOURCE_DIR })) {
    throw new Error(
      "The isolated publisher checkout has changes; iOS delivery cannot change its source.",
    );
  }
  run("git", ["checkout", "--quiet", "--detach", release.commit], { cwd: SOURCE_DIR });
  const script = NodePath.join(SOURCE_DIR, "scripts/fork/ios-release.ts");
  if (!(await exists(script))) {
    console.log(
      "This published source predates Loom iOS delivery; waiting for the next qualified release.",
    );
    return;
  }
  if (config.signingKeychain && config.signingKeychainPasswordFile)
    unlockIosSigningKeychain(config.signingKeychain, config.signingKeychainPasswordFile);
  const connectConfig = await preparedConnectConfig(
    NodePath.join(BUILDS_DIR, release.recordName),
    release.commit,
  );
  const result = NodeChildProcess.spawnSync(
    NodeProcess.execPath,
    [
      script,
      "release",
      "--output-dir",
      NodePath.join(STATE_DIR, "ios", release.recordName),
      "--source-sha",
      release.commit,
    ],
    {
      cwd: SOURCE_DIR,
      env: {
        ...automaticIosEnvironment(buildEnvironment(SOURCE_DIR, NodeProcess.env, connectConfig)),
        ASC_PROFILE: config.profile,
        ASC_STRICT_AUTH: "true",
        LOOM_IOS_TEAM_ID: config.teamId,
        LOOM_IOS_ASC_APP_ID: config.appId,
        LOOM_IOS_TESTFLIGHT_GROUPS: config.groups?.join(",") ?? "",
        ...(config.exportOptions ? { LOOM_IOS_EXPORT_OPTIONS: config.exportOptions } : {}),
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw new Error("Could not start Loom iOS delivery.", { cause: result.error });
  if (result.status !== 0)
    throw new Error(
      "Desktop is published; Loom iOS delivery failed and will retry on the next publisher run.",
    );
}

async function main(command: string | undefined, args: readonly string[] = []) {
  if (command === "next-version") {
    // loom.sh tags fork changes on main with this, so they join the same release train.
    console.log(
      nextLoomVersion(
        publicationTags(NodeProcess.cwd()).map((item) => item.tag),
        args[0],
      ),
    );
    return;
  }
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
      "Usage: node scripts/fork/updates.ts <check|prepare|publish [--wait]|next-version [upstream tag]|enable|disable|status>",
    );
  }
  await withLock(async () => {
    const release = await latestIntegration();
    const state = await releaseState(release);
    console.log(`${new Date().toISOString()} ${release.tag}: ${state}`);
    if (command === "check") return;
    if (command === "publish" && state === "published") {
      await publishIos(release);
      return;
    }
    if (command === "publish") reservePublicationTag(release);
    const prepared = await prepare(release);
    console.log(`Prepared ${prepared.record}/Loom.app`);
    if (command === "publish") {
      await publish(release, prepared);
      await publishIos(release);
    }
  }, args.includes("--wait"));
}

if (import.meta.main) {
  await main(NodeProcess.argv[2], NodeProcess.argv.slice(3)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
