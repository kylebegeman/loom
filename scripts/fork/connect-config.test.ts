import { describe, expect, it } from "vite-plus/test";

import {
  loomConnectBuildEnvironment,
  loomMobileConnectConfig,
  parseLoomConnectConfig,
} from "./connect-config.ts";

const config = {
  enabled: true,
  mobileEnabled: true,
  clerkPublishableKey: "pk_live_YXV0aC5leGFtcGxlLnRlc3Qk",
  clerkJwtTemplate: "relay",
  clerkCliOAuthClientId: "public-oauth-id",
  relayUrl: "https://relay.example.test/",
  accountPortalUrl: "https://accounts.example.test",
};

describe("Loom release Connect configuration", () => {
  it("propagates explicit public account configuration to every release surface", () => {
    const parsed = parseLoomConnectConfig(config)!;
    const env = loomConnectBuildEnvironment(parsed);
    expect(env).toEqual({
      T3CODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
      T3CODE_CLERK_JWT_TEMPLATE: "relay",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "public-oauth-id",
      T3CODE_RELAY_URL: "https://relay.example.test",
      LOOM_MOBILE_ACCOUNT_PORTAL_URL: "https://accounts.example.test",
      LOOM_MOBILE_CONNECT_ENABLED: "1",
    });
    expect(loomMobileConnectConfig(env)).toEqual(parsed);
  });

  it("requires a separate mobile opt-in and complete host OAuth configuration", () => {
    const parsed = parseLoomConnectConfig({ ...config, mobileEnabled: undefined })!;
    expect(loomMobileConnectConfig(loomConnectBuildEnvironment(parsed))).toBeNull();
    expect(loomMobileConnectConfig({ T3CODE_RELAY_URL: config.relayUrl })).toBeNull();
    expect(() => loomMobileConnectConfig({ LOOM_MOBILE_CONNECT_ENABLED: "1" })).toThrow();
    expect(() => parseLoomConnectConfig({ ...config, clerkCliOAuthClientId: "" })).toThrow();
    expect(parseLoomConnectConfig({ enabled: false })).toBeNull();
  });

  it.each([
    { clerkPublishableKey: "sk_live_private" },
    { relayUrl: "http://relay.example.test" },
    { relayUrl: "https://user:password@relay.example.test" },
    { relayUrl: "https://relay.example.test?token=secret" },
    { relayUrl: "https://relay.example.test#fragment" },
    { CLERK_SECRET_KEY: "must-not-be-copied" },
    { nativeAuthDomain: "clerk.t3.codes" },
    { nativeAuthDomain: "https://auth.example.test" },
    { mobileEnabled: "true" },
    { accountPortalUrl: "http://accounts.example.test" },
    { accountPortalUrl: "https://user:password@accounts.example.test" },
    { accountPortalUrl: "https://accounts.example.test/sign-in" },
    { accountPortalUrl: "https://accounts.example.test#token" },
  ])("rejects unsafe or ambiguous public configuration %j", (override) => {
    expect(() => parseLoomConnectConfig({ ...config, ...override })).toThrow();
  });

  it("uses upstream's verified hosted account pages without claiming native app registration", () => {
    const upstream = parseLoomConnectConfig({
      ...config,
      clerkPublishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk",
      accountPortalUrl: undefined,
    });
    expect(upstream?.accountPortalUrl).toBe("https://accounts.t3.codes");
    expect(upstream?.nativeAuthDomain).toBeUndefined();
    expect(() => parseLoomConnectConfig({ ...config, accountPortalUrl: undefined })).toThrow(
      "accountPortalUrl",
    );
  });

  it("does not assume native credentials or callbacks from account discovery", () => {
    const parsed = parseLoomConnectConfig(config)!;
    expect(loomConnectBuildEnvironment(parsed)).not.toHaveProperty("LOOM_MOBILE_AUTH_DOMAIN");
    expect(
      loomConnectBuildEnvironment(
        parseLoomConnectConfig({ ...config, nativeAuthDomain: "auth.example.test" }),
      ),
    ).toHaveProperty("LOOM_MOBILE_AUTH_DOMAIN", "auth.example.test");
  });
});
