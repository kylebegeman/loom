import * as HostProcess from "@t3tools/shared/HostProcess";
import { identityOwnershipSubject } from "../../auth/identityPolicy.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import {
  AuthAccessWriteScope,
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  AuthStandardClientScopes,
  type EnvironmentId,
} from "@t3tools/contracts";
import { type AccountAdmission } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import type * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as Directory from "../directory/DirectoryService.ts";
import * as ReachStore from "../reach/library/ReachStore.ts";

const GRANT_LIFETIME_MS = 60_000;
const MAX_PENDING_GRANTS = 4096;
type AccountLease = { readonly keyFingerprint: string; readonly membershipRevision: number | null };

export class AccountAccessError extends Schema.TaggedError<AccountAccessError>()(
  "AccountAccessError",
  {
    reason: Schema.Literals(["disabled", "authentication", "denied", "unavailable", "capacity"]),
  },
) {
  override get message(): string {
    return this.reason === "unavailable"
      ? "This computer is currently unavailable. Your saved history is still in the Library."
      : "Loom could not authorize access to this computer.";
  }
}

export class AccountAccess extends Context.Service<
  AccountAccess,
  {
    readonly authorize: (
      caller: EnvironmentAuth.AuthenticatedSession,
      environmentId: EnvironmentId,
    ) => Effect.Effect<
      { readonly origin: string; readonly keyFingerprint: string },
      AccountAccessError
    >;
    readonly publicRoute: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<string, AccountAccessError>;
    readonly awaitRemoval: (
      environmentId: EnvironmentId,
      lease?: AccountLease,
    ) => Effect.Effect<void>;
    readonly prepare: (input: {
      readonly caller: EnvironmentAuth.AuthenticatedSession;
      readonly environmentId: EnvironmentId;
      readonly method: string;
      readonly path: string;
    }) => Effect.Effect<
      { readonly origin: string; readonly grant: string; readonly lease: AccountLease },
      AccountAccessError
    >;
    readonly consume: (input: {
      readonly publisher: EnvironmentAuth.AuthenticatedSession;
      readonly grant: string;
      readonly keyFingerprint: string;
      readonly method: string;
      readonly path: string;
    }) => Effect.Effect<AccountAdmission, AccountAccessError>;
  }
>()("t3/fork/account-access/AccountAccess") {}

const make = Effect.gen(function* () {
  const enabled = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  const random = yield* SecureRandom.SecureRandom;
  const sessions = yield* SessionStore.SessionStore;
  const directory = yield* Directory.DirectoryService;
  const reach = yield* ReachStore.ReachStore;
  const environment = yield* HostProcess.Environment;
  const authorityId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const pending = new Map<
    string,
    {
      readonly environmentId: EnvironmentId;
      readonly keyFingerprint: string;
      readonly method: string;
      readonly path: string;
      readonly admission: AccountAdmission;
      readonly lease: AccountLease;
      readonly ownerSubject: string;
      readonly deadline: number;
    }
  >();
  const fail = (reason: AccountAccessError["reason"]) => new AccountAccessError({ reason });
  const route = Effect.fn("AccountAccess.route")(function* (environmentId: EnvironmentId) {
    const pin = yield* directory
      .pinned(environmentId)
      .pipe(Effect.mapError(() => fail("unavailable")));
    const state = yield* reach.read.pipe(Effect.mapError(() => fail("unavailable")));
    const computer = state.computers[environmentId];
    const hostname = ReachStore.readyHostname(computer);
    if (
      pin === null ||
      hostname === null ||
      computer?.keyFingerprint !== pin.keyFingerprint ||
      computer.zone === null ||
      !hostname.endsWith(`.${computer.zone.name}`) ||
      !/^[a-z0-9.-]+$/u.test(hostname)
    )
      return yield* fail("unavailable");
    return {
      origin: `https://${hostname}`,
      keyFingerprint: pin.keyFingerprint,
      membershipRevision: computer.account?.approvedAt ?? null,
      ownerSubject: computer.account?.ownerSubject,
    };
  });
  const active = Effect.fn("AccountAccess.active")(function* (sessionId: string) {
    const live = yield* sessions.listActive().pipe(Effect.mapError(() => fail("unavailable")));
    if (!live.some((session) => session.sessionId === sessionId)) return yield* fail("denied");
  });
  const authorize = Effect.fn("AccountAccess.authorize")(function* (
    caller: EnvironmentAuth.AuthenticatedSession,
    environmentId: EnvironmentId,
  ) {
    if (!enabled) return yield* fail("disabled");
    if (
      caller.subject === "mcp-client" ||
      caller.subject.startsWith("loom-host:") ||
      !caller.scopes.includes(AuthOrchestrationOperateScope) ||
      !caller.scopes.includes(AuthAccessWriteScope) ||
      caller.proofKeyThumbprint !== undefined
    )
      return yield* fail("denied");
    yield* active(caller.sessionId);
    const target = yield* route(environmentId);
    if (
      target.ownerSubject !== undefined &&
      target.ownerSubject !== identityOwnershipSubject(caller.subject, environment)
    )
      return yield* fail("denied");
    return target;
  });
  const prepare: AccountAccess["Service"]["prepare"] = Effect.fn("AccountAccess.prepare")(
    function* (input) {
      const { caller } = input;
      const target = yield* authorize(caller, input.environmentId);
      const now = yield* Clock.currentTimeMillis;
      for (const [key, value] of pending) if (value.deadline <= now) pending.delete(key);
      if (pending.size >= MAX_PENDING_GRANTS) return yield* fail("capacity");
      const grant = Hex.encode(yield* random.randomBytes(32).pipe(Effect.orDie));
      const owner = identityOwnershipSubject(caller.subject, environment);
      const lease = {
        keyFingerprint: target.keyFingerprint,
        membershipRevision: target.membershipRevision,
      };
      const principal = owner.startsWith("identity-principal:v1:")
        ? owner
        : `loom-account-owner:${authorityId}:${Buffer.from(owner).toString("base64url")}`;
      pending.set(grant, {
        environmentId: input.environmentId,
        keyFingerprint: target.keyFingerprint,
        method: input.method,
        path: input.path,
        deadline: now + GRANT_LIFETIME_MS,
        lease,
        ownerSubject: owner,
        admission: {
          sessionId: caller.sessionId,
          principal,
          scopes: AuthStandardClientScopes.filter((scope) => caller.scopes.includes(scope)),
          expiresAt: caller.expiresAt?.epochMilliseconds ?? now + GRANT_LIFETIME_MS,
        },
      });
      return { origin: target.origin, grant, lease };
    },
  );
  const consume: AccountAccess["Service"]["consume"] = Effect.fn("AccountAccess.consume")(
    function* (input) {
      if (!enabled) return yield* fail("disabled");
      const { publisher } = input;
      if (publisher.subject === "mcp-client" || !publisher.scopes.includes(AuthLibraryPublishScope))
        return yield* fail("denied");
      const entry = pending.get(input.grant);
      if (
        entry === undefined ||
        publisher.subject !== `loom-host:${entry.environmentId}` ||
        entry.keyFingerprint !== input.keyFingerprint ||
        entry.method !== input.method ||
        entry.path !== input.path
      )
        return yield* fail("denied");
      // Remove before any I/O, so concurrent callbacks can never admit the same grant twice.
      pending.delete(input.grant);
      const now = yield* Clock.currentTimeMillis;
      if (entry.deadline <= now || entry.admission.expiresAt <= now) return yield* fail("denied");
      yield* active(entry.admission.sessionId);
      yield* active(publisher.sessionId);
      const target = yield* route(entry.environmentId);
      if (target.keyFingerprint !== entry.keyFingerprint) return yield* fail("denied");
      if (
        target.membershipRevision !== entry.lease.membershipRevision ||
        (target.ownerSubject !== undefined && target.ownerSubject !== entry.ownerSubject)
      )
        return yield* fail("denied");
      return entry.admission;
    },
  );
  const awaitRemoval = Effect.fn("AccountAccess.awaitRemoval")(function* (
    environmentId: EnvironmentId,
    lease?: AccountLease,
  ) {
    yield* reach.changes.pipe(
      Stream.filter((state) => {
        const computer = state.computers[environmentId];
        return (
          !ReachStore.isReachActive(computer) ||
          !ReachStore.accountAllowsAccess(computer) ||
          (lease !== undefined &&
            (computer?.keyFingerprint !== lease.keyFingerprint ||
              (computer.account?.approvedAt ?? null) !== lease.membershipRevision))
        );
      }),
      Stream.take(1),
      Stream.runDrain,
    );
  });
  const publicRoute = Effect.fn("AccountAccess.publicRoute")(function* (
    environmentId: EnvironmentId,
  ) {
    if (!enabled) return yield* fail("disabled");
    return (yield* route(environmentId)).origin;
  });
  return AccountAccess.of({ prepare, consume, awaitRemoval, publicRoute, authorize });
});

export const layer = Layer.effect(AccountAccess, make);
