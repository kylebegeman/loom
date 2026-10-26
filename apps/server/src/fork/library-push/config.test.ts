import { describe, expect, it } from "@effect/vitest";

import { isLibraryAuthorityEnv } from "../project-library/authority.ts";
import {
  LIBRARY_PUSH_TTL_SECONDS,
  libraryPushActivityAdvertised,
  libraryPushAdvertised,
  libraryPushAlertRecipients,
  libraryPushConfig,
  libraryPushEffective,
  libraryPushSwitchOn,
  parseLibraryPushTopics,
} from "./config.ts";

const FULL = {
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_ISSUER: "https://id.example.test",
  LOOM_IDENTITY_AUDIENCE: "loom-library",
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "alice, bob,alice",
  LOOM_LIBRARY_PUSH_ENABLED: "true",
  LOOM_LIBRARY_PUSH_APNS_TEAM_ID: "TEAM123456",
  LOOM_LIBRARY_PUSH_APNS_KEY_ID: "KEY1234567",
  LOOM_LIBRARY_PUSH_APNS_KEY_FILE: "/srv/loom/apns.p8",
};

const REQUIRED = [
  "LOOM_LIBRARY_AUTHORITY",
  "LOOM_IDENTITY_ISSUER",
  "LOOM_IDENTITY_AUDIENCE",
  "LOOM_IDENTITY_ALLOWED_SUBJECTS",
  "LOOM_LIBRARY_PUSH_ENABLED",
  "LOOM_LIBRARY_PUSH_APNS_TEAM_ID",
  "LOOM_LIBRARY_PUSH_APNS_KEY_ID",
  "LOOM_LIBRARY_PUSH_APNS_KEY_FILE",
] as const;

describe("library push config", () => {
  it("is effective only with the authority, Identity, the switch and every key setting", () => {
    expect(libraryPushEffective(FULL)).toBe(true);
    expect(libraryPushEffective({})).toBe(false);
    const missing = REQUIRED.filter((key) => libraryPushEffective({ ...FULL, [key]: " " }));
    expect(missing).toEqual([]);
    const unset = REQUIRED.filter((key) => {
      const env: Record<string, string | undefined> = { ...FULL };
      delete env[key];
      return libraryPushEffective(env);
    });
    expect(unset).toEqual([]);
  });

  it("advertises exactly when push is effective", () => {
    const cases = [
      FULL,
      {},
      { ...FULL, LOOM_LIBRARY_PUSH_ENABLED: "false" },
      { ...FULL, LOOM_LIBRARY_AUTHORITY: "0" },
      { ...FULL, LOOM_LIBRARY_PUSH_APNS_KEY_FILE: "" },
    ];
    expect(cases.map(libraryPushAdvertised)).toEqual(cases.map(libraryPushEffective));
  });

  it("reads the switch with the authority's literals", () => {
    const values = [
      "true",
      "yes",
      "on",
      "1",
      "y",
      "TRUE",
      "True",
      "false",
      "0",
      "",
      " true",
      "enabled",
    ];
    expect(
      values.map((value) => libraryPushSwitchOn({ LOOM_LIBRARY_PUSH_ENABLED: value })),
    ).toEqual(values.map((value) => isLibraryAuthorityEnv({ LOOM_LIBRARY_AUTHORITY: value })));
    expect(libraryPushSwitchOn({})).toBe(false);
  });

  it("keeps a row 60 days whatever the Identity sign-in limit", () => {
    const ttl = (value?: string) => {
      const config = libraryPushConfig({ ...FULL, LOOM_IDENTITY_MAX_SESSION_AGE: value });
      return config._tag === "On" ? config.ttlSeconds : null;
    };
    expect(LIBRARY_PUSH_TTL_SECONDS).toBe(60 * 24 * 60 * 60);
    expect(ttl()).toBe(LIBRARY_PUSH_TTL_SECONDS);
    expect(ttl("7d")).toBe(LIBRARY_PUSH_TTL_SECONDS);
  });

  it("says why push is off", () => {
    expect(libraryPushConfig({})).toEqual({ _tag: "Off", reason: "not-library" });
    expect(libraryPushConfig({ ...FULL, LOOM_LIBRARY_PUSH_ENABLED: "0" })).toEqual({
      _tag: "Off",
      reason: null,
    });
  });

  it("sends agent alerts to the one allowed account, else only to the ones named", () => {
    const one = { ...FULL, LOOM_IDENTITY_ALLOWED_SUBJECTS: "alice" };
    expect(libraryPushAlertRecipients(one)).toEqual(["alice"]);
    expect(libraryPushAlertRecipients(FULL)).toEqual([]);
    expect(
      libraryPushAlertRecipients({ ...FULL, LOOM_LIBRARY_PUSH_RECIPIENTS: " bob, carol,bob" }),
    ).toEqual(["bob"]);
    // A named account must also be allowed to sign in.
    expect(libraryPushAlertRecipients({ ...one, LOOM_LIBRARY_PUSH_RECIPIENTS: "carol" })).toEqual(
      [],
    );
  });

  it("runs agent alerts only with their switch, working push and someone to receive them", () => {
    const on = {
      ...FULL,
      LOOM_LIBRARY_PUSH_ACTIVITY: "yes",
      LOOM_LIBRARY_PUSH_RECIPIENTS: "alice",
    };
    expect(libraryPushActivityAdvertised(on)).toBe(true);
    expect(libraryPushConfig(on)).toMatchObject({ _tag: "On", alertRecipients: ["alice"] });
    const off = [
      { ...on, LOOM_LIBRARY_PUSH_ACTIVITY: undefined },
      { ...on, LOOM_LIBRARY_PUSH_ACTIVITY: "TRUE" },
      { ...on, LOOM_LIBRARY_PUSH_ENABLED: "false" },
      { ...on, LOOM_LIBRARY_PUSH_RECIPIENTS: "carol" },
    ];
    expect(off.map(libraryPushActivityAdvertised)).toEqual([false, false, false, false]);
    expect(libraryPushConfig(FULL)).toMatchObject({ _tag: "On", alertRecipients: null });
  });

  it("takes the account rules from the Identity settings", () => {
    expect(
      libraryPushConfig({ ...FULL, LOOM_IDENTITY_ISSUER: " https://id.example.test " }),
    ).toMatchObject({
      _tag: "On",
      issuer: "https://id.example.test",
      allowedSubjects: ["alice", "bob"],
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      keyFile: "/srv/loom/apns.p8",
    });
  });

  it("serves only the App Store app in production unless the Library lists more", () => {
    expect(parseLibraryPushTopics(undefined)).toEqual([
      { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" },
    ]);
    expect(parseLibraryPushTopics("  ")).toEqual(parseLibraryPushTopics(undefined));
    expect(
      parseLibraryPushTopics(
        "com.kylebegeman.loom:production, com.kylebegeman.loom.dev:sandbox,com.kylebegeman.loom:production",
      ),
    ).toEqual([
      { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" },
      { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" },
    ]);
  });

  it("ignores pairs outside the bundle allowlist and never falls back to the default", () => {
    expect(
      parseLibraryPushTopics(
        "com.example.other:production,com.kylebegeman.loom:staging,com.kylebegeman.loom,com.kylebegeman.loom.preview:production",
      ),
    ).toEqual([{ bundleId: "com.kylebegeman.loom.preview", apsEnvironment: "production" }]);
    expect(parseLibraryPushTopics("com.example.other:production")).toEqual([]);
  });
});
