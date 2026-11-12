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
export const ACCOUNT_ENROLLMENT_WS_METHODS = {
  prepare: "loom.account.prepareEnrollment",
  approve: "loom.account.approveEnrollment",
  install: "loom.account.installEnrollment",
} as const;
export const AccountEnrollmentRpcGroup = RpcGroup.make(
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
