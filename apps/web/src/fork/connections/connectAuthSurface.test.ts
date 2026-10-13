import { describe, expect, it } from "vite-plus/test";
import { resolveConnectAuthSurface } from "./connectAuthSurface.ts";

const key = (host: string, stage: "live" | "test" = "live") => `pk_${stage}_${btoa(`${host}$`)}`;
const configured = {
  clerkPublishableKey: key("clerk.t3.codes"),
  clerkJwtTemplate: "t3-relay",
  relayUrl: "https://relay.t3.codes",
};
const input = (currentUrl: string) => ({
  config: configured,
  currentUrl,
  isElectron: false,
  hostedAppUrl: "https://app.t3.codes",
});

describe("Connect authentication surface", () => {
  it("allows production browser authentication only on the deployment's HTTPS domains", () => {
    for (const currentUrl of [
      "https://t3.codes",
      "https://app.t3.codes/settings",
      "https://nightly.app.t3.codes",
    ]) {
      expect(resolveConnectAuthSurface(input(currentUrl)).kind).toBe("available");
    }
    for (const currentUrl of [
      "http://localhost:5733",
      "http://127.0.0.1:3773",
      "https://dorothy.tailnet.ts.net",
      "http://app.t3.codes",
      "https://app.t3.codes.evil.test",
      "https://evil-t3.codes",
      "invalid",
    ]) {
      expect(resolveConnectAuthSurface(input(currentUrl))).toMatchObject({
        kind: "unsupported-origin",
        primaryDomain: "t3.codes",
        hostedAppUrl: "https://app.t3.codes",
      });
    }
  });
  it("derives custom production domains and validates the configured hosted destination", () => {
    const custom = {
      ...configured,
      clerkPublishableKey: key("clerk.work.example"),
      relayUrl: "https://relay.work.example",
    };
    expect(
      resolveConnectAuthSurface({
        ...input("https://app.work.example"),
        config: custom,
        hostedAppUrl: "https://fleet.work.example",
      }),
    ).toMatchObject({
      kind: "available",
      primaryDomain: "work.example",
      hostedAppUrl: "https://fleet.work.example",
    });
    expect(
      resolveConnectAuthSurface({ ...input("http://localhost:5733"), config: custom }),
    ).toMatchObject({
      kind: "unsupported-origin",
      primaryDomain: "work.example",
      hostedAppUrl: null,
    });
    for (const hostedAppUrl of [
      "https://work.example.evil.test",
      "http://app.work.example",
      "https://user:password@app.work.example",
      "https://app.work.example?token=example",
    ]) {
      expect(
        resolveConnectAuthSurface({
          ...input("http://localhost:5733"),
          config: custom,
          hostedAppUrl,
        }).hostedAppUrl,
      ).toBeNull();
    }
  });
  it("keeps Electron and development browser clients on their supported authentication paths", () => {
    expect(resolveConnectAuthSurface({ ...input("t3code://app/"), isElectron: true }).kind).toBe(
      "available",
    );
    const config = {
      ...configured,
      clerkPublishableKey: key("dev-account.clerk.accounts.dev", "test"),
    };
    expect(resolveConnectAuthSurface({ ...input("http://localhost:5733"), config }).kind).toBe(
      "available",
    );
  });
  it("does not load Clerk for incomplete or invalid public configuration", () => {
    expect(
      resolveConnectAuthSurface({
        ...input("https://app.t3.codes"),
        config: { ...configured, clerkJwtTemplate: null },
      }).kind,
    ).toBe("disabled");
    for (const clerkPublishableKey of [
      "badkey",
      "pk_live_invalid",
      "sk_live_example",
      key("clerk.example.com/unsafe"),
      key("clerk.example.com?unsafe"),
      key("user:password@clerk.example.com"),
    ]) {
      expect(
        resolveConnectAuthSurface({
          ...input("https://app.t3.codes"),
          config: { ...configured, clerkPublishableKey },
        }).kind,
      ).toBe("invalid-config");
    }
  });
});
