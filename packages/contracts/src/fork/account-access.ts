import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { DirectoryReportRequest } from "./directory.ts";
import { LibraryManagementDelegation, LibraryError } from "./project-library.ts";
import { EnvironmentId, AuthSessionId, IsoDateTime } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError, AuthStandardClientScopes } from "../auth.ts";
import * as Schema from "effect/Schema";

export const ACCOUNT_ACCESS_FEATURE = "account-access";
export const ACCOUNT_GATEWAY_FEATURE = "account-gateway";

export const ACCOUNT_ACCESS_PREFIX = "/api/loom/account/computers/";
export const ACCOUNT_ACCESS_VERIFY = "/api/loom/account/verify";
export const ACCOUNT_ACCESS_HEADER = "x-loom-account-grant";

export const AccountAdmission = Schema.Struct({
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
export const ACCOUNT_ENROLLMENT_WS_METHODS = {
  prepare: "loom.account.prepareEnrollment",
  approve: "loom.account.approveEnrollment",
  install: "loom.account.installEnrollment",
  startJoin: "loom.account.startJoin",
  stepJoin: "loom.account.stepJoin",
  lookupJoin: "loom.account.lookupJoin",
  decideJoin: "loom.account.decideJoin",
} as const;
export const AccountEnrollmentRpcGroup = RpcGroup.make(
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
    payload: Schema.Struct({ code: AccountJoinCode, approve: Schema.Boolean }),
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
