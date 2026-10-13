import { describe, expect, it, vi } from "vite-plus/test";
import { IOSConfig } from "expo/config-plugins";

vi.mock("../../../../../scripts/lib/public-config.ts", () => ({ loadRepoEnv: () => ({}) }));

describe("Loom native distribution config", () => {
  it("wires safe defaults into the actual Expo configuration", async () => {
    const { default: config } = await import("../../../app.config.ts");
    expect(config.name).toBe("Loom");
    expect(config.scheme).toBe("loom");
    expect(config.ios).toMatchObject({
      bundleIdentifier: "com.kylebegeman.loom",
      entitlements: { "keychain-access-groups": ["$(AppIdentifierPrefix)com.kylebegeman.loom"] },
    });
    expect(config.ios).not.toHaveProperty("associatedDomains");
    expect(
      IOSConfig.Entitlements.setAssociatedDomains(config, {
        "com.apple.developer.associated-domains": [],
        "com.apple.security.application-groups": ["group.com.kylebegeman.loom"],
      }),
    ).toEqual({ "com.apple.security.application-groups": ["group.com.kylebegeman.loom"] });
    expect(config.ios?.appleTeamId).toBeUndefined();
    expect(config.owner).toBeUndefined();
    expect(config.extra?.eas).toBeUndefined();
    expect(config.updates?.enabled).toBe(false);
    expect(config.updates?.url).toBeUndefined();
    expect(config.extra?.relay.url).toBeNull();
    expect(config.extra?.clerk.publishableKey).toBeNull();
    expect(config.extra?.iosPushEnabled).toBe(false);
  });
});
