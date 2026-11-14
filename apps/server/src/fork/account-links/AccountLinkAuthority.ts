import {
  AuthLibraryPublishScope,
  type AuthMcpClientAccess,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  ACCOUNT_LINKS_FEATURE,
  AccountComputerBinding,
  AccountLinkPolicy,
  DEFAULT_ACCOUNT_LINK_POLICY,
  LibraryError,
  type AccountLinkGrant,
  type AccountLinkGrantRequest,
  type AccountLinkMember,
  type AccountLinkRoster,
  type AccountLinkVerification,
  type AccountLinkVerifyRequest,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as Directory from "../directory/DirectoryService.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import * as LibraryStore from "../project-library/LibraryStore.ts";
import * as ReachStore from "../reach/library/ReachStore.ts";
import { AccountLinkError } from "./AccountLinks.ts";

const GRANT_LIFETIME_MS = 60_000;
const MAX_PENDING_GRANTS = 4096;
const POLICY_KEY = "policy";

const decodeEnvironmentId = Schema.decodeEffect(EnvironmentId);
const decodePolicy = Schema.decodeEffect(Schema.fromJsonString(AccountLinkPolicy));
const encodePolicy = Schema.encodeEffect(Schema.fromJsonString(AccountLinkPolicy));
const decodeAuthority = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      id: AccountComputerBinding.fields.authorityId,
      epoch: AccountComputerBinding.fields.authorityEpoch,
    }),
  ),
);

interface PendingGrant {
  readonly source: EnvironmentId;
  readonly target: EnvironmentId;
  readonly targetFingerprint: string;
  readonly access: AuthMcpClientAccess;
  readonly account: typeof AccountComputerBinding.Type;
  readonly deadline: number;
}

/**
 * On the Library: the owner's account link policy, the roster each computer of the account links
 * to, and the one-use grants that let one computer admit another. A grant names both computers and
 * the access, and only the target's own Library session can redeem it, so it is useless anywhere
 * else.
 */
export class AccountLinkAuthority extends Context.Service<
  AccountLinkAuthority,
  {
    readonly policy: (
      session: AuthenticatedSession,
    ) => Effect.Effect<AccountLinkPolicy, LibraryError>;
    readonly setPolicy: (
      session: AuthenticatedSession,
      policy: AccountLinkPolicy,
    ) => Effect.Effect<AccountLinkPolicy, LibraryError>;
    readonly roster: (
      publisher: AuthenticatedSession,
    ) => Effect.Effect<AccountLinkRoster, AccountLinkError>;
    readonly grant: (
      publisher: AuthenticatedSession,
      request: AccountLinkGrantRequest,
    ) => Effect.Effect<AccountLinkGrant, AccountLinkError>;
    readonly verify: (
      publisher: AuthenticatedSession,
      request: AccountLinkVerifyRequest,
    ) => Effect.Effect<AccountLinkVerification, AccountLinkError>;
  }
>()("t3/fork/account-links/AccountLinkAuthority") {}

const make = Effect.gen(function* () {
  const enabled = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const sessions = yield* SessionStore.SessionStore;
  const directory = yield* Directory.DirectoryService;
  const reach = yield* ReachStore.ReachStore;
  const library = yield* LibraryStore.LibraryStore;
  const management = yield* LibraryManagement;
  const pending = new Map<string, PendingGrant>();
  const fail = (reason: AccountLinkError["reason"]) => new AccountLinkError({ reason });
  const io = () =>
    new LibraryError({ reason: "io", detail: "The Library could not read its link policy." });

  const readPolicy = Effect.gen(function* () {
    const rows = yield* sql<{ readonly value_json: string }>`
      SELECT value_json FROM fork_account_links_policy WHERE key = ${POLICY_KEY}
    `;
    const row = rows[0];
    return row === undefined ? DEFAULT_ACCOUNT_LINK_POLICY : yield* decodePolicy(row.value_json);
  }).pipe(Effect.withSpan("AccountLinkAuthority.readPolicy"));

  const policy = Effect.fn("AccountLinkAuthority.policy")(function* (
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session, "read");
    return yield* readPolicy.pipe(Effect.mapError(io));
  });

  const setPolicy = Effect.fn("AccountLinkAuthority.setPolicy")(function* (
    session: AuthenticatedSession,
    next: AccountLinkPolicy,
  ) {
    yield* management.authorizeEnrollment(session, "write");
    const valueJson = yield* encodePolicy(next).pipe(Effect.mapError(io));
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO fork_account_links_policy (key, value_json, updated_at)
      VALUES (${POLICY_KEY}, ${valueJson}, ${updatedAt})
      ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `.pipe(Effect.mapError(io));
    yield* Effect.logInfo("Account link policy changed.", next);
    return next;
  });

  const currentAuthority = Effect.gen(function* () {
    const saved = yield* library.authority;
    if (saved === null) return yield* fail("unavailable");
    return yield* decodeAuthority(saved);
  }).pipe(Effect.mapError(() => fail("unavailable")));

  /** The computer a publisher session belongs to, while it is an active computer of the account. */
  const publisherComputer = Effect.fn("AccountLinkAuthority.publisher")(function* (
    publisher: AuthenticatedSession,
  ) {
    if (!enabled) return yield* fail("disabled");
    if (
      !publisher.subject.startsWith("loom-host:") ||
      !publisher.scopes.includes(AuthLibraryPublishScope)
    )
      return yield* fail("denied");
    return yield* decodeEnvironmentId(publisher.subject.slice("loom-host:".length)).pipe(
      Effect.mapError(() => fail("denied")),
    );
  });

  const accountView = Effect.gen(function* () {
    const authority = yield* currentAuthority;
    const state = yield* reach.read.pipe(Effect.mapError(() => fail("unavailable")));
    const listing = yield* directory.list.pipe(Effect.mapError(() => fail("unavailable")));
    const memberOf = (environmentId: EnvironmentId) => {
      const account = state.computers[environmentId]?.account;
      return account !== undefined &&
        account.state === "active" &&
        !account.publishingEnded &&
        account.authorityId === authority.id &&
        account.authorityEpoch === authority.epoch
        ? account
        : undefined;
    };
    return {
      account: { authorityId: authority.id, authorityEpoch: authority.epoch },
      memberOf,
      listing,
    };
  });

  /** The other active computers of the owner of `self`, as `self` should link to them. */
  const membersFor = Effect.fn("AccountLinkAuthority.members")(function* (self: EnvironmentId) {
    const view = yield* accountView;
    const own = view.memberOf(self);
    if (own === undefined) return yield* fail("denied");
    const members: Array<AccountLinkMember> = [];
    for (const entry of view.listing.environments) {
      if (entry.environmentId === self) continue;
      const account = view.memberOf(entry.environmentId);
      if (account === undefined || account.ownerSubject !== own.ownerSubject) continue;
      members.push({
        environmentId: entry.environmentId,
        label: entry.label,
        routes: entry.routes,
        linkable: entry.loomFeatures.includes(ACCOUNT_LINKS_FEATURE),
      });
    }
    return { ...view, own, members };
  });

  const roster = Effect.fn("AccountLinkAuthority.roster")(function* (
    publisher: AuthenticatedSession,
  ) {
    const self = yield* publisherComputer(publisher);
    const { account, members } = yield* membersFor(self);
    const current = yield* readPolicy.pipe(Effect.mapError(() => fail("unavailable")));
    return { account, policy: current, members } satisfies AccountLinkRoster;
  });

  const grant = Effect.fn("AccountLinkAuthority.grant")(function* (
    publisher: AuthenticatedSession,
    request: AccountLinkGrantRequest,
  ) {
    const source = yield* publisherComputer(publisher);
    const current = yield* readPolicy.pipe(Effect.mapError(() => fail("unavailable")));
    if (!current.enabled) return yield* fail("denied");
    const { account, members } = yield* membersFor(source);
    const target = members.find((member) => member.environmentId === request.environmentId);
    if (target === undefined || !target.linkable) return yield* fail("denied");
    const pin = yield* directory
      .pinned(target.environmentId)
      .pipe(Effect.mapError(() => fail("unavailable")));
    if (pin === null) return yield* fail("unavailable");
    const now = yield* Clock.currentTimeMillis;
    for (const [key, value] of pending) if (value.deadline <= now) pending.delete(key);
    if (pending.size >= MAX_PENDING_GRANTS) return yield* fail("capacity");
    const value = Hex.encode(yield* random.randomBytes(32).pipe(Effect.orDie));
    const deadline = now + GRANT_LIFETIME_MS;
    pending.set(value, {
      source,
      target: target.environmentId,
      targetFingerprint: pin.keyFingerprint,
      access: current.access,
      account,
      deadline,
    });
    return { grant: value, access: current.access, expiresAt: deadline } satisfies AccountLinkGrant;
  });

  const verify = Effect.fn("AccountLinkAuthority.verify")(function* (
    publisher: AuthenticatedSession,
    request: AccountLinkVerifyRequest,
  ) {
    const self = yield* publisherComputer(publisher);
    const entry = pending.get(request.grant);
    if (
      entry === undefined ||
      entry.target !== self ||
      entry.source !== request.source ||
      entry.targetFingerprint !== request.keyFingerprint
    )
      return yield* fail("denied");
    // Removed before any I/O, so two presentations can never admit the same grant twice.
    pending.delete(request.grant);
    if (entry.deadline <= (yield* Clock.currentTimeMillis)) return yield* fail("denied");
    const live = yield* sessions.listActive().pipe(Effect.mapError(() => fail("unavailable")));
    if (!live.some((session) => session.sessionId === publisher.sessionId))
      return yield* fail("denied");
    const current = yield* readPolicy.pipe(Effect.mapError(() => fail("unavailable")));
    if (!current.enabled || current.access !== entry.access) return yield* fail("denied");
    const { account, members, listing, own } = yield* membersFor(entry.source);
    const target = members.find((member) => member.environmentId === self);
    if (
      target === undefined ||
      account.authorityId !== entry.account.authorityId ||
      account.authorityEpoch !== entry.account.authorityEpoch
    )
      return yield* fail("denied");
    const pin = yield* directory.pinned(self).pipe(Effect.mapError(() => fail("unavailable")));
    if (pin?.keyFingerprint !== entry.targetFingerprint) return yield* fail("denied");
    const listed = listing.environments.find((env) => env.environmentId === entry.source);
    return {
      source: entry.source,
      label: listed?.label ?? (own.label.length > 0 ? own.label.slice(0, 160) : entry.source),
      access: entry.access,
      account,
    } satisfies AccountLinkVerification;
  });

  return AccountLinkAuthority.of({ policy, setPolicy, roster, grant, verify });
});

export const layer = Layer.effect(AccountLinkAuthority, make);
