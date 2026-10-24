import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExpoConfig } from "expo/config";
import { IOSConfig, type ExportedConfig } from "expo/config-plugins";

import withLoomIosCloudCapabilities from "../../../plugins/withLoomIosCloudCapabilities.cjs";

const repoEnv = vi.hoisted(() => ({ current: {} as Record<string, string> }));

vi.mock("../../../../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => repoEnv.current,
}));

const CLOUD_CAPABILITIES_PLUGIN = "./plugins/withLoomIosCloudCapabilities.cjs";
const PUSH_ENTITLEMENT = "aps-environment";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  // app.config.ts copies the repo env into process.env; restore it for the next case.
  vi.unstubAllEnvs();
});

async function loadConfig(env: Record<string, string> = {}): Promise<ExpoConfig> {
  repoEnv.current = env;
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { default: config } = await import("../../../app.config.ts");
  return config;
}

function pluginOptions(config: ExpoConfig, name: string): unknown {
  const entry = config.plugins?.find(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name,
  );
  return Array.isArray(entry) ? entry[1] : undefined;
}

/** Runs the plugin's entitlements mod the way prebuild does, after other plugins added theirs. */
async function signedEntitlements(
  options: Parameters<typeof withLoomIosCloudCapabilities>[1],
  modResults: Record<string, string | string[]>,
) {
  const base = { name: "Loom", slug: "loom" };
  const config: ExportedConfig = withLoomIosCloudCapabilities({ ...base }, options);
  const mod = config.mods?.ios?.entitlements;
  if (!mod) throw new Error("withLoomIosCloudCapabilities registered no entitlements mod.");
  const result = await mod({
    ...config,
    modRawConfig: base,
    modResults: { ...modResults },
    modRequest: {
      projectRoot: "/loom",
      platformProjectRoot: "/loom/ios",
      modName: "entitlements",
      platform: "ios",
      introspect: true,
    },
  });
  return result.modResults;
}

describe("Loom native distribution config", () => {
  it("wires safe defaults into the actual Expo configuration", async () => {
    const config = await loadConfig();
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
    expect(config.extra?.relay.url).toBeUndefined();
    expect(config.extra?.clerk.publishableKey).toBeUndefined();
    expect(config.extra?.iosPushEnabled).toBe(false);
  });

  it("ships the default build without any push entitlement", async () => {
    const config = await loadConfig();
    const options = { pushEnabled: false, appleSignInEnabled: false };
    expect(pluginOptions(config, CLOUD_CAPABILITIES_PLUGIN)).toEqual(options);
    expect(pluginOptions(config, "expo-widgets")).toMatchObject({ enablePushNotifications: false });
    expect(config.extra).toMatchObject({ iosPushEnabled: false, loomLibraryPush: false });
    // expo-notifications always adds aps-environment; the Loom plugin must remove it.
    expect(
      await signedEntitlements(options, { [PUSH_ENTITLEMENT]: "production" }),
    ).not.toHaveProperty(PUSH_ENTITLEMENT);
  });

  it("keeps the push entitlement for Library push without the relay or widget push paths", async () => {
    const config = await loadConfig({
      LOOM_IOS_TEAM_ID: "ABC1234567",
      LOOM_MOBILE_LIBRARY_PUSH_ENABLED: "1",
    });
    const options = { pushEnabled: true, appleSignInEnabled: false };
    expect(pluginOptions(config, CLOUD_CAPABILITIES_PLUGIN)).toEqual(options);
    expect(pluginOptions(config, "expo-widgets")).toMatchObject({ enablePushNotifications: false });
    expect(config.extra).toMatchObject({ iosPushEnabled: false, loomLibraryPush: true });
    expect(await signedEntitlements(options, { [PUSH_ENTITLEMENT]: "production" })).toMatchObject({
      [PUSH_ENTITLEMENT]: "production",
    });
  });
});

describe("withLoomIosCloudCapabilities", () => {
  const nativeEntitlements = {
    [PUSH_ENTITLEMENT]: "production",
    "com.apple.developer.applesignin": ["Default"],
    "com.apple.security.application-groups": ["group.com.kylebegeman.loom"],
  };

  it("removes capabilities the build did not opt into and keeps everything else", async () => {
    expect(await signedEntitlements(undefined, nativeEntitlements)).toEqual({
      "com.apple.security.application-groups": ["group.com.kylebegeman.loom"],
    });
  });

  it("keeps each capability the build opted into", async () => {
    expect(
      await signedEntitlements(
        { pushEnabled: true, appleSignInEnabled: false },
        nativeEntitlements,
      ),
    ).toEqual({
      [PUSH_ENTITLEMENT]: "production",
      "com.apple.security.application-groups": ["group.com.kylebegeman.loom"],
    });
    expect(
      await signedEntitlements({ pushEnabled: true, appleSignInEnabled: true }, nativeEntitlements),
    ).toEqual(nativeEntitlements);
  });
});
