// @effect-diagnostics nodeBuiltinImport:off - Verify the real public Expo serialization boundary without Apple or account-service calls.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { loomConnectBuildEnvironment, type LoomConnectConfig } from "./connect-config.ts";
import { iosBuildEnvironment, validateIosReleaseConfig } from "./ios-release.ts";

const MOBILE_ROOT = NodeURL.fileURLToPath(new URL("../../apps/mobile", import.meta.url));
const TEAM = "LOOMTEST01";
const connect: LoomConnectConfig = {
  enabled: true,
  mobileEnabled: true,
  clerkPublishableKey: "pk_live_YXV0aC5leGFtcGxlLnRlc3Qk",
  clerkJwtTemplate: "relay",
  clerkCliOAuthClientId: "public-oauth-id",
  relayUrl: "https://relay.example.test",
  accountPortalUrl: "https://accounts.example.test",
};

function publicExpoConfig(config: LoomConnectConfig | null): unknown {
  const env = iosBuildEnvironment(
    {
      PATH: NodeProcess.env.PATH,
      LOOM_IOS_TEAM_ID: TEAM,
      ...loomConnectBuildEnvironment(config),
    },
    "1",
  );
  const result = NodeChildProcess.spawnSync(
    NodePath.join(MOBILE_ROOT, "node_modules/.bin/expo"),
    ["config", "--json", "--type", "public"],
    { cwd: MOBILE_ROOT, env, encoding: "utf8", timeout: 15_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe("iOS release public Expo configuration", () => {
  it("validates an actually unconfigured public manifest without source env files", () => {
    const config = publicExpoConfig(null);
    expect(() => validateIosReleaseConfig(config, TEAM, "1")).not.toThrow();
    expect(config).not.toHaveProperty("extra.clerk.publishableKey");
    expect(config).not.toHaveProperty("extra.clerk.jwtTemplate");
    expect(config).not.toHaveProperty("extra.clerk.nativeAuthDomain");
    expect(config).not.toHaveProperty("extra.clerk.accountPortalUrl");
    expect(config).not.toHaveProperty("extra.relay.url");
    expect(() => validateIosReleaseConfig(config, TEAM, "1", connect)).toThrow(
      "Connect configuration",
    );
  });

  it("validates the exact explicitly enabled deployment after public serialization", () => {
    const config = publicExpoConfig(connect);
    expect(() => validateIosReleaseConfig(config, TEAM, "1", connect)).not.toThrow();
    expect(config).toMatchObject({
      extra: {
        clerk: {
          publishableKey: connect.clerkPublishableKey,
          jwtTemplate: connect.clerkJwtTemplate,
          accountPortalUrl: connect.accountPortalUrl,
        },
        relay: { url: connect.relayUrl },
      },
    });
    expect(config).not.toHaveProperty("extra.clerk.nativeAuthDomain");
    expect(() => validateIosReleaseConfig(config, TEAM, "1")).toThrow("Connect configuration");
  });
});
