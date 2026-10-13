import { describe, expect, it } from "vite-plus/test";

import { resolveLoomMobileIdentity } from "./mobileIdentity.ts";

const cloud = {
  LOOM_MOBILE_CONNECT_ENABLED: "1",
  LOOM_IOS_TEAM_ID: "ABC1234567",
  T3CODE_RELAY_URL: "https://relay.example.test",
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_own_app",
  EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "relay",
};

describe("Loom mobile identity", () => {
  it.each([
    ["production", "Loom", "loom", "com.kylebegeman.loom"],
    ["development", "Loom Dev", "loom-dev", "com.kylebegeman.loom.dev"],
    ["preview", "Loom Preview", "loom-preview", "com.kylebegeman.loom.preview"],
  ])(
    "isolates the %s app from the upstream installation",
    (appVariant, appName, scheme, iosBundleIdentifier) => {
      expect(resolveLoomMobileIdentity({ APP_VARIANT: appVariant })).toMatchObject({
        appName,
        scheme,
        iosBundleIdentifier,
      });
    },
  );

  it("keeps inherited desktop cloud configuration out of the mobile release", () => {
    const identity = resolveLoomMobileIdentity({
      ...cloud,
      LOOM_MOBILE_CONNECT_ENABLED: undefined,
      T3CODE_MOBILE_UPDATES_ENABLED: "1",
    });
    expect(identity).toMatchObject({
      updatesEnabled: false,
      connectEnabled: false,
      pushEnabled: false,
      appleSignInEnabled: false,
      associatedDomains: [],
    });
    expect(identity.relayUrl).toBeUndefined();
    expect(identity.clerkPublishableKey).toBeUndefined();
    expect(identity.clerkJwtTemplate).toBeUndefined();
    expect(identity.expoProjectId).toBeUndefined();
    expect(identity.expoOwner).toBeUndefined();
  });

  it.each([
    { LOOM_IOS_TEAM_ID: "ARK85ZXQ4Z" },
    { LOOM_IOS_TEAM_ID: "not-a-team" },
    {
      LOOM_MOBILE_EXPO_PROJECT_ID: "d763fcb8-d37c-41ea-a773-b54a0ab4a454",
      LOOM_MOBILE_EXPO_OWNER: "own-account",
    },
    {
      LOOM_MOBILE_EXPO_PROJECT_ID: "57b4c15b-bebd-4783-afdf-643f3b559cfa",
      LOOM_MOBILE_EXPO_OWNER: "pingdotgg",
    },
    { LOOM_MOBILE_EXPO_PROJECT_ID: "not-a-uuid", LOOM_MOBILE_EXPO_OWNER: "own-account" },
  ])("rejects invalid or upstream distribution targets %j", (env) => {
    expect(() => resolveLoomMobileIdentity(env)).toThrow();
  });

  it("requires the complete owned Expo identity before enabling OTA", () => {
    expect(() => resolveLoomMobileIdentity({ LOOM_MOBILE_UPDATES_ENABLED: "1" })).toThrow(
      "Expo project",
    );
    expect(() => resolveLoomMobileIdentity({ LOOM_MOBILE_EXPO_OWNER: "own-account" })).toThrow(
      "together",
    );
    expect(
      resolveLoomMobileIdentity({
        LOOM_MOBILE_EXPO_PROJECT_ID: "57b4c15b-bebd-4783-afdf-643f3b559cfa",
        LOOM_MOBILE_EXPO_OWNER: "own-account",
        LOOM_MOBILE_UPDATES_ENABLED: "1",
      }).updatesEnabled,
    ).toBe(true);
  });

  it("does not opt a newly configured Expo project into OTA automatically", () => {
    expect(
      resolveLoomMobileIdentity({
        LOOM_MOBILE_EXPO_PROJECT_ID: "57b4c15b-bebd-4783-afdf-643f3b559cfa",
        LOOM_MOBILE_EXPO_OWNER: "own-account",
      }).updatesEnabled,
    ).toBe(false);
  });

  it("requires explicit complete Connect configuration and secure routing", () => {
    expect(() => resolveLoomMobileIdentity({ LOOM_MOBILE_CONNECT_ENABLED: "1" })).toThrow(
      "configured relay",
    );
    expect(() =>
      resolveLoomMobileIdentity({ ...cloud, T3CODE_RELAY_URL: "http://relay.example.test" }),
    ).toThrow("HTTPS");
    expect(() =>
      resolveLoomMobileIdentity({
        ...cloud,
        T3CODE_RELAY_URL: "https://user:password@relay.example.test",
      }),
    ).toThrow("credentials");
    expect(resolveLoomMobileIdentity(cloud)).toMatchObject({
      connectEnabled: true,
      pushEnabled: false,
      appleSignInEnabled: false,
      associatedDomains: [],
    });
  });

  it("enables cloud entitlements only when individually configured", () => {
    expect(() => resolveLoomMobileIdentity({ LOOM_MOBILE_PUSH_ENABLED: "1" })).toThrow(
      "eligible Apple team",
    );
    expect(() =>
      resolveLoomMobileIdentity({
        ...cloud,
        T3CODE_IOS_PERSONAL_TEAM: "1",
        T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.loom",
        LOOM_MOBILE_PUSH_ENABLED: "1",
      }),
    ).toThrow("eligible Apple team");
    expect(
      resolveLoomMobileIdentity({
        ...cloud,
        LOOM_MOBILE_PUSH_ENABLED: "1",
        LOOM_MOBILE_APPLE_SIGN_IN_ENABLED: "1",
        LOOM_MOBILE_AUTH_DOMAIN: "auth.example.test",
      }),
    ).toMatchObject({
      pushEnabled: true,
      appleSignInEnabled: true,
      associatedDomains: ["applinks:auth.example.test", "webcredentials:auth.example.test"],
    });
  });

  it("rejects an upstream authentication domain instead of assuming its allowlist", () => {
    expect(() =>
      resolveLoomMobileIdentity({ ...cloud, LOOM_MOBILE_AUTH_DOMAIN: "clerk.t3.codes" }),
    ).toThrow("own authentication domain");
  });

  it("retains the reduced-capability Personal Team path with a controlled identifier", () => {
    expect(
      resolveLoomMobileIdentity({
        T3CODE_IOS_PERSONAL_TEAM: "1",
        T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.loom.dev",
      }),
    ).toMatchObject({
      personalTeam: true,
      iosBundleIdentifier: "com.example.loom.dev",
      pushEnabled: false,
      appleSignInEnabled: false,
    });
    expect(() => resolveLoomMobileIdentity({ T3CODE_IOS_PERSONAL_TEAM: "1" })).toThrow(
      "identifier you control",
    );
    expect(() =>
      resolveLoomMobileIdentity({
        T3CODE_IOS_PERSONAL_TEAM: "1",
        T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.t3tools.t3code",
      }),
    ).toThrow("identifier you control");
  });

  it("fails visibly on misspelled release variants or opt-in values", () => {
    expect(() => resolveLoomMobileIdentity({ APP_VARIANT: "prodution" })).toThrow("APP_VARIANT");
    expect(() => resolveLoomMobileIdentity({ LOOM_MOBILE_UPDATES_ENABLED: "true" })).toThrow(
      "0 or 1",
    );
  });

  it("accepts reproducible Apple build identity and rejects malformed package metadata", () => {
    expect(
      resolveLoomMobileIdentity({
        LOOM_IOS_BUILD_NUMBER: "12.3.4",
        LOOM_IOS_SOURCE_SHA: "5ae63746034acbcc7ee17204ec90bc629820006d",
      }),
    ).toMatchObject({
      iosBuildNumber: "12.3.4",
      sourceCommit: "5ae63746034acbcc7ee17204ec90bc629820006d",
    });
    expect(() => resolveLoomMobileIdentity({ LOOM_IOS_BUILD_NUMBER: "12.3.4.5" })).toThrow(
      "LOOM_IOS_BUILD_NUMBER",
    );
    expect(() => resolveLoomMobileIdentity({ LOOM_IOS_BUILD_NUMBER: "2-beta" })).toThrow(
      "LOOM_IOS_BUILD_NUMBER",
    );
    expect(() => resolveLoomMobileIdentity({ LOOM_IOS_SOURCE_SHA: "5ae6374603" })).toThrow(
      "source commit",
    );
    expect(() => resolveLoomMobileIdentity({ LOOM_IOS_BUILD_NUMBER: "10000.1.1" })).toThrow(
      "LOOM_IOS_BUILD_NUMBER",
    );
    expect(() => resolveLoomMobileIdentity({ LOOM_IOS_BUILD_NUMBER: "1.100.1" })).toThrow(
      "LOOM_IOS_BUILD_NUMBER",
    );
    expect(() => resolveLoomMobileIdentity({ LOOM_IOS_BUILD_NUMBER: "01.1.1" })).toThrow(
      "LOOM_IOS_BUILD_NUMBER",
    );
  });
});
