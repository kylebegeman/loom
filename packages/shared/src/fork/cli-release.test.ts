import { describe, expect, it } from "vite-plus/test";
import {
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "../cliRelease.ts";

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
