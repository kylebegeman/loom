import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  looksLikePreviewLinkUrl,
  needsPreviewLinkEntry,
  parsePreviewLinkHost,
  PreviewLinksSettings,
  PreviewLinkSuffix,
} from "./preview-links.ts";

const decodeSettings = Schema.decodeSync(PreviewLinksSettings);
const isSuffix = Schema.is(PreviewLinkSuffix);

describe("parsePreviewLinkHost", () => {
  it("splits a link host under its suffix", () => {
    expect(parsePreviewLinkHost("5173-k3f9x2-maple.example.net", "example.net")).toEqual({
      port: 5173,
      share: "k3f9x2",
      machine: "maple",
    });
    expect(parsePreviewLinkHost("5173-K3F9X2-Maple.Example.Net", "example.net")?.port).toBe(5173);
  });

  it.each([
    ["5173-k3f9x2-maple.other.top", "another suffix"],
    ["a.5173-k3f9x2-maple.example.net", "a second label"],
    ["example.net", "the apex"],
    ["5173-k3f9-maple.example.net", "a short share segment"],
    ["70000-k3f9x2-maple.example.net", "an out of range port"],
    ["5173-k3f9x2-doro_thy.example.net", "a machine outside [a-z0-9]"],
    ["5173-k3f9x2-maple.xexample.net", "a suffix that only ends the same way"],
  ])("refuses %s (%s)", (host) => {
    expect(parsePreviewLinkHost(host, "example.net")).toBeNull();
  });
});

describe("looksLikePreviewLinkUrl", () => {
  it("recognizes https link hosts without knowing the suffix", () => {
    expect(looksLikePreviewLinkUrl("https://5173-k3f9x2-maple.example.net/app?x=1")).toBe(true);
    expect(looksLikePreviewLinkUrl("http://5173-k3f9x2-maple.example.net/")).toBe(false);
    expect(looksLikePreviewLinkUrl("https://example.net/")).toBe(false);
    expect(looksLikePreviewLinkUrl("not a url")).toBe(false);
  });
});

describe("needsPreviewLinkEntry", () => {
  it.each([
    ["https://5173-k3f9x2-maple.example.net/app?x=1", true],
    ["https://5173-k3f9x2-maple.example.net/__loom/enter?code=abc", false],
    ["https://github.com/pingdotgg/t3code", false],
  ])("%s needs an entry: %s", (url, expected) => {
    expect(needsPreviewLinkEntry(url)).toBe(expected);
  });
});

describe("PreviewLinksSettings", () => {
  it("defaults the gateway port for settings saved without one", () => {
    const decoded = decodeSettings({
      enabled: true,
      suffix: "example.net",
      machine: "maple",
      defaultLifetime: "12h",
    });
    expect(decoded.gatewayPort).toBe(3779);
  });

  it.each([
    ["example.net", true],
    ["previews.example.dev", true],
    ["Example.net", false],
    ["localhost", false],
    [".example.net", false],
    ["bagels..top", false],
  ])("checks the suffix %s", (suffix, valid) => {
    expect(isSuffix(suffix)).toBe(valid);
  });
});
