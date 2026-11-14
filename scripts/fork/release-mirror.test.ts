// @effect-diagnostics nodeBuiltinImport:off - Exercises the standalone publisher's filesystem boundary without an Effect runtime.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  feedVersion,
  mirrorUploads,
  parseReleaseMirrorConfig,
  readReleaseMirrorConfig,
  releaseIndex,
  verifyRuntimeChecksums,
} from "./release-mirror.ts";

const VERSION = "0.0.208-nightly.20261112.4606";
const RELEASE_FILES = [
  "nightly-mac.yml",
  `Loom-${VERSION}-arm64.zip`,
  `Loom-${VERSION}-arm64.zip.blockmap`,
  `t3-${VERSION}-linux-x64.tar.gz`,
  `t3-${VERSION}-darwin-arm64.tar.gz`,
  "SHA256SUMS",
  "builder-debug.yml",
];
const CONFIG = {
  feedUrl: "https://library.example/api/loom/releases",
  endpoint: "https://s3.us-west-004.backblazeb2.com",
  region: "us-west-004",
  bucket: "library-assets",
  keyId: "key-id",
  applicationKey: "application-key",
};

describe("release mirror", () => {
  it("uploads archives and checksums before installers and the feed last", () => {
    const uploads = mirrorUploads({
      version: VERSION,
      channel: "nightly",
      files: RELEASE_FILES,
      writeFeed: true,
    });
    expect(uploads.map((upload) => upload.key)).toEqual([
      `releases/v${VERSION}/t3-${VERSION}-darwin-arm64.tar.gz`,
      `releases/v${VERSION}/t3-${VERSION}-linux-x64.tar.gz`,
      `releases/v${VERSION}/SHA256SUMS`,
      `releases/Loom-${VERSION}-arm64.zip`,
      `releases/Loom-${VERSION}-arm64.zip.blockmap`,
      "releases/nightly-mac.yml",
    ]);
    const backfill = mirrorUploads({
      version: VERSION,
      channel: "nightly",
      files: RELEASE_FILES,
      writeFeed: false,
    });
    expect(backfill.map((upload) => upload.key)).not.toContain("releases/nightly-mac.yml");
  });

  it("refuses a release missing its checksums, runtime archives, feed or installer", () => {
    for (const missing of [
      "SHA256SUMS",
      `t3-${VERSION}-linux-x64.tar.gz`,
      "nightly-mac.yml",
      `Loom-${VERSION}-arm64.zip`,
    ]) {
      const files = RELEASE_FILES.filter(
        (name) => name !== missing && !(missing.endsWith(".tar.gz") && name.endsWith(".tar.gz")),
      );
      expect(() =>
        mirrorUploads({ version: VERSION, channel: "nightly", files, writeFeed: true }),
      ).toThrow(VERSION);
    }
  });

  it("accepts only a complete config with plain https URLs and the release route", async () => {
    expect(parseReleaseMirrorConfig(CONFIG)).toEqual(CONFIG);
    for (const raw of [
      null,
      { ...CONFIG, applicationKey: "" },
      { ...CONFIG, keyId: " key-id" },
      { ...CONFIG, endpoint: "http://s3.example" },
      { ...CONFIG, feedUrl: "https://library.example/api/loom/releases?token=abc" },
      { ...CONFIG, feedUrl: "https://user@library.example/api/loom/releases" },
      { ...CONFIG, feedUrl: "https://library.example/releases" },
    ]) {
      expect(() => parseReleaseMirrorConfig(raw)).toThrow("Release mirror");
    }
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-mirror-test-"));
    try {
      const file = NodePath.join(directory, "release-mirror.json");
      expect(await readReleaseMirrorConfig(file)).toBeNull();
      await NodeFSP.writeFile(file, JSON.stringify(CONFIG), { mode: 0o644 });
      await expect(readReleaseMirrorConfig(file)).rejects.toThrow("chmod 600");
      await NodeFSP.chmod(file, 0o600);
      expect(await readReleaseMirrorConfig(file)).toEqual(CONFIG);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("mirrors nothing when an archive does not match the release checksums", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-mirror-test-"));
    try {
      const archive = `t3-${VERSION}-linux-x64.tar.gz`;
      const bytes = Buffer.from("runtime archive");
      const digest = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
      await NodeFSP.writeFile(NodePath.join(directory, archive), bytes);
      await NodeFSP.writeFile(NodePath.join(directory, "SHA256SUMS"), `${digest}  ${archive}\n`);
      await expect(verifyRuntimeChecksums(directory, [archive, "SHA256SUMS"])).resolves.toBe(
        undefined,
      );
      await NodeFSP.writeFile(NodePath.join(directory, archive), "tampered");
      await expect(verifyRuntimeChecksums(directory, [archive, "SHA256SUMS"])).rejects.toThrow(
        "nothing was mirrored",
      );
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("indexes only published, mirrored releases in GitHub's list shape", () => {
    const release = (tag_name: string, draft = false) => ({
      tag_name,
      draft,
      prerelease: true,
      body: "notes",
      assets: [{ name: "SHA256SUMS", url: "https://api.github.com/assets/1" }],
    });
    const index = JSON.parse(
      releaseIndex(
        [release("0.0.3"), release("0.0.2", true), release("0.0.1"), release("0.0.0")],
        new Set(["0.0.3", "0.0.2", "0.0.1"]),
      ),
    );
    expect(index).toEqual([
      {
        tag_name: "0.0.3",
        draft: false,
        prerelease: true,
        body: "notes",
        assets: [{ name: "SHA256SUMS" }],
      },
      {
        tag_name: "0.0.1",
        draft: false,
        prerelease: true,
        body: "notes",
        assets: [{ name: "SHA256SUMS" }],
      },
    ]);
  });

  it("reads the version a mirrored feed points at", () => {
    expect(feedVersion(null)).toBeNull();
    expect(feedVersion(`version: ${VERSION}\nfiles: []\n`)).toBe(VERSION);
    expect(feedVersion("version: '0.0.46'\n")).toBe("0.0.46");
    expect(feedVersion("files: []\n")).toBeNull();
  });
});
