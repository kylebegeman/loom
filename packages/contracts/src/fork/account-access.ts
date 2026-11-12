import { AuthStandardClientScopes } from "../auth.ts";
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
