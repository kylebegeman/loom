// @effect-diagnostics nodeBuiltinImport:off - Exercise real Expo config against private synthetic root env files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../../../../scripts/lib/public-config.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../../scripts/lib/public-config.ts")>();
  return {
    ...actual,
    loadRepoEnv: (options: Parameters<typeof actual.loadRepoEnv>[0]) =>
      actual.loadRepoEnv({ ...options, repoRoot: fixture.directory }),
  };
});

beforeEach(() => {
  vi.resetModules();
  fixture.directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-ios-config-"));
  for (const key of [
    "LOOM_MOBILE_EXPO_OWNER",
    "LOOM_MOBILE_EXPO_PROJECT_ID",
    "EXPO_PUBLIC_SHOWCASE",
    "T3_SHOWCASE_CAPTURE_BUILD",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("LOOM_IOS_TEAM_ID", "LOOMTEST01");
  vi.stubEnv("LOOM_IOS_RELEASE_BUILD", "1");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "0");
  for (const key of [
    "LOOM_MOBILE_CONNECT_ENABLED",
    "LOOM_MOBILE_UPDATES_ENABLED",
    "LOOM_MOBILE_PUSH_ENABLED",
    "LOOM_MOBILE_APPLE_SIGN_IN_ENABLED",
  ])
    vi.stubEnv(key, "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  NodeFS.rmSync(fixture.directory, { recursive: true, force: true });
});

describe("Loom iOS release config environment", () => {
  it("does not reload development or upstream publishing values from checkout env files", async () => {
    NodeFS.writeFileSync(
      NodePath.join(fixture.directory, ".env"),
      [
        "LOOM_IOS_RELEASE_BUILD=0",
        "EXPO_PUBLIC_SHOWCASE=1",
        "T3_SHOWCASE_CAPTURE_BUILD=1",
        "LOOM_MOBILE_EXPO_OWNER=pingdotgg",
        "LOOM_MOBILE_EXPO_PROJECT_ID=d763fcb8-d37c-41ea-a773-b54a0ab4a454",
      ].join("\n"),
    );
    const { default: config } = await import("../../../app.config.ts");
    expect(config.name).toBe("Loom");
    expect(config.ios?.requireFullScreen).toBe(false);
    expect(config.owner).toBeUndefined();
    expect(config.extra?.eas).toBeUndefined();
    expect(process.env.LOOM_IOS_RELEASE_BUILD).toBe("1");
    expect(process.env.EXPO_PUBLIC_SHOWCASE).toBeUndefined();
    expect(process.env.LOOM_MOBILE_EXPO_PROJECT_ID).toBeUndefined();
  });

  it("keeps root file loading available for ordinary development", async () => {
    vi.stubEnv("LOOM_IOS_RELEASE_BUILD", "0");
    vi.stubEnv("APP_VARIANT", "development");
    NodeFS.writeFileSync(
      NodePath.join(fixture.directory, ".env"),
      "EXPO_PUBLIC_SHOWCASE=1\nT3_SHOWCASE_CAPTURE_BUILD=1\n",
    );
    const { default: config } = await import("../../../app.config.ts");
    expect(config.name).toBe("Loom Dev");
    expect(config.ios?.requireFullScreen).toBe(true);
    expect(process.env.EXPO_PUBLIC_SHOWCASE).toBe("1");
  });
});
