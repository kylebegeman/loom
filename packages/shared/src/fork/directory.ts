import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import {
  DIRECTORY_ROUTE_URL_MAX_LENGTH,
  DirectoryEnvironmentReport,
  LoomOsIdentityPayload,
  type LoomOsSignedIdentity,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Hex from "effect/encoding/Hex";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { RelayJwtError, signRelayJwt, verifyRelayJwt } from "../relayJwt.ts";

/** Distinct from every relay typ, so neither kind of proof can be replayed as the other. */
export const DIRECTORY_REPORT_TYP = "loom-directory-report+jwt";
const DIRECTORY_REPORT_LIFETIME_SECONDS = 300;

// RFC 8410 SubjectPublicKeyInfo for Ed25519: this prefix, then the 32-byte public key.
const ED25519_SPKI_PREFIX = Hex.decode("302a300506032b6570032100").pipe(Result.getOrThrow);
const ED25519_SPKI_LENGTH = ED25519_SPKI_PREFIX.length + 32;
const ED25519_SIGNATURE_LENGTH = 64;

const ROUTE_URL =
  /^https:\/\/([a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?(\/(?:[A-Za-z0-9._~/-]|%[0-9A-Fa-f]{2})*)?$/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
// The WHATWG URL parser reads a host whose last label is a number as IPv4 (`127.1`, `0x7f.1`).
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/u;

/**
 * The one route rule: `https:` with a lowercase DNS name of at least two labels, an optional
 * port and a plain path. It refuses IP literals in every form, `localhost`, userinfo, query and
 * fragment. A regular expression rather than `URL`, so React Native and Node agree.
 */
export function isDirectoryRouteUrl(url: string): boolean {
  if (url.length > DIRECTORY_ROUTE_URL_MAX_LENGTH) return false;
  const match = ROUTE_URL.exec(url);
  if (match === null) return false;
  const [, host = "", port] = match;
  if (port !== undefined && Number(port) > 65_535) return false;
  if (host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => DNS_LABEL.test(label))) return false;
  if (labels.includes("localhost")) return false;
  return !NUMERIC_LABEL.test(labels.at(-1) ?? "");
}

/** SHA-256 of a DER public key in hex, matching LoomOS `public_fingerprint`. */
export function keyFingerprint(spkiDer: Uint8Array): string {
  return Hex.encode(sha256(spkiDer));
}

function decodeCanonicalBase64(value: string): Uint8Array | null {
  const decoded = Base64.decode(value);
  if (Result.isFailure(decoded) || Base64.encode(decoded.success) !== value) return null;
  return decoded.success;
}

/** Decodes a base64 DER Ed25519 public key, refusing any other key type or encoding. */
export function decodeEd25519PublicKey(publicKey: string): Uint8Array | null {
  const der = decodeCanonicalBase64(publicKey);
  if (der === null || der.length !== ED25519_SPKI_LENGTH) return null;
  return ED25519_SPKI_PREFIX.every((byte, index) => der[index] === byte) ? der : null;
}

/** The base64 DER form of an Ed25519 public key PEM, as a report post carries it. */
export function directoryPublicKeyFromPem(pem: string): string | null {
  const match = /^-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----$/u.exec(
    pem.replace(/\\n/gu, "\n").trim(),
  );
  const body = match?.[1]?.replace(/\s/gu, "") ?? "";
  return decodeEd25519PublicKey(body) === null ? null : body;
}

function publicKeyPem(publicKey: string): string | null {
  return decodeEd25519PublicKey(publicKey) === null
    ? null
    : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----\n`;
}

function directoryAudience(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

const directoryIssuer = (environmentId: string) => `loom-env:${environmentId}`;

export class DirectoryReportError extends Schema.TaggedError<DirectoryReportError>()(
  "DirectoryReportError",
  {
    operation: Schema.Literals(["sign", "verify"]),
    reason: Schema.Literals([
      "invalid-audience",
      "invalid-key",
      "invalid-report",
      "unverified",
      "wrong-environment",
    ]),
    /** The jose error code behind the failure, for logs. */
    diagnostic: Schema.optional(Schema.String),
    /**
     * Set only when signing. A refused report's jose and schema errors carry its decoded claims,
     * and those name hosts the directory must not log.
     */
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} directory report: ${this.reason}.`;
  }
}

const encodeReport = Schema.encodeEffect(DirectoryEnvironmentReport);
const decodeReport = Schema.decodeUnknownEffect(DirectoryEnvironmentReport);

/** Signs a report with the environment's Ed25519 private key (PKCS#8 PEM) for one directory. */
export function signDirectoryReport(input: {
  readonly privateKey: string;
  readonly report: DirectoryEnvironmentReport;
  /** The directory's URL; only its origin is signed. */
  readonly audience: string;
  readonly nowEpochSeconds: number;
}): Effect.Effect<string, DirectoryReportError> {
  return Effect.gen(function* () {
    const audience = directoryAudience(input.audience);
    if (audience === null) {
      return yield* new DirectoryReportError({ operation: "sign", reason: "invalid-audience" });
    }
    const report = yield* encodeReport(input.report).pipe(
      Effect.mapError(
        (cause) => new DirectoryReportError({ operation: "sign", reason: "invalid-report", cause }),
      ),
    );
    const iat = Math.floor(input.nowEpochSeconds);
    return yield* signRelayJwt({
      privateKey: input.privateKey,
      typ: DIRECTORY_REPORT_TYP,
      payload: {
        iss: directoryIssuer(report.environmentId),
        sub: report.environmentId,
        aud: audience,
        iat,
        exp: iat + DIRECTORY_REPORT_LIFETIME_SECONDS,
        report,
      },
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DirectoryReportError({
            operation: "sign",
            reason: "invalid-key",
            diagnostic: RelayJwtError.diagnosticCode(cause),
            cause,
          }),
      ),
    );
  });
}

const isIssuerClaimFailure = (error: RelayJwtError) =>
  Predicate.isObject(error.cause) &&
  Predicate.hasProperty(error.cause, "claim") &&
  error.cause.claim === "iss";

/**
 * Verifies a report token against the environment's public key (base64 DER SPKI) and the
 * environment the caller expects, then decodes the report it carries.
 */
export function verifyDirectoryReport(input: {
  readonly publicKey: string;
  readonly token: string;
  readonly environmentId: string;
  /** This directory's URL; only its origin is compared. */
  readonly audience: string;
  readonly nowEpochSeconds: number;
}): Effect.Effect<DirectoryEnvironmentReport, DirectoryReportError> {
  const fail = (reason: DirectoryReportError["reason"], diagnostic?: string) =>
    new DirectoryReportError({ operation: "verify", reason, diagnostic });
  return Effect.gen(function* () {
    const audience = directoryAudience(input.audience);
    if (audience === null) return yield* fail("invalid-audience");
    const publicKey = publicKeyPem(input.publicKey);
    if (publicKey === null) return yield* fail("invalid-key");
    const claims = yield* verifyRelayJwt({
      publicKey,
      token: input.token,
      typ: DIRECTORY_REPORT_TYP,
      issuer: directoryIssuer(input.environmentId),
      audience,
      nowEpochSeconds: input.nowEpochSeconds,
      maxTokenAge: DIRECTORY_REPORT_LIFETIME_SECONDS,
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
    if (claims.sub !== input.environmentId) return yield* fail("wrong-environment");
    const report = yield* decodeReport(claims.report).pipe(
      Effect.mapError(() => fail("invalid-report")),
    );
    if (report.environmentId !== input.environmentId) return yield* fail("wrong-environment");
    return report;
  });
}

/** Carries no cause: payload decode errors echo the machine's hostname. */
export class LoomOsIdentityError extends Schema.TaggedError<LoomOsIdentityError>()(
  "LoomOsIdentityError",
  {
    reason: Schema.Literals([
      "malformed",
      "unverified",
      "invalid-payload",
      "unsupported-version",
      "key-mismatch",
    ]),
  },
) {
  override get message(): string {
    return `LoomOS identity rejected: ${this.reason}.`;
  }
}

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeIdentityPayload = Schema.decodeUnknownEffect(LoomOsIdentityPayload);

/**
 * Verifies a LoomOS signed identity over the payload bytes exactly as received, then checks that
 * the payload names the key that signed it. Payloads are never re-serialized, so Python and
 * TypeScript never need to agree on canonical JSON.
 */
export function verifyLoomOsIdentity(
  identity: LoomOsSignedIdentity,
): Effect.Effect<LoomOsIdentityPayload, LoomOsIdentityError> {
  const fail = (reason: LoomOsIdentityError["reason"]) => new LoomOsIdentityError({ reason });
  return Effect.gen(function* () {
    const publicKey = decodeEd25519PublicKey(identity.public_key);
    const signature = decodeCanonicalBase64(identity.signature);
    if (publicKey === null || signature?.length !== ED25519_SIGNATURE_LENGTH) {
      return yield* fail("malformed");
    }
    // zip215 off is strict RFC 8032 verification, as OpenSSL performs it.
    const verified = ed25519.verify(
      signature,
      new TextEncoder().encode(identity.payload),
      publicKey.subarray(ED25519_SPKI_PREFIX.length),
      { zip215: false },
    );
    if (!verified) return yield* fail("unverified");
    const parsed = yield* decodeJson(identity.payload).pipe(
      Effect.mapError(() => fail("invalid-payload")),
    );
    if (!Predicate.isObject(parsed) || !Predicate.hasProperty(parsed, "schema_version")) {
      return yield* fail("invalid-payload");
    }
    if (parsed.schema_version !== 1) return yield* fail("unsupported-version");
    const payload = yield* decodeIdentityPayload(parsed).pipe(
      Effect.mapError(() => fail("invalid-payload")),
    );
    if (
      payload.machine_key.public_key !== identity.public_key ||
      payload.machine_key.fingerprint !== keyFingerprint(publicKey)
    ) {
      return yield* fail("key-mismatch");
    }
    return payload;
  });
}
