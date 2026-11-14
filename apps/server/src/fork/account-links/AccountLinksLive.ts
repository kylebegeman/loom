import {
  AuthMcpClientAccess,
  AuthSessionId,
  EnvironmentId,
  type PeerLink,
} from "@t3tools/contracts";
import {
  ACCOUNT_LINKS_ADMIT,
  ACCOUNT_LINKS_GRANT,
  ACCOUNT_LINKS_ROSTER,
  ACCOUNT_LINKS_VERIFY,
  AccountLinkAdmission,
  AccountLinkGrant,
  AccountLinkRoster,
  AccountLinkVerification,
  type AccountComputerBinding as AccountComputerBindingSchema,
  type AccountLinkEntry,
  type AccountLinkMember,
  type AccountLinkPolicy,
  type AccountLinkStatus,
} from "@t3tools/contracts/fork";
import {
  decodeEd25519PublicKey,
  directoryPublicKeyFromPem,
  isDirectoryRouteUrl,
  keyFingerprint,
  signAccountLinkProof,
} from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as Signature from "effect/crypto/Signature";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { LINK_NO_LONGER_ACCEPTED } from "../../peer/PeerMcpClient.ts";
import * as PeerLinks from "../../peer/PeerLinks.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { AccountLinkError, AccountLinks } from "./AccountLinks.ts";

/** How often a computer of the account asks the Library for its roster. */
export const RECONCILE_INTERVAL = Duration.minutes(3);
/** How often a computer that is not (yet) in an account looks again, so a join links quickly. */
const UNENROLLED_RECHECK = Duration.seconds(30);
const RETRY_INTERVAL = Duration.minutes(1);
/** A link is renewed once less than this is left of its session. */
const RENEW_BEFORE = Duration.days(7);
const LIBRARY_TIMEOUT = Duration.seconds(10);
export const PEER_TIMEOUT = Duration.seconds(15);
/**
 * Without a roster for this long, links stop until the Library answers: meanwhile the owner may
 * have removed a computer or lowered its access.
 */
export const ROSTER_STALE_AFTER = Duration.hours(1);
/** Library verifications the public admit route runs at once; more are turned away. */
export const MAX_CONCURRENT_VERIFIES = 4;
/** How often computers the roster does not list yet may make this one look again. */
const UNLISTED_RECHECK = Duration.seconds(30);

/** Socket codes that mean no connection opened, so the request reached no one. */
const NOT_CONNECTED = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
  "ENETDOWN",
  "EADDRNOTAVAIL",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const socketCodes = (error: unknown): ReadonlyArray<string> =>
  error instanceof AggregateError
    ? error.errors.flatMap(socketCodes)
    : Predicate.hasProperty(error, "code")
      ? [String(error.code)]
      : [];
/** Fetch hides the socket's error behind "fetch failed"; a timeout is never this. */
const neverConnected = (error: unknown) => {
  if (!HttpClientError.isHttpClientError(error) || error.reason._tag !== "TransportError")
    return false;
  const fetchError = error.reason.cause;
  const codes = socketCodes(
    Predicate.hasProperty(fetchError, "cause") ? fetchError.cause : fetchError,
  );
  return codes.length > 0 && codes.every((code) => NOT_CONNECTED.has(code));
};

const decodeRoster = Schema.decodeUnknownEffect(AccountLinkRoster);
const decodeGrant = Schema.decodeUnknownEffect(AccountLinkGrant);
const decodeAdmission = Schema.decodeUnknownEffect(AccountLinkAdmission);
const decodeVerification = Schema.decodeUnknownEffect(AccountLinkVerification);
const decodeAccess = Schema.decodeUnknownOption(AuthMcpClientAccess);

type AccountComputerBinding = typeof AccountComputerBindingSchema.Type;
type RemoteLibrary = Extract<LibraryConnection.LibraryConnection, { kind: "remote" }>;

interface InboundRow {
  readonly environment_id: string;
  readonly session_id: string;
  readonly label: string;
  readonly access: string;
  readonly expires_at: string;
  readonly issued_at: string;
}

/** The last roster the Library answered, which admission trusts while it is fresh. */
interface LastRoster {
  readonly at: number;
  readonly members: ReadonlySet<EnvironmentId>;
  readonly enabled: boolean;
}

interface Snapshot {
  readonly state: AccountLinkStatus["state"];
  readonly policy: AccountLinkPolicy | null;
  readonly members: ReadonlyArray<AccountLinkMember>;
  readonly failures: ReadonlyMap<EnvironmentId, string>;
  readonly checkedAt: string | null;
  readonly lastError: string | null;
}

const OFF: Snapshot = {
  state: "off",
  policy: null,
  members: [],
  failures: new Map(),
  checkedAt: null,
  lastError: null,
};

const sameBinding = (left: AccountComputerBinding, right: AccountComputerBinding | undefined) =>
  right !== undefined &&
  left.authorityId === right.authorityId &&
  left.authorityEpoch === right.authorityEpoch;

/**
 * The addresses a grant and then the link's token may travel to: the public Loomhost route first,
 * then tailnet ones. Only https DNS names, the route rule the directory keeps, so never plain
 * http, an IP address or loopback.
 */
export const linkOrigins = (member: AccountLinkMember): ReadonlyArray<string> => {
  const origins: Array<string> = [];
  const ordered = [
    ...member.routes.filter((route) => route.kind === "public"),
    ...member.routes.filter((route) => route.kind !== "public"),
  ];
  for (const route of ordered) {
    if (!isDirectoryRouteUrl(route.url)) continue;
    const origin = new URL(route.url).origin;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
};

const signedOutBody = (body: unknown) =>
  Predicate.hasProperty(body, "reason") && body.reason === "disabled";

/** Why a computer refused a grant, in the owner's terms. */
const refusal = (member: AccountLinkMember, response: HttpClientResponse.HttpClientResponse) =>
  response.status !== 404
    ? Effect.succeed(`${member.label} refused the link (HTTP ${response.status}).`)
    : response.json.pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.map((body) =>
          signedOutBody(body)
            ? `${member.label} is signed out of your Library. Loom links it once it signs in again.`
            : `${member.label} runs a Loom version without account links. Update it.`,
        ),
      );

const make = Effect.gen(function* () {
  const connection = yield* LibraryConnection.LibraryConnectionService;
  const links = yield* PeerLinks.PeerLinks;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const sessions = yield* SessionStore.SessionStore;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const signature = yield* Signature.Signature;
  const sql = yield* SqlClient.SqlClient;
  const httpClient = yield* HttpClient.HttpClient;
  const ownId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  // Only the origin `linkOrigins` checked may receive the grant: a redirect could send it anywhere.
  const peerClient = HttpClient.transform(httpClient, (response) =>
    Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
  );

  const reconcileLock = yield* Semaphore.make(1);
  // Short and separate from the reconcile, so two computers linking to each other at once
  // never wait on each other's reconcile.
  const inboundLock = yield* Semaphore.make(1);
  const verifySlots = yield* Semaphore.make(MAX_CONCURRENT_VERIFIES);
  const wakes = yield* Queue.sliding<void>(1);
  const snapshot = yield* Ref.make<Snapshot>(OFF);
  // In memory, so a restart starts the hour again.
  const lastRoster = yield* Ref.make<LastRoster | null>(null);
  const startedAt = yield* Clock.currentTimeMillis;
  const lastUnlistedWake = yield* Ref.make(Number.NEGATIVE_INFINITY);

  const readOutbound = sql<{ readonly environment_id: string; readonly linked_at: string }>`
    SELECT environment_id, linked_at FROM fork_account_links_outbound
  `;
  const readInbound = sql<InboundRow>`SELECT * FROM fork_account_links_inbound`;
  const outboundIds = yield* Ref.make<ReadonlySet<string>>(
    new Set(
      (yield* readOutbound.pipe(Effect.orElseSucceed(() => []))).map((row) => row.environment_id),
    ),
  );
  /** Sessions whose revoke failed: no longer account links, though their rows stay to retry. */
  const unrevoked = yield* Ref.make<ReadonlySet<string>>(new Set());
  const admittedSessions = (rows: ReadonlyArray<InboundRow>, skip: ReadonlySet<string>) =>
    new Map(
      rows
        .filter((row) => !skip.has(row.session_id))
        .map((row) => [row.session_id, EnvironmentId.make(row.environment_id)] as const),
    );
  const inboundSessions = yield* Ref.make<ReadonlyMap<string, EnvironmentId>>(
    admittedSessions(yield* readInbound.pipe(Effect.orElseSucceed(() => [])), new Set()),
  );
  const refreshSets = Effect.gen(function* () {
    yield* Ref.set(outboundIds, new Set((yield* readOutbound).map((row) => row.environment_id)));
    yield* Ref.set(
      inboundSessions,
      admittedSessions(yield* readInbound, yield* Ref.get(unrevoked)),
    );
  });
  const forgetSession = (sessionId: string, revoked: boolean) =>
    Effect.all([
      Ref.update(inboundSessions, (ids) => {
        const next = new Map(ids);
        next.delete(sessionId);
        return next;
      }),
      Ref.update(unrevoked, (ids) => {
        const next = new Set(ids);
        if (revoked) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      }),
    ]);

  const proofFor = Effect.fn("AccountLinks.proofFor")(
    function* (grant: string, target: EnvironmentId) {
      const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
      return yield* signAccountLinkProof({
        privateKey: keyPair.privateKey,
        source: ownId,
        target,
        grant,
        nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000,
      });
    },
    Effect.provideService(Signature.Signature, signature),
    Effect.mapError(() => "This computer could not sign its link grant. Loom retries."),
  );

  const fingerprint = Effect.gen(function* () {
    const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
    const publicKey = directoryPublicKeyFromPem(keyPair.publicKey);
    const der = publicKey === null ? null : decodeEd25519PublicKey(publicKey);
    return der === null ? null : keyFingerprint(der);
  }).pipe(
    Effect.provideService(Signature.Signature, signature),
    Effect.orElseSucceed(() => null),
  );

  /**
   * `left` has no account sign-in at all, so whatever it held goes. `unavailable` may be a
   * credential that is mid-renewal, so links stay for up to `ROSTER_STALE_AFTER`.
   */
  const currentLibrary = connection.current.pipe(
    Effect.map(
      (
        library,
      ):
        | {
            readonly kind: "member";
            readonly library: RemoteLibrary;
            readonly account: AccountComputerBinding;
          }
        | { readonly kind: "authority" | "left" | "unavailable" } =>
        library.kind === "remote" && library.credential?.account !== undefined
          ? { kind: "member", library, account: library.credential.account }
          : library.kind === "authority"
            ? { kind: "authority" }
            : library.kind === "unavailable"
              ? { kind: "unavailable" }
              : { kind: "left" },
    ),
  );

  /** A held peer link is ours while its linked_at is the one recorded when we stored it. */
  const heldLinks = Effect.gen(function* () {
    const rows = yield* readOutbound;
    const held = new Map<EnvironmentId, Option.Option<PeerLink>>();
    for (const row of rows) {
      const environmentId = EnvironmentId.make(row.environment_id);
      const link = yield* links.get(environmentId).pipe(Effect.orElseSucceed(Option.none));
      held.set(
        environmentId,
        Option.filter(link, (value) => DateTime.formatIso(value.linkedAt) === row.linked_at),
      );
    }
    return held;
  });

  const removeOutbound = Effect.fn("AccountLinks.removeOutbound")(function* (
    environmentId: EnvironmentId,
    ours: boolean,
  ) {
    if (ours) yield* links.unlink(environmentId).pipe(Effect.ignoreCause({ log: true }));
    yield* sql`DELETE FROM fork_account_links_outbound WHERE environment_id = ${environmentId}`;
  });

  /** A row goes only once its session is revoked, so no session stays valid untracked. */
  const revokeInbound = Effect.fn("AccountLinks.revokeInbound")(function* (row: InboundRow) {
    const revoked = yield* sessions.revoke(AuthSessionId.make(row.session_id)).pipe(Effect.result);
    if (Result.isSuccess(revoked))
      yield* sql`DELETE FROM fork_account_links_inbound WHERE session_id = ${row.session_id}`;
    else
      yield* Effect.logWarning("An account link session could not be revoked. Loom retries.", {
        cause: revoked.failure,
      });
    yield* forgetSession(row.session_id, Result.isSuccess(revoked));
  });

  /** Inbound sessions the roster no longer covers: a computer that left, or another access. */
  const pruneInbound = (keep: (row: InboundRow) => boolean) =>
    inboundLock.withPermit(
      Effect.gen(function* () {
        const live = new Set((yield* sessions.listActive()).map((session) => session.sessionId));
        for (const row of yield* readInbound)
          if (!live.has(AuthSessionId.make(row.session_id)) || !keep(row))
            yield* revokeInbound(row);
      }),
    );

  const dropAll = Effect.gen(function* () {
    const held = yield* heldLinks;
    for (const [environmentId, link] of held)
      yield* removeOutbound(environmentId, Option.isSome(link));
    yield* pruneInbound(() => false);
  }).pipe(Effect.withSpan("AccountLinks.dropAll"));

  const askLibrary = (library: RemoteLibrary, request: HttpClientRequest.HttpClientRequest) =>
    library.send(request).pipe(Effect.timeout(LIBRARY_TIMEOUT), Effect.result);

  /** Asks the Library for a grant to `member`, then presents it at the member's addresses. */
  const present = Effect.fn("AccountLinks.present")(function* (
    library: RemoteLibrary,
    member: AccountLinkMember,
  ) {
    const origins = linkOrigins(member);
    if (origins.length === 0)
      return yield* Effect.fail(`${member.label} has no Loomhost or Tailscale address yet.`);
    const granted = yield* askLibrary(
      library,
      HttpClientRequest.post(library.endpoint(ACCOUNT_LINKS_GRANT)).pipe(
        HttpClientRequest.bodyJsonUnsafe({ environmentId: member.environmentId }),
      ),
    );
    if (Result.isFailure(granted) || granted.success.status !== 200)
      return yield* Effect.fail("Your Library did not issue a link grant. Loom retries.");
    const grant = yield* granted.success.json.pipe(
      Effect.flatMap(decodeGrant),
      Effect.mapError(() => "Your Library answered the link grant in an unexpected shape."),
    );
    const proof = yield* proofFor(grant.grant, member.environmentId);
    for (const origin of origins) {
      const answered = yield* peerClient
        .execute(
          HttpClientRequest.post(`${origin}${ACCOUNT_LINKS_ADMIT}`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ grant: grant.grant, proof, environmentId: ownId }),
          ),
        )
        .pipe(Effect.timeout(PEER_TIMEOUT), Effect.result);
      if (Result.isFailure(answered)) {
        // Only a connection that never opened leaves the grant unseen for the next address.
        if (neverConnected(answered.failure)) continue;
        return yield* Effect.fail(
          `${member.label} did not answer at ${origin}. Loom tries again with a new grant.`,
        );
      }
      const response = answered.success;
      if (response.status !== 200) return yield* Effect.fail(yield* refusal(member, response));
      const admission = yield* response.json.pipe(
        Effect.flatMap(decodeAdmission),
        Effect.mapError(() => `${member.label} answered in an unexpected shape.`),
      );
      if (admission.environmentId !== member.environmentId)
        return yield* Effect.fail(`${origin} answered as another computer.`);
      return { admission, origins };
    }
    return yield* Effect.fail(`${member.label} did not answer at any of its addresses.`);
  });

  const link = Effect.fn("AccountLinks.link")(function* (
    library: RemoteLibrary,
    member: AccountLinkMember,
  ) {
    const { admission, origins } = yield* present(library, member);
    const now = yield* DateTime.now;
    const stored = yield* links
      .store(
        {
          environmentId: member.environmentId,
          label: member.label,
          urls: origins,
          access: admission.access,
          linkedAt: now,
          expiresAt: DateTime.makeUnsafe(admission.expiresAt),
          lastReachedAt: now,
          lastError: null,
        },
        Redacted.value(admission.accessToken),
      )
      .pipe(Effect.mapError((error) => error.message));
    const linkedAt = DateTime.formatIso(stored.linkedAt);
    yield* sql`
      INSERT INTO fork_account_links_outbound (environment_id, linked_at)
      VALUES (${member.environmentId}, ${linkedAt})
      ON CONFLICT (environment_id) DO UPDATE SET linked_at = excluded.linked_at
    `.pipe(Effect.mapError(() => "The link could not be saved here."));
  });

  const needsLink = (
    held: Option.Option<PeerLink>,
    access: AuthMcpClientAccess,
    now: DateTime.Utc,
  ) =>
    Option.isNone(held) ||
    held.value.access !== access ||
    // Any other error passes, and a new session would only cut off what this link started.
    held.value.lastError === LINK_NO_LONGER_ACCEPTED ||
    DateTime.isLessThan(held.value.expiresAt, DateTime.addDuration(now, RENEW_BEFORE));

  const record = (next: Omit<Snapshot, "checkedAt">) =>
    DateTime.now.pipe(
      Effect.flatMap((now) => Ref.set(snapshot, { ...next, checkedAt: DateTime.formatIso(now) })),
    );

  /**
   * The Library could not say. Links stay, since most of this passes within minutes, but not past
   * `ROSTER_STALE_AFTER`: the roster is what tells a removed computer or a lowered access apart.
   */
  const unsure = Effect.fn("AccountLinks.unsure")(function* (lastError: string) {
    const previous = yield* Ref.get(snapshot);
    const since = (yield* Ref.get(lastRoster))?.at ?? startedAt;
    if ((yield* Clock.currentTimeMillis) - since < Duration.toMillis(ROSTER_STALE_AFTER))
      return yield* record({ ...previous, state: "retrying", lastError });
    yield* dropAll;
    return yield* record({
      ...previous,
      state: "retrying",
      lastError: `${lastError} Account links are paused until it answers.`,
    });
  });

  const leave = (lastError: string | null) =>
    Ref.set(lastRoster, null).pipe(
      Effect.andThen(dropAll),
      Effect.andThen(record({ ...OFF, lastError })),
    );

  const reconcileOnce = Effect.gen(function* () {
    const current = yield* currentLibrary;
    if (current.kind === "unavailable")
      return yield* unsure("This computer's Library sign-in is unavailable.");
    if (current.kind !== "member") return yield* leave(null);
    const { library, account } = current;
    const asked = yield* askLibrary(
      library,
      HttpClientRequest.get(library.endpoint(ACCOUNT_LINKS_ROSTER)),
    );
    if (Result.isFailure(asked) || asked.success.status >= 500)
      return yield* unsure("Loom could not reach your Library to check account links.");
    const response = asked.success;
    if (response.status === 401 || response.status === 403)
      return yield* leave("Your Library no longer lists this computer in your account.");
    if (response.status !== 200)
      return yield* unsure(
        response.status === 404
          ? "Your Library runs a Loom version without account links. Update Loom on your Library."
          : `Your Library answered HTTP ${response.status}.`,
      );
    const roster = yield* response.json.pipe(Effect.flatMap(decodeRoster), Effect.option);
    if (Option.isNone(roster) || !sameBinding(roster.value.account, account))
      return yield* unsure("Your Library answered account links in an unexpected shape.");
    const { policy, members } = roster.value;
    yield* Ref.set(lastRoster, {
      at: yield* Clock.currentTimeMillis,
      members: new Set(members.map((member) => member.environmentId)),
      enabled: policy.enabled,
    });
    if (!policy.enabled) {
      yield* dropAll;
      return yield* record({ ...OFF, policy, members });
    }
    const listed = new Map(members.map((member) => [member.environmentId, member]));
    yield* pruneInbound(
      (row) => listed.has(EnvironmentId.make(row.environment_id)) && row.access === policy.access,
    );
    const held = yield* heldLinks;
    for (const [environmentId, link] of held)
      if (listed.get(environmentId)?.linkable !== true)
        yield* removeOutbound(environmentId, Option.isSome(link));
    const failures = new Map<EnvironmentId, string>();
    const now = yield* DateTime.now;
    for (const member of members) {
      if (!member.linkable) continue;
      if (!needsLink(held.get(member.environmentId) ?? Option.none(), policy.access, now)) continue;
      const linked = yield* link(library, member).pipe(Effect.result);
      if (Result.isFailure(linked)) failures.set(member.environmentId, linked.failure);
    }
    return yield* record({ state: "linked", policy, members, failures, lastError: null });
  });

  const status: AccountLinks["Service"]["status"] = Effect.gen(function* () {
    const current = yield* Ref.get(snapshot);
    const held = yield* heldLinks.pipe(
      Effect.orElseSucceed(() => new Map<EnvironmentId, Option.Option<PeerLink>>()),
    );
    const outbound: Array<AccountLinkEntry> = [];
    for (const member of current.members) {
      const link = held.get(member.environmentId) ?? Option.none();
      const failure = current.failures.get(member.environmentId);
      if (!member.linkable && Option.isNone(link)) {
        outbound.push({
          environmentId: member.environmentId,
          label: member.label,
          access: current.policy?.access ?? "full-access",
          expiresAt: null,
          lastError: `${member.label} runs a Loom version without account links. Update it.`,
        });
        continue;
      }
      outbound.push({
        environmentId: member.environmentId,
        label: Option.isSome(link) ? link.value.label : member.label,
        access: Option.isSome(link) ? link.value.access : (current.policy?.access ?? "full-access"),
        expiresAt: Option.isSome(link) ? DateTime.formatIso(link.value.expiresAt) : null,
        lastError: failure ?? (Option.isSome(link) ? link.value.lastError : null),
      });
    }
    const inbound = (yield* readInbound.pipe(Effect.orElseSucceed(() => []))).flatMap((row) => {
      const access = decodeAccess(row.access);
      return Option.isNone(access)
        ? []
        : [
            {
              environmentId: EnvironmentId.make(row.environment_id),
              label: row.label,
              access: access.value,
              expiresAt: row.expires_at,
              lastError: null,
            } satisfies AccountLinkEntry,
          ];
    });
    return {
      state: current.state,
      policy: current.policy,
      outbound,
      inbound,
      checkedAt: current.checkedAt,
      lastError: current.lastError,
    } satisfies AccountLinkStatus;
  }).pipe(Effect.withSpan("AccountLinks.status"));

  const reconcile: AccountLinks["Service"]["reconcile"] = reconcileLock
    .withPermit(
      reconcileOnce.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Account links could not be checked.", { cause }).pipe(
            Effect.andThen(Ref.get(snapshot)),
            Effect.flatMap((previous) =>
              record({
                ...previous,
                state: "retrying",
                lastError: "Loom could not update this computer's account links. It retries.",
              }),
            ),
          ),
        ),
        Effect.andThen(refreshSets.pipe(Effect.ignoreCause({ log: true }))),
      ),
    )
    .pipe(Effect.andThen(status), Effect.withSpan("AccountLinks.reconcile"));

  const fail = (reason: AccountLinkError["reason"]) => new AccountLinkError({ reason });

  /** Whether the last roster, while fresh and with links on, lists `environmentId`. */
  const lists = Effect.fn("AccountLinks.lists")(function* (environmentId: EnvironmentId) {
    const roster = yield* Ref.get(lastRoster);
    const age = (yield* Clock.currentTimeMillis) - (roster?.at ?? 0);
    return (
      roster !== null &&
      roster.enabled &&
      age < Duration.toMillis(ROSTER_STALE_AFTER) &&
      roster.members.has(environmentId)
    );
  });

  /** A computer the roster does not list may have just joined, so look again, now and then. */
  const wakeForUnlisted = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const due = yield* Ref.modify(lastUnlistedWake, (last) =>
      now - last >= Duration.toMillis(UNLISTED_RECHECK) ? [true, now] : [false, last],
    );
    if (due) yield* Queue.offer(wakes, undefined);
  });

  const admit: AccountLinks["Service"]["admit"] = Effect.fn("AccountLinks.admit")(
    function* (request) {
      const current = yield* currentLibrary;
      if (current.kind !== "member")
        return yield* fail(current.kind === "unavailable" ? "unavailable" : "disabled");
      const { library, account } = current;
      if (request.environmentId === ownId) return yield* fail("denied");
      // Anyone can reach this route, so only the account's own computers cost a Library call.
      if (!(yield* lists(request.environmentId))) {
        yield* wakeForUnlisted;
        return yield* fail("denied");
      }
      const ownFingerprint = yield* fingerprint;
      if (ownFingerprint === null) return yield* fail("unavailable");
      const verified = yield* askLibrary(
        library,
        HttpClientRequest.post(library.endpoint(ACCOUNT_LINKS_VERIFY)).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            grant: request.grant,
            proof: request.proof,
            source: request.environmentId,
            keyFingerprint: ownFingerprint,
          }),
        ),
      ).pipe(verifySlots.withPermitsIfAvailable(1));
      if (Option.isNone(verified)) return yield* fail("capacity");
      const asked = verified.value;
      if (Result.isFailure(asked) || asked.success.status >= 500) return yield* fail("unavailable");
      if (asked.success.status !== 200) return yield* fail("denied");
      const verification = yield* asked.success.json.pipe(
        Effect.flatMap(decodeVerification),
        Effect.mapError(() => fail("denied")),
      );
      const latest = yield* currentLibrary;
      if (
        verification.source !== request.environmentId ||
        !sameBinding(verification.account, account) ||
        latest.kind !== "member" ||
        latest.library.origin !== library.origin ||
        !sameBinding(latest.account, account)
      )
        return yield* fail("denied");
      const { issued, expiresAt, isNew } = yield* inboundLock
        .withPermit(
          Effect.gen(function* () {
            const previous = (yield* readInbound).filter(
              (row) => row.environment_id === request.environmentId,
            );
            // Before the new session exists, so a failed revoke leaves the old one tracked.
            for (const row of previous) yield* sessions.revoke(AuthSessionId.make(row.session_id));
            const issued = yield* auth.issueMcpClientSession({
              label: `${verification.label} · account link`,
              access: verification.access,
              peerLink: true,
              client: { deviceType: "bot" },
            });
            const issuedAt = DateTime.formatIso(yield* DateTime.now);
            const expiresAt = DateTime.formatIso(issued.expiresAt);
            yield* sql`
              INSERT INTO fork_account_links_inbound
                (environment_id, session_id, label, access, expires_at, issued_at)
              VALUES (${request.environmentId}, ${issued.sessionId}, ${verification.label},
                ${verification.access}, ${expiresAt}, ${issuedAt})
              ON CONFLICT (environment_id) DO UPDATE SET
                session_id = excluded.session_id, label = excluded.label, access = excluded.access,
                expires_at = excluded.expires_at, issued_at = excluded.issued_at
            `.pipe(Effect.tapError(() => sessions.revoke(issued.sessionId).pipe(Effect.ignore)));
            for (const row of previous) yield* forgetSession(row.session_id, true);
            yield* Ref.update(inboundSessions, (ids) =>
              new Map(ids).set(issued.sessionId, request.environmentId),
            );
            return { issued, expiresAt, isNew: previous.length === 0 };
          }),
        )
        .pipe(Effect.mapError(() => fail("unavailable")));
      // A computer that just joined links back right away instead of at the next check.
      if (isNew) yield* Queue.offer(wakes, undefined);
      yield* Effect.logInfo("Admitted an account link.", {
        environmentId: request.environmentId,
        access: verification.access,
      });
      return {
        environmentId: ownId,
        access: verification.access,
        accessToken: Redacted.make(issued.token),
        expiresAt,
      };
    },
  );

  const holdsAny = Ref.get(outboundIds).pipe(Effect.map((ids) => ids.size > 0));
  const holds = (environmentId: EnvironmentId) =>
    Ref.get(outboundIds).pipe(Effect.map((ids) => ids.has(environmentId)));
  const admits = (sessionId: AuthSessionId) =>
    Ref.get(inboundSessions).pipe(Effect.map((ids) => ids.has(sessionId)));
  const admittedFrom = (sessionId: AuthSessionId) =>
    Ref.get(inboundSessions).pipe(Effect.map((ids) => Option.fromNullishOr(ids.get(sessionId))));
  const admitsToken = (token: string) =>
    sessions.verify(token).pipe(
      Effect.flatMap((verified) =>
        verified.peerLink === true ? admits(verified.sessionId) : Effect.succeed(false),
      ),
      Effect.orElseSucceed(() => false),
    );

  const run = Effect.gen(function* () {
    const current = yield* currentLibrary;
    if (current.kind === "authority") return yield* Effect.never;
    const result = yield* reconcile;
    const delay =
      current.kind === "left"
        ? UNENROLLED_RECHECK
        : result.state === "retrying"
          ? RETRY_INTERVAL
          : RECONCILE_INTERVAL;
    yield* Queue.take(wakes).pipe(
      Effect.timeoutOrElse({ duration: delay, orElse: () => Effect.void }),
    );
  }).pipe(Effect.forever);

  return {
    service: AccountLinks.of({
      reconcile,
      status,
      admit,
      holdsAny,
      holds,
      admits,
      admittedFrom,
      admitsToken,
    }),
    run,
  };
});

export const layer = Layer.effect(
  AccountLinks,
  Effect.map(make, ({ service }) => service),
);

/**
 * The service, plus its loop: now, then on a schedule, whenever a new computer links here, and
 * when one the roster does not list yet presents a grant.
 */
export const layerWithReconciler = Layer.effect(
  AccountLinks,
  Effect.gen(function* () {
    const { service, run } = yield* make;
    yield* Effect.forkScoped(run);
    return service;
  }),
);
