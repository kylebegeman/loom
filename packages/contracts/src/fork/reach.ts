import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
} from "../baseSchemas.ts";

/** Advertised by every computer that answers `loom.reach.*`. */
export const REACH_FEATURE = "reach";
/** Advertised by every computer that also answers `loom.reach.forget`. */
export const REACH_FORGET_FEATURE = "reach-forget";
export const REACH_IDENTITY_APPLY_FEATURE = "reach-identity-apply";
/**
 * Advertised by the Library authority once its directory runs and its reach zone and Cloudflare
 * token file are configured. It answers `loom.reach.library.*` and the two provisioning routes.
 */
export const REACH_LIBRARY_FEATURE = "reach-library";

const ShortText = Schema.String.check(Schema.isMaxLength(500));
const UrlText = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2048));
const HostnameText = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(253));

/**
 * `unavailable` cannot run reach at all (see `blocked`). `provisioning` waits on the Library,
 * `starting` has cloudflared running without an edge connection yet, and `error` keeps the intent
 * on while a step fails and the server retries.
 */
export const ReachState = Schema.Literals([
  "off",
  "unavailable",
  "provisioning",
  "starting",
  "connected",
  "error",
  "removing",
]);
export type ReachState = typeof ReachState.Type;

/**
 * Why reach cannot be turned on now. The first three are known from the Library connection; the
 * last two come back from a failed ensure.
 */
export const ReachBlocked = Schema.Literals([
  "no-library",
  "is-library",
  "library-signed-out",
  "library-not-ready",
  "library-outdated",
]);
export type ReachBlocked = typeof ReachBlocked.Type;

/**
 * `retired`: cloudflared's edge refused this computer's connector token for good, so the Library
 * retired the address or another copy of this computer took it over. Reach turned itself off.
 */
export const ReachWarning = Schema.Literals([
  "library-unreachable",
  "library-signed-out",
  "identity-off",
  "identity-resource-differs",
  "passkey-not-required",
  "retired",
]);
export type ReachWarning = typeof ReachWarning.Type;

/**
 * Non-secret Loom Identity values the Library prepared for this computer. The computer adopts them
 * only when its own admin applies them to private host configuration; environment variables take precedence.
 */
export const ReachPrepared = Schema.Struct({
  issuer: UrlText,
  resource: UrlText,
  nativeClientId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
});
export type ReachPrepared = typeof ReachPrepared.Type;

/** What clients show for one computer. It never carries the connector token. */
export const ReachStatus = Schema.Struct({
  state: ReachState,
  /** The user's intent: true from turning reach on until it is turned off or removed. */
  enabled: Schema.Boolean,
  blocked: Schema.NullOr(ReachBlocked),
  /** `https://<slug>-loom.<zone>/` once the Library assigned one. Hostnames are sticky. */
  url: Schema.NullOr(UrlText),
  /** One short line about the last failure. Never a token or a Library or Cloudflare body. */
  message: Schema.NullOr(ShortText),
  /** A newer computer's warnings that this client does not know are dropped, not fatal. */
  warnings: ForwardCompatibleArray(ReachWarning),
  prepared: Schema.NullOr(ReachPrepared),
});
export type ReachStatus = typeof ReachStatus.Type;

/** The range `LOOM_IDENTITY_MAX_SESSION_AGE` accepts: one hour to 365 days. */
export const ReachIdentityMaxSessionAge = Schema.Int.check(
  Schema.isBetween({ minimum: 60 * 60, maximum: 365 * 24 * 60 * 60 }),
);
/**
 * Seven days, the Library native client's refresh lifetime in Pocket ID
 * (`refreshTokenDurationMinutes: 10080`), which ends a grant left unused that long.
 */
export const REACH_IDENTITY_DEFAULT_MAX_SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;

/** `maxSessionAgeSeconds` keeps the saved value when omitted, else the default. */
export const ReachApplyIdentityInput = Schema.Struct({
  requirePasskey: Schema.Boolean,
  allowedSubjects: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  maxSessionAgeSeconds: Schema.optionalKey(ReachIdentityMaxSessionAge),
});
export type ReachApplyIdentityInput = typeof ReachApplyIdentityInput.Type;

export const ReachSetInput = Schema.Struct({ enabled: Schema.Boolean });
export type ReachSetInput = typeof ReachSetInput.Type;

/**
 * Has no cause on purpose: a Library ensure reply carries the connector token, and an error's
 * cause would cross the wire and reach logs. Library answers never fail a call: `set` and `remove`
 * answer once the intent is stored, and the status carries what the Library said.
 */
export class ReachError extends Schema.TaggedError<ReachError>()("ReachError", {
  reason: Schema.Literals(["unavailable", "busy", "storage", "identity-allowlist"]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "identity-allowlist":
        return "Enter the Loom account IDs allowed to sign in to this computer. A wildcard is not allowed.";
      case "unavailable":
        return "Reach cannot run on this computer right now. It needs a Library that supports reach and a current sign-in to it.";
      case "busy":
        return "Reach is still finishing another change on this computer. Try again in a moment.";
      case "storage":
        return "This computer could not save its reach settings. Try again.";
    }
  }
}

export const REACH_LIST_ROUTE = "/api/loom/reach/list";
export const REACH_ENSURE_ROUTE = "/api/loom/reach/ensure";
export const REACH_REMOVE_ROUTE = "/api/loom/reach/remove";
/** The Library refuses a larger body before reading it. */
export const REACH_REQUEST_MAX_BYTES = 8192;
/** A signed request is a few hundred bytes; this only bounds the text. */
export const REACH_REQUEST_TOKEN_MAX_LENGTH = 4096;
const REACH_CONNECTOR_TOKEN_MAX_LENGTH = 4096;

export const ReachAction = Schema.Literals(["ensure", "remove"]);
export type ReachAction = typeof ReachAction.Type;

const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/u;

/**
 * Where the tunnel's ingress points: the forms `loopbackUrlHostForAddress` produces for the
 * computer's bound address. Anything else would let a request publish a LAN host or a socket.
 */
export const ReachLoopbackOrigin = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      const match = LOOPBACK_ORIGIN.exec(value);
      return match !== null && Number(match[1]) <= 65_535;
    },
    { expected: "http://127.0.0.1:<port> or http://[::1]:<port>" },
  ),
);
export type ReachLoopbackOrigin = typeof ReachLoopbackOrigin.Type;

/**
 * The claims a computer signs beside `iss`, `sub`, `aud`, `iat` and `exp`. `seq` only grows per
 * computer, so the Library refuses a replay even inside the token's lifetime. Only `ensure`
 * carries an origin.
 */
export const ReachRequestClaims = Schema.Struct({
  action: ReachAction,
  seq: PositiveInt,
  origin: Schema.optionalKey(ReachLoopbackOrigin),
});
export type ReachRequestClaims = typeof ReachRequestClaims.Type;

/** The public key travels with the token, so the Library can tell `key-changed` from a forgery. */
export const ReachRequestBody = Schema.Struct({
  token: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(REACH_REQUEST_TOKEN_MAX_LENGTH),
  ),
  /** The environment's Ed25519 public key as base64 DER SPKI. */
  publicKey: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
});
export type ReachRequestBody = typeof ReachRequestBody.Type;

export const ReachIdentityFailure = Schema.Literals(["denied", "unavailable", "conflict"]);
export type ReachIdentityFailure = typeof ReachIdentityFailure.Type;

/** Pocket ID provisioning never fails an ensure; its outcome rides along. */
export const ReachEnsureIdentity = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    issuer: UrlText,
    nativeClientId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
    resource: UrlText,
  }),
  Schema.Struct({ state: Schema.Literal("not-configured") }),
  Schema.Struct({ state: Schema.Literal("failed"), reason: ReachIdentityFailure }),
]);
export type ReachEnsureIdentity = typeof ReachEnsureIdentity.Type;

export const ReachAllowlistState = Schema.Literals(["ready", "stale", "failed"]);
export type ReachAllowlistState = typeof ReachAllowlistState.Type;
/** `occupied`: a rule the Library does not own holds the free plan's one rate-limit slot. */
export const ReachRateLimitState = Schema.Literals(["ready", "occupied", "failed"]);
export type ReachRateLimitState = typeof ReachRateLimitState.Type;

/**
 * Every ensure rotates the tunnel secret and clears connections first, so `connectorToken` is
 * fresh each time and an older copy is dead. It carries a secret: decode it without printing the
 * schema issue, never log it, and never persist it.
 */
export const ReachEnsureReply = Schema.Struct({
  hostname: HostnameText,
  url: UrlText,
  /** The ingress the Library configured; a reply naming another origin is refused. */
  origin: ReachLoopbackOrigin,
  connectorToken: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(REACH_CONNECTOR_TOKEN_MAX_LENGTH),
  ),
  edge: Schema.Struct({
    // A failed allowlist fails the ensure with `edge-failed`, so a reply only sees these two.
    allowlist: Schema.Literals(["ready", "stale"]),
    rateLimit: ReachRateLimitState,
  }),
  identity: ReachEnsureIdentity,
});
export type ReachEnsureReply = typeof ReachEnsureReply.Type;

export const ReachRemoveReply = Schema.Struct({ removed: Schema.Literal(true) });
export type ReachRemoveReply = typeof ReachRemoveReply.Type;

/** Why the Library refused or failed a request. Bodies carry only this, never upstream text. */
export const ReachFailureReason = Schema.Literals([
  "not-authority",
  "not-configured",
  "is-library",
  "not-in-directory",
  "key-changed",
  "unverified",
  "wrong-environment",
  "stale-request",
  "too-many-requests",
  "edge-failed",
  "cloudflare-denied",
  "cloudflare-limited",
  "cloudflare-unavailable",
  "hostname-unavailable",
  "tunnel-busy",
  "io",
  "invalid",
  "too-large",
]);
export type ReachFailureReason = typeof ReachFailureReason.Type;

export const ReachFailureReply = Schema.Struct({
  reason: ReachFailureReason,
  retryAfterSeconds: Schema.optionalKey(PositiveInt),
});
export type ReachFailureReply = typeof ReachFailureReply.Type;

/** From a file check plus the last call that used the credential. */
export const ReachCredentialState = Schema.Literals(["ready", "missing", "refused", "unavailable"]);
export type ReachCredentialState = typeof ReachCredentialState.Type;

export const ReachLibrarySetup = Schema.Struct({
  /** The configured reach zone, or null while it is unset or invalid. */
  zone: Schema.NullOr(HostnameText),
  cloudflare: ReachCredentialState,
  /** The Pocket ID admin key. `missing` is a normal state: the key can be supplied on demand. */
  identity: ReachCredentialState,
  /** Null until the first ensure checked the edge rules. */
  edge: Schema.NullOr(
    Schema.Struct({
      allowlist: ReachAllowlistState,
      rateLimit: ReachRateLimitState,
      checkedAt: IsoDateTime,
    }),
  ),
});
export type ReachLibrarySetup = typeof ReachLibrarySetup.Type;

/**
 * `removed` and `removed-with-leftover` keep the hostname as a tombstone that is never reassigned.
 * `removed-with-leftover` left a DNS record alone because its id or content no longer matched.
 */
export const ReachLibraryRecordState = Schema.Literals([
  "provisioning",
  "ready",
  "removing",
  "removed",
  "removed-with-leftover",
  "failed",
]);
export type ReachLibraryRecordState = typeof ReachLibraryRecordState.Type;

const CloudflareId = Schema.String.check(Schema.isMaxLength(64));

/**
 * `hostname` is set while its DNS record there may remain, with the record's id when known.
 * `tunnelLeft` is true while tunnel `loom-reach-<environment id>` may remain in its account.
 */
export const ReachLeftoverZone = Schema.Struct({
  zone: HostnameText,
  hostname: Schema.NullOr(HostnameText),
  dnsRecordId: Schema.NullOr(CloudflareId),
  tunnelLeft: Schema.Boolean,
});
export type ReachLeftoverZone = typeof ReachLeftoverZone.Type;

export const ReachLibraryComputer = Schema.Struct({
  environmentId: EnvironmentId,
  /** The directory label the computer signed, or null once it was forgotten there. */
  label: Schema.NullOr(Schema.String.check(Schema.isMaxLength(160))),
  hostname: Schema.NullOr(HostnameText),
  state: ReachLibraryRecordState,
  lastError: Schema.NullOr(ReachFailureReason),
  /** From one Cloudflare tunnel list per refresh; `unknown` when that call failed. */
  connection: Schema.Literals(["connected", "down", "unknown"]),
  /**
   * Distinct cloudflared connectors on the tunnel at the last list, or null when unknown. More
   * than one means a copy of the connector token runs somewhere else.
   */
  connectors: Schema.NullOr(NonNegativeInt),
  /** The record left alone while `removed-with-leftover`, for the operator to inspect by hand. */
  leftoverDnsRecordId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
  /**
   * What an earlier reach zone may still hold for this computer because the Library's token could
   * not remove it there. Absent from Libraries older than it.
   */
  leftoverZones: Schema.optionalKey(Schema.Array(ReachLeftoverZone)),
  identity: Schema.NullOr(
    Schema.Struct({
      resource: UrlText,
      state: Schema.Literals(["ready", "failed"]),
      lastError: Schema.NullOr(ReachIdentityFailure),
    }),
  ),
  /**
   * The computer's Library sign-in that last provisioned. A live, signed-in computer provisions
   * again on its next start, so a retire should also end this sign-in.
   */
  signIn: Schema.Literals(["active", "ended", "unknown"]),
  updatedAt: IsoDateTime,
  lastEnsuredAt: Schema.NullOr(IsoDateTime),
});
export type ReachLibraryComputer = typeof ReachLibraryComputer.Type;

/** The one place clients decide what "extra connector" means. */
export const hasExtraReachConnector = (computer: Pick<ReachLibraryComputer, "connectors">) =>
  computer.connectors !== null && computer.connectors > 1;

export const ReachLibraryListing = Schema.Struct({
  setup: ReachLibrarySetup,
  computers: Schema.Array(ReachLibraryComputer),
});
export type ReachLibraryListing = typeof ReachLibraryListing.Type;

/**
 * Retire tears down a computer's tunnel and DNS record without it. `endIdentity` also deletes its
 * Pocket ID resource, which ends every device's Loom sign-in renewal for that computer.
 */
export const ReachRetireInput = Schema.Struct({
  environmentId: EnvironmentId,
  endIdentity: Schema.Boolean,
});
export type ReachRetireInput = typeof ReachRetireInput.Type;

/**
 * `identity-key-missing` refuses a retire that would end Loom sign-in while the Pocket ID admin
 * key file is not ready, before anything changes. Clients older than it cannot decode it, so new
 * clients do not offer ending sign-in while the listing's `setup.identity` is `missing`.
 */
export class ReachLibraryError extends Schema.TaggedError<ReachLibraryError>()(
  "ReachLibraryError",
  {
    reason: Schema.Literals([
      "not-authority",
      "not-configured",
      "not-found",
      "cloudflare-denied",
      "cloudflare-limited",
      "cloudflare-unavailable",
      "tunnel-busy",
      "io",
      "identity-key-missing",
    ]),
    retryAfterSeconds: Schema.optionalKey(PositiveInt),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-authority":
        return "This computer is not your Library, so it does not manage reach addresses.";
      case "not-configured":
        return "This Library is not set up for reach. Set its reach zone and Cloudflare token file, then restart it.";
      case "not-found":
        return "This Library has no reach address for that computer.";
      case "cloudflare-denied":
        return "Cloudflare refused this Library's token. Check the token and its permissions.";
      case "cloudflare-limited":
        return "Cloudflare is limiting this Library's requests. Try again in a few minutes.";
      case "cloudflare-unavailable":
        return "Cloudflare did not answer. Try again.";
      case "tunnel-busy":
        return "The computer's connector is still attached. Try again in a moment.";
      case "io":
        return "This Library could not store or read its reach records. Try again.";
      case "identity-key-missing":
        return "Nothing was changed. Ending Loom sign-in needs this Library's Pocket ID admin key file, which is missing or unreadable. Bring the key online, then retire again, or retire without ending sign-in.";
    }
  }
}

export const REACH_WS_METHODS = {
  applyIdentity: "loom.reach.applyIdentity",
  watch: "loom.reach.watch",
  set: "loom.reach.set",
  remove: "loom.reach.remove",
  forget: "loom.reach.forget",
  libraryList: "loom.reach.library.list",
  libraryRetire: "loom.reach.library.retire",
} as const;

const computerError = Schema.Union([ReachError, EnvironmentAuthorizationError]);
const libraryError = Schema.Union([ReachLibraryError, EnvironmentAuthorizationError]);

/**
 * `set` answers once the intent is stored; provisioning continues in the background and the
 * `watch` stream shows its progress. `forget` clears reach on the computer without asking its
 * Library, leaving the Library's tunnel and address until they are retired there; only call it on
 * a computer that advertises `REACH_FORGET_FEATURE`.
 */
export const ReachRpcGroup = RpcGroup.make(
  Rpc.make(REACH_WS_METHODS.applyIdentity, {
    payload: ReachApplyIdentityInput,
    success: Schema.Void,
    error: computerError,
  }),
  Rpc.make(REACH_WS_METHODS.watch, {
    payload: Schema.Struct({}),
    success: ReachStatus,
    error: computerError,
    stream: true,
  }),
  Rpc.make(REACH_WS_METHODS.set, {
    payload: ReachSetInput,
    success: ReachStatus,
    error: computerError,
  }),
  Rpc.make(REACH_WS_METHODS.remove, {
    payload: Schema.Struct({}),
    success: ReachStatus,
    error: computerError,
  }),
  Rpc.make(REACH_WS_METHODS.forget, {
    payload: Schema.Struct({}),
    success: ReachStatus,
    error: computerError,
  }),
  Rpc.make(REACH_WS_METHODS.libraryList, {
    payload: Schema.Struct({}),
    success: ReachLibraryListing,
    error: libraryError,
  }),
  Rpc.make(REACH_WS_METHODS.libraryRetire, {
    payload: ReachRetireInput,
    success: ReachLibraryComputer,
    error: libraryError,
  }),
);
