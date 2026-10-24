import {
  LOOM_IOS_PUSH_BUNDLE_IDS,
  type LibraryPushApsEnvironment,
  type LibraryPushBundleId,
} from "@t3tools/contracts/fork";

import { identitySessionPrefix, parseMaxSessionAge } from "../../auth/identityPolicy.ts";
import { isLibraryAuthorityEnv } from "../project-library/authority.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** A bundle and APNs environment the Library's key can deliver to. */
export interface LibraryPushTopic {
  readonly bundleId: LibraryPushBundleId;
  readonly apsEnvironment: LibraryPushApsEnvironment;
}

/**
 * The runbook's key is a Production, topic-specific key for the App Store app, so only that pair
 * is accepted unless the Library says otherwise.
 */
export const DEFAULT_LIBRARY_PUSH_TOPICS: ReadonlyArray<LibraryPushTopic> = [
  { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" },
];

/** Row lifetime when the Library sets no `LOOM_IDENTITY_MAX_SESSION_AGE`. */
export const DEFAULT_LIBRARY_PUSH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Same literals as `isLibraryAuthorityEnv`, so the advertised slug and the service always agree. */
export const libraryPushSwitchOn = (env: Env) =>
  /^(true|yes|on|1|y)$/.test(env.LOOM_LIBRARY_PUSH_ENABLED ?? "");

const trimmed = (value: string | undefined) => value?.trim() || null;

/**
 * Push runs only on a Library authority with Identity, the switch on and every key setting
 * present. Whether the key file is readable is a runtime question the service answers with
 * `misconfigured`, since checking it here would mean a synchronous read at module load.
 */
export const libraryPushEffective = (env: Env) =>
  isLibraryAuthorityEnv(env) &&
  identitySessionPrefix(env) !== null &&
  libraryPushSwitchOn(env) &&
  trimmed(env.LOOM_LIBRARY_PUSH_APNS_TEAM_ID) !== null &&
  trimmed(env.LOOM_LIBRARY_PUSH_APNS_KEY_ID) !== null &&
  trimmed(env.LOOM_LIBRARY_PUSH_APNS_KEY_FILE) !== null;

/** Phones use the slug to decide whether to register at all, so it must mean "push runs here". */
export const libraryPushAdvertised = libraryPushEffective;

const isBundleId = (value: string): value is LibraryPushBundleId =>
  (LOOM_IOS_PUSH_BUNDLE_IDS as ReadonlyArray<string>).includes(value);

const isApsEnvironment = (value: string): value is LibraryPushApsEnvironment =>
  value === "production" || value === "sandbox";

/**
 * `LOOM_LIBRARY_PUSH_TOPICS` is a comma list of `bundleId:environment`. Entries outside the
 * contract's bundle allowlist or naming another environment are ignored, so a typo narrows what
 * the Library accepts and never widens it. An explicitly set list with no usable entry accepts
 * nothing.
 */
export const parseLibraryPushTopics = (
  value: string | undefined,
): ReadonlyArray<LibraryPushTopic> => {
  if (value === undefined || value.trim() === "") return DEFAULT_LIBRARY_PUSH_TOPICS;
  const topics: Array<LibraryPushTopic> = [];
  for (const entry of value.split(",")) {
    const separator = entry.lastIndexOf(":");
    if (separator < 0) continue;
    const bundleId = entry.slice(0, separator).trim();
    const apsEnvironment = entry.slice(separator + 1).trim();
    if (!isBundleId(bundleId) || !isApsEnvironment(apsEnvironment)) continue;
    if (topics.some((t) => t.bundleId === bundleId && t.apsEnvironment === apsEnvironment))
      continue;
    topics.push({ bundleId, apsEnvironment });
  }
  return topics;
};

export const libraryPushTtlSeconds = (env: Env) => {
  const setting = trimmed(env.LOOM_IDENTITY_MAX_SESSION_AGE);
  return (
    (setting === null ? null : parseMaxSessionAge(setting)) ?? DEFAULT_LIBRARY_PUSH_TTL_SECONDS
  );
};

export type LibraryPushConfig =
  | {
      readonly _tag: "Off";
      /** `not-library` on a computer; null on a Library that has push switched off. */
      readonly reason: "not-library" | null;
    }
  | {
      readonly _tag: "On";
      readonly teamId: string;
      readonly keyId: string;
      readonly keyFile: string;
      readonly topics: ReadonlyArray<LibraryPushTopic>;
      readonly ttlSeconds: number;
      /** Rows whose account no longer matches these are never sent to and are dropped. */
      readonly issuer: string;
      readonly allowedSubjects: ReadonlyArray<string>;
    };

/** Read once when the service starts; changing any of these takes a restart. */
export const libraryPushConfig = (env: Env): LibraryPushConfig => {
  if (!libraryPushEffective(env)) {
    return { _tag: "Off", reason: isLibraryAuthorityEnv(env) ? null : "not-library" };
  }
  return {
    _tag: "On",
    teamId: trimmed(env.LOOM_LIBRARY_PUSH_APNS_TEAM_ID)!,
    keyId: trimmed(env.LOOM_LIBRARY_PUSH_APNS_KEY_ID)!,
    keyFile: trimmed(env.LOOM_LIBRARY_PUSH_APNS_KEY_FILE)!,
    topics: parseLibraryPushTopics(env.LOOM_LIBRARY_PUSH_TOPICS),
    ttlSeconds: libraryPushTtlSeconds(env),
    // identityAccountFromSession takes the issuer the same way, so stored rows compare equal.
    issuer: env.LOOM_IDENTITY_ISSUER!.trim(),
    // Parsed as PocketId parses it, which decides who can sign in at all.
    allowedSubjects: [
      ...new Set(
        (env.LOOM_IDENTITY_ALLOWED_SUBJECTS ?? "")
          .split(",")
          .map((subject) => subject.trim())
          .filter(Boolean),
      ),
    ],
  };
};
