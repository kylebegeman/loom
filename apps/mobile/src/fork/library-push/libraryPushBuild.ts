import {
  LIBRARY_PUSH_LABEL_MAX_LENGTH,
  LOOM_IOS_PUSH_BUNDLE_IDS,
  type LibraryPushApsEnvironment,
  type LibraryPushBundleId,
} from "@t3tools/contracts/fork";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { resolveApsEnvironment } from "../../features/agent-awareness/registrationPayload";

export interface LibraryPushBuild {
  readonly bundleId: LibraryPushBundleId;
  readonly apsEnvironment: LibraryPushApsEnvironment;
  readonly appVersion: string | null;
}

export interface LibraryPushBuildInput {
  readonly platform: string;
  readonly extra: Readonly<Record<string, unknown>> | undefined;
  readonly bundleId: string | undefined;
  readonly version: string | undefined;
}

const APP_VERSION_MAX_LENGTH = 64;

const isLoomBundle = (bundleId: string | undefined): bundleId is LibraryPushBundleId =>
  LOOM_IOS_PUSH_BUNDLE_IDS.some((allowed) => allowed === bundleId);

/**
 * Only an iOS build made with the Library push flag carries `aps-environment`, and a personal
 * team build cannot. The Library accepts only Loom's own bundle IDs as APNs topics.
 */
export function libraryPushBuild(input: LibraryPushBuildInput): LibraryPushBuild | null {
  const extra = input.extra;
  if (input.platform !== "ios" || extra?.loomLibraryPush !== true) return null;
  if (extra.iosPersonalTeamBuild === true) return null;
  const bundleId = input.bundleId?.trim();
  if (!isLoomBundle(bundleId)) return null;
  const version = input.version?.trim();
  return {
    bundleId,
    apsEnvironment: resolveApsEnvironment(extra.appVariant),
    appVersion: version && version.length <= APP_VERSION_MAX_LENGTH ? version : null,
  };
}

const current = libraryPushBuild({
  platform: Platform.OS,
  extra: Constants.expoConfig?.extra,
  bundleId: Constants.expoConfig?.ios?.bundleIdentifier,
  version: Constants.expoConfig?.version,
});

export const currentLibraryPushBuild = (): LibraryPushBuild | null => current;

export const supportsLibraryPushBuild = (): boolean => current !== null;

/** C0 and C1 controls, which the Library refuses in a device label. */
const isControl = (character: string) => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/** The name the Library lists this iPhone under, cut by code point so emoji stay whole. */
export function libraryPushDeviceLabel(deviceName: string | null | undefined): string {
  const characters = Array.from(deviceName ?? "").filter((character) => !isControl(character));
  const label = characters.join("").trim();
  return Array.from(label).slice(0, LIBRARY_PUSH_LABEL_MAX_LENGTH).join("").trim() || "iPhone";
}
