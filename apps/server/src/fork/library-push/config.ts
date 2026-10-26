import {
  LOOM_IOS_PUSH_BUNDLE_IDS,
  type LibraryPushApsEnvironment,
  type LibraryPushBundleId,
} from "@t3tools/contracts/fork";

import { identitySessionPrefix } from "../../auth/identityPolicy.ts";
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

/**
 * Row lifetime after its last refresh. It ignores the Identity session age on purpose, so alerts
 * keep reaching a phone whose sign-in lapsed until it has been away this long (D-11).
 */
export const LIBRARY_PUSH_TTL_SECONDS = 60 * 24 * 60 * 60;

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

/** Agent alerts (C04-10) have a switch of their own, read with the same literals. */
export const libraryPushActivitySwitchOn = (env: Env) =>
  /^(true|yes|on|1|y)$/.test(env.LOOM_LIBRARY_PUSH_ACTIVITY ?? "");

/** Parsed as PocketId parses `LOOM_IDENTITY_ALLOWED_SUBJECTS`, which decides who can sign in. */
const subjectList = (value: string | undefined) => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean),
  ),
];

/**
 * The Identity subjects whose iPhones get agent alerts. A computer belongs to no account, so a
 * Library that admits one person sends to that person, and one that admits several sends only to
 * the subjects `LOOM_LIBRARY_PUSH_RECIPIENTS` names. A named subject must also be allowed to sign
 * in, so a list with no allowed subject sends to no one.
 */
export const libraryPushAlertRecipients = (env: Env): ReadonlyArray<string> => {
  const allowed = subjectList(env.LOOM_IDENTITY_ALLOWED_SUBJECTS);
  const named = subjectList(env.LOOM_LIBRARY_PUSH_RECIPIENTS);
  if (named.length > 0) return allowed.filter((subject) => named.includes(subject));
  return allowed.length === 1 ? allowed : [];
};

/** Clients read the slug as "this Library sends agent alerts", so it needs someone to send to. */
export const libraryPushActivityAdvertised = (env: Env) =>
  libraryPushEffective(env) &&
  libraryPushActivitySwitchOn(env) &&
  libraryPushAlertRecipients(env).length > 0;

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
      /** Who gets agent alerts; null while they are off. Never empty. */
      readonly alertRecipients: ReadonlyArray<string> | null;
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
    ttlSeconds: LIBRARY_PUSH_TTL_SECONDS,
    // identityAccountFromSession takes the issuer the same way, so stored rows compare equal.
    issuer: env.LOOM_IDENTITY_ISSUER!.trim(),
    allowedSubjects: subjectList(env.LOOM_IDENTITY_ALLOWED_SUBJECTS),
    alertRecipients: libraryPushActivityAdvertised(env) ? libraryPushAlertRecipients(env) : null,
  };
};
