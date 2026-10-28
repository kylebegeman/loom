import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  ScheduledTaskId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";

/** Advertised only by a Library whose push switch, Identity and APNs key settings are all set. */
export const LIBRARY_PUSH_FEATURE = "library-push";
export const LIBRARY_PUSH_KIND_PREFERENCES_FEATURE = "library-push-kind-preferences";

/**
 * Advertised by a push Library that also sends agent alerts (C04-10): its alert switch is on and
 * it has an account to send them to. Computers do not wait for it; they post and back off on 404.
 */
export const LIBRARY_PUSH_ACTIVITY_FEATURE = "library-push-activity";

/** Where a computer's publisher session posts one thread's alert. */
export const LIBRARY_PUSH_ACTIVITY_ROUTE = "/api/loom/library/push/activity";
export const LIBRARY_PUSH_ACTIVITY_MAX_BYTES = 4 * 1024;
/** Keeps the APNs payload, which carries the id three times, far below Apple's 4 KB. */
const LIBRARY_PUSH_ACTIVITY_THREAD_ID_MAX_LENGTH = 256;

/**
 * `limited` is a run that failed on a usage limit. `vault-approval` is a Vault access request from
 * the thread waiting for a decision; a Library from before it answers 400, so that alert is lost.
 */
const LIBRARY_PUSH_THREAD_ACTIVITY_KINDS = [
  "approval",
  "input",
  "failed",
  "limited",
  "completed",
  "vault-approval",
] as const;
export const LIBRARY_PUSH_ACTIVITY_KINDS = [
  ...LIBRARY_PUSH_THREAD_ACTIVITY_KINDS,
  "scheduled-failed",
] as const;
export const LibraryPushActivityKind = Schema.Literals(LIBRARY_PUSH_ACTIVITY_KINDS);
export const LibraryPushThreadActivityKind = Schema.Literals(LIBRARY_PUSH_THREAD_ACTIVITY_KINDS);
export type LibraryPushThreadActivityKind = typeof LibraryPushThreadActivityKind.Type;
export type LibraryPushActivityKind = typeof LibraryPushActivityKind.Type;

export const libraryPushAllowsKind = (
  allowedKinds: ReadonlyArray<LibraryPushActivityKind> | undefined,
  kind: LibraryPushActivityKind,
) => allowedKinds === undefined || allowedKinds.includes(kind);

export const normalizeLibraryPushKinds = (
  allowedKinds: ReadonlyArray<LibraryPushActivityKind> | undefined,
) => LIBRARY_PUSH_ACTIVITY_KINDS.filter((kind) => libraryPushAllowsKind(allowedKinds, kind));

/**
 * One thread on the posting computer needs attention or finished. The computer comes from its
 * publisher session, never the body, and no title, project or model travels with it. The computer
 * posts a change as it sees it happen, or within 2 minutes of it, so no timestamp crosses between
 * two clocks.
 */
export const LibraryPushActivityRequest = Schema.Union([
  Schema.Struct({
    threadId: ThreadId.check(Schema.isMaxLength(LIBRARY_PUSH_ACTIVITY_THREAD_ID_MAX_LENGTH)),
    kind: LibraryPushThreadActivityKind,
  }),
  Schema.Struct({
    kind: Schema.Literal("scheduled-failed"),
    taskId: ScheduledTaskId.check(Schema.isMaxLength(LIBRARY_PUSH_ACTIVITY_THREAD_ID_MAX_LENGTH)),
  }),
]);
export type LibraryPushActivityRequest = typeof LibraryPushActivityRequest.Type;

/**
 * How many iPhones Apple accepted the alert for. None is not a failure. `devices` counts the
 * recipients' registered iPhones, so 0 means no one could have heard it; an older Library omits it.
 */
export const LibraryPushActivityReply = Schema.Struct({
  sent: NonNegativeInt,
  devices: Schema.optionalKey(NonNegativeInt),
});
export type LibraryPushActivityReply = typeof LibraryPushActivityReply.Type;

/** Where a computer's publisher session reads whether its Library can deliver alerts. */
export const LIBRARY_PUSH_READINESS_ROUTE = "/api/loom/library/push/readiness";

/**
 * Outer allowlist of Loom's iOS bundle IDs. The Library's `LOOM_LIBRARY_PUSH_TOPICS` narrows it
 * to the bundle and environment pairs its APNs key actually serves.
 */
export const LOOM_IOS_PUSH_BUNDLE_IDS = [
  "com.kylebegeman.loom",
  "com.kylebegeman.loom.preview",
  "com.kylebegeman.loom.dev",
] as const;

export const LIBRARY_PUSH_WS_METHODS = {
  status: "loom.library-push.status",
  register: "loom.library-push.register",
  unregister: "loom.library-push.unregister",
  test: "loom.library-push.test",
} as const;

const LIBRARY_PUSH_DEVICE_ID_MAX_LENGTH = 128;
export const LIBRARY_PUSH_LABEL_MAX_LENGTH = 80;
/** Length of a row id: base64url SHA-256 of (issuer, subject, deviceId), truncated. */
export const LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH = 22;

const NoControlCharacters = Schema.isPattern(/^[^\p{Cc}]+$/u);

export const LibraryPushBundleId = Schema.Literals(LOOM_IOS_PUSH_BUNDLE_IDS);
export type LibraryPushBundleId = typeof LibraryPushBundleId.Type;

/** Development-signed builds receive sandbox tokens; TestFlight and App Store builds production. */
export const LibraryPushApsEnvironment = Schema.Literals(["sandbox", "production"]);
export type LibraryPushApsEnvironment = typeof LibraryPushApsEnvironment.Type;

/** The phone's per-install id. Two accounts may report the same one, so rows key on account too. */
export const LibraryPushClientDeviceId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(LIBRARY_PUSH_DEVICE_ID_MAX_LENGTH),
  NoControlCharacters,
);

export const LibraryPushDeviceLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(LIBRARY_PUSH_LABEL_MAX_LENGTH),
  NoControlCharacters,
);

export const LibraryPushAppVersion = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  NoControlCharacters,
);

/**
 * Opaque, so an operator removing or testing a row names exactly one account's device even when
 * two accounts report the same `deviceId`.
 */
export const LibraryPushDeviceRowId = Schema.String.check(
  Schema.isPattern(new RegExp(`^[A-Za-z0-9_-]{${LIBRARY_PUSH_DEVICE_ROW_ID_LENGTH}}$`)),
);
export type LibraryPushDeviceRowId = typeof LibraryPushDeviceRowId.Type;

/** Apple's 10-character Team ID and Key ID. */
export const LibraryPushAppleId = Schema.String.check(Schema.isPattern(/^[A-Z0-9]{10}$/));

export const LibraryPushRegisterRequest = Schema.Struct({
  deviceId: LibraryPushClientDeviceId,
  label: LibraryPushDeviceLabel,
  platform: Schema.Literal("ios"),
  bundleId: LibraryPushBundleId,
  apsEnvironment: LibraryPushApsEnvironment,
  appVersion: Schema.optionalKey(LibraryPushAppVersion),
  allowedKinds: Schema.optionalKey(Schema.Array(LibraryPushActivityKind)),
  /**
   * Redacted so logs, spans and `JSON.stringify` never carry it. It has no format check: a payload
   * decode failure reaches the client as a defect carrying schema issue text, so the Library checks
   * the hex form itself and answers the typed, fixed `invalid` instead.
   */
  token: Schema.RedactedFromValue(Schema.String),
});
export type LibraryPushRegisterRequest = typeof LibraryPushRegisterRequest.Type;

/** Why a send did not succeed, in a fixed vocabulary that never carries Apple's raw reply. */
export const LibraryPushDeliveryReason = Schema.Literals([
  "bad-token",
  "key-rejected",
  "topic-disallowed",
  "rate-limited",
  "unavailable",
  "other",
]);
export type LibraryPushDeliveryReason = typeof LibraryPushDeliveryReason.Type;

/** A `bad-token` reply removes the row, so a listed device's last delivery is never `removed`. */
export const LibraryPushLastDelivery = Schema.Struct({
  at: IsoDateTime,
  outcome: Schema.Literals(["sent", "failed"]),
  reason: Schema.NullOr(LibraryPushDeliveryReason),
});
export type LibraryPushLastDelivery = typeof LibraryPushLastDelivery.Type;

/** A registered phone as clients see it. It never includes the push token. */
export const LibraryPushDevice = Schema.Struct({
  id: LibraryPushDeviceRowId,
  deviceId: LibraryPushClientDeviceId,
  label: LibraryPushDeviceLabel,
  bundleId: LibraryPushBundleId,
  apsEnvironment: LibraryPushApsEnvironment,
  appVersion: Schema.NullOr(LibraryPushAppVersion),
  allowedKinds: Schema.optionalKey(Schema.Array(LibraryPushActivityKind)),
  registeredAt: IsoDateTime,
  refreshedAt: IsoDateTime,
  /** The Library stops sending, and drops the row, after this. The phone re-registers before it. */
  expiresAt: IsoDateTime,
  /** True when the row belongs to the calling Identity account. */
  mine: Schema.Boolean,
  lastDelivery: Schema.NullOr(LibraryPushLastDelivery),
});
export type LibraryPushDevice = typeof LibraryPushDevice.Type;

export const LibraryPushState = Schema.Literals(["off", "misconfigured", "ready", "failing"]);
export type LibraryPushState = typeof LibraryPushState.Type;

/**
 * `not-library` explains `off` on a computer. `key-unreadable` and `key-invalid` explain
 * `misconfigured`. `key-rejected` explains `failing`: Apple refused the key itself, so no device
 * can receive pushes until it is replaced. A refused topic stays on that device's last delivery.
 */
export const LibraryPushStatusReason = Schema.Literals([
  "not-library",
  "key-unreadable",
  "key-invalid",
  "key-rejected",
]);
export type LibraryPushStatusReason = typeof LibraryPushStatusReason.Type;

/** Identifies the key without exposing it or its file path. */
export const LibraryPushKeySummary = Schema.Struct({
  teamId: LibraryPushAppleId,
  keyId: LibraryPushAppleId,
});
export type LibraryPushKeySummary = typeof LibraryPushKeySummary.Type;

/**
 * A bundle and APNs environment the Library sends to. Plain strings rather than the bundle and
 * environment literals, so a Library that serves a newer build still decodes on an older client.
 */
export const LibraryPushServedTopic = Schema.Struct({
  bundleId: Schema.String,
  apsEnvironment: Schema.String,
});
export type LibraryPushServedTopic = typeof LibraryPushServedTopic.Type;

/**
 * `devices` holds the caller's own rows for an Identity session, every row for an operator, and
 * none otherwise; rows for an unknown bundle or environment are left out. `topics` lists the builds
 * push accepts: empty when none is usable, so every register gets `unsupported-app`, and absent
 * with push off or from an older Library.
 */
export const LibraryPushStatus = Schema.Struct({
  state: LibraryPushState,
  reason: Schema.NullOr(LibraryPushStatusReason),
  key: Schema.NullOr(LibraryPushKeySummary),
  devices: ForwardCompatibleArray(LibraryPushDevice),
  topics: Schema.optionalKey(Schema.Array(LibraryPushServedTopic)),
});
export type LibraryPushStatus = typeof LibraryPushStatus.Type;

/**
 * What a computer's publisher session learns about its Library's push: how many iPhones are
 * registered, never which ones. `alerts` is whether the Library sends agent alerts.
 */
export const LibraryPushReadiness = Schema.Struct({
  state: LibraryPushState,
  reason: Schema.NullOr(LibraryPushStatusReason),
  alerts: Schema.Boolean,
  devices: NonNegativeInt,
});
export type LibraryPushReadiness = typeof LibraryPushReadiness.Type;

export const LibraryPushUnregisterRequest = Schema.Struct({ id: LibraryPushDeviceRowId });
export type LibraryPushUnregisterRequest = typeof LibraryPushUnregisterRequest.Type;

/** `removed: false` also covers a row already gone and push being off, so backing out never fails. */
export const LibraryPushUnregisterResult = Schema.Struct({ removed: Schema.Boolean });
export type LibraryPushUnregisterResult = typeof LibraryPushUnregisterResult.Type;

/** Without an `id`, an Identity caller tests every device of its own account. */
export const LibraryPushTestRequest = Schema.Struct({
  id: Schema.optionalKey(LibraryPushDeviceRowId),
});
export type LibraryPushTestRequest = typeof LibraryPushTestRequest.Type;

/** `removed` means Apple reported the token dead and the Library dropped the row. */
export const LibraryPushTestDelivery = Schema.Struct({
  id: LibraryPushDeviceRowId,
  label: LibraryPushDeviceLabel,
  outcome: Schema.Literals(["sent", "failed", "removed"]),
  reason: Schema.NullOr(LibraryPushDeliveryReason),
});
export type LibraryPushTestDelivery = typeof LibraryPushTestDelivery.Type;

/** Lists only the rows the call targeted. */
export const LibraryPushTestResult = Schema.Struct({
  deliveries: Schema.Array(LibraryPushTestDelivery),
});
export type LibraryPushTestResult = typeof LibraryPushTestResult.Type;

export const LibraryPushErrorReason = Schema.Literals([
  "off",
  "misconfigured",
  "identity-required",
  "unsupported-app",
  "invalid",
  "limit",
  "rate-limited",
  "storage",
]);
export type LibraryPushErrorReason = typeof LibraryPushErrorReason.Type;

const libraryPushErrorMessages: Record<LibraryPushErrorReason, string> = {
  off: "Push notifications are off on this Library.",
  misconfigured: "The Library can't use its Apple push key.",
  "identity-required": "Sign in to the Library with your Loom account to get notifications.",
  "unsupported-app": "This Library doesn't send notifications to this app build.",
  invalid: "The Library could not accept that notification request.",
  limit: "The Library has reached its limit of registered devices. Remove one and try again.",
  "rate-limited": "Wait a little before sending another test notification.",
  storage: "The Library could not save its device list. Try again.",
};

/**
 * Carries only a reason. There is no `cause` and no free text, because a transport or schema
 * failure can embed the token, and defects are logged with their full cause.
 */
export class LibraryPushError extends Schema.TaggedError<LibraryPushError>()("LibraryPushError", {
  reason: LibraryPushErrorReason,
}) {
  override get message(): string {
    return libraryPushErrorMessages[this.reason];
  }
}

const error = Schema.Union([LibraryPushError, EnvironmentAuthorizationError]);
export const LibraryPushRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_PUSH_WS_METHODS.status, {
    payload: Schema.Struct({}),
    success: LibraryPushStatus,
    error: EnvironmentAuthorizationError,
  }),
  Rpc.make(LIBRARY_PUSH_WS_METHODS.register, {
    payload: LibraryPushRegisterRequest,
    success: LibraryPushDevice,
    error,
  }),
  Rpc.make(LIBRARY_PUSH_WS_METHODS.unregister, {
    payload: LibraryPushUnregisterRequest,
    success: LibraryPushUnregisterResult,
    error,
  }),
  Rpc.make(LIBRARY_PUSH_WS_METHODS.test, {
    payload: LibraryPushTestRequest,
    success: LibraryPushTestResult,
    error,
  }),
);
