// @effect-diagnostics nodeBuiltinImport:off - tickets are signed and checked synchronously on request paths.
import * as NodeCrypto from "node:crypto";
import { PREVIEW_LINK_GATEWAY_PATH } from "@t3tools/contracts/fork";

/**
 * A cold browser signs in through the Library: the Library signs a one-minute Ed25519 ticket for
 * one exact host and one nonce, and the host trades it for its own cookie. The nonce lives in a
 * host-only cookie set by the host's sign-in page, so a ticket taken from a URL is useless in any
 * other browser.
 */
export const PREVIEW_TICKET_PATH = `${PREVIEW_LINK_GATEWAY_PATH}ticket`;
const PREVIEW_TICKET_TYPE = "loom-preview-ticket+jwt";
const PREVIEW_TICKET_TTL_SECONDS = 60;
export const PREVIEW_NONCE_COOKIE_NAME = "__Host-loom_pv_n";
/** Long enough to finish a Pocket ID sign-in on the Library before the nonce lapses. */
export const PREVIEW_NONCE_MAX_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 30;
const MAX_TICKET_LENGTH = 2048;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface PreviewTicketKeyPair {
  /** PKCS #8 DER, base64url. */
  readonly privateKey: string;
  /** The raw 32-byte Ed25519 public key, base64url. */
  readonly publicKey: string;
}

export interface VerifiedPreviewTicket {
  readonly subject: string;
  readonly ticketId: string;
  readonly expiresAtMs: number;
}

export function generatePreviewTicketKeyPair(): PreviewTicketKeyPair {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("Ed25519 public key has no x coordinate.");
  return {
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKey: jwk.x,
  };
}

export function previewTicketPublicKey(raw: string): NodeCrypto.KeyObject | null {
  if (!SEGMENT_PATTERN.test(raw) || Buffer.from(raw, "base64url").length !== 32) return null;
  try {
    return NodeCrypto.createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: raw },
      format: "jwk",
    });
  } catch {
    return null;
  }
}

export function previewTicketPrivateKey(pkcs8: string): NodeCrypto.KeyObject | null {
  try {
    const key = NodeCrypto.createPrivateKey({
      key: Buffer.from(pkcs8, "base64url"),
      format: "der",
      type: "pkcs8",
    });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

/** A short, stable name for a public key, so a rotated key fails loudly instead of silently. */
export function previewTicketKeyId(publicKey: string): string {
  return NodeCrypto.createHash("sha256").update(publicKey).digest("base64url").slice(0, 16);
}

/** The audience every ticket names: exactly one host, never a wildcard or the Library. */
export function previewTicketAudience(host: string): string {
  return `https://${host}`;
}

export function randomPreviewNonce(): string {
  return NodeCrypto.randomBytes(32).toString("base64url");
}

export function isPreviewNonce(value: string | null | undefined): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

export function formatNonceSetCookie(nonce: string): string {
  return `${PREVIEW_NONCE_COOKIE_NAME}=${nonce}; Max-Age=${PREVIEW_NONCE_MAX_AGE_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export function formatNonceClearCookie(): string {
  return `${PREVIEW_NONCE_COOKIE_NAME}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

/** One cookie's value from Cookie headers; null when it is missing or appears more than once. */
export function readRequestCookie(
  cookies: ReadonlyArray<string> | string | undefined,
  name: string,
): string | null {
  const joined = typeof cookies === "string" ? cookies : (cookies ?? []).join(";");
  let found: string | null = null;
  for (const pair of joined.split(";")) {
    const trimmed = pair.replace(/^[ \t]+|[ \t]+$/g, "");
    const equals = trimmed.indexOf("=");
    if (equals === -1 || trimmed.slice(0, equals) !== name) continue;
    if (found !== null) return null;
    found = trimmed.slice(equals + 1);
  }
  return found;
}

const encodeSegment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function signPreviewTicket(input: {
  readonly privateKey: NodeCrypto.KeyObject;
  readonly keyId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly subject: string;
  readonly nonce: string;
  readonly nowMs: number;
}): string {
  const iat = Math.floor(input.nowMs / 1000);
  const header = encodeSegment({ alg: "EdDSA", typ: PREVIEW_TICKET_TYPE, kid: input.keyId });
  const payload = encodeSegment({
    iss: input.issuer,
    aud: input.audience,
    sub: input.subject,
    nonce: input.nonce,
    iat,
    exp: iat + PREVIEW_TICKET_TTL_SECONDS,
    jti: NodeCrypto.randomUUID(),
  });
  const signature = NodeCrypto.sign(
    null,
    Buffer.from(`${header}.${payload}`),
    input.privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const decodeSegment = (segment: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** Null for anything but a fresh ticket for this exact issuer, key, host and nonce. */
export function verifyPreviewTicket(
  token: string,
  expected: {
    readonly publicKey: NodeCrypto.KeyObject;
    readonly keyId: string;
    readonly issuer: string;
    readonly audience: string;
    readonly nonce: string;
    readonly nowMs: number;
    /**
     * When the verifying process started. Spent tickets are remembered in memory only, so a
     * ticket signed before then may already have been redeemed by the previous process.
     */
    readonly notBeforeMs?: number;
  },
): VerifiedPreviewTicket | null {
  if (token.length > MAX_TICKET_LENGTH) return null;
  const segments = token.split(".");
  if (segments.length !== 3 || !segments.every((segment) => SEGMENT_PATTERN.test(segment))) {
    return null;
  }
  const [headerSegment = "", payloadSegment = "", signatureSegment = ""] = segments;
  const header = decodeSegment(headerSegment);
  if (
    header === null ||
    header.alg !== "EdDSA" ||
    header.typ !== PREVIEW_TICKET_TYPE ||
    header.kid !== expected.keyId
  ) {
    return null;
  }
  let valid = false;
  try {
    valid = NodeCrypto.verify(
      null,
      Buffer.from(`${headerSegment}.${payloadSegment}`),
      expected.publicKey,
      Buffer.from(signatureSegment, "base64url"),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  const claims = decodeSegment(payloadSegment);
  if (claims === null) return null;
  const { iss, aud, sub, nonce, iat, exp, jti } = claims;
  if (iss !== expected.issuer || aud !== expected.audience || nonce !== expected.nonce) return null;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 256) return null;
  if (typeof jti !== "string" || jti.length === 0 || jti.length > 64) return null;
  if (typeof iat !== "number" || typeof exp !== "number") return null;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  if (exp <= iat || exp - iat > PREVIEW_TICKET_TTL_SECONDS) return null;
  const now = Math.floor(expected.nowMs / 1000);
  if (iat > now + CLOCK_SKEW_SECONDS || exp < now - CLOCK_SKEW_SECONDS) return null;
  // Compared in whole seconds like `iat`, so a ticket signed just after start still counts.
  if (expected.notBeforeMs !== undefined && iat < Math.floor(expected.notBeforeMs / 1000))
    return null;
  return { subject: sub, ticketId: jti, expiresAtMs: exp * 1000 };
}
