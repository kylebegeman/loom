import * as Schema from "effect/Schema";
import { EnvironmentId } from "../baseSchemas.ts";
import { AuthAccessTokenResult } from "../auth.ts";

/** Public sign-in capabilities for this host. No credentials or subject allowlist are exposed. */
export const LoomIdentityMetadata = Schema.Struct({
  enabled: Schema.Boolean,
  browserLoginEnabled: Schema.Boolean,
  issuer: Schema.NullOr(Schema.String),
  clientId: Schema.NullOr(Schema.String),
  desktopRedirectUri: Schema.optional(Schema.String),
  nativeClientId: Schema.optional(Schema.String),
  authorizationEndpoint: Schema.NullOr(Schema.String),
  tokenEndpoint: Schema.NullOr(Schema.String),
  scopes: Schema.Array(Schema.String),
  audience: Schema.String,
  resource: Schema.optional(Schema.String),
  environmentId: EnvironmentId,
  sessionExchangeEnabled: Schema.optional(Schema.Boolean),
  browserOrigins: Schema.optional(Schema.Array(Schema.String)),
});
export type LoomIdentityMetadata = typeof LoomIdentityMetadata.Type;
export const LOOM_IDENTITY_METADATA_PATH = "/api/loom/identity";
export const LOOM_IDENTITY_LOGIN_PATH = "/api/loom/identity/login";
export const LOOM_IDENTITY_CALLBACK_PATH = "/api/loom/identity/callback";

export const LOOM_IDENTITY_SESSION_PATH = "/api/loom/identity/session";
export const LOOM_IDENTITY_LOGOUT_PATH = "/api/loom/identity/logout";

export const LoomIdentityAccount = Schema.Struct({
  issuer: Schema.String,
  subject: Schema.String,
});
export type LoomIdentityAccount = typeof LoomIdentityAccount.Type;
export const LoomIdentitySessionResult = Schema.Struct({
  ...AuthAccessTokenResult.fields,
  environmentId: EnvironmentId,
  identity: LoomIdentityAccount,
});
export type LoomIdentitySessionResult = typeof LoomIdentitySessionResult.Type;
export const LoomIdentityBrowserRequest = Schema.Struct({
  origin: Schema.String,
  state: Schema.String,
  challenge: Schema.String,
  environmentId: EnvironmentId,
  expectedIdentity: Schema.optional(LoomIdentityAccount),
});
export type LoomIdentityBrowserRequest = typeof LoomIdentityBrowserRequest.Type;
export const LoomIdentitySessionRequest = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("browser"),
    code: Schema.String,
    verifier: Schema.String,
    environmentId: EnvironmentId,
    expectedIdentity: Schema.optional(LoomIdentityAccount),
  }),
  Schema.Struct({
    type: Schema.Literal("native"),
    accessToken: Schema.String,
    environmentId: EnvironmentId,
    expectedIdentity: Schema.optional(LoomIdentityAccount),
  }),
]);
export type LoomIdentitySessionRequest = typeof LoomIdentitySessionRequest.Type;
export const LoomDesktopSignInRequest = Schema.Struct({
  httpBaseUrl: Schema.String,
  expectedEnvironmentId: Schema.optional(EnvironmentId),
  expectedIdentity: Schema.optional(LoomIdentityAccount),
});
export type LoomDesktopSignInRequest = typeof LoomDesktopSignInRequest.Type;
export const LoomDesktopSignInResult = Schema.Struct({
  httpBaseUrl: Schema.String,
  environmentId: EnvironmentId,
  accessToken: Schema.String,
  identity: Schema.optional(LoomIdentityAccount),
  expiresAt: Schema.optional(Schema.Number),
});
export type LoomDesktopSignInResult = typeof LoomDesktopSignInResult.Type;
