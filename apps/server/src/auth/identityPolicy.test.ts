// @effect-diagnostics-next-line nodeBuiltinImport:off -- Recomputes the previous prefix exactly.
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { identitySessionPrefix, parseMaxSessionAge } from "./identityPolicy.ts";

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
    const environment = {
      LOOM_IDENTITY_ISSUER: "https://id.example.test",
      LOOM_IDENTITY_AUDIENCE: "https://host.example.test",
      LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner-id",
    };
    const unlimited = identitySessionPrefix(environment);
    const weekly = identitySessionPrefix({ ...environment, LOOM_IDENTITY_MAX_SESSION_AGE: "7d" });
    expect(weekly).not.toBe(unlimited);
    expect(
      identitySessionPrefix({ ...environment, LOOM_IDENTITY_MAX_SESSION_AGE: "30d" }),
    ).not.toBe(weekly);
  });

  it("keeps sessions issued before the sign-in limit existed while it stays unset", () => {
    const environment = {
      LOOM_IDENTITY_ISSUER: "https://id.example.test",
      LOOM_IDENTITY_AUDIENCE: "https://host.example.test",
      LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner-id",
    };
    // The prefix every host computed before LOOM_IDENTITY_MAX_SESSION_AGE was a policy key.
    const keys = [
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
    const policy = keys
      .map((key) => {
        const value = (environment as Record<string, string | undefined>)[key] ?? "";
        return `${key.length}:${key}${value.length}:${value}`;
      })
      .join("");
    const previous = `identity:${NodeCrypto.createHash("sha256").update(policy).digest("base64url")}:`;
    expect(identitySessionPrefix(environment)).toBe(previous);
    expect(identitySessionPrefix({ ...environment, LOOM_IDENTITY_MAX_SESSION_AGE: " " })).toBe(
      previous,
    );
  });
});
