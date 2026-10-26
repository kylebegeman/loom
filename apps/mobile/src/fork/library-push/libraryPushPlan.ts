import { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryPushApsEnvironment,
  LibraryPushBundleId,
  LibraryPushDeviceRowId,
  LibraryPushErrorReason,
  type LibraryPushServedTopic,
  LoomIdentityAccount,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

/**
 * Library refusals that the same request would get again, so the phone stops asking until the
 * app version, the Library or its `library-push` slug changes, or the user asks again.
 * `storage` and `rate-limited` are momentary and stay out.
 */
export const LibraryPushRefusalReason = Schema.Literals([
  "off",
  "misconfigured",
  "identity-required",
  "unsupported-app",
  "invalid",
  "limit",
]);
export type LibraryPushRefusalReason = typeof LibraryPushRefusalReason.Type;

export const LibraryPushRegistration = Schema.Struct({
  id: LibraryPushDeviceRowId,
  registeredAt: Schema.Number,
  expiresAt: Schema.Number,
  bundleId: LibraryPushBundleId,
  apsEnvironment: LibraryPushApsEnvironment,
  appVersion: Schema.NullOr(Schema.String),
  /** Enough of the token to notice that iOS issued a new one. The full token is never stored. */
  tokenSuffix: Schema.String,
});
export type LibraryPushRegistration = typeof LibraryPushRegistration.Type;

/**
 * This iPhone's opt-in for one Library and one Identity account. Another Library or account
 * starts from off, because the Library only lets an account remove its own devices.
 */
export const LibraryPushRecord = Schema.Struct({
  v: Schema.Literal(1),
  libraryEnvironmentId: EnvironmentId,
  account: Schema.NullOr(LoomIdentityAccount),
  optedIn: Schema.Boolean,
  registration: Schema.NullOr(LibraryPushRegistration),
  refusal: Schema.NullOr(
    Schema.Struct({
      reason: LibraryPushRefusalReason,
      appVersion: Schema.NullOr(Schema.String),
    }),
  ),
});
export type LibraryPushRecord = typeof LibraryPushRecord.Type;

/** "unknown" until the first local read; reading never prompts. */
export type LibraryPushPermission = "unknown" | "granted" | "denied";

/** What the coordinator is doing, and how its last step failed when the record cannot say. */
export interface LibraryPushActivity {
  readonly running: "register" | "unregister" | null;
  readonly failure: "token" | "register" | "unregister" | null;
  /** The Library's typed reason for a momentary refusal such as `storage`. */
  readonly failureReason: LibraryPushErrorReason | null;
}

export const IDLE_ACTIVITY: LibraryPushActivity = {
  running: null,
  failure: null,
  failureReason: null,
};

export interface LibraryPushLibrary {
  readonly id: EnvironmentId;
  /** Saved on this phone. A Library removed from the phone is never contacted again. */
  readonly configured: boolean;
  readonly connected: boolean;
  /** Whether the Library advertises `library-push`; null while its config is unknown. */
  readonly advertised: boolean | null;
  /** Whether it also sends agent alerts (`library-push-activity`); null while unknown. */
  readonly alerts: boolean | null;
  /** The session holds the scope register and unregister need. */
  readonly canChange: boolean;
  readonly account: LoomIdentityAccount | null;
}

export interface LibraryPushSnapshot {
  /** Preferences, the connection catalog and the stored record have all loaded. */
  readonly ready: boolean;
  /** The Library chosen in Library connection, or null when none is. */
  readonly chosen: LibraryPushLibrary | null;
  /** The record's own Library when it is not the chosen one, so it can still be unregistered. */
  readonly recorded: LibraryPushLibrary | null;
  readonly record: LibraryPushRecord | null;
}

export const NOT_READY_SNAPSHOT: LibraryPushSnapshot = {
  ready: false,
  chosen: null,
  recorded: null,
  record: null,
};

const sameAccount = (a: LoomIdentityAccount | null, b: LoomIdentityAccount | null) =>
  a === b || (a !== null && b !== null && a.issuer === b.issuer && a.subject === b.subject);

const sameLibrary = (a: LibraryPushLibrary | null, b: LibraryPushLibrary | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.id === b.id &&
    a.configured === b.configured &&
    a.connected === b.connected &&
    a.advertised === b.advertised &&
    a.alerts === b.alerts &&
    a.canChange === b.canChange &&
    sameAccount(a.account, b.account));

/** Records change only by writing a new object, so identity is enough for them. */
export const sameLibraryPushSnapshot = (a: LibraryPushSnapshot, b: LibraryPushSnapshot) =>
  a.ready === b.ready &&
  a.record === b.record &&
  sameLibrary(a.chosen, b.chosen) &&
  sameLibrary(a.recorded, b.recorded);

/** The record when it belongs to this Library and the account its connection signs in as. */
export function recordFor(
  record: LibraryPushRecord | null,
  library: Pick<LibraryPushLibrary, "id" | "account">,
): LibraryPushRecord | null {
  return record !== null &&
    record.libraryEnvironmentId === library.id &&
    sameAccount(record.account, library.account)
    ? record
    : null;
}

export interface LibraryPushPlanInput extends LibraryPushSnapshot {
  readonly supported: boolean;
  readonly permission: LibraryPushPermission;
  readonly appVersion: string | null;
}

/**
 * `clearLocal` touches only this phone. With `keepOptIn` it forgets the registration and any
 * refusal and keeps the user's choice; without it the record goes. `checkServed` reads the
 * Library's status, whose list of served builds can lift an `unsupported-app` refusal.
 */
export type LibraryPushStep =
  | { readonly kind: "none" }
  | { readonly kind: "clearLocal"; readonly keepOptIn: boolean }
  | {
      readonly kind: "unregister";
      readonly libraryId: EnvironmentId;
      readonly id: LibraryPushDeviceRowId;
    }
  | { readonly kind: "checkServed"; readonly libraryId: EnvironmentId }
  | { readonly kind: "needsToken"; readonly libraryId: EnvironmentId };

const NONE: LibraryPushStep = { kind: "none" };
const FORGET: LibraryPushStep = { kind: "clearLocal", keepOptIn: false };

/**
 * Step one decides everything that needs no push token, so iOS is asked for one only when the phone
 * is opted in, allowed, connected and the Library advertises push. Every step changes the record or
 * waits for a new snapshot, and status reads happen at most once per run, so neither a failure nor
 * a contradicting status can loop.
 */
export function planLibraryPush(input: LibraryPushPlanInput): LibraryPushStep {
  const { record } = input;
  if (!input.supported || !input.ready || record === null) return NONE;
  const isChosen = input.chosen?.id === record.libraryEnvironmentId;
  const library = isChosen ? input.chosen : input.recorded;
  if (library === null || !library.configured) return FORGET;
  // The new account's session cannot remove the old account's row, which lapses at its expiry.
  if (!sameAccount(record.account, library.account)) return FORGET;
  const unregister: LibraryPushStep | null =
    record.registration === null
      ? null
      : { kind: "unregister", libraryId: library.id, id: record.registration.id };
  const canUnregister = library.connected && library.canChange;

  if (!isChosen || !record.optedIn) {
    if (unregister === null) return FORGET;
    // Kept until the Library answers, so an opt-out made offline still reaches it.
    return canUnregister ? unregister : NONE;
  }
  if (!library.connected || library.advertised === null) return NONE;
  if (!library.advertised) {
    // The Library purged its devices when push went off. A refusal is forgotten too, so turning
    // push back on there is a fresh start.
    return record.registration !== null || record.refusal !== null
      ? { kind: "clearLocal", keepOptIn: true }
      : NONE;
  }
  if (input.permission === "unknown") return NONE;
  if (input.permission === "denied") {
    // The opt-in stays, so allowing notifications in iOS Settings registers again.
    return unregister !== null && canUnregister ? unregister : NONE;
  }
  if (!library.canChange) return NONE;
  if (record.refusal !== null && record.refusal.appVersion === input.appVersion)
    // The Library fixing its push settings changes no snapshot, but a status read can show it.
    return record.refusal.reason === "unsupported-app"
      ? { kind: "checkServed", libraryId: library.id }
      : NONE;
  return { kind: "needsToken", libraryId: library.id };
}

export interface LibraryPushDeviceState {
  readonly bundleId: LibraryPushBundleId;
  readonly apsEnvironment: LibraryPushApsEnvironment;
  readonly appVersion: string | null;
  readonly tokenSuffix: string;
}

/** Re-registering at least daily keeps the Library's row alive and corrects a restored Library. */
export const LIBRARY_PUSH_REFRESH_MS = 24 * 60 * 60 * 1000;

export const tokenSuffix = (token: string) => token.slice(-8);

/** Step two, once iOS returned a token: register unless the Library already has this one. */
export function planLibraryPushRegistration(
  registration: LibraryPushRegistration | null,
  device: LibraryPushDeviceState,
  now: number,
): "register" | "none" {
  if (registration === null) return "register";
  const changed =
    registration.bundleId !== device.bundleId ||
    registration.apsEnvironment !== device.apsEnvironment ||
    registration.appVersion !== device.appVersion ||
    registration.tokenSuffix !== device.tokenSuffix;
  // A short Library sign-in cap can end the row before a day passes, so refresh by halfway.
  const refreshAt = Math.min(
    registration.registeredAt + LIBRARY_PUSH_REFRESH_MS,
    registration.registeredAt + (registration.expiresAt - registration.registeredAt) / 2,
  );
  return changed || now >= refreshAt ? "register" : "none";
}

export function recordAfterClear(
  record: LibraryPushRecord | null,
  step: Extract<LibraryPushStep, { kind: "clearLocal" }>,
): LibraryPushRecord | null {
  if (record === null || !step.keepOptIn) return null;
  return record.registration === null && record.refusal === null
    ? record
    : { ...record, registration: null, refusal: null };
}

export type LibraryPushUnregisterOutcome =
  | { readonly kind: "answered" }
  | { readonly kind: "failed" };

/**
 * Any answer from the Library, `removed: false` included, means it holds no row for this phone
 * any more. A failure keeps the record so the next connect tries again.
 */
export function recordAfterUnregister(
  record: LibraryPushRecord | null,
  step: Extract<LibraryPushStep, { kind: "unregister" }>,
  outcome: LibraryPushUnregisterOutcome,
): LibraryPushRecord | null {
  if (
    outcome.kind === "failed" ||
    record === null ||
    record.libraryEnvironmentId !== step.libraryId ||
    record.registration?.id !== step.id
  )
    return record;
  return record.optedIn ? { ...record, registration: null } : null;
}

/**
 * How long after registering a status read is not taken as proof that the row is gone. A read
 * started before the registration landed can arrive after it, and a Library whose status never
 * lists the row must not cause a register loop.
 */
export const LIBRARY_PUSH_ROW_SETTLE_MS = 60_000;

/**
 * A Library status that no longer lists this iPhone's row means the Library dropped it, after an
 * operator's Remove or Apple refusing the token. Forgetting the registration makes the next sync
 * register again.
 */
export function recordAfterStatus(
  record: LibraryPushRecord | null,
  libraryId: EnvironmentId,
  status: { readonly devices: ReadonlyArray<{ readonly id: string }>; readonly readAt: number },
): LibraryPushRecord | null {
  const registration = record?.libraryEnvironmentId === libraryId ? record.registration : null;
  if (
    registration === null ||
    status.readAt < registration.registeredAt + LIBRARY_PUSH_ROW_SETTLE_MS ||
    status.devices.some((device) => device.id === registration.id)
  )
    return record;
  return recordAfterUnregister(
    record,
    { kind: "unregister", libraryId, id: registration.id },
    { kind: "answered" },
  );
}

/**
 * Whether the Library sends to this build, by its status's served list. Null when the status has
 * no list, as from a Library older than it; then only a register's answer tells.
 */
export function libraryPushServes(
  topics: ReadonlyArray<LibraryPushServedTopic> | undefined,
  build: Pick<LibraryPushDeviceState, "bundleId" | "apsEnvironment">,
): boolean | null {
  if (topics === undefined) return null;
  return topics.some(
    (topic) => topic.bundleId === build.bundleId && topic.apsEnvironment === build.apsEnvironment,
  );
}

/**
 * The served list answers what a register would. A build left out is held as refused without
 * asking, so the phone never registers for it. A build listed lifts a held `unsupported-app`
 * refusal, so once the Library's settings are fixed the next sync registers on its own. Other
 * refusals are the Library's answer about this account or its limits, so they stay.
 */
export function recordAfterServed(
  record: LibraryPushRecord | null,
  libraryId: EnvironmentId,
  served: boolean | null,
  appVersion: string | null,
): LibraryPushRecord | null {
  if (record === null || served === null || record.libraryEnvironmentId !== libraryId)
    return record;
  if (served)
    return record.refusal?.reason === "unsupported-app" ? { ...record, refusal: null } : record;
  if (
    !record.optedIn ||
    (record.refusal?.reason === "unsupported-app" && record.refusal.appVersion === appVersion)
  )
    return record;
  return { ...record, refusal: { reason: "unsupported-app", appVersion } };
}

/**
 * A registration that finishes after the user moved to another Library or account is not
 * recorded; that row lapses at its expiry. One that finishes after an opt-out is recorded, so
 * the next step unregisters it.
 */
export function recordAfterRegister(
  record: LibraryPushRecord | null,
  planned: LibraryPushRecord,
  registration: LibraryPushRegistration,
): LibraryPushRecord | null {
  if (record === null || recordFor(record, plannedTarget(planned)) === null) return record;
  return { ...record, registration, refusal: null };
}

export function recordAfterRefusal(
  record: LibraryPushRecord | null,
  planned: LibraryPushRecord,
  reason: LibraryPushRefusalReason,
  appVersion: string | null,
): LibraryPushRecord | null {
  if (record === null || recordFor(record, plannedTarget(planned)) === null) return record;
  return { ...record, refusal: { reason, appVersion } };
}

const plannedTarget = (planned: LibraryPushRecord) => ({
  id: planned.libraryEnvironmentId,
  account: planned.account,
});

/**
 * The toggle. Turning on also clears a refusal, which makes it the explicit retry. Turning off
 * keeps the record only while the Library still has a row to remove. Opting in on a new Library
 * replaces a record left for another one; that row lapses at its expiry.
 */
export function recordForOptIn(
  record: LibraryPushRecord | null,
  library: Pick<LibraryPushLibrary, "id" | "account">,
  optedIn: boolean,
): LibraryPushRecord | null {
  const own = recordFor(record, library);
  if (optedIn) {
    return own === null
      ? {
          v: 1,
          libraryEnvironmentId: library.id,
          account: library.account,
          optedIn: true,
          registration: null,
          refusal: null,
        }
      : { ...own, optedIn: true, refusal: null };
  }
  if (own === null) return record;
  return own.registration === null ? null : { ...own, optedIn: false, refusal: null };
}

/** Try again: forget a refusal without changing the opt-in. */
export function recordForRetry(record: LibraryPushRecord | null): LibraryPushRecord | null {
  return record === null || record.refusal === null ? record : { ...record, refusal: null };
}

const isErrorReason = Schema.is(LibraryPushErrorReason);
const isRefusalReason = Schema.is(LibraryPushRefusalReason);

/** The Library's typed reason, read structurally so a decoded error and a plain one both match. */
export function libraryPushErrorReason(error: unknown): LibraryPushErrorReason | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("_tag" in error) || error._tag !== "LibraryPushError" || !("reason" in error)) return null;
  return isErrorReason(error.reason) ? error.reason : null;
}

export function libraryPushRefusal(error: unknown): LibraryPushRefusalReason | null {
  const reason = libraryPushErrorReason(error);
  return reason !== null && isRefusalReason(reason) ? reason : null;
}
