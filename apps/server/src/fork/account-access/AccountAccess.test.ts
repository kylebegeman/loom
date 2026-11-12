import * as HostProcess from "@t3tools/shared/HostProcess";
import { identityOwnershipSubject, identitySessionPrefix } from "../../auth/identityPolicy.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthLibraryPublishScope,
  AuthStandardClientScopes,
  EnvironmentId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/SubscriptionRef";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import type * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as Directory from "../directory/DirectoryService.ts";
import * as ReachStore from "../reach/library/ReachStore.ts";
import * as LibraryStore from "../project-library/LibraryStore.ts";
import * as Schema from "effect/Schema";
import * as AccountAccess from "./AccountAccess.ts";

const COMPUTER = EnvironmentId.make("computer-a");
const OTHER = EnvironmentId.make("computer-b");
const OWNER = AuthSessionId.make("owner-device");
const PUBLISHER = AuthSessionId.make("publisher-a");
const KEY = "a".repeat(64);
const encodeAuthority = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.String,
      epoch: Schema.Number,
    }),
  ),
);
const IDENTITY_ENV = {
  LOOM_IDENTITY_ISSUER: "https://id.example.test",
  LOOM_IDENTITY_AUDIENCE: "library",
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner",
};
const caller: EnvironmentAuth.AuthenticatedSession = {
  sessionId: OWNER,
  subject: `${identitySessionPrefix(IDENTITY_ENV)}${Buffer.from("owner").toString("base64url")}`,
  method: "bearer-access-token",
  scopes: AuthStandardClientScopes,
};
const publisher: EnvironmentAuth.AuthenticatedSession = {
  sessionId: PUBLISHER,
  subject: `loom-host:${COMPUTER}`,
  method: "bearer-access-token",
  scopes: [AuthLibraryPublishScope],
};
const fixture = Effect.gen(function* () {
  const active = yield* Ref.make([OWNER, PUBLISHER]);
  const retired = yield* Ref.make(false);
  const revision = yield* Ref.make(0);
  const authorityEpoch = yield* Ref.make(1);
  const approvedEpoch = yield* Ref.make(1);
  const membership = yield* Ref.make<"active" | "removing" | "removed" | null>(null);
  const read = Effect.all([
    Ref.get(retired),
    Ref.get(membership),
    Ref.get(revision),
    Ref.get(approvedEpoch),
  ]).pipe(
    Effect.map(([removed, accountState, membershipRevision, approvedAuthorityEpoch]) => ({
      ...ReachStore.emptyReachLibraryState,
      computers: {
        [COMPUTER]: {
          seq: 1,
          keyFingerprint: KEY,
          hostname: "computer-loom.example.test",
          tunnelId: "tunnel",
          dnsRecordId: "dns",
          origin: "http://localhost:1000",
          state: removed ? ("removed" as const) : ("ready" as const),
          lastError: null,
          leftoverDnsRecordId: null,
          publisherSessionId: PUBLISHER,
          updatedAt: "2026-01-01T00:00:00Z",
          lastEnsuredAt: null,
          identity: null,
          zone: { name: "example.test", zoneId: "zone", accountId: "account" },
          leftoverZones: [],
          ...(accountState === null
            ? {}
            : {
                account: {
                  authorityId: "library-authority",
                  authorityEpoch: approvedAuthorityEpoch,
                  state: accountState,
                  label: "Computer",
                  ownerSubject: identityOwnershipSubject(caller.subject, IDENTITY_ENV),
                  requestId: "enrollment",
                  approvedAt: membershipRevision,
                  epoch: 0,
                  removedAt: accountState === "active" ? null : 1,
                  removalRequestId: accountState === "active" ? null : "removal",
                  publishingEnded: false,
                  routeRemoved: false,
                  directoryRemoved: false,
                  detail: null,
                },
              }),
        },
      },
    })),
  );
  const service = yield* AccountAccess.AccountAccess.pipe(
    Effect.provide(
      AccountAccess.layer.pipe(
        Layer.provide(
          Layer.mock(LibraryStore.LibraryStore)({
            authority: Ref.get(authorityEpoch).pipe(
              Effect.map((epoch) => encodeAuthority({ id: "library-authority", epoch })),
            ),
          }),
        ),
        Layer.provide(
          Layer.mock(SessionStore.SessionStore)({
            cookieName: "test",
            legacyCookieName: undefined,
            listActive: () =>
              Ref.get(active).pipe(
                Effect.flatMap((ids) =>
                  Effect.forEach(ids, (sessionId) =>
                    Effect.gen(function* () {
                      return {
                        sessionId,
                        method: "bearer-access-token" as const,
                        scopes: AuthStandardClientScopes,
                        subject: sessionId === OWNER ? caller.subject : publisher.subject,
                        client: { label: "test", deviceType: "unknown" as const },
                        lastConnectedAt: null,
                        issuedAt: DateTime.toUtc(yield* DateTime.now),
                        expiresAt: DateTime.toUtc(DateTime.add(yield* DateTime.now, { days: 1 })),
                        current: false,
                        connected: false,
                      };
                    }),
                  ),
                ),
              ),
          }),
        ),
        Layer.provide(
          Layer.mock(Directory.DirectoryService)({
            pinned: () =>
              Effect.succeed({ publicKey: "unused", keyFingerprint: KEY, label: "Computer" }),
          }),
        ),
        Layer.provide(
          Layer.mock(ReachStore.ReachStore)({
            changes: Stream.merge(
              Stream.merge(Ref.changes(retired), Ref.changes(membership)),
              Stream.merge(Ref.changes(revision), Ref.changes(approvedEpoch)),
            ).pipe(Stream.mapEffect(() => read)),
            read,
          }),
        ),
        Layer.provide(
          Layer.succeed(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } }),
          ),
        ),
        Layer.provide(SecureRandom.layerWebCrypto),
        Layer.provide(Layer.succeed(HostProcess.Environment, IDENTITY_ENV)),
        Layer.provide(
          Layer.mock(ServerEnvironmentIdentity)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("library")),
          }),
        ),
      ),
    ),
  );
  const prepare = () =>
    service.prepare({ caller, environmentId: COMPUTER, method: "GET", path: "/ws" });
  const consume = (grant: string) =>
    service.consume({ publisher, grant, keyFingerprint: KEY, method: "GET", path: "/ws" });
  return {
    service,
    active,
    retired,
    membership,
    revision,
    authorityEpoch,
    approvedEpoch,
    prepare,
    consume,
  };
});

it.effect("admits an enrolled computer once, without exposing the account credential", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const route = yield* f.prepare();
    expect(route.origin).toBe("https://computer-loom.example.test");
    expect(yield* f.consume(route.grant)).toEqual({
      account: { authorityId: "library-authority", authorityEpoch: 1 },
      sessionId: OWNER,
      principal: identityOwnershipSubject(caller.subject, IDENTITY_ENV),
      scopes: AuthStandardClientScopes,
      expiresAt: 60_000,
    });
    expect((yield* Effect.result(f.consume(route.grant)))._tag).toBe("Failure");
    const secondDevice = AuthSessionId.make("owner-device-two");
    yield* Ref.set(f.active, [OWNER, PUBLISHER, secondDevice]);
    const another = yield* f.service.prepare({
      caller: { ...caller, sessionId: secondDevice },
      environmentId: COMPUTER,
      method: "GET",
      path: "/ws",
    });
    const admission = yield* f.consume(another.grant);
    expect(admission.sessionId).toBe(secondDevice);
    expect(admission.principal).toBe(identityOwnershipSubject(caller.subject, IDENTITY_ENV));
  }),
);

it.effect("requires explicit membership repair after the Library revision changes", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* Ref.set(f.membership, "active");
    const prepared = yield* f.prepare();
    yield* Ref.set(f.authorityEpoch, 2);
    expect((yield* Effect.result(f.consume(prepared.grant)))._tag).toBe("Failure");
    expect((yield* Effect.result(f.prepare()))._tag).toBe("Failure");
    yield* Ref.set(f.approvedEpoch, 2);
    const repaired = yield* f.prepare();
    expect((yield* Effect.result(f.consume(repaired.grant)))._tag).toBe("Success");
  }),
);

it.effect("binds admission to the publisher, machine key, method and full request path", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const { grant } = yield* f.prepare();
    for (const mismatch of [
      { publisher: { ...publisher, subject: `loom-host:${OTHER}` } },
      { publisher: { ...publisher, scopes: AuthStandardClientScopes } },
      { keyFingerprint: "b".repeat(64) },
      { method: "POST" },
      { path: "/ws?another=computer" },
    ])
      expect(
        (yield* Effect.result(
          f.service.consume({
            publisher,
            grant,
            keyFingerprint: KEY,
            method: "GET",
            path: "/ws",
            ...mismatch,
          }),
        ))._tag,
      ).toBe("Failure");
    yield* f.consume(grant);
  }),
);

it.effect("refuses revoked devices, revoked publishers, retired computers and expired grants", () =>
  Effect.gen(function* () {
    for (const change of ["device", "publisher", "computer", "membership", "expired"] as const) {
      const f = yield* fixture;
      const { grant } = yield* f.prepare();
      if (change === "device") yield* Ref.set(f.active, [PUBLISHER]);
      if (change === "publisher") yield* Ref.set(f.active, [OWNER]);
      if (change === "computer") yield* Ref.set(f.retired, true);
      if (change === "membership") yield* Ref.set(f.membership, "removing");
      if (change === "expired") yield* TestClock.adjust(Duration.minutes(1));
      expect((yield* Effect.result(f.consume(grant)))._tag).toBe("Failure");
    }
  }),
);

it.effect("does not turn publishers or restricted agent sessions into owner access", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    for (const denied of [
      publisher,
      { ...caller, subject: "mcp-client" },
      { ...caller, scopes: AuthStandardClientScopes.slice(0, 2) },
      { ...caller, proofKeyThumbprint: "proof" },
    ]) {
      expect(
        (yield* Effect.result(
          f.service.prepare({
            caller: denied,
            environmentId: COMPUTER,
            method: "GET",
            path: "/ws",
          }),
        ))._tag,
      ).toBe("Failure");
    }
  }),
);

it.effect("closes held leases after removal, re-enrollment or Library repair", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* Ref.set(f.membership, "active");
    const { lease, grant } = yield* f.prepare();
    const held = yield* f.service.awaitRemoval(COMPUTER, lease).pipe(Effect.forkChild);
    yield* Ref.set(f.membership, "removing");
    yield* Fiber.join(held);
    expect((yield* Effect.result(f.consume(grant)))._tag).toBe("Failure");
    yield* Ref.set(f.membership, "active");
    yield* Ref.set(f.revision, 1);
    yield* f.service.awaitRemoval(COMPUTER, lease);
    const repaired = yield* f.prepare();
    const beforeRepair = yield* f.service
      .awaitRemoval(COMPUTER, repaired.lease)
      .pipe(Effect.forkChild);
    yield* Ref.set(f.approvedEpoch, 2);
    yield* Fiber.join(beforeRepair);
  }),
);
