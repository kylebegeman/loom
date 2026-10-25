import { REACH_LIST_ROUTE, ReachLibraryListing, ReachLibraryError } from "@t3tools/contracts/fork";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  DIRECTORY_MAX_PROVIDERS,
  DirectoryEnvironment,
  DirectoryError,
  type DirectoryForgetRequest,
  DirectoryListing,
  DirectoryMachine,
  type DirectoryReportRequest,
  type LoomOsIdentityPayload,
} from "@t3tools/contracts/fork";
import {
  type DirectoryReportError,
  decodeEd25519PublicKey,
  directoryPublicKeyFromPem,
  isDirectoryRouteUrl,
  keyFingerprint,
  verifyDirectoryReport,
  verifyLoomOsIdentity,
} from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClientRequest } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import {
  ReachStore,
  type ReachStoredComputer,
  isReachActive,
  readyHostname,
} from "../reach/library/ReachStore.ts";
import { httpsOrigin } from "./advertised.ts";

export const DIRECTORY_REPORT_ROUTE = "/api/loom/directory/report";
export const DIRECTORY_LIST_ROUTE = "/api/loom/directory/list";

// Created with IF NOT EXISTS because parallel packets renumber this migration at merge.
export const DIRECTORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS fork_directory_environments (environment_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, key_fingerprint TEXT NOT NULL, sequence INTEGER NOT NULL, payload_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, received_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS fork_directory_machines (key_fingerprint TEXT PRIMARY KEY, reported_by TEXT NOT NULL, payload_json TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
] as const;

/** What the directory pinned for a computer: the key its reports verify against. */
export interface DirectoryPin {
  /** Base64 DER SPKI, as the first report carried it. */
  readonly publicKey: string;
  readonly keyFingerprint: string;
  /** The label of its newest stored report, or null when that payload no longer decodes. */
  readonly label: string | null;
}

export class DirectoryService extends Context.Service<
  DirectoryService,
  {
    /** Verifies and stores one computer's signed report. Only the Library authority stores. */
    readonly report: (input: {
      /** The computer the publisher session speaks for, never a value from the body. */
      readonly environmentId: EnvironmentId;
      readonly request: DirectoryReportRequest;
    }) => Effect.Effect<DirectoryEnvironment, DirectoryError>;
    /** The authority's own records, with itself first. */
    readonly list: Effect.Effect<DirectoryListing, DirectoryError>;
    /**
     * Removes a record. An environment's next report then pins whatever key it signs with, so a
     * computer with a live reach address is refused until the Library retires that address.
     */
    readonly forget: (request: DirectoryForgetRequest) => Effect.Effect<void, DirectoryError>;
    /** The pinned key of one computer, or null when the directory has none. */
    readonly pinned: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<DirectoryPin | null, DirectoryError>;
    /** The listing wherever the directory runs: here on the authority, else asked of it. */
    readonly computers: Effect.Effect<DirectoryListing, DirectoryError>;
    readonly reachComputers: Effect.Effect<ReachLibraryListing, ReachLibraryError>;
  }
>()("t3/fork/directory/DirectoryService") {}

/** A worker clock this far ahead is still believed. */
const IDENTITY_CLOCK_SKEW_MS = 5 * 60_000;

const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const directoryError = (reason: DirectoryError["reason"], cause?: unknown) =>
  new DirectoryError({ reason, cause });

const REPORT_REASON = {
  "invalid-key": "invalid",
  "invalid-report": "invalid",
  "invalid-audience": "unverified",
  unverified: "unverified",
  "wrong-environment": "wrong-environment",
} as const satisfies Record<DirectoryReportError["reason"], DirectoryError["reason"]>;

const EnvironmentJson = Schema.fromJsonString(DirectoryEnvironment);
const MachineJson = Schema.fromJsonString(DirectoryMachine);
const encodeEnvironment = Schema.encodeEffect(EnvironmentJson);
const encodeMachine = Schema.encodeEffect(MachineJson);
const decodeEnvironment = Schema.decodeUnknownOption(EnvironmentJson);
const decodeMachine = Schema.decodeUnknownOption(MachineJson);
const decodeSelf = Schema.decodeUnknownOption(DirectoryEnvironment);
const decodeListing = Schema.decodeUnknownEffect(DirectoryListing);
const decodeRefusal = Schema.decodeUnknownEffect(
  Schema.Struct({ reason: DirectoryError.fields.reason }),
);

/**
 * A computer may publish a `public` route only as the reach hostname the Library recorded ready
 * for it, so a computer cannot point clients at a host it does not answer for.
 *
 * It goes only to the key that holds the reach pin. Retire clears the pin and lets the computer
 * be forgotten, so a new key that reports for the same id gets no public route until it sets
 * reach up itself.
 */
const withReach = (
  environment: DirectoryEnvironment,
  computer: ReachStoredComputer | undefined,
): DirectoryEnvironment => {
  const pinned = computer?.keyFingerprint === environment.keyFingerprint ? computer : undefined;
  const hostname = readyHostname(pinned);
  return {
    ...environment,
    routes: environment.routes.filter(
      (route) =>
        route.kind !== "public" || (hostname !== null && route.url === `https://${hostname}/`),
    ),
  };
};

const make = Effect.gen(function* () {
  const authority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  // Reports are signed for the Library's public origin, the one its identity callback names.
  // A computer signs for its Library URL's origin, so that URL must be this public origin too.
  const identityRedirect = yield* Config.String("LOOM_IDENTITY_REDIRECT_URI").pipe(Config.option);
  const audience =
    authority && Option.isSome(identityRedirect) ? httpsOrigin(identityRedirect.value) : null;
  if (authority && audience === null)
    yield* Effect.logWarning(
      "The directory is off: set LOOM_IDENTITY_REDIRECT_URI to the Library's public https URL.",
    );
  const sql = yield* SqlClient.SqlClient;
  const lock = yield* Semaphore.make(1);
  const descriptors = yield* Effect.serviceOption(ServerEnvironment);
  const secrets = yield* Effect.serviceOption(ServerSecretStore.ServerSecretStore);
  const providers = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  // Optional, so the directory runs without reach; reach depends on the directory, not back.
  const reach = yield* Effect.serviceOption(ReachStore);
  const libraryConnection = yield* LibraryConnection.LibraryConnectionService;

  const running = audience === null ? Effect.fail(directoryError("not-authority")) : Effect.void;
  const io = (cause: unknown) => directoryError("io", cause);
  const nowIso = Clock.currentTimeMillis.pipe(Effect.map(isoAt));

  const refuse = (
    environmentId: EnvironmentId,
    reason: DirectoryError["reason"],
    diagnostic?: string,
  ) =>
    Effect.logWarning("The directory refused a report.", {
      environmentId,
      reason,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    }).pipe(Effect.andThen(Effect.fail(directoryError(reason))));

  const report = Effect.fn("DirectoryService.report")(function* (input: {
    readonly environmentId: EnvironmentId;
    readonly request: DirectoryReportRequest;
  }) {
    yield* running;
    const { environmentId, request } = input;
    const now = yield* Clock.currentTimeMillis;
    const verified = yield* verifyDirectoryReport({
      publicKey: request.publicKey,
      token: request.token,
      environmentId,
      audience: audience ?? "",
      nowEpochSeconds: now / 1000,
    }).pipe(
      Effect.catch((error) => refuse(environmentId, REPORT_REASON[error.reason], error.diagnostic)),
    );
    const publicKey = decodeEd25519PublicKey(request.publicKey);
    if (publicKey === null) return yield* refuse(environmentId, "invalid");
    const fingerprint = keyFingerprint(publicKey);
    const receivedAt = isoAt(now);
    const workers: Array<{ readonly identity: LoomOsIdentityPayload; readonly issuedAt: number }> =
      [];
    for (const worker of verified.workers ?? []) {
      const identity = yield* verifyLoomOsIdentity(worker).pipe(
        Effect.map((payload) => ({ payload, issuedAt: Date.parse(payload.issued_at) })),
        Effect.filterOrFail(
          // Identities are ordered by issue time, so a future one would outrank every later one.
          ({ issuedAt }) => Number.isFinite(issuedAt) && issuedAt <= now + IDENTITY_CLOCK_SKEW_MS,
          () => ({ reason: "issued-at" }),
        ),
        Effect.tapError((error) =>
          Effect.logWarning("The directory skipped a worker identity.", {
            environmentId,
            reason: error.reason,
          }),
        ),
        Effect.option,
      );
      if (Option.isSome(identity))
        workers.push({ identity: identity.value.payload, issuedAt: identity.value.issuedAt });
    }
    const stored = yield* lock.withPermits(1)(
      sql
        .withTransaction(
          Effect.gen(function* () {
            const [existing] = yield* sql<{
              readonly key_fingerprint: string;
              readonly sequence: number;
              readonly first_seen_at: string;
            }>`SELECT key_fingerprint, sequence, first_seen_at FROM fork_directory_environments WHERE environment_id = ${environmentId}`;
            if (existing !== undefined && existing.key_fingerprint !== fingerprint)
              return { refused: "key-changed" as const };
            if (existing !== undefined && verified.sequence <= existing.sequence)
              return { refused: "stale-sequence" as const };
            const environment: DirectoryEnvironment = {
              environmentId: verified.environmentId,
              label: verified.label,
              serverVersion: verified.serverVersion,
              platform: verified.platform,
              supportsExecution: verified.supportsExecution,
              loomFeatures: verified.loomFeatures,
              // An IP route reaches one network only and names a machine to anyone who reads it.
              routes: verified.routes.filter((route) => isDirectoryRouteUrl(route.url)),
              providers: verified.providers,
              sequence: verified.sequence,
              reportedAt: verified.reportedAt,
              keyFingerprint: fingerprint,
              firstSeenAt: existing?.first_seen_at ?? receivedAt,
              receivedAt,
            };
            const payload = yield* encodeEnvironment(environment);
            yield* sql`INSERT INTO fork_directory_environments (environment_id, public_key, key_fingerprint, sequence, payload_json, first_seen_at, received_at) VALUES (${environmentId}, ${request.publicKey}, ${fingerprint}, ${verified.sequence}, ${payload}, ${environment.firstSeenAt}, ${receivedAt}) ON CONFLICT(environment_id) DO UPDATE SET public_key = excluded.public_key, key_fingerprint = excluded.key_fingerprint, sequence = excluded.sequence, payload_json = excluded.payload_json, received_at = excluded.received_at`;
            for (const { identity, issuedAt } of workers) {
              const lastSeenAt = isoAt(issuedAt);
              const machineFingerprint = identity.machine_key.fingerprint;
              const [known] = yield* sql<{
                readonly first_seen_at: string;
                readonly last_seen_at: string;
              }>`SELECT first_seen_at, last_seen_at FROM fork_directory_machines WHERE key_fingerprint = ${machineFingerprint}`;
              if (known !== undefined && Date.parse(known.last_seen_at) > issuedAt) continue;
              const machine: DirectoryMachine = {
                keyFingerprint: machineFingerprint,
                installationId: identity.installation_id,
                hostname: identity.hostname,
                ...(identity.tailnet_name === undefined
                  ? {}
                  : { tailnetName: identity.tailnet_name }),
                release: identity.release,
                ...(identity.ssh_host_key_fingerprints === undefined
                  ? {}
                  : { sshHostKeyFingerprints: identity.ssh_host_key_fingerprints }),
                reportedBy: environmentId,
                firstSeenAt: known?.first_seen_at ?? lastSeenAt,
                lastSeenAt,
              };
              const machinePayload = yield* encodeMachine(machine);
              yield* sql`INSERT INTO fork_directory_machines (key_fingerprint, reported_by, payload_json, first_seen_at, last_seen_at) VALUES (${machineFingerprint}, ${environmentId}, ${machinePayload}, ${machine.firstSeenAt}, ${lastSeenAt}) ON CONFLICT(key_fingerprint) DO UPDATE SET reported_by = excluded.reported_by, payload_json = excluded.payload_json, last_seen_at = excluded.last_seen_at`;
            }
            return { environment };
          }),
        )
        .pipe(Effect.mapError(io)),
    );
    if ("refused" in stored) return yield* refuse(environmentId, stored.refused);
    return stored.environment;
  });

  /** The authority itself, which reports to no one. Absent when it cannot describe itself. */
  const self = Effect.gen(function* () {
    if (Option.isNone(descriptors) || Option.isNone(secrets)) return null;
    const descriptor = yield* descriptors.value.getDescriptor;
    const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets.value).pipe(
      Effect.option,
    );
    const publicKey = Option.isSome(keyPair)
      ? directoryPublicKeyFromPem(keyPair.value.publicKey)
      : null;
    const der = publicKey === null ? null : decodeEd25519PublicKey(publicKey);
    if (der === null) return null;
    const now = yield* nowIso;
    const executes = descriptor.capabilities.supportsExecution !== false;
    const snapshot =
      executes && Option.isSome(providers) ? yield* providers.value.getProviders : [];
    const candidate = {
      environmentId: descriptor.environmentId,
      label: descriptor.label.slice(0, 160).trim(),
      serverVersion: descriptor.serverVersion.slice(0, 160).trim(),
      platform: { os: descriptor.platform.os, arch: descriptor.platform.arch },
      supportsExecution: executes,
      loomFeatures: descriptor.capabilities.loomFeatures ?? [],
      routes:
        audience !== null && isDirectoryRouteUrl(audience)
          ? [{ kind: "public", url: audience }]
          : [],
      providers: snapshot
        .slice(0, DIRECTORY_MAX_PROVIDERS)
        .map((provider) => ({ id: provider.instanceId, status: provider.status })),
      sequence: Date.parse(now),
      reportedAt: now,
      keyFingerprint: keyFingerprint(der),
      firstSeenAt: now,
      receivedAt: now,
    };
    return Option.getOrNull(decodeSelf(candidate));
  });

  const list = Effect.gen(function* () {
    yield* running;
    const [environmentRows, machineRows] = yield* Effect.all([
      sql<{
        readonly payload_json: string;
      }>`SELECT payload_json FROM fork_directory_environments ORDER BY received_at DESC, environment_id`,
      sql<{
        readonly payload_json: string;
      }>`SELECT payload_json FROM fork_directory_machines ORDER BY last_seen_at DESC, key_fingerprint`,
    ]).pipe(Effect.mapError(io));
    const own = yield* self;
    // Unreadable reach records attest nothing and keep no computer's public route.
    const reachRecords: Readonly<Record<string, ReachStoredComputer>> = Option.isSome(reach)
      ? yield* reach.value.read.pipe(
          Effect.map((state) => state.computers),
          Effect.orElseSucceed(() => ({})),
        )
      : {};
    const environments = environmentRows.flatMap((row) =>
      Option.toArray(decodeEnvironment(row.payload_json))
        .filter((environment) => environment.environmentId !== own?.environmentId)
        .map((environment) => withReach(environment, reachRecords[environment.environmentId])),
    );
    return {
      environments: own === null ? environments : [own, ...environments],
      machines: machineRows.flatMap((row) => Option.toArray(decodeMachine(row.payload_json))),
      generatedAt: yield* nowIso,
    } satisfies DirectoryListing;
  });

  const forget = Effect.fn("DirectoryService.forget")(function* (request: DirectoryForgetRequest) {
    yield* running;
    if (request.kind === "environment" && Option.isSome(reach)) {
      const state = yield* reach.value.read.pipe(Effect.mapError(io));
      if (isReachActive(state.computers[request.environmentId]))
        return yield* directoryError("reach-active");
    }
    const removed = yield* lock
      .withPermits(1)(
        request.kind === "environment"
          ? sql`DELETE FROM fork_directory_environments WHERE environment_id = ${request.environmentId} RETURNING environment_id`
          : sql`DELETE FROM fork_directory_machines WHERE key_fingerprint = ${request.keyFingerprint} RETURNING key_fingerprint`,
      )
      .pipe(Effect.mapError(io));
    if (removed.length === 0) return yield* directoryError("not-found");
  });

  const pinned = Effect.fn("DirectoryService.pinned")(function* (environmentId: EnvironmentId) {
    yield* running;
    const [row] = yield* sql<{
      readonly public_key: string;
      readonly key_fingerprint: string;
      readonly payload_json: string;
    }>`SELECT public_key, key_fingerprint, payload_json FROM fork_directory_environments WHERE environment_id = ${environmentId}`.pipe(
      Effect.mapError(io),
    );
    if (row === undefined) return null;
    return {
      publicKey: row.public_key,
      keyFingerprint: row.key_fingerprint,
      label: Option.match(decodeEnvironment(row.payload_json), {
        onNone: () => null,
        onSome: (environment) => environment.label,
      }),
    } satisfies DirectoryPin;
  });

  const forwarded = Effect.gen(function* () {
    const connection = yield* libraryConnection.current;
    if (connection === null || connection.kind === "none")
      return yield* directoryError("not-authority");
    if (connection.kind !== "remote") return yield* directoryError("io");
    const response = yield* connection
      .send(
        HttpClientRequest.post(connection.endpoint(DIRECTORY_LIST_ROUTE)).pipe(
          HttpClientRequest.bodyText("{}", "application/json"),
        ),
      )
      .pipe(Effect.mapError(io));
    // A Library older than the directory answers an unknown route 404 or with its web app.
    if (response.status === 404 || /^text\/html\b/i.test(response.headers["content-type"] ?? ""))
      return yield* directoryError("not-authority");
    if (response.status < 200 || response.status >= 300) {
      const refused = yield* response.json.pipe(Effect.flatMap(decodeRefusal), Effect.option);
      return yield* directoryError(Option.isSome(refused) ? refused.value.reason : "io");
    }
    return yield* response.json.pipe(Effect.flatMap(decodeListing), Effect.mapError(io));
  });

  return DirectoryService.of({
    report,
    list,
    forget,
    pinned,
    computers: authority ? list : forwarded,
    reachComputers: Effect.gen(function* () {
      const connection = yield* libraryConnection.current;
      if (connection.kind !== "remote")
        return yield* new ReachLibraryError({ reason: "not-authority" });
      const response = yield* connection
        .send(HttpClientRequest.post(connection.endpoint(REACH_LIST_ROUTE)))
        .pipe(Effect.mapError(() => new ReachLibraryError({ reason: "io" })));
      if (response.status === 404)
        return yield* new ReachLibraryError({ reason: "not-configured" });
      if (response.status !== 200) return yield* new ReachLibraryError({ reason: "io" });
      return yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReachLibraryListing)),
        Effect.mapError(() => new ReachLibraryError({ reason: "io" })),
      );
    }),
  });
});

export const layer = Layer.effect(DirectoryService, make).pipe(
  Layer.provide(LibraryConnection.layer),
);
