// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off - Installed publisher has only Node built-ins.
// Copies a published Loom release into the Library's private object store, laid out as an upstream
// update mirror. The Library serves it to enrolled computers and owners at /api/loom/releases.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";

import { signB2ObjectUrl } from "../../apps/server/src/fork/project-library/assets/b2Signing.ts";

/** The publisher's write key is restricted to this prefix; it cannot read Library assets. */
const PREFIX = "releases/";
const RUNTIME_ARCHIVE = /^t3-.+\.tar\.gz$/;
const DESKTOP_FILE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:zip|zip\.blockmap)$/;
export const RELEASE_INDEX_FILE = "index.json";

export interface ReleaseMirrorConfig {
  /** The feed the publisher embeds in desktop builds: the Library's release route. */
  readonly feedUrl: string;
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly keyId: string;
  readonly applicationKey: string;
}

/** `null` while no mirror is configured, so the publisher keeps the GitHub feed. */
export async function readReleaseMirrorConfig(file: string): Promise<ReleaseMirrorConfig | null> {
  const stat = await NodeFSP.stat(file).catch(() => null);
  if (stat === null) return null;
  if (!stat.isFile() || (stat.mode & 0o077) !== 0)
    throw new Error(`${file} must be a private file (chmod 600).`);
  return parseReleaseMirrorConfig(JSON.parse(await NodeFSP.readFile(file, "utf8")));
}

export function parseReleaseMirrorConfig(raw: unknown): ReleaseMirrorConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = (key: string) => {
    const field = value[key];
    if (typeof field !== "string" || field.trim() === "" || field !== field.trim())
      throw new Error(`Release mirror config requires ${key}.`);
    return field;
  };
  const config = {
    feedUrl: text("feedUrl"),
    endpoint: text("endpoint"),
    region: text("region"),
    bucket: text("bucket"),
    keyId: text("keyId"),
    applicationKey: text("applicationKey"),
  };
  for (const key of ["feedUrl", "endpoint"] as const) {
    const url = URL.parse(config[key]);
    if (url === null || url.protocol !== "https:" || url.search || url.hash || url.username)
      throw new Error(`Release mirror ${key} must be a plain https URL.`);
  }
  if (!new URL(config.feedUrl).pathname.endsWith("/api/loom/releases"))
    throw new Error("Release mirror feedUrl must be the Library's /api/loom/releases route.");
  return config;
}

export interface MirrorUpload {
  readonly file: string;
  readonly key: string;
  readonly contentType: string;
}

/**
 * Uploads in an order that never exposes a partial release: archives and checksums first, then
 * the desktop installers, and the channel feed last, since clients only follow the feed.
 */
export function mirrorUploads(input: {
  readonly version: string;
  readonly channel: "latest" | "nightly";
  readonly files: readonly string[];
  readonly writeFeed: boolean;
}): MirrorUpload[] {
  const names = new Set(input.files);
  const feed = `${input.channel}-mac.yml`;
  const runtime = input.files.filter((name) => RUNTIME_ARCHIVE.test(name)).sort();
  const desktop = input.files.filter((name) => DESKTOP_FILE.test(name)).sort();
  if (!names.has("SHA256SUMS") || runtime.length === 0)
    throw new Error(`Release ${input.version} has no runtime archives and checksums to mirror.`);
  if (!names.has(feed) || !desktop.some((name) => name.endsWith(".zip")))
    throw new Error(`Release ${input.version} has no ${feed} and desktop archive to mirror.`);
  const versioned = (name: string, contentType: string) => ({
    file: name,
    key: `${PREFIX}v${input.version}/${name}`,
    contentType,
  });
  const root = (name: string, contentType: string) => ({
    file: name,
    key: `${PREFIX}${name}`,
    contentType,
  });
  return [
    ...runtime.map((name) => versioned(name, "application/gzip")),
    versioned("SHA256SUMS", "text/plain; charset=utf-8"),
    ...desktop.map((name) => root(name, "application/octet-stream")),
    ...(input.writeFeed ? [root(feed, "text/yaml; charset=utf-8")] : []),
  ];
}

/** Every runtime archive must match the release's checksums before it is mirrored. */
export async function verifyRuntimeChecksums(directory: string, files: readonly string[]) {
  const sums = new Map(
    (await NodeFSP.readFile(NodePath.join(directory, "SHA256SUMS"), "utf8"))
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line.trim());
        return match ? [[match[2]!, match[1]!] as const] : [];
      }),
  );
  for (const name of files.filter((file) => RUNTIME_ARCHIVE.test(file))) {
    const hash = NodeCrypto.createHash("sha256");
    for await (const chunk of NodeFS.createReadStream(NodePath.join(directory, name)))
      hash.update(chunk);
    if (sums.get(name) !== hash.digest("hex"))
      throw new Error(`${name} does not match the release's SHA256SUMS; nothing was mirrored.`);
  }
}

const presigned = (
  config: ReleaseMirrorConfig,
  method: "GET" | "PUT",
  key: string,
  expiresInSeconds = 900,
) =>
  signB2ObjectUrl(config, {
    method,
    objectKey: key,
    now: new Date().toISOString(),
    expiresInSeconds,
  });

async function put(config: ReleaseMirrorConfig, upload: MirrorUpload, body: Buffer | string) {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  const response = await fetch(presigned(config, "PUT", upload.key), {
    method: "PUT",
    body: bytes,
    headers: { "content-type": upload.contentType, "content-length": String(bytes.length) },
  });
  // The signed URL carries the request signature, so only the status is reported.
  if (!response.ok) throw new Error(`Uploading ${upload.key} failed with ${response.status}.`);
}

async function putFile(config: ReleaseMirrorConfig, directory: string, upload: MirrorUpload) {
  const path = NodePath.join(directory, upload.file);
  const size = (await NodeFSP.stat(path)).size;
  const response = await fetch(presigned(config, "PUT", upload.key), {
    method: "PUT",
    body: NodeStream.Readable.toWeb(NodeFS.createReadStream(path)) as ReadableStream<Uint8Array>,
    headers: { "content-type": upload.contentType, "content-length": String(size) },
    duplex: "half",
  } as RequestInit);
  if (!response.ok) throw new Error(`Uploading ${upload.key} failed with ${response.status}.`);
}

/** The text of a mirrored root file, or `null` before the first publication. */
export async function readMirrored(config: ReleaseMirrorConfig, name: string) {
  const response = await fetch(presigned(config, "GET", `${PREFIX}${name}`, 60));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Reading mirrored ${name} failed with ${response.status}.`);
  return response.text();
}

export function feedVersion(feed: string | null) {
  return feed === null ? null : (/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(feed)?.[1] ?? null);
}

export async function mirrorRelease(input: {
  readonly config: ReleaseMirrorConfig;
  readonly version: string;
  readonly channel: "latest" | "nightly";
  readonly directory: string;
  readonly writeFeed: boolean;
  readonly log?: (message: string) => void;
}) {
  const files = await NodeFSP.readdir(input.directory);
  const uploads = mirrorUploads({ ...input, files });
  await verifyRuntimeChecksums(input.directory, files);
  for (const upload of uploads) {
    input.log?.(`Mirroring ${upload.key}`);
    await putFile(input.config, input.directory, upload);
  }
}

export interface IndexedRelease {
  readonly tag_name: string;
  readonly prerelease: boolean;
  readonly body: string | null;
  readonly assets: ReadonlyArray<{ readonly name: string }>;
}

/**
 * The mirrored releases, newest first, in the shape of GitHub's release list so clients decode
 * it with the schema they already use for that list.
 */
export function releaseIndex(
  releases: ReadonlyArray<IndexedRelease & { readonly draft: boolean }>,
  mirrored: ReadonlySet<string>,
) {
  return `${JSON.stringify(
    releases
      .filter((release) => !release.draft && mirrored.has(release.tag_name))
      .slice(0, 100)
      .map((release) => ({
        tag_name: release.tag_name,
        draft: false,
        prerelease: release.prerelease,
        body: release.body,
        assets: release.assets.map((asset) => ({ name: asset.name })),
      })),
    null,
    2,
  )}\n`;
}

export async function publishReleaseIndex(config: ReleaseMirrorConfig, index: string) {
  await put(
    config,
    {
      file: RELEASE_INDEX_FILE,
      key: `${PREFIX}${RELEASE_INDEX_FILE}`,
      contentType: "application/json",
    },
    index,
  );
}
