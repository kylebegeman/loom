import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { DirectoryReportRequest, DirectoryReporting, LibrarySignInStatus } from "./directory.ts";
import { ReachState } from "./reach.ts";
import { LibraryManagementDelegation, LibraryError } from "./project-library.ts";
import { EnvironmentId, AuthSessionId, IsoDateTime } from "../baseSchemas.ts";
import {
  EnvironmentAuthorizationError,
  AuthStandardClientScopes,
  AuthSettingsWriteScope,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
} from "../auth.ts";
import * as Schema from "effect/Schema";

export const ACCOUNT_ACCESS_FEATURE = "account-access";
export const ACCOUNT_GATEWAY_FEATURE = "account-gateway";

export const ACCOUNT_ACCESS_PREFIX = "/api/loom/account/computers/";
export const ACCOUNT_ACCESS_VERIFY = "/api/loom/account/verify";
export const ACCOUNT_ACCESS_HEADER = "x-loom-account-grant";

export const AccountComputerBinding = Schema.Struct({
  authorityId: LibraryManagementDelegation.fields.authorityId,
  authorityEpoch: LibraryManagementDelegation.fields.authorityEpoch,
});

export const AccountAdmission = Schema.Struct({
  account: Schema.optionalKey(AccountComputerBinding),
  sessionId: Schema.String.check(Schema.isMaxLength(256)),
  principal: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1024)),
  scopes: Schema.Array(Schema.Literals(AuthStandardClientScopes)),
  expiresAt: Schema.Number,
});
export type AccountAdmission = typeof AccountAdmission.Type;

export const AccountVerification = Schema.Struct({
  grant: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  keyFingerprint: Schema.String.check(Schema.isMaxLength(256)),
  method: Schema.String.check(Schema.isMaxLength(16)),
  path: Schema.String.check(Schema.isMaxLength(8192)),
});

export const AccountComputerCredential = Schema.Struct({
  account: Schema.optionalKey(AccountComputerBinding),
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String,
  sessionId: AuthSessionId,
  accessToken: Schema.RedactedFromValue(Schema.String),
  expiresAt: IsoDateTime,
  issuedAt: Schema.optional(IsoDateTime),
});
export type AccountComputerCredential = typeof AccountComputerCredential.Type;

export const ACCOUNT_ENROLLMENT_FEATURE = "account-enrollment";
export const ACCOUNT_ENROLLMENT_ACTIVATE = "/api/loom/account/enrollment/activate";
export const AccountComputerEnrollmentRequest = Schema.Struct({
  requestId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2048)),
});
export type AccountComputerEnrollmentRequest = typeof AccountComputerEnrollmentRequest.Type;
export const AccountComputerEnrollmentProof = Schema.Struct({
  ...AccountComputerEnrollmentRequest.fields,
  environmentId: EnvironmentId,
  request: DirectoryReportRequest,
});
export type AccountComputerEnrollmentProof = typeof AccountComputerEnrollmentProof.Type;
export const AccountComputerEnrollment = Schema.Struct({
  requestId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(193)),
  credential: AccountComputerCredential,
  management: LibraryManagementDelegation,
});
export type AccountComputerEnrollment = typeof AccountComputerEnrollment.Type;
export const ACCOUNT_JOIN_BEGIN = "/api/loom/account/join/begin";
export const ACCOUNT_JOIN_REDEEM = "/api/loom/account/join/redeem";
export const ACCOUNT_JOIN_FEATURE = "account-join";
export const ACCOUNT_COMPUTERS_FEATURE = "account-computers";
export const ACCOUNT_COMPUTER_ADMIN_SCOPES = [
  AuthSettingsWriteScope,
  AuthAccessWriteScope,
  AuthRelayWriteScope,
] as const;
export const AccountComputerStatus = Schema.Struct({
  membershipRevision: Schema.NullOr(Schema.Number),
  environmentId: EnvironmentId,
  label: Schema.String,
  state: Schema.Literals(["active", "removing", "removed"]),
  publishingEnded: Schema.Boolean,
  routeRemoved: Schema.Boolean,
  directoryRemoved: Schema.Boolean,
  detail: Schema.NullOr(Schema.String),
});
export type AccountComputerStatus = typeof AccountComputerStatus.Type;
export const AccountComputerRemoval = Schema.Struct({
  membershipRevision: Schema.NullOr(Schema.Number),
  environmentId: EnvironmentId,
  requestId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
});
export type AccountComputerRemoval = typeof AccountComputerRemoval.Type;
export const ACCOUNT_JOIN_START = "/api/loom/account/join/start";
export const ACCOUNT_JOIN_STEP = "/api/loom/account/join/step";
export const AccountJoinCode = Schema.String.check(Schema.isPattern(/^[A-F0-9]{5}-[A-F0-9]{5}$/u));
export const AccountJoinRequest = Schema.Struct({
  proof: AccountComputerEnrollmentProof,
  secret: Schema.RedactedFromValue(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))),
});
export type AccountJoinRequest = typeof AccountJoinRequest.Type;
export const AccountJoinReview = Schema.Struct({
  requestId: AccountComputerEnrollmentRequest.fields.requestId,
  code: AccountJoinCode,
  environmentId: EnvironmentId,
  label: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(160)),
  keyFingerprint: Schema.String,
  expiresAt: Schema.Number,
  state: Schema.Literals(["pending", "approved", "denied"]),
});
export type AccountJoinReview = typeof AccountJoinReview.Type;
export const AccountJoinRedemption = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["pending", "denied"]) }),
  Schema.Struct({ state: Schema.Literal("approved"), enrollment: AccountComputerEnrollment }),
]);
export type AccountJoinRedemption = typeof AccountJoinRedemption.Type;
export const ComputerJoinStart = Schema.Struct({
  libraryUrl: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2048)),
  restart: Schema.Boolean,
});
export const ComputerJoinPrompt = Schema.Struct({
  review: AccountJoinReview,
  libraryUrl: Schema.String,
});
export const ComputerJoinProgress = Schema.Literals(["pending", "denied", "complete"]);

/** Owner devices hear about joining computers and answer with the code the terminal shows. */
export const ACCOUNT_JOIN_PROMPTS_FEATURE = "account-join-prompts";
/** The Library refuses an approval without `AccountJoinApproval`, so clients ask before sending. */
export const ACCOUNT_JOIN_PASSKEY_FEATURE = "account-join-passkey";
export const ACCOUNT_JOIN_PROMPT_CHOICES = 3;
/**
 * A computer waiting to join, as an owner device shows it. The terminal's code is one of
 * `choices`, unmarked, so approving needs the terminal in view.
 */
export const AccountJoinPrompt = Schema.Struct({
  requestId: AccountJoinReview.fields.requestId,
  environmentId: EnvironmentId,
  label: AccountJoinReview.fields.label,
  keyFingerprint: Schema.String,
  expiresAt: Schema.Number,
  choices: Schema.Array(AccountJoinCode).check(Schema.isMaxLength(ACCOUNT_JOIN_PROMPT_CHOICES)),
});
export type AccountJoinPrompt = typeof AccountJoinPrompt.Type;
/**
 * What lets a Library with Loom Identity accept an approval. `passkey` redeems the single-use
 * grant from a passkey sign-in made moments ago; `device` is the token an owner phone received
 * at such a sign-in and releases only after Face ID or its passcode.
 */
export const AccountJoinApproval = Schema.Union([
  Schema.TaggedStruct("passkey", {
    code: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)),
    verifier: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~-]{43,128}$/u)),
  }),
  Schema.TaggedStruct("device", {
    token: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2048)),
  }),
]);
export type AccountJoinApproval = typeof AccountJoinApproval.Type;
/** The refusal detail for an approval sent without fresh proof, so clients can ask for one. */
export const ACCOUNT_JOIN_APPROVAL_REQUIRED =
  "Approving a computer needs your passkey. Approve it again, or update Loom on this device if it does not ask for one.";
/** The refusal detail for an expired or replaced phone approval token. */
export const ACCOUNT_JOIN_DEVICE_APPROVAL_ENDED =
  "This phone needs your passkey again before it can approve computers. Approve it again to confirm.";

/** `code: null` declines. A code other than the terminal's also declines the request. */
export const AccountJoinResponse = Schema.Struct({
  requestId: AccountJoinReview.fields.requestId,
  code: Schema.NullOr(AccountJoinCode),
  /** Required to approve on a Library with Loom Identity; a decline never needs it. */
  approval: Schema.optionalKey(AccountJoinApproval),
});
export type AccountJoinResponse = typeof AccountJoinResponse.Type;

/** Answered by the joining computer's own server, for `loom join` to wait on. */
export const ACCOUNT_JOIN_STATUS = "/api/loom/account/join/status";
export const ComputerJoinReadiness = Schema.Struct({
  joined: Schema.Boolean,
  history: LibrarySignInStatus.fields.state,
  directory: DirectoryReporting.fields.state,
  remote: ReachState,
  url: Schema.NullOr(Schema.String),
  /** Why remote access will not start without a change elsewhere, or null. */
  remoteNote: Schema.NullOr(Schema.String),
  /** The first thing still missing, in words, or null once everything is ready. */
  waitingFor: Schema.NullOr(Schema.String),
});
export type ComputerJoinReadiness = typeof ComputerJoinReadiness.Type;

export const ACCOUNT_ENROLLMENT_WS_METHODS = {
  prepare: "loom.account.prepareEnrollment",
  approve: "loom.account.approveEnrollment",
  install: "loom.account.installEnrollment",
  startJoin: "loom.account.startJoin",
  stepJoin: "loom.account.stepJoin",
  lookupJoin: "loom.account.lookupJoin",
  decideJoin: "loom.account.decideJoin",
  computers: "loom.account.computers",
  removeComputer: "loom.account.removeComputer",
  joinPrompts: "loom.account.joinPrompts",
  respondJoin: "loom.account.respondJoin",
} as const;
export const AccountEnrollmentRpcGroup = RpcGroup.make(
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.computers, {
    payload: Schema.Struct({}),
    success: Schema.Array(AccountComputerStatus),
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.removeComputer, {
    payload: AccountComputerRemoval,
    success: AccountComputerStatus,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.startJoin, {
    payload: ComputerJoinStart,
    success: ComputerJoinPrompt,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.stepJoin, {
    payload: Schema.Struct({}),
    success: ComputerJoinProgress,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.lookupJoin, {
    payload: Schema.Struct({ code: AccountJoinCode }),
    success: AccountJoinReview,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.decideJoin, {
    payload: Schema.Struct({
      code: AccountJoinCode,
      approve: Schema.Boolean,
      approval: Schema.optionalKey(AccountJoinApproval),
    }),
    success: AccountJoinReview,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.joinPrompts, {
    payload: Schema.Struct({}),
    success: Schema.Array(AccountJoinPrompt),
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.respondJoin, {
    payload: AccountJoinResponse,
    success: AccountJoinReview,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.prepare, {
    payload: AccountComputerEnrollmentRequest,
    success: AccountComputerEnrollmentProof,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.approve, {
    payload: AccountComputerEnrollmentProof,
    success: AccountComputerEnrollment,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_ENROLLMENT_WS_METHODS.install, {
    payload: AccountComputerEnrollment,
    success: Schema.Void,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
);
