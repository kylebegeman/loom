import { describe, expect, it } from "vite-plus/test";
import {
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "../cliRelease.ts";

import { loomReleaseDatabaseMigration } from "./cli-release.ts";

const version = "0.0.49-nightly.20261013.3046";

describe("Loom runtime release source", () => {
  it("downloads the exact published Loom tag without entering upstream's tag namespace", () => {
    expect(cliReleaseDownloadBaseUrl(version)).toBe(
      `https://github.com/kylebegeman/loom/releases/download/${version}`,
    );
    expect(cliReleaseIndexPageUrl(1)).toBe(
      "https://api.github.com/repos/kylebegeman/loom/releases?per_page=100&page=1",
    );
  });

  it("preserves the established v-prefixed mirror contract", () => {
    expect(cliReleaseDownloadBaseUrl(version, "https://mirror.example/runtime/")).toBe(
      `https://mirror.example/runtime/v${version}`,
    );
  });

  it("accepts Loom publications and skips integration and upstream tags", () => {
    const releases = [
      { tag_name: "0.0.50-nightly.20261014.3047", draft: true },
      { tag_name: "v0.0.99-nightly.20261013.9" },
      { tag_name: "loom-v0.0.99-nightly.20261013.8" },
      { tag_name: version },
      { tag_name: "0.0.48" },
    ];
    expect(newestCliReleaseVersion(releases, "nightly")).toBe(version);
    expect(newestCliReleaseVersion(releases, "stable")).toBe("0.0.48");
  });
});

describe("Loom release migration metadata", () => {
  const metadata = {
    schemaVersion: 1,
    version,
    sourceCommit: "a".repeat(40),
    databaseMigration: 38,
  };
  const body = (value: unknown) =>
    `Notes\n\n<!-- loom-release-metadata: ${JSON.stringify(value)} -->\n`;

  it("accepts only one version-pinned, valid migration record", () => {
    expect(loomReleaseDatabaseMigration(body(metadata), version)).toBe(38);
    expect(loomReleaseDatabaseMigration(body({ ...metadata, databaseMigration: 0 }), version)).toBe(
      0,
    );
    for (const value of [
      { ...metadata, version: "0.0.1" },
      { ...metadata, schemaVersion: 2 },
      { ...metadata, sourceCommit: "main" },
      { ...metadata, databaseMigration: -1 },
      { ...metadata, databaseMigration: 1.5 },
      { ...metadata, databaseMigration: "38" },
      { ...metadata, databaseMigration: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(loomReleaseDatabaseMigration(body(value), version)).toBeUndefined();
    for (const notes of [
      null,
      undefined,
      "Legacy release",
      "<!-- loom-release-metadata: not-json -->",
      body(metadata) + body(metadata),
    ])
      expect(loomReleaseDatabaseMigration(notes, version)).toBeUndefined();
  });
});
