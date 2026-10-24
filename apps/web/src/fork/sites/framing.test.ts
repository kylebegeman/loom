import { describe, expect, it } from "vite-plus/test";
import { siteFrameUrl } from "./framing";

const APP = "https://app.t3.codes";

describe("siteFrameUrl", () => {
  it("frames a path on the site's own origin", () => {
    expect(siteFrameUrl("https://pages.bagels.top", "/blog/post?x=1", APP)).toBe(
      "https://pages.bagels.top/blog/post?x=1",
    );
    expect(siteFrameUrl("https://pages.bagels.top/", "about", APP)).toBe(
      "https://pages.bagels.top/about",
    );
  });

  it("keeps a path that names another origin on the site", () => {
    expect(siteFrameUrl("https://pages.bagels.top", "//evil.example/x", APP)).toBe(
      "https://pages.bagels.top/",
    );
  });

  it("refuses the app's own origin and non-web addresses", () => {
    expect(siteFrameUrl(`${APP}/x`, undefined, APP)).toBeNull();
    expect(siteFrameUrl("javascript:alert(1)", undefined, APP)).toBeNull();
    expect(siteFrameUrl("not a url", undefined, APP)).toBeNull();
  });
});
