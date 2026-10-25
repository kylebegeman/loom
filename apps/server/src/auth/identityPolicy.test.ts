// @effect-diagnostics-next-line nodeBuiltinImport:off -- Recomputes the previous prefix exactly.
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import {
  identityConfigured,
  identityResource,
  identitySessionPrefix,
  parseMaxSessionAge,
  passkeyRequired,
} from "./identityPolicy.ts";

const ENVIRONMENT = {
  LOOM_IDENTITY_ISSUER: "https://id.example.test",
  LOOM_IDENTITY_AUDIENCE: "https://host.example.test",
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner-id",
};
// The keys every host hashed before LOOM_IDENTITY_MAX_SESSION_AGE was a policy key.
const ORIGINAL_KEYS = [
  "LOOM_IDENTITY_ISSUER",
  "LOOM_IDENTITY_AUDIENCE",
  "LOOM_IDENTITY_RESOURCE",
  "LOOM_IDENTITY_BROWSER_ORIGINS",
  "LOOM_IDENTITY_CLIENT_ID",
  "LOOM_IDENTITY_NATIVE_CLIENT_ID",
  "LOOM_IDENTITY_ALLOWED_SUBJECTS",
  "LOOM_IDENTITY_REQUIRED_GROUPS",
  "LOOM_IDENTITY_ALLOW_ADMIN",
] as const;

/** Recomputes a prefix an earlier release issued, so an upgrade provably keeps its sessions. */
function earlierPrefix(environment: Record<string, string>, keys: ReadonlyArray<string>) {
  const policy = keys
    .map((key) => {
      const value = environment[key] ?? "";
      return `${key.length}:${key}${value.length}:${value}`;
    })
    .join("");
  return `identity:${NodeCrypto.createHash("sha256").update(policy).digest("base64url")}:`;
}

describe("parseMaxSessionAge", () => {
  it("reads whole seconds and s, m, h or d suffixes", () => {
    expect(parseMaxSessionAge("3600")).toBe(3600);
    expect(parseMaxSessionAge("90m")).toBe(5400);
    expect(parseMaxSessionAge("12h")).toBe(43_200);
    expect(parseMaxSessionAge(" 7d ")).toBe(604_800);
    expect(parseMaxSessionAge("30d")).toBe(2_592_000);
    expect(parseMaxSessionAge("365d")).toBe(31_536_000);
  });

  it("refuses limits outside one hour to 365 days and anything that is not a whole number", () => {
    for (const value of ["", "59m", "3599", "366d", "1.5h", "-1d", "7 d", "7D", "1w", "7dd", "d"])
      expect(parseMaxSessionAge(value)).toBeNull();
  });
});

describe("identitySessionPrefix", () => {
  it("invalidates earlier Identity sessions when the sign-in limit changes", () => {
    const unlimited = identitySessionPrefix(ENVIRONMENT);
    const weekly = identitySessionPrefix({ ...ENVIRONMENT, LOOM_IDENTITY_MAX_SESSION_AGE: "7d" });
    expect(weekly).not.toBe(unlimited);
    expect(
      identitySessionPrefix({ ...ENVIRONMENT, LOOM_IDENTITY_MAX_SESSION_AGE: "30d" }),
    ).not.toBe(weekly);
  });

  it("keeps sessions issued before the sign-in limit existed while it stays unset", () => {
    const previous = earlierPrefix(ENVIRONMENT, ORIGINAL_KEYS);
    expect(identitySessionPrefix(ENVIRONMENT)).toBe(previous);
    expect(identitySessionPrefix({ ...ENVIRONMENT, LOOM_IDENTITY_MAX_SESSION_AGE: " " })).toBe(
      previous,
    );
  });

  it("invalidates earlier Identity sessions once a passkey is required and keeps them while unset", () => {
    const limited = { ...ENVIRONMENT, LOOM_IDENTITY_MAX_SESSION_AGE: "7d" };
    const beforePasskeys = earlierPrefix(limited, [
      ...ORIGINAL_KEYS,
      "LOOM_IDENTITY_MAX_SESSION_AGE",
    ]);
    expect(identitySessionPrefix(limited)).toBe(beforePasskeys);
    expect(identitySessionPrefix({ ...limited, LOOM_IDENTITY_REQUIRE_PASSKEY: " " })).toBe(
      beforePasskeys,
    );
    expect(identitySessionPrefix({ ...limited, LOOM_IDENTITY_REQUIRE_PASSKEY: "true" })).not.toBe(
      beforePasskeys,
    );
    expect(
      identitySessionPrefix({ ...ENVIRONMENT, LOOM_IDENTITY_REQUIRE_PASSKEY: "true" }),
    ).not.toBe(identitySessionPrefix(ENVIRONMENT));
  });
});

describe("environment helpers for reach warnings", () => {
  it("reports Identity on only with an issuer, an audience and an allowlist", () => {
    expect(identityConfigured(ENVIRONMENT)).toBe(true);
    for (const key of Object.keys(ENVIRONMENT))
      expect(identityConfigured({ ...ENVIRONMENT, [key]: " " })).toBe(false);
  });

  it("requires a passkey only for the exact value true", () => {
    expect(passkeyRequired({ LOOM_IDENTITY_REQUIRE_PASSKEY: " true " })).toBe(true);
    for (const value of [undefined, "", "yes", "TRUE", "1"])
      expect(passkeyRequired({ LOOM_IDENTITY_REQUIRE_PASSKEY: value })).toBe(false);
  });

  it("names the resource clients pin, falling back to the first audience", () => {
    expect(
      identityResource({
        ...ENVIRONMENT,
        LOOM_IDENTITY_RESOURCE: " https://library.example.test/computers/host ",
      }),
    ).toBe("https://library.example.test/computers/host");
    expect(
      identityResource({
        LOOM_IDENTITY_AUDIENCE: " , https://host.example.test,https://other.example.test",
      }),
    ).toBe("https://host.example.test");
    expect(identityResource({ LOOM_IDENTITY_RESOURCE: " " })).toBeNull();
  });
});
