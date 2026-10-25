import { AuthLibraryRecoveryReadScope, EnvironmentId } from "@t3tools/contracts";
import { LibraryError, LibraryRecoveryGrant } from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Schema from "effect/Schema";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";

const subjectPrefix = "loom-library-recovery:";
const sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Claims = Schema.Struct({
  descriptorDigest: sha256,
  sourceEnvironmentId: EnvironmentId,
  copyId: Schema.String,
  sha256,
  byteLength: Schema.Int,
  projectId: Schema.String,
  projectRevision: Schema.Int,
  destinationEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  expiresAt: Schema.String,
});
const encodeClaims = Schema.encodeEffect(Schema.fromJsonString(Claims));
const decodeClaims = Schema.decodeEffect(Schema.fromJsonString(Claims));
const encodeDescriptor = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      sourceCopy: LibraryRecoveryGrant.fields.sourceCopy,
      destinationEnvironmentId: LibraryRecoveryGrant.fields.destinationEnvironmentId,
      libraryEnvironmentId: LibraryRecoveryGrant.fields.libraryEnvironmentId,
      expiresAt: LibraryRecoveryGrant.fields.expiresAt,
    }),
  ),
);
const json = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeSync(json);
const encodeJson = Schema.encodeSync(json);
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;

export const recoveryDescriptorDigest = Effect.fn("LibraryRecoveryGrant.digest")(function* (
  grant: Omit<LibraryRecoveryGrant, "accessToken">,
) {
  const encoded = yield* encodeDescriptor(grant).pipe(
    Effect.mapError(() => new LibraryError({ reason: "invalid" })),
  );
  return Hex.encode(
    yield* (yield* Crypto.Crypto)
      .digest("SHA-256", new TextEncoder().encode(encodeJson(canonical(decodeJson(encoded)))))
      .pipe(Effect.mapError(() => new LibraryError({ reason: "io" }))),
  );
});

export const recoveryGrantSubject = Effect.fn("LibraryRecoveryGrant.subject")(function* (
  grant: Omit<LibraryRecoveryGrant, "accessToken">,
) {
  const copy = grant.sourceCopy;
  if (copy.recovery === undefined) return yield* new LibraryError({ reason: "archive-unverified" });
  return (
    subjectPrefix +
    Base64Url.encode(
      yield* encodeClaims({
        descriptorDigest: yield* recoveryDescriptorDigest(grant),
        sourceEnvironmentId: copy.environmentId,
        copyId: copy.id,
        sha256: copy.recovery.sha256,
        byteLength: copy.recovery.byteLength,
        projectId: copy.projectId,
        projectRevision: copy.projectRevision,
        destinationEnvironmentId: grant.destinationEnvironmentId,
        libraryEnvironmentId: grant.libraryEnvironmentId,
        expiresAt: grant.expiresAt,
      }).pipe(Effect.mapError(() => new LibraryError({ reason: "invalid" }))),
    )
  );
});

/** Grants last minutes and name exact files, so a refused one is replaced, never retried. */
export const recoveryGrantRefused = () =>
  new LibraryError({
    reason: "blocked",
    detail:
      "This restore authorization expired or does not match these saved files. Start the restore again to get a new one.",
  });

export const readRecoveryGrantClaims = Effect.fn("LibraryRecoveryGrant.readClaims")(function* (
  session: Pick<AuthenticatedSession, "subject" | "scopes" | "expiresAt">,
) {
  if (
    !session.scopes.includes(AuthLibraryRecoveryReadScope) ||
    !session.subject.startsWith(subjectPrefix)
  )
    return yield* recoveryGrantRefused();
  const claims = yield* Effect.fromResult(
    Base64Url.decodeString(session.subject.slice(subjectPrefix.length)),
  ).pipe(Effect.flatMap(decodeClaims), Effect.mapError(recoveryGrantRefused));
  if (
    session.expiresAt === undefined ||
    session.expiresAt.epochMilliseconds !== Date.parse(claims.expiresAt)
  )
    return yield* recoveryGrantRefused();
  return claims;
});
