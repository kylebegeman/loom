import { type ReachCredentialState, isLoomDesktopRedirectUri } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isReachZone } from "@t3tools/shared/fork/reach";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { httpsOrigin } from "../../directory/advertised.ts";
import { isLibraryAuthorityEnv } from "../../project-library/authority.ts";

const CREDENTIAL_MAX_BYTES = 16_384n;

type Env = Readonly<Record<string, string | undefined>>;

const nonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
};

/** A valid `LOOM_REACH_ZONE`, or null while it is unset or invalid. */
export const reachZoneFromEnv = (env: Env): string | null => {
  const zone = nonEmpty(env.LOOM_REACH_ZONE);
  return zone !== null && isReachZone(zone) ? zone : null;
};

/**
 * What the Library reads from its environment at start. Only paths and public values: the
 * credentials themselves stay in their files and are read on every call, so rotating one needs
 * no restart.
 */
export interface ReachLibraryConfig {
  /** The Library's public origin, as its directory audience; null off the authority. */
  readonly audience: string | null;
  readonly zone: string | null;
  readonly cloudflareTokenFile: string | null;
  readonly identity: {
    /** The Pocket ID issuer, whose origin also serves its admin API. */
    readonly issuer: string | null;
    readonly nativeClientId: string | null;
    /** The native client's registered desktop callback, or null while it is unset or invalid. */
    readonly desktopRedirectUri: string | null;
    readonly adminKeyFile: string | null;
  };
}

export const reachLibraryConfig = (env: Env): ReachLibraryConfig => {
  const issuer = nonEmpty(env.LOOM_IDENTITY_ISSUER);
  const desktopRedirectUri = nonEmpty(env.LOOM_IDENTITY_DESKTOP_REDIRECT_URI);
  return {
    audience: isLibraryAuthorityEnv(env) ? httpsOrigin(env.LOOM_IDENTITY_REDIRECT_URI ?? "") : null,
    zone: reachZoneFromEnv(env),
    cloudflareTokenFile: nonEmpty(env.LOOM_REACH_CLOUDFLARE_TOKEN_FILE),
    identity: {
      issuer: issuer !== null && httpsOrigin(issuer) !== null ? issuer : null,
      nativeClientId: nonEmpty(env.LOOM_IDENTITY_NATIVE_CLIENT_ID),
      desktopRedirectUri:
        desktopRedirectUri !== null && isLoomDesktopRedirectUri(desktopRedirectUri)
          ? desktopRedirectUri
          : null,
      adminKeyFile: nonEmpty(env.LOOM_IDENTITY_ADMIN_API_KEY_FILE),
    },
  };
};

/** Carries no path or contents, so it is safe to log and to map onto a wire reason. */
export class ReachCredentialError extends Schema.TaggedError<ReachCredentialError>()(
  "ReachCredentialError",
  { reason: Schema.Literals(["missing", "refused"]) },
) {
  override get message(): string {
    return this.reason === "missing"
      ? "The reach credential file is not set or does not exist."
      : "The reach credential file must be a private regular file holding one value.";
  }
}

/**
 * The checks the OpenBao token file gets: a regular file no group or other user can read, at most
 * 16 KiB, holding one value with no inner whitespace.
 */
export const readReachCredential = Effect.fn("ReachCredentials.read")(function* (
  file: string | null,
) {
  if (file === null) return yield* new ReachCredentialError({ reason: "missing" });
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const refused = new ReachCredentialError({ reason: "refused" });
  const stat = yield* fs
    .stat(file)
    .pipe(
      Effect.mapError((error) =>
        error.reason._tag === "NotFound"
          ? new ReachCredentialError({ reason: "missing" })
          : refused,
      ),
    );
  if (
    stat.type !== "File" ||
    ByteSize.toBigInt(stat.size) > CREDENTIAL_MAX_BYTES ||
    (platform !== "win32" && (stat.mode & 0o077) !== 0)
  ) {
    return yield* refused;
  }
  const value = (yield* fs.readFileString(file).pipe(Effect.mapError(() => refused))).trim();
  if (value.length === 0 || /\s/u.test(value)) return yield* refused;
  return Redacted.make(value);
});

/** The file half of a credential state; the caller folds in how its last call went. */
export const credentialFileState = (file: string | null) =>
  readReachCredential(file).pipe(
    Effect.as<ReachCredentialState>("ready"),
    Effect.catchTags({
      ReachCredentialError: (error) => Effect.succeed<ReachCredentialState>(error.reason),
    }),
  );
