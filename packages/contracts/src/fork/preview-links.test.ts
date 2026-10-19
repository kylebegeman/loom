import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  looksLikePreviewLinkUrl,
  parsePreviewLinkHost,
  PreviewLinksSettings,
  PreviewLinkSuffix,
} from "./preview-links.ts";

const decodeSettings = Schema.decodeSync(PreviewLinksSettings);
const isSuffix = Schema.is(PreviewLinkSuffix);

describe("parsePreviewLinkHost", () => {
  it("splits a link host under its suffix", () => {
    expect(parsePreviewLinkHost("5173-k3f9x2-dorothy.bagels.top", "bagels.top")).toEqual({
      port: 5173,
      share: "k3f9x2",
      machine: "dorothy",
    });
    expect(parsePreviewLinkHost("5173-K3F9X2-Dorothy.Bagels.Top", "bagels.top")?.port).toBe(5173);
  });

  it.each([
    ["5173-k3f9x2-dorothy.other.top", "another suffix"],
    ["a.5173-k3f9x2-dorothy.bagels.top", "a second label"],
    ["bagels.top", "the apex"],
    ["5173-k3f9-dorothy.bagels.top", "a short share segment"],
    ["70000-k3f9x2-dorothy.bagels.top", "an out of range port"],
    ["5173-k3f9x2-doro_thy.bagels.top", "a machine outside [a-z0-9]"],
    ["5173-k3f9x2-dorothy.xbagels.top", "a suffix that only ends the same way"],
  ])("refuses %s (%s)", (host) => {
    expect(parsePreviewLinkHost(host, "bagels.top")).toBeNull();
  });
});

describe("looksLikePreviewLinkUrl", () => {
  it("recognizes https link hosts without knowing the suffix", () => {
    expect(looksLikePreviewLinkUrl("https://5173-k3f9x2-dorothy.bagels.top/app?x=1")).toBe(true);
    expect(looksLikePreviewLinkUrl("http://5173-k3f9x2-dorothy.bagels.top/")).toBe(false);
    expect(looksLikePreviewLinkUrl("https://bagels.top/")).toBe(false);
    expect(looksLikePreviewLinkUrl("not a url")).toBe(false);
  });
});

describe("PreviewLinksSettings", () => {
  it("defaults the gateway port for settings saved without one", () => {
    const decoded = decodeSettings({
      enabled: true,
      suffix: "bagels.top",
      machine: "dorothy",
      defaultLifetime: "12h",
    });
    expect(decoded.gatewayPort).toBe(3779);
  });

  it.each([
    ["bagels.top", true],
    ["previews.example.dev", true],
    ["Bagels.top", false],
    ["localhost", false],
    [".bagels.top", false],
    ["bagels..top", false],
  ])("checks the suffix %s", (suffix, valid) => {
    expect(isSuffix(suffix)).toBe(valid);
  });
});
