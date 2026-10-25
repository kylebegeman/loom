import { type ReachAction, ReachRequestClaims } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { RelayJwtError, signRelayJwt, verifyRelayJwt } from "../relayJwt.ts";
import { decodeEd25519PublicKey, isDirectoryRouteUrl } from "./directory.ts";

/** Distinct from the directory report and every relay typ, so no proof replays as another. */
export const REACH_REQUEST_TYP = "loom-reach-request+jwt";
/** Short because `seq` already orders requests; this only bounds a captured token's use. */
export const REACH_REQUEST_LIFETIME_SECONDS = 60;

const reachIssuer = (environmentId: string) => `loom-env:${environmentId}`;

function reachAudience(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function publicKeyPem(publicKey: string): string | null {
  return decodeEd25519PublicKey(publicKey) === null
    ? null
    : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----\n`;
}

export class ReachRequestError extends Schema.TaggedError<ReachRequestError>()(
  "ReachRequestError",
  {
    operation: Schema.Literals(["sign", "verify"]),
    reason: Schema.Literals([
      "invalid-audience",
      "invalid-key",
      "invalid-request",
      "unverified",
      "wrong-environment",
    ]),
    /** The jose error code behind the failure, for logs. */
    diagnostic: Schema.optional(Schema.String),
    /** Set only when signing; a refused token's jose errors carry its decoded claims. */
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} reach request: ${this.reason}.`;
  }
}

const encodeClaims = Schema.encodeEffect(ReachRequestClaims);
const decodeClaims = Schema.decodeUnknownEffect(ReachRequestClaims);

const claimsFitAction = (claims: ReachRequestClaims, action: ReachAction) =>
  claims.action === action && (action === "ensure") === (claims.origin !== undefined);

/** Signs one ensure or remove with the environment's Ed25519 private key (PKCS#8 PEM). */
export const signReachRequest = Effect.fn("ReachRequest.sign")(function* (input: {
  readonly privateKey: string;
  readonly environmentId: string;
  /** The Library's URL; only its origin is signed. */
  readonly audience: string;
  readonly claims: ReachRequestClaims;
  readonly nowEpochSeconds: number;
}): Effect.fn.Return<string, ReachRequestError> {
  const audience = reachAudience(input.audience);
  if (audience === null) {
    return yield* new ReachRequestError({ operation: "sign", reason: "invalid-audience" });
  }
  const claims = yield* encodeClaims(input.claims).pipe(
    Effect.mapError(
      (cause) => new ReachRequestError({ operation: "sign", reason: "invalid-request", cause }),
    ),
  );
  if (!claimsFitAction(claims, claims.action)) {
    return yield* new ReachRequestError({ operation: "sign", reason: "invalid-request" });
  }
  const iat = Math.floor(input.nowEpochSeconds);
  return yield* signRelayJwt({
    privateKey: input.privateKey,
    typ: REACH_REQUEST_TYP,
    payload: {
      ...claims,
      iss: reachIssuer(input.environmentId),
      sub: input.environmentId,
      aud: audience,
      iat,
      exp: iat + REACH_REQUEST_LIFETIME_SECONDS,
    },
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ReachRequestError({
          operation: "sign",
          reason: "invalid-key",
          diagnostic: RelayJwtError.diagnosticCode(cause),
          cause,
        }),
    ),
  );
});

const isIssuerClaimFailure = (error: RelayJwtError) =>
  Predicate.isObject(error.cause) &&
  Predicate.hasProperty(error.cause, "claim") &&
  error.cause.claim === "iss";

/**
 * Verifies a request against the environment's pinned public key (base64 DER SPKI), the
 * environment the session names and the route's action. The caller still checks `seq`.
 */
export function verifyReachRequest(input: {
  readonly publicKey: string;
  readonly token: string;
  readonly environmentId: string;
  /** This Library's URL; only its origin is compared. */
  readonly audience: string;
  readonly action: ReachAction;
  readonly nowEpochSeconds: number;
}): Effect.Effect<ReachRequestClaims, ReachRequestError> {
  const fail = (reason: ReachRequestError["reason"], diagnostic?: string) =>
    new ReachRequestError({ operation: "verify", reason, diagnostic });
  return Effect.gen(function* () {
    const audience = reachAudience(input.audience);
    if (audience === null) return yield* fail("invalid-audience");
    const publicKey = publicKeyPem(input.publicKey);
    if (publicKey === null) return yield* fail("invalid-key");
    const payload = yield* verifyRelayJwt({
      publicKey,
      token: input.token,
      typ: REACH_REQUEST_TYP,
      issuer: reachIssuer(input.environmentId),
      audience,
      nowEpochSeconds: input.nowEpochSeconds,
      maxTokenAge: REACH_REQUEST_LIFETIME_SECONDS,
    }).pipe(
      // jose checks the signature before claims, so a wrong issuer is this key naming another
      // environment.
      Effect.mapError((cause) =>
        fail(
          isIssuerClaimFailure(cause) ? "wrong-environment" : "unverified",
          RelayJwtError.diagnosticCode(cause),
        ),
      ),
    );
    if (payload.sub !== input.environmentId) return yield* fail("wrong-environment");
    // Schema issues echo the claims, so the decode failure carries no cause.
    const claims = yield* decodeClaims(payload).pipe(
      Effect.mapError(() => fail("invalid-request")),
    );
    if (!claimsFitAction(claims, input.action)) return yield* fail("invalid-request");
    return claims;
  });
}

/** OPTIONS is here because hosted web clients preflight `Authorization`. */
export const REACH_ALLOWED_METHODS = ["GET", "HEAD", "POST", "OPTIONS"] as const;

/**
 * What a remote client needs from a computer, matched exactly. Pairing administration other than
 * revoking devices, MCP and its OAuth, browser Identity login, webhooks, Connect, observability,
 * Library-only routes and the web app stay unreachable on a reach host.
 */
export const REACH_ALLOWED_PATHS = [
  "/ws",
  "/.well-known/t3/environment",
  "/oauth/token",
  "/api/auth/session",
  "/api/auth/websocket-ticket",
  // A device that reaches the computer only this way must still be able to revoke a stolen one.
  "/api/auth/clients",
  "/api/auth/clients/revoke",
  "/api/auth/clients/revoke-others",
  "/api/loom/identity",
  "/api/loom/identity/session",
  "/api/loom/identity/logout",
  "/api/orchestration/shell",
  "/api/projects",
  "/api/projects/mutate",
  "/api/pull-requests/diff",
] as const;

/** Families whose handlers authenticate each request or check a signed URL. */
export const REACH_ALLOWED_PREFIXES = [
  "/api/orchestration/threads/",
  "/api/assets/",
  "/api/attachments/upload/",
  "/api/device-hub/",
  "/api/preview-stream/",
  "/api/loom/model-preview-3d/f/",
  "/api/loom/pcb-preview/f/",
] as const;

const ALLOWED_METHODS: ReadonlySet<string> = new Set(REACH_ALLOWED_METHODS);
const ALLOWED_PATHS: ReadonlySet<string> = new Set(REACH_ALLOWED_PATHS);
const ENCODED_SEPARATOR_OR_NUL = /%(?:2f|5c|00)/iu;

/** The path part of a request target: what the edge rule sees as `http.request.uri.path`. */
const requestPath = (target: string) => target.split(/[?#]/u, 1)[0] ?? "";

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * True when a raw request target could resolve somewhere other than it reads: a dot segment
 * (also as `%2e` after one decode), an empty segment (`//`), a backslash, an encoded slash or backslash,
 * a NUL, malformed escapes, or a target that is not origin-form. Dots inside a segment are fine,
 * so `a..b.png` passes. The query is not routed and is not checked.
 */
export function isUnsafeReachPath(target: string): boolean {
  const path = requestPath(target);
  if (!path.startsWith("/")) return true;
  if (path.includes("//") || path.includes("\\") || path.includes("\0")) return true;
  if (ENCODED_SEPARATOR_OR_NUL.test(path)) return true;
  for (const segment of path.slice(1).split("/")) {
    const decoded = decodeSegment(segment);
    if (decoded === null || decoded === "." || decoded === "..") return true;
  }
  return false;
}

/** Whether a reach host may serve this request. Unsafe paths are never allowed. */
export function reachAllowsRequest(method: string, target: string): boolean {
  if (!ALLOWED_METHODS.has(method) || isUnsafeReachPath(target)) return false;
  const path = requestPath(target);
  return (
    ALLOWED_PATHS.has(path) || REACH_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

/** Hostnames are `<slug>-loom.<zone>`, or `<slug>-<n>-loom.<zone>` after a collision. */
export const REACH_HOST_SUFFIX = "-loom";
export const REACH_SLUG_MAX_LENGTH = 40;
export const REACH_SLUG_FALLBACK = "computer";
/** Attempt 1 is the bare slug; 2 to 99 add a numeric suffix. */
export const REACH_HOSTNAME_MAX_ATTEMPTS = 99;
/** Bare slugs that read like the Library's or Identity's own hosts. They start at attempt 2. */
export const REACH_RESERVED_SLUGS = [
  "www",
  "id",
  "api",
  "auth",
  "login",
  "sso",
  "admin",
  "library",
  "loom",
  "pages",
  "mail",
  "status",
  "mcp",
] as const;
const RESERVED_SLUGS: ReadonlySet<string> = new Set(REACH_RESERVED_SLUGS);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u;
const ENVIRONMENT_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
// The route URL check also admits a port and a path after the host, which no DNS name has.
const ZONE_CHARACTERS = /^[a-z0-9.-]+$/u;

/**
 * A valid reach zone is a lowercase DNS name with at least two labels and room for every hostname.
 * It is rendered into the edge rule, so this check also keeps quotes out of the expression, and
 * the guard compares hostnames without a port, so a zone never carries one.
 */
export function isReachZone(zone: string): boolean {
  const longest = `${"a".repeat(REACH_SLUG_MAX_LENGTH)}-${REACH_HOSTNAME_MAX_ATTEMPTS}${REACH_HOST_SUFFIX}.${zone}`;
  return (
    ZONE_CHARACTERS.test(zone) &&
    zone.includes(".") &&
    isDirectoryRouteUrl(`https://x${REACH_HOST_SUFFIX}.${zone}/`) &&
    isDirectoryRouteUrl(`https://${longest}/`)
  );
}

/**
 * A slug proposed from a computer's signed label: accents and apostrophes dropped ("Kyle's"
 * becomes "kyles"), other runs of characters collapsed to one `-`, at most 40 characters. Runs
 * collapse, so `--` and the `xn--` IDNA form never appear.
 */
export function reachSlug(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, REACH_SLUG_MAX_LENGTH)
    .replace(/-+$/u, "");
  return slug.length === 0 ? REACH_SLUG_FALLBACK : slug;
}

export function isReachSlug(slug: string): boolean {
  return SLUG.test(slug) && !slug.includes("--");
}

/**
 * The hostname for one allocation attempt, or null when the attempt cannot be used: out of range,
 * a reserved bare slug, an invalid slug or zone. The caller tries attempts in order and keeps the
 * first one no record or foreign DNS record holds.
 */
export function reachHostname(slug: string, attempt: number, zone: string): string | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > REACH_HOSTNAME_MAX_ATTEMPTS) {
    return null;
  }
  if (!isReachSlug(slug) || !isReachZone(zone)) return null;
  if (attempt === 1 && RESERVED_SLUGS.has(slug)) return null;
  const label = attempt === 1 ? slug : `${slug}-${attempt}`;
  const hostname = `${label}${REACH_HOST_SUFFIX}.${zone}`;
  return isDirectoryRouteUrl(`https://${hostname}/`) ? hostname : null;
}

const NUMBERED_LABEL = /^(.+)-([1-9][0-9]?)$/u;

/**
 * Whether `hostname` is one `reachHostname` produces, in any valid zone. A computer guards the
 * hostname its Library assigns, so it refuses any other shape, such as its own tailnet name.
 */
export function isReachHostname(hostname: string): boolean {
  const dot = hostname.indexOf(".");
  const label = hostname.slice(0, Math.max(dot, 0));
  if (!label.endsWith(REACH_HOST_SUFFIX)) return false;
  const zone = hostname.slice(dot + 1);
  const name = label.slice(0, -REACH_HOST_SUFFIX.length);
  // A slug can end in `-<n>` itself, so a numbered label is tried both ways.
  const numbered = NUMBERED_LABEL.exec(name);
  return (
    reachHostname(name, 1, zone) === hostname ||
    (numbered !== null && reachHostname(numbered[1] ?? "", Number(numbered[2]), zone) === hostname)
  );
}

/** Environment ids that can sit in a resource URL as they are, with no case folding to collide. */
export function isReachEnvironmentId(environmentId: string): boolean {
  return ENVIRONMENT_ID.test(environmentId);
}

/**
 * The Loom Identity resource the Library derives for a computer: `<Library origin>/computers/<id>`,
 * lowercase with no trailing slash, as Pocket ID stores it. Null for a non-HTTPS origin or an id
 * that would need folding or escaping.
 */
export function reachResource(libraryOrigin: string, environmentId: string): string | null {
  if (!isReachEnvironmentId(environmentId)) return null;
  try {
    const url = new URL(libraryOrigin);
    return url.protocol === "https:" ? `${url.origin}/computers/${environmentId}` : null;
  } catch {
    return null;
  }
}

/** Rules the Library owns carry this prefix; it never edits or deletes any other rule. */
export const REACH_EDGE_RULE_PREFIX = "loom-reach:";
export const REACH_WAF_RULE_DESCRIPTION = "loom-reach:allowlist v1 (managed by the Loom Library)";
export const REACH_RATE_LIMIT_RULE_DESCRIPTION =
  "loom-reach:ratelimit v1 (managed by the Loom Library)";

const quoted = (values: ReadonlyArray<string>) => values.map((value) => `"${value}"`).join(" ");

/**
 * The zone WAF rule's expression, rendered from the same constants the guard enforces. `contains`
 * on the lowered host also catches `Host: X-LOOM.zone:443`, which `ends_with` would miss. Null for
 * an invalid zone.
 */
export function renderReachWafExpression(zone: string): string | null {
  if (!isReachZone(zone)) return null;
  const prefixes = REACH_ALLOWED_PREFIXES.map(
    (prefix) => `starts_with(http.request.uri.path, "${prefix}")`,
  );
  return (
    `(lower(http.host) contains "${REACH_HOST_SUFFIX}.${zone}") and not (` +
    `http.request.method in {${quoted(REACH_ALLOWED_METHODS)}} and (` +
    `http.request.uri.path in {${quoted(REACH_ALLOWED_PATHS)}} or ${prefixes.join(" or ")}))`
  );
}

/** The WAF custom rule body for the `http_request_firewall_custom` phase. */
export function reachWafRule(zone: string) {
  const expression = renderReachWafExpression(zone);
  return expression === null
    ? null
    : ({
        action: "block",
        description: REACH_WAF_RULE_DESCRIPTION,
        expression,
        enabled: true,
      } as const);
}

/** The free plan's one rate-limit rule matches paths only, so it applies zone-wide. */
export const REACH_RATE_LIMITED_PATHS = [
  "/oauth/token",
  "/api/auth/websocket-ticket",
  "/api/auth/session",
  "/api/loom/identity/session",
] as const;

/**
 * The rate-limit rule body for the `http_ratelimit` phase. `/ws` and assets stay out, so
 * reconnects and image bursts never trip it.
 */
export const REACH_RATE_LIMIT_RULE = {
  action: "block",
  description: REACH_RATE_LIMIT_RULE_DESCRIPTION,
  expression: REACH_RATE_LIMITED_PATHS.map((path) => `(http.request.uri.path eq "${path}")`).join(
    " or ",
  ),
  ratelimit: {
    characteristics: ["cf.colo.id", "ip.src"],
    period: 10,
    requests_per_period: 60,
    mitigation_timeout: 10,
  },
  enabled: true,
} as const;

/**
 * The `PUT .../cfd_tunnel/{id}/configurations` body. No path rules (cloudflared matches paths
 * with an unanchored regex) and no `originRequest`, so the original Host reaches the computer.
 */
export function reachIngressConfiguration(hostname: string, origin: string) {
  return {
    config: {
      ingress: [{ hostname, service: origin }, { service: "http_status:404" }],
    },
  } as const;
}
