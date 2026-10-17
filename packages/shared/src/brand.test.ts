import { describe, expect, it } from "vite-plus/test";

import { BRAND_NAME, formatBrandDisplayName } from "./brand.ts";

describe("fork brand display names", () => {
  it("shows the bare name for stable stages", () => {
    expect(formatBrandDisplayName("Beta")).toBe(BRAND_NAME);
    // Older desktop hosts still report upstream's previous stable stage.
    expect(formatBrandDisplayName("Alpha")).toBe(BRAND_NAME);
    expect(formatBrandDisplayName("Latest")).toBe(BRAND_NAME);
  });

  it("labels development and nightly stages", () => {
    expect(formatBrandDisplayName("Dev")).toBe(`${BRAND_NAME} (Dev)`);
    expect(formatBrandDisplayName("Nightly")).toBe(`${BRAND_NAME} (Nightly)`);
  });

  it("applies the same policy to another base name", () => {
    expect(formatBrandDisplayName("Beta", "Other")).toBe("Other");
    expect(formatBrandDisplayName("Nightly", "Other")).toBe("Other (Nightly)");
  });
});
