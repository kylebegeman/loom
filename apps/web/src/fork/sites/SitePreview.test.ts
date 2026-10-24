import { describe, expect, it } from "vite-plus/test";
import { PREVIEW_DEVICES, normalizePreviewPath, previewStageLayout } from "./SitePreview";

const SITE = "https://pages.bagels.top";

describe("previewStageLayout", () => {
  it("scales a device down to the stage, never up", () => {
    expect(previewStageLayout(640, PREVIEW_DEVICES.desktop)).toEqual({
      scale: 0.5,
      width: 640,
      height: 400,
    });
    expect(previewStageLayout(2000, PREVIEW_DEVICES.phone)).toEqual({
      scale: 1,
      width: 390,
      height: 844,
    });
  });

  it("rounds the box down so it never overflows the stage by a fraction", () => {
    const layout = previewStageLayout(333, PREVIEW_DEVICES.tablet);
    expect(layout.width).toBeLessThanOrEqual(333);
    expect(layout.height).toBe(Math.floor(1112 * (333 / 834)));
  });

  it("shows the device at full size before the stage is measured", () => {
    expect(previewStageLayout(0, PREVIEW_DEVICES.desktop).scale).toBe(1);
  });
});

describe("normalizePreviewPath", () => {
  it("keeps paths, queries and fragments on the site", () => {
    expect(normalizePreviewPath("/blog/post?x=1#top", SITE)).toEqual({
      ok: true,
      path: "/blog/post?x=1#top",
    });
    expect(normalizePreviewPath("  ?page=2 ", SITE)).toEqual({ ok: true, path: "/?page=2" });
  });

  it("reads a bare word as a page rather than a host", () => {
    expect(normalizePreviewPath("about", SITE)).toEqual({ ok: true, path: "/about" });
  });

  it("strips the site's own host from a pasted address", () => {
    expect(normalizePreviewPath("https://pages.bagels.top/docs", SITE)).toEqual({
      ok: true,
      path: "/docs",
    });
    expect(normalizePreviewPath("Pages.Bagels.Top/docs?a=1", SITE)).toEqual({
      ok: true,
      path: "/docs?a=1",
    });
  });

  it("returns the site's own address as no path", () => {
    expect(normalizePreviewPath("", SITE)).toEqual({ ok: true, path: undefined });
    expect(normalizePreviewPath("/", SITE)).toEqual({ ok: true, path: undefined });
    expect(normalizePreviewPath("https://pages.bagels.top", SITE)).toEqual({
      ok: true,
      path: undefined,
    });
  });

  it("treats a site that lives under a path as its home, keeping the root reachable", () => {
    const docs = "https://example.com/docs";
    expect(normalizePreviewPath("/docs", docs)).toEqual({ ok: true, path: undefined });
    expect(normalizePreviewPath("/", docs)).toEqual({ ok: true, path: "/" });
  });

  it("refuses addresses that leave the site", () => {
    for (const input of [
      "https://evil.example/x",
      "//evil.example/x",
      "http://pages.bagels.top/x",
      "javascript:alert(1)",
    ]) {
      expect(normalizePreviewPath(input, SITE)).toEqual({
        ok: false,
        reason: "The preview stays on pages.bagels.top.",
      });
    }
  });

  it("refuses an address too long for the route to keep", () => {
    const result = normalizePreviewPath(`/${"a".repeat(2048)}`, SITE);
    expect(result.ok).toBe(false);
  });

  it("refuses everything when the site's own address is broken", () => {
    expect(normalizePreviewPath("/x", "not a url").ok).toBe(false);
  });
});
