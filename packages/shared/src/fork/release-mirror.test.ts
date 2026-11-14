import { describe, expect, it } from "vite-plus/test";

import { newestChannelRelease, releaseAssetNames } from "./release-mirror.ts";

const metadata = (version: string, databaseMigration: number) =>
  `Notes\n<!-- loom-release-metadata: ${JSON.stringify({ schemaVersion: 1, version, sourceCommit: "a".repeat(40), databaseMigration })} -->`;

const nightly = "0.0.51-nightly.20261101.4100";
const releases = [
  { tag_name: "0.0.52", draft: true, assets: [{ name: "SHA256SUMS" }] },
  { tag_name: nightly, draft: false, body: metadata(nightly, 41), assets: [] },
  { tag_name: "loom-v0.0.51", draft: false, assets: [] },
  {
    tag_name: "0.0.50",
    draft: false,
    body: metadata("0.0.50", 40),
    assets: [{ name: "SHA256SUMS" }, { name: "t3-0.0.50-linux-x64.tar.gz" }],
  },
  { tag_name: "0.0.49", draft: false, body: null, assets: [] },
];

describe("release list derivation", () => {
  it("lists a published release's assets and none for a draft or missing release", () => {
    expect(releaseAssetNames(releases, "0.0.50")).toEqual([
      "SHA256SUMS",
      "t3-0.0.50-linux-x64.tar.gz",
    ]);
    expect(releaseAssetNames(releases, "0.0.52")).toEqual([]);
    expect(releaseAssetNames(releases, "0.0.48")).toEqual([]);
  });

  it("finds each channel's newest published release with its recorded migration", () => {
    expect(newestChannelRelease(releases, "stable")).toEqual({
      version: "0.0.50",
      databaseMigration: 40,
    });
    expect(newestChannelRelease(releases, "nightly")).toEqual({
      version: nightly,
      databaseMigration: 41,
    });
    expect(newestChannelRelease(releases, "preview")).toBeNull();
    expect(newestChannelRelease(releases.slice(4), "stable")).toEqual({
      version: "0.0.49",
      databaseMigration: undefined,
    });
  });
});
