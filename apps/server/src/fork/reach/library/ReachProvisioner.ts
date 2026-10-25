import { AuthSessionId, EnvironmentId, PositiveInt } from "@t3tools/contracts";
import {
  type ReachAction,
  type ReachCredentialState,
  type ReachEnsureIdentity,
  type ReachEnsureReply,
  ReachFailureReason,
  type ReachLibraryComputer,
  ReachLibraryError,
  type ReachLibraryListing,
  type ReachRemoveReply,
  type ReachRequestBody,
  type ReachRequestClaims,
  type ReachRetireInput,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import {
  REACH_HOSTNAME_MAX_ATTEMPTS,
  type ReachRequestError,
  isReachEnvironmentId,
  reachHostname,
  reachResource,
  reachSlug,
  verifyReachRequest,
} from "@t3tools/shared/fork/reach";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerEnvironmentIdentity } from "../../../environment/ServerEnvironment.ts";
import { AuthSessionRepository } from "../../../persistence/AuthSessions.ts";
import { DirectoryService } from "../../directory/DirectoryService.ts";
import { credentialFileState, reachLibraryConfig } from "./credentials.ts";
import {
  type CloudflareDnsRecord,
  type CloudflareTunnel,
  ReachCloudflare,
  type ReachCloudflareError,
  isTunnelConnected,
  reachDnsComment,
  reachTunnelName,
  reachTunnelTarget,
} from "./ReachCloudflare.ts";
import { ReachPocketId, type ReachPocketIdError, reachApiName } from "./ReachPocketId.ts";
import {
  type ReachStoreError,
  type ReachStoredComputer,
  type ReachStoredEdge,
  type ReachStoredIdentity,
  ReachStore,
} from "./ReachStore.ts";

/** Per computer, so one looping computer cannot spend the Cloudflare budget of the others. */
const REQUEST_WINDOW_MS = 10 * 60_000;
const REQUESTS_PER_WINDOW = 10;
/** Bounds the connector count calls one admin list has open against Cloudflare at once. */
const DESCRIBE_CONCURRENCY = 4;

/** Answered to the computer as `{ reason, retryAfterSeconds? }`; it never carries a cause. */
export class ReachProvisionError extends Schema.TaggedError<ReachProvisionError>()(
  "ReachProvisionError",
  {
    reason: ReachFailureReason,
    retryAfterSeconds: Schema.optionalKey(PositiveInt),
  },
) {
  override get message(): string {
    return `The Library refused or failed a reach request: ${this.reason}.`;
  }
}

export interface ReachCallInput {
  /** From the publisher session's subject, never from the body. */
  readonly environmentId: EnvironmentId;
  readonly publisherSessionId: string;
  readonly request: ReachRequestBody;
}

export class ReachProvisioner extends Context.Service<
  ReachProvisioner,
  {
    /**
     * Sets up or repairs a computer's hostname, tunnel, ingress and DNS record, then rotates the
     * tunnel secret, clears its connections and answers a fresh connector token.
     */
    readonly ensure: (
      input: ReachCallInput,
    ) => Effect.Effect<ReachEnsureReply, ReachProvisionError>;
    /** Deletes the tunnel and DNS record. The hostname, `seq`, key pin and Identity stay. */
    readonly remove: (
      input: ReachCallInput,
    ) => Effect.Effect<ReachRemoveReply, ReachProvisionError>;
    readonly list: Effect.Effect<ReachLibraryListing, ReachLibraryError>;
    /**
     * An admin's removal without the computer. It also releases the key pin. Ending a sign-in
     * Pocket ID holds while the admin key file is not ready is refused before anything changes.
     */
    readonly retire: (
      input: ReachRetireInput,
    ) => Effect.Effect<ReachLibraryComputer, ReachLibraryError>;
  }
>()("t3/fork/reach/library/ReachProvisioner") {}

const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const VERIFY_REASON = {
  "invalid-audience": "unverified",
  "invalid-key": "invalid",
  "invalid-request": "invalid",
  unverified: "unverified",
  "wrong-environment": "wrong-environment",
} as const satisfies Record<ReachRequestError["reason"], ReachFailureReason>;

/** The provisioning reasons an admin call can answer as they are. */
type LibraryReason = Extract<ReachLibraryError["reason"], ReachFailureReason>;
const LIBRARY_REASONS: ReadonlyArray<LibraryReason> = [
  "not-authority",
  "not-configured",
  "cloudflare-denied",
  "cloudflare-limited",
  "cloudflare-unavailable",
  "tunnel-busy",
  "io",
];
const isLibraryReason = (reason: ReachFailureReason): reason is LibraryReason =>
  (LIBRARY_REASONS as ReadonlyArray<string>).includes(reason);

const provisionError = (reason: ReachFailureReason, retryAfterSeconds?: number) =>
  new ReachProvisionError(
    retryAfterSeconds === undefined ? { reason } : { reason, retryAfterSeconds },
  );

const isEdgeStage = (stage: string) =>
  stage.startsWith("allowlist") || stage.startsWith("ratelimit");

const cloudflareFailure = (error: ReachCloudflareError): ReachProvisionError => {
  switch (error.reason) {
    case "credential":
      return provisionError("not-configured");
    case "denied":
      return provisionError("cloudflare-denied");
    case "limited":
      return provisionError("cloudflare-limited", error.retryAfterSeconds);
    case "busy":
      return provisionError("tunnel-busy");
    case "not-found":
      // A zone this token cannot see is a token scoped to the wrong zone.
      return provisionError(
        error.stage === "zone" ? "cloudflare-denied" : "cloudflare-unavailable",
      );
    case "invalid":
      return provisionError(isEdgeStage(error.stage) ? "edge-failed" : "cloudflare-unavailable");
    case "unavailable":
      return provisionError(isEdgeStage(error.stage) ? "edge-failed" : "cloudflare-unavailable");
  }
};

const freshComputer = (updatedAt: string): ReachStoredComputer => ({
  seq: 0,
  keyFingerprint: null,
  hostname: null,
  tunnelId: null,
  dnsRecordId: null,
  origin: null,
  state: "provisioning",
  lastError: null,
  leftoverDnsRecordId: null,
  publisherSessionId: null,
  updatedAt,
  lastEnsuredAt: null,
  identity: null,
});

const failedEdge = (zoneId: string, checkedAt: string): ReachStoredEdge => ({
  zoneId,
  rulesetId: null,
  allowlistRuleId: null,
  rateLimitRulesetId: null,
  rateLimitRuleId: null,
  allowlist: "failed",
  rateLimit: "failed",
  checkedAt,
});

interface Admitted {
  readonly claims: ReachRequestClaims;
  readonly fingerprint: string;
  readonly label: string | null;
}

type StepError = ReachCloudflareError | ReachStoreError | ReachProvisionError;

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const config = reachLibraryConfig(env);
  const configured = config.zone !== null && config.cloudflareTokenFile !== null;
  const store = yield* ReachStore;
  const cloudflare = yield* ReachCloudflare;
  const pocketId = yield* ReachPocketId;
  const directory = yield* DirectoryService;
  const sessions = yield* AuthSessionRepository;
  const fs = yield* FileSystem.FileSystem;
  const ownEnvironmentId = yield* Effect.flatMap(
    ServerEnvironmentIdentity,
    (identity) => identity.getEnvironmentId,
  );
  const lock = yield* Semaphore.make(1);
  const requests = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<number>>>(new Map());
  const edgeChecked = yield* Ref.make(false);
  // How the last call with each credential went, folded into the admin list's setup states.
  const lastCloudflare = yield* Ref.make<ReachCredentialState | null>(null);
  const lastIdentity = yield* Ref.make<ReachCredentialState | null>(null);

  const nowIso = Clock.currentTimeMillis.pipe(Effect.map(isoAt));
  const read = store.read;

  const putComputer = (
    environmentId: string,
    change: (current: ReachStoredComputer) => ReachStoredComputer,
  ) =>
    store.update((state) => {
      const current = state.computers[environmentId];
      return current === undefined
        ? state
        : { ...state, computers: { ...state.computers, [environmentId]: change(current) } };
    });

  const refuse = (reason: ReachFailureReason, diagnostic?: string) =>
    Effect.logWarning("The Library refused a reach request.", {
      stage: "admit",
      reason,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    }).pipe(Effect.andThen(Effect.fail(provisionError(reason))));

  const noteCloudflare = (error: ReachCloudflareError | null) =>
    Ref.set(
      lastCloudflare,
      error === null || error.reason === "credential"
        ? null
        : error.reason === "denied"
          ? "refused"
          : error.reason === "limited" || error.reason === "unavailable"
            ? "unavailable"
            : null,
    );

  // A conflict is an answer from Pocket ID with a working key, so it says nothing about the key.
  const noteIdentity = (error: ReachPocketIdError | null) =>
    Ref.set(
      lastIdentity,
      error?.reason === "denied"
        ? "refused"
        : error?.reason === "unavailable"
          ? "unavailable"
          : null,
    );

  /**
   * Logs one failure with its stage, notes the credential and answers the wire reason. Untraced:
   * it always runs inside the ensure, remove or retire span.
   */
  const normalize = Effect.fnUntraced(function* (error: StepError) {
    if (error._tag === "ReachProvisionError") return error;
    if (error._tag === "ReachStoreError") {
      yield* Effect.logWarning("Reach provisioning failed.", { stage: "store", reason: "io" });
      return provisionError("io");
    }
    yield* noteCloudflare(error);
    const failure = cloudflareFailure(error);
    yield* Effect.logWarning("Reach provisioning failed.", {
      stage: error.stage,
      reason: failure.reason,
    });
    return failure;
  });

  /** Checks 1 to 6 of the protocol: availability, the directory pin and the signature. */
  const admit = Effect.fnUntraced(function* (input: ReachCallInput, action: ReachAction) {
    const { environmentId, request } = input;
    if (config.audience === null) return yield* refuse("not-authority");
    if (!configured) return yield* refuse("not-configured");
    if (!isReachEnvironmentId(environmentId)) return yield* refuse("invalid");
    if (environmentId === ownEnvironmentId) return yield* refuse("is-library");
    const pin = yield* directory.pinned(environmentId).pipe(
      Effect.catchTags({
        DirectoryError: (error) =>
          refuse(error.reason === "not-authority" ? "not-authority" : "io"),
      }),
    );
    if (pin === null) return yield* refuse("not-in-directory");
    const der = decodeEd25519PublicKey(request.publicKey);
    if (der === null) return yield* refuse("invalid");
    const fingerprint = keyFingerprint(der);
    if (fingerprint !== pin.keyFingerprint) return yield* refuse("key-changed");
    const now = yield* Clock.currentTimeMillis;
    const claims = yield* verifyReachRequest({
      publicKey: pin.publicKey,
      token: request.token,
      environmentId,
      audience: config.audience,
      action,
      nowEpochSeconds: now / 1000,
    }).pipe(
      Effect.catchTags({
        ReachRequestError: (error) => refuse(VERIFY_REASON[error.reason], error.diagnostic),
      }),
    );
    return { claims, fingerprint, label: pin.label } satisfies Admitted;
  });

  /** F2 and replay checks, then `seq` and the key pin are written before any outside call. */
  const claim = Effect.fnUntraced(function* (environmentId: string, admitted: Admitted) {
    const now = yield* Clock.currentTimeMillis;
    const existing = (yield* read).computers[environmentId];
    if (
      existing !== undefined &&
      existing.keyFingerprint !== null &&
      existing.keyFingerprint !== admitted.fingerprint
    ) {
      return yield* refuse("key-changed");
    }
    if (existing !== undefined && admitted.claims.seq <= existing.seq) {
      return yield* refuse("stale-request");
    }
    const updatedAt = isoAt(now);
    yield* store.update((state) => ({
      ...state,
      computers: {
        ...state.computers,
        [environmentId]: {
          ...(state.computers[environmentId] ?? freshComputer(updatedAt)),
          seq: admitted.claims.seq,
          keyFingerprint: admitted.fingerprint,
          updatedAt,
        },
      },
    }));
    const retryAfter = yield* Ref.modify(requests, (byEnvironment) => {
      const recent = (byEnvironment.get(environmentId) ?? []).filter(
        (at) => at > now - REQUEST_WINDOW_MS,
      );
      const next = new Map(byEnvironment);
      const [oldest] = recent;
      if (oldest !== undefined && recent.length >= REQUESTS_PER_WINDOW) {
        next.set(environmentId, recent);
        return [Math.max(1, Math.ceil((oldest + REQUEST_WINDOW_MS - now) / 1000)), next] as const;
      }
      next.set(environmentId, [...recent, now]);
      return [null, next] as const;
    });
    if (retryAfter !== null) {
      yield* Effect.logWarning("The Library refused a reach request.", {
        stage: "limit",
        reason: "too-many-requests",
      });
      return yield* provisionError("too-many-requests", retryAfter);
    }
  });

  const resolveZone = Effect.gen(function* () {
    const zoneName = config.zone ?? "";
    const state = yield* read;
    if (state.zone !== null && state.zone.name === zoneName) return state.zone;
    const found = yield* cloudflare.findZone(zoneName);
    const zone = { name: zoneName, ...found };
    yield* store.update((current) => ({ ...current, zone }));
    return zone;
  });

  /** Once per process, and again after any check that was not fully ready. */
  const ensureEdge = Effect.fnUntraced(function* (zone: {
    readonly name: string;
    readonly zoneId: string;
  }) {
    const known = (yield* read).edge;
    if (
      (yield* Ref.get(edgeChecked)) &&
      known !== null &&
      known.zoneId === zone.zoneId &&
      known.allowlist === "ready" &&
      known.rateLimit !== "failed"
    ) {
      return known;
    }
    const checkedAt = yield* nowIso;
    const rules = yield* cloudflare
      .ensureEdgeRules({ zoneId: zone.zoneId, zone: zone.name })
      .pipe(
        Effect.tapError(() =>
          store
            .update((state) => ({ ...state, edge: failedEdge(zone.zoneId, checkedAt) }))
            .pipe(Effect.ignore),
        ),
      );
    const edge: ReachStoredEdge = { zoneId: zone.zoneId, ...rules, checkedAt };
    yield* store.update((state) => ({ ...state, edge }));
    yield* Ref.set(edgeChecked, true);
    if (edge.allowlist === "failed") {
      yield* Effect.logWarning("Reach provisioning failed.", {
        stage: "allowlist",
        reason: "edge-failed",
      });
      return yield* provisionError("edge-failed");
    }
    return edge;
  });

  const isOurRecord = (
    record: CloudflareDnsRecord,
    environmentId: string,
    storedId: string | null,
  ) =>
    record.type === "CNAME" &&
    (record.id === storedId || record.comment === reachDnsComment(environmentId));

  /**
   * Sticky: a stored hostname is kept. A new one skips every hostname another record holds,
   * tombstones included, and every name a DNS record the Library does not own already uses.
   */
  const resolveHostname = Effect.fnUntraced(function* (
    environmentId: string,
    label: string | null,
    zone: { readonly name: string; readonly zoneId: string },
  ) {
    const state = yield* read;
    const own = state.computers[environmentId];
    if (own !== undefined && own.hostname !== null)
      return { hostname: own.hostname, records: null };
    const held = new Set(
      Object.entries(state.computers).flatMap(([id, computer]) =>
        id === environmentId || computer.hostname === null ? [] : [computer.hostname],
      ),
    );
    const slug = reachSlug(label ?? "");
    for (let attempt = 1; attempt <= REACH_HOSTNAME_MAX_ATTEMPTS; attempt += 1) {
      const hostname = reachHostname(slug, attempt, zone.name);
      if (hostname === null || held.has(hostname)) continue;
      const records = yield* cloudflare.findDns(zone.zoneId, hostname);
      if (records.some((record) => !isOurRecord(record, environmentId, null))) continue;
      const updatedAt = yield* nowIso;
      yield* putComputer(environmentId, (current) => ({ ...current, hostname, updatedAt }));
      return { hostname, records };
    }
    return yield* provisionError("hostname-unavailable");
  });

  /** A stored id counts only while it names this computer's tunnel; otherwise find or create. */
  const resolveTunnel = Effect.fnUntraced(function* (environmentId: string, accountId: string) {
    const name = reachTunnelName(environmentId);
    const storedId = (yield* read).computers[environmentId]?.tunnelId ?? null;
    const stored = storedId === null ? null : yield* cloudflare.getTunnel(accountId, storedId);
    const tunnel =
      stored !== null && stored.name === name && stored.deletedAt === null
        ? stored
        : ((yield* cloudflare.findTunnel(accountId, name)) ??
          (yield* cloudflare.createTunnel(accountId, name)));
    if (tunnel.id !== storedId) {
      const updatedAt = yield* nowIso;
      // Another tunnel's ingress is unknown, so the next step writes it.
      yield* putComputer(environmentId, (current) => ({
        ...current,
        tunnelId: tunnel.id,
        origin: null,
        updatedAt,
      }));
    }
    return tunnel;
  });

  const ensureIngress = Effect.fnUntraced(function* (input: {
    readonly environmentId: string;
    readonly accountId: string;
    readonly tunnelId: string;
    readonly hostname: string;
    readonly origin: string;
  }) {
    if ((yield* read).computers[input.environmentId]?.origin === input.origin) return;
    yield* cloudflare.putIngress(input);
    const updatedAt = yield* nowIso;
    yield* putComputer(input.environmentId, (current) => ({
      ...current,
      origin: input.origin,
      updatedAt,
    }));
  });

  const ensureCname = Effect.fnUntraced(function* (input: {
    readonly environmentId: string;
    readonly zoneId: string;
    readonly hostname: string;
    readonly tunnelId: string;
    readonly records: ReadonlyArray<CloudflareDnsRecord> | null;
  }) {
    const storedId = (yield* read).computers[input.environmentId]?.dnsRecordId ?? null;
    const records = input.records ?? (yield* cloudflare.findDns(input.zoneId, input.hostname));
    const desired = {
      name: input.hostname,
      content: reachTunnelTarget(input.tunnelId),
      comment: reachDnsComment(input.environmentId),
    };
    const ours = records.find((record) => isOurRecord(record, input.environmentId, storedId));
    if (records.some((record) => record !== ours)) {
      yield* Effect.logWarning("Reach provisioning failed.", {
        stage: "dns",
        reason: "hostname-unavailable",
      });
      return yield* provisionError("hostname-unavailable");
    }
    const recordId =
      ours === undefined
        ? (yield* cloudflare.createCname(input.zoneId, desired)).id
        : ours.content !== desired.content ||
            ours.proxied !== true ||
            ours.comment !== desired.comment
          ? (yield* cloudflare.patchCname(input.zoneId, ours.id, desired)).id
          : ours.id;
    if (recordId !== storedId) {
      const updatedAt = yield* nowIso;
      yield* putComputer(input.environmentId, (current) => ({
        ...current,
        dnsRecordId: recordId,
        updatedAt,
      }));
    }
  });

  /**
   * D11: the computer's resource is created only here. Without a key file a resource Pocket ID
   * already holds stays usable, so an on-demand key need not be present on every start.
   */
  const provisionIdentity = Effect.fnUntraced(function* (
    environmentId: string,
    label: string | null,
  ): Effect.fn.Return<{
    readonly stored: ReachStoredIdentity | null;
    readonly reply: ReachEnsureIdentity;
  }> {
    const stored = (yield* read.pipe(Effect.orElseSucceed(() => null)))?.computers[environmentId]
      ?.identity;
    const kept = stored ?? null;
    const { issuer, nativeClientId } = config.identity;
    const resource =
      config.audience === null ? null : reachResource(config.audience, environmentId);
    if (issuer === null || nativeClientId === null || resource === null) {
      return { stored: kept, reply: { state: "not-configured" } };
    }
    const ready = { state: "ready", issuer, nativeClientId, resource } as const;
    const outcome = yield* pocketId
      .ensureApi({
        apiId: kept?.resource === resource ? kept.apiId : null,
        name: reachApiName(label, environmentId),
        resource,
        clientId: nativeClientId,
      })
      .pipe(Effect.result);
    if (Result.isSuccess(outcome)) {
      yield* noteIdentity(null);
      return {
        stored: { apiId: outcome.success.apiId, resource, state: "ready", lastError: null },
        reply: ready,
      };
    }
    const error = outcome.failure;
    if (error.reason === "not-configured") {
      return kept !== null &&
        kept.apiId !== null &&
        kept.resource === resource &&
        kept.state === "ready"
        ? { stored: kept, reply: ready }
        : { stored: kept, reply: { state: "not-configured" } };
    }
    yield* noteIdentity(error);
    yield* Effect.logWarning("Reach could not set up Loom Identity.", {
      stage: error.stage,
      reason: error.reason,
    });
    return {
      stored: {
        apiId: kept?.resource === resource ? kept.apiId : null,
        resource,
        state: "failed",
        lastError: error.failure,
      },
      reply: { state: "failed", reason: error.failure },
    };
  });

  const provision = Effect.fnUntraced(function* (input: ReachCallInput, admitted: Admitted) {
    const { environmentId } = input;
    const origin = admitted.claims.origin;
    if (origin === undefined) return yield* provisionError("invalid");
    const startedAt = yield* nowIso;
    yield* putComputer(environmentId, (current) => ({
      ...current,
      state: "provisioning",
      lastError: null,
      updatedAt: startedAt,
    }));
    const zone = yield* resolveZone;
    const edge = yield* ensureEdge(zone);
    const { hostname, records } = yield* resolveHostname(environmentId, admitted.label, zone);
    const tunnel = yield* resolveTunnel(environmentId, zone.accountId);
    yield* ensureIngress({
      environmentId,
      accountId: zone.accountId,
      tunnelId: tunnel.id,
      hostname,
      origin,
    });
    yield* ensureCname({
      environmentId,
      zoneId: zone.zoneId,
      hostname,
      tunnelId: tunnel.id,
      records,
    });
    // F1: a token handed out before this ensure, wherever it went, stops working here.
    yield* cloudflare.rotateSecret(zone.accountId, tunnel.id);
    yield* cloudflare.clearConnections(zone.accountId, tunnel.id);
    const connectorToken = yield* cloudflare.tunnelToken(zone.accountId, tunnel.id);
    yield* noteCloudflare(null);
    const identity = yield* provisionIdentity(environmentId, admitted.label);
    const finishedAt = yield* nowIso;
    yield* putComputer(environmentId, (current) => ({
      ...current,
      state: "ready",
      lastError: null,
      leftoverDnsRecordId: null,
      publisherSessionId: input.publisherSessionId,
      lastEnsuredAt: finishedAt,
      updatedAt: finishedAt,
      identity: identity.stored,
    }));
    return {
      hostname,
      url: `https://${hostname}/`,
      origin,
      connectorToken: Redacted.value(connectorToken),
      edge: {
        allowlist: edge.allowlist === "stale" ? "stale" : "ready",
        rateLimit: edge.rateLimit,
      },
      identity: identity.reply,
    } satisfies ReachEnsureReply;
  });

  const recordFailure = (
    environmentId: string,
    state: "failed" | "removing",
    reason: ReachFailureReason,
  ) =>
    nowIso.pipe(
      Effect.flatMap((updatedAt) =>
        putComputer(environmentId, (current) => ({
          ...current,
          state,
          lastError: reason,
          updatedAt,
        })),
      ),
      Effect.ignore,
    );

  const ignoreMissing = <A>(effect: Effect.Effect<A, ReachCloudflareError>) =>
    effect.pipe(
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.void,
      ),
    );

  /**
   * Rotation first, so neither a live nor an orphaned connector can reconnect between clearing
   * and deleting. A CNAME whose content no longer names this tunnel is left for the operator.
   */
  const teardown = Effect.fnUntraced(function* (environmentId: string) {
    const startedAt = yield* nowIso;
    yield* putComputer(environmentId, (current) => ({
      ...current,
      state: "removing",
      lastError: null,
      updatedAt: startedAt,
    }));
    const record = (yield* read).computers[environmentId];
    if (record === undefined) return;
    const zone = yield* resolveZone;
    const name = reachTunnelName(environmentId);
    const stored =
      record.tunnelId === null
        ? null
        : yield* cloudflare.getTunnel(zone.accountId, record.tunnelId);
    const tunnel: CloudflareTunnel | null =
      stored !== null && stored.name === name && stored.deletedAt === null
        ? stored
        : yield* cloudflare.findTunnel(zone.accountId, name);
    if (tunnel !== null) {
      yield* ignoreMissing(cloudflare.rotateSecret(zone.accountId, tunnel.id));
      const clearAndDelete = ignoreMissing(
        cloudflare.clearConnections(zone.accountId, tunnel.id),
      ).pipe(Effect.andThen(cloudflare.deleteTunnel(zone.accountId, tunnel.id)));
      // A connector can reattach in the moment between the two calls; one retry covers it.
      yield* clearAndDelete.pipe(
        Effect.catchIf(
          (error) => error.reason === "busy",
          () => clearAndDelete,
        ),
      );
    }
    const targets = new Set(
      [record.tunnelId, tunnel?.id ?? null].flatMap((id) =>
        id === null ? [] : [reachTunnelTarget(id)],
      ),
    );
    const matches = (found: CloudflareDnsRecord) =>
      found.type === "CNAME" &&
      found.name === record.hostname &&
      found.content !== null &&
      targets.has(found.content);
    const storedRecord =
      record.dnsRecordId === null
        ? null
        : yield* cloudflare.getDns(zone.zoneId, record.dnsRecordId);
    // Without a live stored id, the record this computer's comment tags is the one an ensure
    // created but could not store.
    const comment = reachDnsComment(environmentId);
    const candidates =
      storedRecord !== null
        ? [storedRecord]
        : record.hostname === null
          ? []
          : (yield* cloudflare.findDns(zone.zoneId, record.hostname)).filter(
              (found) => found.comment === comment,
            );
    let leftover: string | null = null;
    for (const found of candidates) {
      if (matches(found)) yield* cloudflare.deleteDns(zone.zoneId, found.id);
      else leftover = found.id;
    }
    // A record left at an earlier removal stays reported while it exists, so a later Retire
    // does not hide it from the operator.
    if (leftover === null && record.leftoverDnsRecordId !== null) {
      const earlier = yield* cloudflare.getDns(zone.zoneId, record.leftoverDnsRecordId);
      if (earlier !== null) leftover = earlier.id;
    }
    if (leftover !== null) {
      yield* Effect.logWarning("Reach left a DNS record that no longer matched its tunnel.", {
        stage: "dns.delete",
        reason: "removed-with-leftover",
      });
    }
    const finishedAt = yield* nowIso;
    yield* putComputer(environmentId, (current) => ({
      ...current,
      state: leftover === null ? "removed" : "removed-with-leftover",
      lastError: null,
      tunnelId: null,
      dnsRecordId: null,
      origin: null,
      leftoverDnsRecordId: leftover,
      updatedAt: finishedAt,
    }));
  });

  const ensure = Effect.fn("ReachProvisioner.ensure")(function* (input: ReachCallInput) {
    return yield* Effect.gen(function* () {
      const admitted = yield* admit(input, "ensure");
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          yield* claim(input.environmentId, admitted).pipe(
            Effect.catchTags({ ReachStoreError: () => Effect.fail(provisionError("io")) }),
          );
          return yield* provision(input, admitted).pipe(
            Effect.catch((error) =>
              normalize(error).pipe(
                Effect.tap((failure) =>
                  recordFailure(input.environmentId, "failed", failure.reason),
                ),
                Effect.flatMap(Effect.fail),
              ),
            ),
          );
        }),
      );
    }).pipe(Effect.annotateLogs({ environmentId: input.environmentId }));
  });

  const remove = Effect.fn("ReachProvisioner.remove")(function* (input: ReachCallInput) {
    return yield* Effect.gen(function* () {
      const admitted = yield* admit(input, "remove");
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const existing = (yield* read.pipe(Effect.mapError(() => provisionError("io"))))
            .computers[input.environmentId];
          // Nothing was ever set up, so there is nothing to tear down or to pin.
          if (existing === undefined) return { removed: true } as const;
          yield* claim(input.environmentId, admitted).pipe(
            Effect.catchTags({ ReachStoreError: () => Effect.fail(provisionError("io")) }),
          );
          yield* teardown(input.environmentId).pipe(
            Effect.catch((error) =>
              normalize(error).pipe(
                Effect.tap((failure) =>
                  recordFailure(input.environmentId, "removing", failure.reason),
                ),
                Effect.flatMap(Effect.fail),
              ),
            ),
          );
          return { removed: true } as const;
        }),
      );
    }).pipe(Effect.annotateLogs({ environmentId: input.environmentId }));
  });

  const signInState = (sessionId: string | null, now: number) =>
    sessionId === null
      ? Effect.succeed("unknown" as const)
      : sessions.getById({ sessionId: AuthSessionId.make(sessionId) }).pipe(
          Effect.map(
            Option.match({
              onNone: () => "ended" as const,
              onSome: (session) =>
                session.revokedAt === null && DateTime.toEpochMillis(session.expiresAt) > now
                  ? ("active" as const)
                  : ("ended" as const),
            }),
          ),
          Effect.orElseSucceed(() => "unknown" as const),
        );

  const describe = Effect.fnUntraced(function* (
    environmentId: string,
    record: ReachStoredComputer,
    /** The account's tunnels from one list call, or null when that call failed. */
    tunnels: ReadonlyArray<CloudflareTunnel> | null,
    accountId: string | null,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const id = EnvironmentId.make(environmentId);
    const pin = yield* directory.pinned(id).pipe(Effect.orElseSucceed(() => null));
    const name = reachTunnelName(environmentId);
    const tunnel =
      tunnels?.find((entry) => entry.id === record.tunnelId) ??
      tunnels?.find((entry) => entry.name === name);
    const connected = tunnel !== undefined && isTunnelConnected(tunnel);
    // The list's own count is deprecated, so a connected tunnel it no longer counts is asked
    // directly; the extra-connector warning then outlives Cloudflare emptying that list.
    const connectors =
      tunnel === undefined
        ? null
        : (tunnel.connectors ??
          (connected && accountId !== null
            ? yield* cloudflare
                .countConnectors(accountId, tunnel.id)
                .pipe(Effect.orElseSucceed(() => null))
            : null));
    return {
      environmentId: id,
      label: pin?.label ?? null,
      hostname: record.hostname,
      state: record.state,
      lastError: record.lastError,
      connection: tunnels === null ? "unknown" : connected ? "connected" : "down",
      connectors,
      leftoverDnsRecordId: record.leftoverDnsRecordId,
      identity:
        record.identity === null
          ? null
          : {
              resource: record.identity.resource,
              state: record.identity.state,
              lastError: record.identity.lastError,
            },
      signIn: yield* signInState(record.publisherSessionId, now),
      updatedAt: record.updatedAt,
      lastEnsuredAt: record.lastEnsuredAt,
    } satisfies ReachLibraryComputer;
  });

  const libraryError = (reason: ReachLibraryError["reason"], retryAfterSeconds?: number) =>
    new ReachLibraryError(
      retryAfterSeconds === undefined ? { reason } : { reason, retryAfterSeconds },
    );

  const toLibraryError = (error: ReachProvisionError) =>
    isLibraryReason(error.reason)
      ? libraryError(error.reason, error.retryAfterSeconds)
      : libraryError("cloudflare-unavailable");

  /** The admin key file's half of `setup.identity`, which clients also gate ending sign-in on. */
  const identityKeyFile =
    config.identity.issuer === null || config.identity.nativeClientId === null
      ? Effect.succeed<ReachCredentialState>("missing")
      : credentialFileState(config.identity.adminKeyFile).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
        );

  const list = Effect.gen(function* () {
    if (config.audience === null) return yield* libraryError("not-authority");
    const state = yield* read.pipe(Effect.mapError(() => libraryError("io")));
    const entries = Object.entries(state.computers);
    const accountId = state.zone?.accountId ?? null;
    const outcome =
      accountId === null || entries.length === 0
        ? null
        : yield* cloudflare.listTunnels(accountId).pipe(Effect.result);
    if (outcome !== null) {
      yield* noteCloudflare(Result.isSuccess(outcome) ? null : outcome.failure);
    }
    const tunnels = outcome !== null && Result.isSuccess(outcome) ? outcome.success : null;
    const cloudflareFile = yield* credentialFileState(config.cloudflareTokenFile).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    );
    const identityFile = yield* identityKeyFile;
    // A connected tunnel may cost a connector count call, so slow answers overlap, not add up.
    const described = yield* Effect.forEach(
      entries,
      ([environmentId, record]) => describe(environmentId, record, tunnels, accountId),
      { concurrency: DESCRIBE_CONCURRENCY },
    );
    const computers = described.toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.environmentId.localeCompare(right.environmentId),
    );
    return {
      setup: {
        zone: config.zone,
        cloudflare:
          cloudflareFile === "ready"
            ? ((yield* Ref.get(lastCloudflare)) ?? "ready")
            : cloudflareFile,
        identity:
          identityFile === "ready" ? ((yield* Ref.get(lastIdentity)) ?? "ready") : identityFile,
        edge:
          state.edge === null
            ? null
            : {
                allowlist: state.edge.allowlist,
                rateLimit: state.edge.rateLimit,
                checkedAt: state.edge.checkedAt,
              },
      },
      computers,
    } satisfies ReachLibraryListing;
  }).pipe(Effect.withSpan("ReachProvisioner.list"));

  const retire = Effect.fn("ReachProvisioner.retire")(function* (input: ReachRetireInput) {
    if (config.audience === null) return yield* libraryError("not-authority");
    if (!configured) return yield* libraryError("not-configured");
    return yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const existing = (yield* read.pipe(Effect.mapError(() => libraryError("io")))).computers[
            input.environmentId
          ];
          if (existing === undefined) return yield* libraryError("not-found");
          // Pocket ID cannot delete the resource without the key, so a retire that would tear
          // down the tunnel and then fail to end sign-in is refused before either happens.
          if (
            input.endIdentity &&
            existing.identity !== null &&
            existing.identity.apiId !== null &&
            (yield* identityKeyFile) !== "ready"
          ) {
            return yield* libraryError("identity-key-missing");
          }
          yield* teardown(input.environmentId).pipe(
            Effect.catch((error) =>
              normalize(error).pipe(
                Effect.tap((failure) =>
                  recordFailure(input.environmentId, "removing", failure.reason),
                ),
                Effect.flatMap((failure) => Effect.fail(toLibraryError(failure))),
              ),
            ),
          );
          let identity = existing.identity;
          if (input.endIdentity && identity !== null) {
            const apiId = identity.apiId;
            const deleted =
              apiId === null ? null : yield* pocketId.deleteApi(apiId).pipe(Effect.result);
            if (deleted === null || Result.isSuccess(deleted)) {
              if (deleted !== null) yield* noteIdentity(null);
              identity = null;
            } else {
              yield* noteIdentity(deleted.failure);
              yield* Effect.logWarning("Reach could not end Loom Identity for a computer.", {
                stage: deleted.failure.stage,
                reason: deleted.failure.reason,
              });
              // The resource still exists, so the record keeps it for a later Retire to delete.
              identity = { ...identity, state: "failed", lastError: deleted.failure.failure };
            }
          }
          const updatedAt = yield* nowIso;
          const state = yield* putComputer(input.environmentId, (current) => ({
            ...current,
            identity,
            // F2: a new key may claim this computer's reach only after an admin retired it.
            keyFingerprint: null,
            updatedAt,
          })).pipe(Effect.mapError(() => libraryError("io")));
          const record = state.computers[input.environmentId] ?? existing;
          // The tunnel was just deleted, so no list call is needed to know it is down.
          return yield* describe(input.environmentId, record, [], null);
        }),
      )
      .pipe(Effect.annotateLogs({ environmentId: input.environmentId }));
  });

  return ReachProvisioner.of({ ensure, remove, list, retire });
});

export const layer = Layer.effect(ReachProvisioner, make);
