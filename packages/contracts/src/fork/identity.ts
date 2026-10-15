import * as Schema from "effect/Schema";
import { EnvironmentId } from "../baseSchemas.ts";

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
});
export type LoomIdentityMetadata = typeof LoomIdentityMetadata.Type;
export const LOOM_IDENTITY_METADATA_PATH = "/api/loom/identity";
export const LOOM_IDENTITY_LOGIN_PATH = "/api/loom/identity/login";
export const LOOM_IDENTITY_CALLBACK_PATH = "/api/loom/identity/callback";

export const LoomDesktopSignInRequest = Schema.Struct({ httpBaseUrl: Schema.String });
export type LoomDesktopSignInRequest = typeof LoomDesktopSignInRequest.Type;
export const LoomDesktopSignInResult = Schema.Struct({
  httpBaseUrl: Schema.String,
  environmentId: EnvironmentId,
  accessToken: Schema.String,
});
export type LoomDesktopSignInResult = typeof LoomDesktopSignInResult.Type;
