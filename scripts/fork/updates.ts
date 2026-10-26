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
// Versions are reserved here, not as bare tags: GitHub's release feed lists every tag as soon as
// it is pushed, and the app's updater takes the newest one it lists, so a tag pushed before its
// release has files fails every nightly update check until the build publishes.
const RESERVATIONS = "refs/loom/publications";

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

/** Versions published as bare tags or reserved by Loom, with the commit each one released. */
function publicationTags(sourceDir: string) {
  return run(
    "git",
    [
      "for-each-ref",
      "--format=%(refname)%09%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)",
      "refs/tags",
      RESERVATIONS,
    ],
    { cwd: sourceDir },
  )
    .split("\n")
    .flatMap((line) => {
      const [ref, kind, object, peeledKind, peeled] = line.split("\t");
      const name = ref?.startsWith(`${RESERVATIONS}/`)
        ? ref.slice(RESERVATIONS.length + 1)
        : ref?.replace(/^refs\/tags\//, "");
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

/**
 * Reserve the publication version before building; failed runs retry the same version. GitHub
 * creates the bare tag when the release is published.
 */
export function reservePublication(release: Release, sourceDir = SOURCE_DIR) {
  const ref = `${RESERVATIONS}/${release.releaseTag}`;
  const reserved = run("git", ["for-each-ref", "--format=%(objectname)", ref], { cwd: sourceDir });
  if (reserved !== "" && reserved !== release.commit)
    throw new Error("The Loom publication version is already reserved for a different source.");
  // Unlike a tag, this ref would fast-forward to a newer commit, so the lease keeps it immutable:
  // it refuses a version another host reserved since the last fetch, while pushing the same
  // reservation again is a no-op for retries.
  run(
    "git",
    [
      "push",
      "--quiet",
      `--force-with-lease=${ref}:${reserved}`,
      "origin",
      `${release.commit}:${ref}`,
    ],
    { cwd: sourceDir },
  );
  run("git", ["update-ref", ref, release.commit], { cwd: sourceDir });
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

/** `undefined` when connect.json is missing, `null` when it says `"enabled": false`. */
function publisherConnectConfig() {
  const connectPath = NodePath.join(STATE_DIR, "connect.json");
  return NodeFS.existsSync(connectPath)
    ? parseLoomConnectConfig(JSON.parse(NodeFS.readFileSync(connectPath, "utf8")))
    : undefined;
}

/**
 * What a newly prepared build does with Connect. A missing connect.json and `"enabled": false`
 * both drop Connect config, but only the second clears computers' links, so `status` names it.
 */
export function describePublisherConnect(
  read: () => LoomConnectConfig | null | undefined = publisherConnectConfig,
) {
  let config: LoomConnectConfig | null | undefined;
  try {
    config = read();
  } catch (error) {
    return `connect.json is invalid: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (config === undefined) return "off without connect.json; they keep a computer's existing link";
  if (config === null) return "retired; they clear a computer's Connect link and refuse a new one";
  return `on (${new URL(config.relayUrl).host})`;
}

/** The Connect decision one prepared source was built with, replayed by every later step. */
export type PreparedConnect = {
  readonly connectConfig: LoomConnectConfig | null;
  /**
   * A retired server clears a computer's Connect link, so only connect.json's explicit
   * `"enabled": false` retires. A missing file leaves Connect unconfigured but intact.
   */
  readonly connectRetired: boolean;
};

// Relay and mobile tracing send diagnostics to T3's trace collector. They leave with the relay,
// so no Loom build carries their credentials, even from a shell that exports them.
const T3_TRACING_PREFIXES = [
  "T3CODE_RELAY_CLIENT_OTLP_",
  "VITE_RELAY_OTLP_",
  "T3CODE_MOBILE_OTLP_",
  "EXPO_PUBLIC_OTLP_",
];

export function buildEnvironment(
  sourceDir: string,
  env: NodeJS.ProcessEnv,
  connect?: LoomConnectConfig | null,
  connectRetired = false,
  node?: string,
) {
  const result = { ...env };
  delete result.ELECTRON_RUN_AS_NODE;
  delete result.CLERK_SECRET_KEY;
  delete result.VITE_HTTP_URL;
  delete result.VITE_WS_URL;
  // Only the publisher's own decision may retire Connect in a build.
  delete result.LOOM_CONNECT_RETIRED;
  // Do not inherit build overrides or a mock feed from a running dev instance.
  for (const key of Object.keys(result)) {
    if (
      key.startsWith("T3CODE_DESKTOP_") ||
      T3_TRACING_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
      delete result[key];
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
    ...(connect === null && connectRetired ? { LOOM_CONNECT_RETIRED: "1" } : {}),
    PATH: [
      NodePath.join(sourceDir, "node_modules/.bin"),
      ...(node === undefined ? [] : [NodePath.dirname(node)]),
      "/opt/homebrew/opt/rustup/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(NodePath.delimiter),
    // launchd sets no locale, and CocoaPods refuses to install pods without UTF-8.
    LANG: /utf-?8/i.test(result.LANG ?? "") ? result.LANG : "en_US.UTF-8",
    T3CODE_RELEASE_PUBLIC_CONFIG: "1",
    T3CODE_DESKTOP_UPDATE_REPOSITORY: REPOSITORY,
    T3CODE_DESKTOP_SIGNED: "false",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

const EXACT_NODE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Builds run on the exact Node the release source pins, not on whichever Node runs the publisher. */
export function requiredNodeVersion(packageJson: string) {
  const manifest: unknown = JSON.parse(packageJson);
  const engines =
    manifest && typeof manifest === "object" && "engines" in manifest ? manifest.engines : null;
  const node = engines && typeof engines === "object" && "node" in engines ? engines.node : null;
  if (typeof node !== "string" || !EXACT_NODE_VERSION.test(node))
    throw new Error(
      `Loom builds need package.json engines.node pinned to an exact version, not ${JSON.stringify(node)}.`,
    );
  return node;
}

// Only install locations that stay put: fnm's multishell links and Homebrew's Cellar paths move.
export function nodeCandidates(
  version: string,
  env: NodeJS.ProcessEnv = NodeProcess.env,
  home = NodeOS.homedir(),
) {
  const fnmRoots = [
    env.FNM_DIR,
    NodePath.join(env.XDG_DATA_HOME || NodePath.join(home, ".local/share"), "fnm"),
    NodePath.join(home, "Library/Application Support/fnm"),
    NodePath.join(home, ".fnm"),
  ].filter((root): root is string => root !== undefined && root !== "");
  return [
    ...new Set([
      ...fnmRoots.map((root) =>
        NodePath.join(root, "node-versions", `v${version}`, "installation/bin/node"),
      ),
      `/opt/homebrew/opt/node@${version.split(".")[0]}/bin/node`,
      "/opt/homebrew/opt/node/bin/node",
    ]),
  ];
}

export function resolveNode(version: string, candidates = nodeCandidates(version)) {
  for (const candidate of candidates) {
    const probe = NodeChildProcess.spawnSync(candidate, ["-p", "process.versions.node"], {
      encoding: "utf8",
      env: {},
    });
    if (probe.status === 0 && probe.stdout.trim() === version) return candidate;
  }
  throw new Error(
    [
      `Loom builds need Node ${version} (package.json engines.node), and no stable install of it was found in:`,
      ...candidates.map((candidate) => `  ${candidate}`),
      `Install it with \`fnm install ${version}\`, install pnpm with that Node's npm, then run \`node scripts/fork/updates.ts enable\` from the Loom checkout.`,
    ].join("\n"),
  );
}

/** The Node a release's own package.json pins, read from the commit rather than the working tree. */
function releaseNode(commit: string) {
  return resolveNode(
    requiredNodeVersion(run("git", ["show", `${commit}:package.json`], { cwd: SOURCE_DIR })),
  );
}

const MAIN_LOG_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_TAIL_BYTES = 8 * 1024;
let buildLogFd: number | undefined;

export async function capPublisherLog(path: string) {
  const file = await NodeFSP.open(path, "r+").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!file) return;
  try {
    // launchd keeps the file open: truncate its inode instead of rotating the pathname.
    if ((await file.stat()).size > MAIN_LOG_MAX_BYTES) await file.truncate(0);
  } finally {
    await file.close();
  }
}

export async function withBuildLog<T>(record: string, body: () => Promise<T>): Promise<T> {
  if (buildLogFd !== undefined) throw new Error("A publisher build log is already open.");
  await NodeFSP.mkdir(record, { recursive: true });
  const path = NodePath.join(record, "build.log");
  const fd = NodeFS.openSync(path, "a+", 0o600);
  buildLogFd = fd;
  NodeFS.writeSync(fd, `\n${new Date().toISOString()} Publisher run\n`);
  try {
    return await body();
  } catch (error) {
    const size = NodeFS.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, ERROR_TAIL_BYTES));
    NodeFS.readSync(fd, tail, 0, tail.length, size - tail.length);
    console.error(
      `${new Date().toISOString()} Build failed. Log: ${path}\n${tail.toString("utf8")}`,
    );
    throw error;
  } finally {
    buildLogFd = undefined;
    NodeFS.closeSync(fd);
  }
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; stream?: boolean; connect?: PreparedConnect; node?: string } = {},
) {
  const sourceDir = options.cwd ?? SOURCE_DIR;
  const { connect, node } = options;
  // Retirement reaches only builds, and only from the decision their record froze.
  const env = connect
    ? buildEnvironment(
        sourceDir,
        NodeProcess.env,
        connect.connectConfig,
        connect.connectRetired,
        node,
      )
    : buildEnvironment(sourceDir, NodeProcess.env, publisherConnectConfig(), false, node);
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    stdio: options.stream && buildLogFd !== undefined ? ["ignore", buildLogFd, buildLogFd] : "pipe",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (buildLogFd !== undefined) {
    if (result.stdout) NodeFS.writeSync(buildLogFd, result.stdout);
    if (result.stderr) NodeFS.writeSync(buildLogFd, result.stderr);
  }
  if (options.stream)
    console.log(
      `${new Date().toISOString()} ${command} ${args[0] ?? ""}: ${result.status === 0 ? "done" : "failed"}`,
    );
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
    throw new Error(`${command} is not installed on the publisher's PATH: ${env.PATH}`, {
      cause: result.error,
    });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ""} failed (${result.status ?? result.signal}): ${buildLogFd === undefined ? (result.stderr?.slice(-ERROR_TAIL_BYTES) ?? "See the build log.") : "See the build log."}`,
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

export function installedUpdateRequirement(
  result: Pick<NodeChildProcess.SpawnSyncReturns<string>, "status" | "stdout" | "stderr">,
): string | null {
  const output = `${result.stdout}\n${result.stderr}`;
  const expression = /^#? ?designated => (.+)$/m.exec(output)?.[1];
  if (result.status !== 0 || !expression)
    throw new Error("Cannot read the installed Loom signing requirement.");
  // An ad hoc signature binds the installed bytes, so any newer build needs a manual install.
  return /^Signature=adhoc$/m.test(output) ? null : expression;
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
      // Include Loom publication state; missing annotated upstream refs are fetched below.
      "refs/tags/*:refs/tags/*",
      `${RESERVATIONS}/*:${RESERVATIONS}/*`,
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

function ensureBlockmap(zip: string, node: string) {
  // Reuse the pinned packager's block-map implementation after signing changes
  // the ZIP. The map electron-builder made for the unsigned ZIP is no longer valid.
  run(
    node,
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
    { cwd: SOURCE_DIR, node },
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

// Retirement joined schema 1 as an optional field so that older publisher tool copies, which
// ignore it, can still replay records prepared by newer ones.
export function connectReceipt(sourceSha: string, connect: PreparedConnect) {
  return `${JSON.stringify({ schemaVersion: 1, sourceSha, ...connect }, null, 2)}\n`;
}

/** Old records predate public configuration receipts and retain disabled Connect on replay. */
export async function preparedConnect(record: string, sourceSha: string): Promise<PreparedConnect> {
  const path = NodePath.join(record, "connect-config.json");
  if (!(await exists(path))) return { connectConfig: null, connectRetired: false };
  const value: unknown = JSON.parse(await NodeFSP.readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prepared Connect configuration must be an object.");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.schemaVersion !== 1 || receipt.sourceSha !== sourceSha) {
    throw new Error("Prepared Connect configuration belongs to a different source.");
  }
  const connectConfig =
    receipt.connectConfig === null ? null : parseLoomConnectConfig(receipt.connectConfig);
  // Receipts written before retirement existed were never built retired.
  const connectRetired = receipt.connectRetired ?? false;
  if (typeof connectRetired !== "boolean" || (connectRetired && connectConfig !== null)) {
    throw new Error("Prepared Connect retirement must be a boolean set only while Connect is off.");
  }
  return { connectConfig, connectRetired };
}

async function prepare(release: Release) {
  const record = NodePath.join(BUILDS_DIR, release.recordName);
  const artifacts = NodePath.join(record, "updates");
  const zip = NodePath.join(artifacts, release.filename);
  const manifest = NodePath.join(artifacts, `${release.channel}-mac.yml`);
  if (await exists(NodePath.join(artifacts, "ready"))) {
    if (!(await exists(`${zip}.blockmap`))) ensureBlockmap(zip, releaseNode(release.commit));
    return { record, zip, manifest, ...(await preparedConnect(record, release.commit)) };
  }
  const configured = publisherConnectConfig();
  const connect: PreparedConnect = {
    connectConfig: configured ?? null,
    connectRetired: configured === null,
  };

  const identities = run("security", [
    "find-identity",
    "-p",
    "codesigning",
    NodePath.join(NodeOS.homedir(), "Library/Keychains/login.keychain-db"),
  ]);
  if (!identities.includes(`"${SIGNING_IDENTITY}"`))
    throw new Error(`Missing ${SIGNING_IDENTITY}; run scripts/fork/loom.sh signing-setup first.`);
  if (
    (await exists(record)) &&
    (await NodeFSP.readdir(record)).some((name) => name !== "build.log")
  )
    throw new Error(
      `An incomplete or older build already exists at ${record}; inspect it before retrying.`,
    );

  const node = releaseNode(release.commit);
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
      connect,
      node,
    });
    run(node, ["scripts/update-release-package-versions.ts", release.version], {
      cwd: SOURCE_DIR,
      stream: true,
      node,
    });
    run(
      node,
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
      { cwd: SOURCE_DIR, stream: true, connect, node },
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
      const requirement = NodeChildProcess.spawnSync("codesign", ["-dvv", "-r-", APP_PATH], {
        encoding: "utf8",
      });
      const expression = installedUpdateRequirement(requirement);
      if (expression === null) {
        console.log(
          "The installed app is ad hoc signed. Install this signed release manually to enable future signed updates.",
        );
      } else {
        run("codesign", ["--verify", "--deep", "--strict", "-R", `=${expression}`, app], {
          stream: true,
        });
      }
    }
    const stagedRecord = NodePath.join(staging, "record");
    await NodeFSP.mkdir(NodePath.join(stagedRecord, "updates"), { recursive: true });
    await NodeFSP.rename(app, NodePath.join(stagedRecord, "Loom.app"));
    await NodeFSP.writeFile(NodePath.join(stagedRecord, "build.env"), buildRecord);
    await NodeFSP.writeFile(
      NodePath.join(stagedRecord, "connect-config.json"),
      connectReceipt(release.commit, connect),
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
    ensureBlockmap(stagedZip, node);
    await NodeFSP.writeFile(
      NodePath.join(stagedRecord, "updates", NodePath.basename(manifest)),
      await updateManifest(stagedZip, release),
    );
    await NodeFSP.writeFile(NodePath.join(stagedRecord, "updates", "ready"), `${release.commit}\n`);
    await NodeFSP.mkdir(BUILDS_DIR, { recursive: true });
    if (await exists(NodePath.join(record, "build.log"))) {
      await NodeFSP.rename(
        NodePath.join(record, "build.log"),
        NodePath.join(stagedRecord, "build.log"),
      );
      await NodeFSP.rmdir(record);
    }
    await NodeFSP.rename(stagedRecord, record);
    return { record, zip, manifest, ...connect };
  } finally {
    try {
      restoreBuildInputs(SOURCE_DIR);
    } finally {
      await NodeFSP.rm(staging, { recursive: true, force: true });
    }
  }
}

const CONVENTIONAL_SUBJECT = /^([a-z]+)(?:\(([^)]+)\))?!?:\s+(.+)$/i;
// Commits that cannot change what an installed Loom does stay out of the change list.
const UNLISTED_CHANGE_TYPES = new Set(["docs", "test"]);

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Turns first-parent commit subjects into readable change list items, in the same order. */
export function releaseChangeItems(subjects: readonly string[]) {
  return subjects.flatMap((raw) => {
    const subject = raw.trim();
    const match = CONVENTIONAL_SUBJECT.exec(subject);
    if (!match) return subject ? [subject] : [];
    const [, type, scope, description] = match;
    if (UNLISTED_CHANGE_TYPES.has(type!.toLowerCase())) return [];
    return [scope ? `${sentenceCase(scope)}: ${description}` : sentenceCase(description!)];
  });
}

/**
 * GitHub release body for one publication. `subjects` are the first-parent commits since
 * `previous`, oldest first. The desktop popover lists items up to a "Full changelog"
 * heading and shows the newest first, so build details stay below that heading.
 */
export function releaseNotes(
  release: Release,
  previous: string | undefined,
  subjects: readonly string[],
) {
  const items = releaseChangeItems(subjects);
  const changes =
    items.length > 0
      ? items.map((item) => `- ${item}`).join("\n")
      : `- ${previous ? `No app changes since ${previous}.` : "First Loom publication."}`;
  const compare = previous
    ? `[${previous}...${release.version}](https://github.com/${REPOSITORY}/compare/${previous}...${release.version})\n\n`
    : "";
  const upstream = release.upstreamTag
    ? ` Includes upstream T3 Code [${release.upstreamTag}](https://github.com/pingdotgg/t3code/releases/tag/${release.upstreamTag}).`
    : "";
  return `## What's changed

${changes}

## Full changelog

${compare}Loom built from the checked integration [${release.tag}](https://github.com/${REPOSITORY}/tree/${release.tag}).${upstream}

Source commit: ${release.commit}. macOS Apple Silicon; signed with Kyle's local Loom certificate.

Use Loom's update button to download, then restart and install when ready.
`;
}

/** The newest earlier published release on this channel and the commit subjects since it. */
export function releaseHistory(
  release: Release,
  publishedTags: readonly string[],
  sourceDir = SOURCE_DIR,
) {
  const published = new Set(publishedTags);
  const previous = publicationTags(sourceDir)
    .filter(
      (item) =>
        published.has(item.tag) &&
        item.tag.includes("-nightly.") === (release.channel === "nightly") &&
        compareVersions(item.tag, release.version) < 0,
    )
    .toSorted((a, b) => compareVersions(b.tag, a.tag))[0];
  if (!previous) return { previous: undefined, subjects: [] };
  const log = run(
    "git",
    ["log", "--first-parent", "--reverse", "--format=%s", `${previous.commit}..${release.commit}`],
    { cwd: sourceDir },
  );
  return { previous: previous.tag, subjects: log ? log.split("\n") : [] };
}

async function publish(release: Release, prepared: Awaited<ReturnType<typeof prepare>>) {
  const state = await releaseState(release);
  if (state === "published") return;
  const notes = NodePath.join(prepared.record, "updates/release-notes.md");
  const publishedTags = run("gh", [
    "api",
    "--paginate",
    `repos/${REPOSITORY}/releases?per_page=100`,
    "--jq",
    ".[] | select(.draft == false) | .tag_name",
  ]).split("\n");
  const history = releaseHistory(release, publishedTags);
  await NodeFSP.writeFile(notes, releaseNotes(release, history.previous, history.subjects));
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
    // The bare version tag exists only once the release is published.
    workflowRef: release.tag,
    env: buildEnvironment(
      SOURCE_DIR,
      NodeProcess.env,
      prepared.connectConfig,
      prepared.connectRetired,
    ),
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

/** The scheduled publisher runs on the checkout's pinned Node, at a path that survives shell sessions. */
async function publisherNode() {
  const checkout = NodeURL.fileURLToPath(new URL("../../package.json", import.meta.url));
  const manifest = (await exists(checkout)) ? checkout : NodePath.join(SOURCE_DIR, "package.json");
  return resolveNode(requiredNodeVersion(await NodeFSP.readFile(manifest, "utf8")));
}

async function enable() {
  const node = await publisherNode();
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
  await capPublisherLog(LOG_PATH);
  if (await exists(PLIST_PATH))
    run("launchctl", ["bootout", `gui/${NodeProcess.getuid!()}`, PLIST_PATH]);
  await NodeFSP.writeFile(PLIST_PATH, launchAgent(node, script, LOG_PATH));
  run("plutil", ["-lint", PLIST_PATH]);
  run("launchctl", ["bootstrap", `gui/${NodeProcess.getuid!()}`, PLIST_PATH]);
  console.log(
    `Loom will check for a merged integration every 30 minutes while you are logged in.\nNode: ${node}\nLog: ${LOG_PATH}`,
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
  const libraryPush = value.libraryPush;
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
  if (libraryPush !== undefined && typeof libraryPush !== "boolean")
    throw new Error("Loom iOS libraryPush must be true or false.");
  return {
    teamId,
    appId,
    profile,
    signingKeychain: signingKeychain as string | undefined,
    signingKeychainPasswordFile: signingKeychainPasswordFile as string | undefined,
    groups: groups as string[] | undefined,
    exportOptions: exportOptions as string | undefined,
    // The launch agent carries no environment, so the Library push build flag lives here.
    libraryPush: libraryPush as boolean | undefined,
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

/** A confirmed upload of this exact source leaves nothing to build, inspect or upload again. */
export function iosDelivered(
  receipt: unknown,
  commit: string,
  config: { readonly teamId: string; readonly appId: string },
) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const value = receipt as Record<string, unknown>;
  return (
    typeof value.buildId === "string" &&
    value.buildId.trim() !== "" &&
    typeof value.artifactSha256 === "string" &&
    value.sourceSha === commit &&
    value.teamId === config.teamId &&
    value.appId === config.appId
  );
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
  const output = NodePath.join(STATE_DIR, "ios", release.recordName);
  const receipt = NodePath.join(output, "loom-ios-release.json");
  if (
    (await exists(receipt)) &&
    iosDelivered(JSON.parse(await NodeFSP.readFile(receipt, "utf8")), release.commit, config)
  )
    return;
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
  const node = releaseNode(release.commit);
  if (config.signingKeychain && config.signingKeychainPasswordFile)
    unlockIosSigningKeychain(config.signingKeychain, config.signingKeychainPasswordFile);
  const { connectConfig, connectRetired } = await preparedConnect(
    NodePath.join(BUILDS_DIR, release.recordName),
    release.commit,
  );
  const result = NodeChildProcess.spawnSync(
    node,
    [script, "release", "--output-dir", output, "--source-sha", release.commit],
    {
      cwd: SOURCE_DIR,
      env: {
        ...automaticIosEnvironment(
          buildEnvironment(SOURCE_DIR, NodeProcess.env, connectConfig, connectRetired, node),
        ),
        ASC_PROFILE: config.profile,
        ASC_STRICT_AUTH: "true",
        LOOM_IOS_TEAM_ID: config.teamId,
        LOOM_IOS_ASC_APP_ID: config.appId,
        LOOM_IOS_TESTFLIGHT_GROUPS: config.groups?.join(",") ?? "",
        ...(config.exportOptions ? { LOOM_IOS_EXPORT_OPTIONS: config.exportOptions } : {}),
        ...(config.libraryPush !== undefined
          ? { LOOM_MOBILE_LIBRARY_PUSH_ENABLED: config.libraryPush ? "1" : "0" }
          : {}),
      },
      stdio: buildLogFd === undefined ? "pipe" : ["ignore", buildLogFd, buildLogFd],
    },
  );
  if (result.error) throw new Error("Could not start Loom iOS delivery.", { cause: result.error });
  if (result.status !== 0)
    throw new Error(
      "Desktop is published; Loom iOS delivery failed and will retry on the next publisher run.",
    );
}

const UPDATE_USAGE = `Usage: node scripts/fork/updates.ts <check|prepare|publish> [--wait] [--expect-tag <loom-v...> --expect-sha <40-character lowercase SHA> --expect-version <version>]
       node scripts/fork/updates.ts next-version [upstream v* tag]
       node scripts/fork/updates.ts <enable|disable|status>
All three --expect-* flags must be supplied together, using separate flag and value arguments.`;

type ReleasePin = Pick<Release, "tag" | "commit" | "version">;

export function parseUpdateArgs(command: string | undefined, args: readonly string[] = []) {
  function fail(message: string): never {
    throw new Error(`${message}\n${UPDATE_USAGE}`);
  }
  if (command === "next-version") {
    const upstreamTag = args[0];
    if (
      args.length > 1 ||
      (upstreamTag !== undefined &&
        upstreamTag !== "" &&
        (upstreamTag !== upstreamTag.trim() ||
          !upstreamTag.startsWith("v") ||
          !LOOM_VERSION.test(upstreamTag.slice(1))))
    )
      fail("next-version accepts at most one exact upstream v* tag.");
    return { command, upstreamTag } as const;
  }
  if (command === "enable" || command === "disable" || command === "status") {
    if (args.length) fail(`${command} does not accept arguments.`);
    return { command } as const;
  }
  if (command !== "check" && command !== "prepare" && command !== "publish")
    fail(`Unknown publisher command: ${command ?? "(missing)"}.`);

  let wait = false;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === "--wait") {
      if (wait) fail("Duplicate --wait flag.");
      wait = true;
      continue;
    }
    if (flag !== "--expect-tag" && flag !== "--expect-sha" && flag !== "--expect-version")
      fail(`Unknown publisher argument: ${flag}.`);
    if (values.has(flag)) fail(`Duplicate ${flag} flag.`);
    const value = args[++index];
    if (!value || value.startsWith("-")) fail(`${flag} requires a value.`);
    values.set(flag, value);
  }
  if (values.size !== 0 && values.size !== 3)
    fail("A publication pin requires --expect-tag, --expect-sha and --expect-version together.");
  const expected = values.size
    ? {
        tag: values.get("--expect-tag")!,
        commit: values.get("--expect-sha")!,
        version: values.get("--expect-version")!,
      }
    : undefined;
  if (expected) {
    if (
      expected.tag !== expected.tag.trim() ||
      !expected.tag.startsWith("loom-v") ||
      !LOOM_VERSION.test(expected.tag.slice("loom-v".length))
    )
      fail("--expect-tag requires an exact Loom integration tag (loom-v<version>).");
    if (expected.commit !== expected.commit.trim() || !SOURCE_COMMIT.test(expected.commit))
      fail("--expect-sha requires a full 40-character lowercase hexadecimal commit SHA.");
    if (expected.version !== expected.version.trim() || !LOOM_VERSION.test(expected.version))
      fail("--expect-version requires an exact bare Loom publication version.");
  }
  return { command, wait, expected } as const;
}

export function assertReleasePin(release: Release, expected: ReleasePin | undefined) {
  if (expected) {
    for (const field of ["tag", "commit", "version"] as const) {
      if (release[field] !== expected[field])
        throw new Error(
          `Loom publication pin mismatch for ${field}: expected ${expected[field]}, selected ${release[field]}.`,
        );
    }
  }
  return release;
}

export async function main(
  command: string | undefined,
  args: readonly string[] = [],
  logging: { withBuildLog: typeof withBuildLog } = { withBuildLog },
) {
  const options = parseUpdateArgs(command, args);
  if (options.command === "next-version") {
    // loom.sh tags fork changes on main with this, so they join the same release train.
    console.log(
      nextLoomVersion(
        publicationTags(NodeProcess.cwd()).map((item) => item.tag),
        options.upstreamTag,
      ),
    );
    return;
  }
  if (NodeProcess.platform !== "darwin" || NodeProcess.arch !== "arm64")
    throw new Error("The local Loom publisher requires an Apple Silicon Mac.");
  if (options.command === "enable") return enable();
  if (options.command === "disable") {
    if (await exists(PLIST_PATH)) {
      run("launchctl", ["bootout", `gui/${NodeProcess.getuid!()}`, PLIST_PATH]);
      await NodeFSP.rm(PLIST_PATH);
    }
    console.log("Automatic Loom publishing is disabled.");
    return;
  }
  if (options.command === "status") {
    const node = await publisherNode().catch((error: unknown) =>
      error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error),
    );
    console.log(
      `Scheduler: ${(await exists(PLIST_PATH)) ? "installed" : "not installed"}\nNode for builds: ${node}\nConnect for new builds: ${describePublisherConnect()}\nBuilds: ${BUILDS_DIR}\nLog: ${LOG_PATH}`,
    );
    return;
  }
  await withLock(async () => {
    const release = assertReleasePin(await latestIntegration(), options.expected);
    const state = await releaseState(release);
    console.log(`${new Date().toISOString()} ${release.tag}: ${state}`);
    if (options.command === "check") return;
    await logging.withBuildLog(NodePath.join(BUILDS_DIR, release.recordName), async () => {
      if (options.command === "publish" && state === "published") {
        await publishIos(release);
        return;
      }
      if (options.command === "publish") reservePublication(release);
      const prepared = await prepare(release);
      console.log(`Prepared ${prepared.record}/Loom.app`);
      if (options.command === "publish") {
        await publish(release, prepared);
        await publishIos(release);
      }
    });
  }, options.wait);
}

if (import.meta.main) {
  await capPublisherLog(LOG_PATH)
    .then(() => main(NodeProcess.argv[2], NodeProcess.argv.slice(3)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
