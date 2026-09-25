import { describe, expect, it } from "@effect/vitest";

import { LOOM_SERVER_FEATURES } from "./features.ts";

describe("LOOM_SERVER_FEATURES", () => {
  it("lists unique kebab-case slugs", () => {
    expect(new Set(LOOM_SERVER_FEATURES).size).toBe(LOOM_SERVER_FEATURES.length);
    expect(LOOM_SERVER_FEATURES.filter((slug) => !/^[a-z0-9-]+$/.test(slug))).toEqual([]);
  });
});
