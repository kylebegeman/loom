import { describe, expect, it } from "@effect/vitest";

import { directoryAdvertised } from "./directory/advertised.ts";
import { LOOM_SERVER_FEATURES } from "./features.ts";

describe("LOOM_SERVER_FEATURES", () => {
  it("lists unique kebab-case slugs", () => {
    expect(new Set(LOOM_SERVER_FEATURES).size).toBe(LOOM_SERVER_FEATURES.length);
    expect(LOOM_SERVER_FEATURES.filter((slug) => !/^[a-z0-9-]+$/.test(slug))).toEqual([]);
  });
});

describe("directoryAdvertised", () => {
  const redirect = "https://library.example.com/api/auth/identity/callback";
  it("needs the authority and a public https identity callback", () => {
    expect(
      directoryAdvertised({ LOOM_LIBRARY_AUTHORITY: "true", LOOM_IDENTITY_REDIRECT_URI: redirect }),
    ).toBe(true);
    expect(directoryAdvertised({ LOOM_IDENTITY_REDIRECT_URI: redirect })).toBe(false);
    expect(directoryAdvertised({ LOOM_LIBRARY_AUTHORITY: "true" })).toBe(false);
    // The same literals the directory's own Config.Boolean gate accepts.
    expect(
      directoryAdvertised({ LOOM_LIBRARY_AUTHORITY: "y", LOOM_IDENTITY_REDIRECT_URI: redirect }),
    ).toBe(true);
    expect(
      directoryAdvertised({ LOOM_LIBRARY_AUTHORITY: "TRUE", LOOM_IDENTITY_REDIRECT_URI: redirect }),
    ).toBe(false);
    expect(
      directoryAdvertised({
        LOOM_LIBRARY_AUTHORITY: "1",
        LOOM_IDENTITY_REDIRECT_URI: "http://library.example.com/callback",
      }),
    ).toBe(false);
  });
});
