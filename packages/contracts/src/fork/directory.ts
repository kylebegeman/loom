import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { ProviderInstanceId } from "../providerInstance.ts";
import { ServerProviderState } from "../server.ts";

/** Advertised in `loomFeatures` by the Library authority that runs the directory. */
export const DIRECTORY_FEATURE = "directory";
/** Advertised by every computer that reports itself and answers `loom.directory.reporting`. */
export const DIRECTORY_REPORTING_FEATURE = "directory-reporting";
export const DIRECTORY_MAX_ROUTES = 8;
export const DIRECTORY_MAX_PROVIDERS = 16;
export const DIRECTORY_MAX_WORKERS = 8;
export const DIRECTORY_ROUTE_URL_MAX_LENGTH = 2048;
export const LOOM_OS_IDENTITY_PAYLOAD_MAX_LENGTH = 8192;
/** Fits every bounded report field at its limit, escaped and base64url encoded, with room to spare. */
export const DIRECTORY_REPORT_TOKEN_MAX_LENGTH = 1_048_576;

const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
/** Base64 DER SubjectPublicKeyInfo. Verifiers decode it strictly; this only bounds the text. */
const PublicKeyBase64 = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128));

export const DirectoryRouteKind = Schema.Literals(["public", "tailnet"]);
export type DirectoryRouteKind = typeof DirectoryRouteKind.Type;
/** Checked with `isDirectoryRouteUrl` from `@t3tools/shared/fork/directory` at every boundary. */
export const DirectoryRoute = Schema.Struct({
  kind: DirectoryRouteKind,
  url: Schema.String.check(Schema.isMaxLength(DIRECTORY_ROUTE_URL_MAX_LENGTH)),
});
export type DirectoryRoute = typeof DirectoryRoute.Type;

export const DirectoryProviderStatus = Schema.Struct({
  id: ProviderInstanceId,
  status: ServerProviderState,
});
export type DirectoryProviderStatus = typeof DirectoryProviderStatus.Type;

/**
 * A LoomOS signed identity exactly as the worker hands it over. The names are LoomOS wire names:
 * the envelope travels unchanged from the worker to the directory, and the signature covers
 * `payload`'s bytes as received, so nothing ever re-serializes it.
 */
export const LoomOsSignedIdentity = Schema.Struct({
  payload: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(LOOM_OS_IDENTITY_PAYLOAD_MAX_LENGTH),
  ),
  /** Base64 of the 64-byte Ed25519 signature over the UTF-8 payload. */
  signature: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  public_key: PublicKeyBase64,
});
export type LoomOsSignedIdentity = typeof LoomOsSignedIdentity.Type;

/** The parts of `/etc/loom-os/release.json` Loom reads. Other keys are ignored. */
export const LoomOsRelease = Schema.Struct({
  version: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
  target: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
  roles: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(32))).check(Schema.isMaxLength(16)),
  ),
  runtime_version: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
});
export type LoomOsRelease = typeof LoomOsRelease.Type;

export const LoomOsMachineKey = Schema.Struct({
  algorithm: Schema.Literal("ed25519"),
  public_key: PublicKeyBase64,
  /** SHA-256 of the DER public key in hex, as LoomOS `public_fingerprint` computes it. */
  fingerprint: Sha256Hex,
});
export type LoomOsMachineKey = typeof LoomOsMachineKey.Type;

/** `loom-os identity` output plus `issued_at`, in LoomOS snake_case. Unknown keys are ignored. */
export const LoomOsIdentityPayload = Schema.Struct({
  schema_version: Schema.Literal(1),
  release: Schema.NullOr(LoomOsRelease),
  installation_id: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  boot_id: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  hostname: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(253)),
  machine_key: LoomOsMachineKey,
  /** The `SHA256:` forms `ssh-keygen -lf` prints for the machine's host keys. */
  ssh_host_key_fingerprints: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(16)),
  ),
  tailnet_name: Schema.optional(Schema.String.check(Schema.isMaxLength(253))),
  issued_at: IsoDateTime,
});
export type LoomOsIdentityPayload = typeof LoomOsIdentityPayload.Type;

const DirectoryEnvironmentFields = {
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  serverVersion: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  platform: Schema.Struct({
    os: Schema.String.check(Schema.isMaxLength(32)),
    arch: Schema.String.check(Schema.isMaxLength(32)),
  }),
  supportsExecution: Schema.Boolean,
  loomFeatures: Schema.Array(Schema.String.check(Schema.isMaxLength(64))).check(
    Schema.isMaxLength(256),
  ),
  routes: Schema.Array(DirectoryRoute).check(Schema.isMaxLength(DIRECTORY_MAX_ROUTES)),
  providers: Schema.Array(DirectoryProviderStatus).check(
    Schema.isMaxLength(DIRECTORY_MAX_PROVIDERS),
  ),
  /**
   * Only ever grows for one environment, so a replayed report cannot roll a record back. The
   * report time in milliseconds works and survives a restart without stored state.
   */
  sequence: NonNegativeInt,
  reportedAt: IsoDateTime,
};

/** What a computer signs with its environment key and posts to the directory. */
export const DirectoryEnvironmentReport = Schema.Struct({
  ...DirectoryEnvironmentFields,
  /** Signed LoomOS identities from this computer's enabled Mini workers, carried as received. */
  workers: Schema.optional(
    Schema.Array(LoomOsSignedIdentity).check(Schema.isMaxLength(DIRECTORY_MAX_WORKERS)),
  ),
});
export type DirectoryEnvironmentReport = typeof DirectoryEnvironmentReport.Type;

/**
 * The body of a report post. The public key always travels with the token, so the directory can
 * tell a changed key from a bad signature and answer `key-changed`.
 */
export const DirectoryReportRequest = Schema.Struct({
  token: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(DIRECTORY_REPORT_TOKEN_MAX_LENGTH),
  ),
  /** The environment's Ed25519 public key as base64 DER SPKI. */
  publicKey: PublicKeyBase64,
});
export type DirectoryReportRequest = typeof DirectoryReportRequest.Type;

/** The latest verified report. Its workers live on as `DirectoryMachine` entries. */
export const DirectoryEnvironment = Schema.Struct({
  ...DirectoryEnvironmentFields,
  keyFingerprint: Sha256Hex,
  firstSeenAt: IsoDateTime,
  receivedAt: IsoDateTime,
  /**
   * The Loom Identity resource this Library derived and provisioned for the computer. Attested by
   * the Library, never taken from the computer's report, so clients can refuse a computer that
   * names another computer's resource. Absent until reach provisioned it, and from older Libraries.
   */
  identityResource: Schema.optionalKey(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(DIRECTORY_ROUTE_URL_MAX_LENGTH)),
  ),
});
export type DirectoryEnvironment = typeof DirectoryEnvironment.Type;

/** A LoomOS machine, keyed by its machine key and known from verified identities only. */
export const DirectoryMachine = Schema.Struct({
  keyFingerprint: Sha256Hex,
  installationId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  hostname: Schema.String.check(Schema.isMaxLength(253)),
  tailnetName: Schema.optional(Schema.String.check(Schema.isMaxLength(253))),
  release: Schema.NullOr(LoomOsRelease),
  sshHostKeyFingerprints: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(16)),
  ),
  /** The environment whose report last carried this machine. */
  reportedBy: EnvironmentId,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type DirectoryMachine = typeof DirectoryMachine.Type;

export const DirectoryListing = Schema.Struct({
  environments: Schema.Array(DirectoryEnvironment),
  machines: Schema.Array(DirectoryMachine),
  generatedAt: IsoDateTime,
});
export type DirectoryListing = typeof DirectoryListing.Type;

export class DirectoryError extends Schema.TaggedError<DirectoryError>()("DirectoryError", {
  reason: Schema.Literals([
    "not-authority",
    "invalid",
    "unverified",
    "wrong-environment",
    "key-changed",
    "stale-sequence",
    "not-found",
    // Forgetting would drop the key pin that guards a live reach address.
    "reach-active",
    "io",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "not-authority":
        return "This computer does not run the directory. Use your Library connection to reach it.";
      case "invalid":
        return "The directory could not read that report.";
      case "unverified":
        return "The directory could not verify that report's signature, audience or age.";
      case "wrong-environment":
        return "That report names a different computer than the one sending it.";
      case "key-changed":
        return "This computer's signing key changed since the directory first saw it. Forget the computer in the directory to accept its new key.";
      case "stale-sequence":
        return "The directory already has a newer report from this computer.";
      case "not-found":
        return "The directory has no entry with that id.";
      case "reach-active":
        return "This computer still has a reach address. Retire it in the Library's reach list first, then forget the computer.";
      case "io":
        return "The directory could not store or read its records. Try again.";
    }
  }
}

/** Forgetting an environment drops its pinned key, so its next report pins whatever key it sends. */
export const DirectoryForgetRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("environment"), environmentId: EnvironmentId }),
  Schema.Struct({ kind: Schema.Literal("machine"), keyFingerprint: Sha256Hex }),
]);
export type DirectoryForgetRequest = typeof DirectoryForgetRequest.Type;

/**
 * How this computer's reports to its Library's directory are going. `off` has no Library to
 * report to or is the directory itself, `unsupported` has a Library without the directory,
 * `key-changed` has stopped until the computer is forgotten in the directory, and `signed-out` has
 * stopped because the computer's Library sign-in is missing, expired or refused.
 */
export const DirectoryReporting = Schema.Struct({
  state: Schema.Literals([
    "off",
    "unsupported",
    "reporting",
    "retrying",
    "key-changed",
    "signed-out",
  ]),
  lastReportedAt: Schema.NullOr(IsoDateTime),
  /** Why the last report failed, while `retrying`. */
  reason: Schema.optional(
    Schema.Literals(["io", "invalid", "unverified", "wrong-environment", "stale-sequence"]),
  ),
});
export type DirectoryReporting = typeof DirectoryReporting.Type;

export const DIRECTORY_WS_METHODS = {
  list: "loom.directory.list",
  forget: "loom.directory.forget",
  reporting: "loom.directory.reporting",
} as const;
const error = Schema.Union([DirectoryError, EnvironmentAuthorizationError]);
export const DirectoryRpcGroup = RpcGroup.make(
  Rpc.make(DIRECTORY_WS_METHODS.list, {
    payload: Schema.Struct({}),
    success: DirectoryListing,
    error,
  }),
  Rpc.make(DIRECTORY_WS_METHODS.forget, {
    payload: DirectoryForgetRequest,
    success: Schema.Void,
    error,
  }),
  Rpc.make(DIRECTORY_WS_METHODS.reporting, {
    payload: Schema.Struct({}),
    success: DirectoryReporting,
    error: EnvironmentAuthorizationError,
  }),
);
