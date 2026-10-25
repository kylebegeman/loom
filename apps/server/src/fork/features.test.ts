import { describe, expect, it } from "@effect/vitest";
import {
  LIBRARY_PUSH_ACTIVITY_FEATURE,
  LIBRARY_PUSH_FEATURE,
  REACH_FEATURE,
  REACH_LIBRARY_FEATURE,
} from "@t3tools/contracts/fork";
import { afterEach, vi } from "vite-plus/test";

import { directoryAdvertised } from "./directory/advertised.ts";
import { LOOM_SERVER_FEATURES } from "./features.ts";

const LIBRARY = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_REDIRECT_URI: "https://library.example.com/api/auth/identity/callback",
};
const REACH_LIBRARY = {
  ...LIBRARY,
  LOOM_REACH_ZONE: "reach.example.com",
  LOOM_REACH_CLOUDFLARE_TOKEN_FILE: "/etc/loom/cloudflare-token",
};
const LIBRARY_PUSH = {
  ...LIBRARY,
  LOOM_IDENTITY_ISSUER: "https://id.example.test",
  LOOM_IDENTITY_AUDIENCE: "loom-library",
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "alice",
  LOOM_LIBRARY_PUSH_ENABLED: "true",
  LOOM_LIBRARY_PUSH_APNS_TEAM_ID: "TEAM123456",
  LOOM_LIBRARY_PUSH_APNS_KEY_ID: "KEY1234567",
  LOOM_LIBRARY_PUSH_APNS_KEY_FILE: "/srv/loom/apns.p8",
};
const LIBRARY_PUSH_ACTIVITY = {
  ...LIBRARY_PUSH,
  LOOM_LIBRARY_PUSH_ACTIVITY: "true",
  LOOM_LIBRARY_PUSH_RECIPIENTS: "",
};
const GATING_KEYS = Object.keys({ ...REACH_LIBRARY, ...LIBRARY_PUSH_ACTIVITY });

/** The list is computed when the module loads, so each env needs a fresh copy. */
const featuresWith = async (env: Readonly<Record<string, string>>) => {
  for (const key of GATING_KEYS) vi.stubEnv(key, env[key]);
  vi.resetModules();
  return (await import("./features.ts")).LOOM_SERVER_FEATURES;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LOOM_SERVER_FEATURES", () => {
  it("lists unique kebab-case slugs", () => {
    expect(new Set(LOOM_SERVER_FEATURES).size).toBe(LOOM_SERVER_FEATURES.length);
    expect(LOOM_SERVER_FEATURES.filter((slug) => !/^[a-z0-9-]+$/.test(slug))).toEqual([]);
  });

  it("advertises reach on every computer and its Library parts only where they run", async () => {
    const plain = await featuresWith({});
    expect(plain).toContain(REACH_FEATURE);
    expect(plain).not.toContain(REACH_LIBRARY_FEATURE);
    expect(plain).not.toContain(LIBRARY_PUSH_FEATURE);

    const reach = await featuresWith(REACH_LIBRARY);
    expect(reach).toContain(REACH_LIBRARY_FEATURE);
    expect(reach).not.toContain(LIBRARY_PUSH_FEATURE);

    const push = await featuresWith(LIBRARY_PUSH);
    expect(push).toContain(LIBRARY_PUSH_FEATURE);
    expect(push).not.toContain(REACH_LIBRARY_FEATURE);
    expect(push).not.toContain(LIBRARY_PUSH_ACTIVITY_FEATURE);
  });

  it("advertises agent alerts only when the Library has someone to send them to", async () => {
    expect(await featuresWith(LIBRARY_PUSH_ACTIVITY)).toContain(LIBRARY_PUSH_ACTIVITY_FEATURE);

    const shared = { ...LIBRARY_PUSH_ACTIVITY, LOOM_IDENTITY_ALLOWED_SUBJECTS: "alice,bob" };
    expect(await featuresWith(shared)).not.toContain(LIBRARY_PUSH_ACTIVITY_FEATURE);
    expect(
      await featuresWith({ ...shared, LOOM_LIBRARY_PUSH_RECIPIENTS: "bob" }),
    ).toContain(LIBRARY_PUSH_ACTIVITY_FEATURE);

    const withoutPush = { ...LIBRARY_PUSH_ACTIVITY, LOOM_LIBRARY_PUSH_ENABLED: "false" };
    expect(await featuresWith(withoutPush)).not.toContain(LIBRARY_PUSH_ACTIVITY_FEATURE);
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
