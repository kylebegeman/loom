import { describe, expect, it } from "vite-plus/test";

import { identityRenewalText } from "./identity-renewal-policy.ts";

const WEEK = 7 * 24 * 3600;

describe("identity renewal text", () => {
  it("states the computer's renewal limit for an app that renews", () => {
    expect(
      identityRenewalText({
        metadata: { sessionExchangeEnabled: true, maxSessionAgeSeconds: WEEK },
        renews: true,
      }),
    ).toBe("Loom renews this sign-in on its own for up to 7 days, then asks you to sign in again.");
  });

  it("tells a browser it asks every hour and where renewal is available", () => {
    expect(
      identityRenewalText({
        metadata: { sessionExchangeEnabled: true, maxSessionAgeSeconds: 36 * 3600 },
        renews: false,
      }),
    ).toBe(
      "A browser asks you to sign in again every hour. The Loom app renews on its own for up to 36 hours.",
    );
  });

  it("says a computer without a sign-in limit or session exchange asks every hour", () => {
    const hourly =
      "This computer does not renew sign-ins, so Loom asks you to sign in again every hour.";
    expect(identityRenewalText({ metadata: { sessionExchangeEnabled: true }, renews: true })).toBe(
      hourly,
    );
    expect(
      identityRenewalText({
        metadata: { sessionExchangeEnabled: false, maxSessionAgeSeconds: WEEK },
        renews: true,
      }),
    ).toBe(hourly);
    expect(
      identityRenewalText({
        metadata: { sessionExchangeEnabled: true, maxSessionAgeSeconds: 3600 },
        renews: true,
      }),
    ).toBe(hourly);
  });
});
