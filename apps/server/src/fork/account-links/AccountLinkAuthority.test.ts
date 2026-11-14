// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation.
import * as NodeCrypto from "node:crypto";
import * as PlatformCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  type AuthClientSession,
  AuthLibraryPublishScope,
  AuthSessionId,
  AuthStandardClientScopes,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  ACCOUNT_LINKS_FEATURE,
  type DirectoryListing,
  LibraryError,
} from "@t3tools/contracts/fork";
import { directoryPublicKeyFromPem, signAccountLinkProof } from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import type * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as Directory from "../directory/DirectoryService.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import * as LibraryStore from "../project-library/LibraryStore.ts";
import * as ReachStore from "../reach/library/ReachStore.ts";
import { AccountLinkAuthority, layer } from "./AccountLinkAuthority.ts";
import { AccountLinksMigrations } from "./migrations.ts";

const OWNER = "identity-owner:owner";
const A = EnvironmentId.make("computer-a");
const B = EnvironmentId.make("computer-b");
const OLD = EnvironmentId.make("computer-old");
const STRANGER = EnvironmentId.make("computer-stranger");
const LEFT = EnvironmentId.make("computer-left");
const KEY_B = "b".repeat(64);
const keyPair = () =>
  NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
const KEY_A = keyPair();
const OTHER_KEY = keyPair();

const owner: EnvironmentAuth.AuthenticatedSession = {
  sessionId: AuthSessionId.make("owner-device"),
  subject: OWNER,
  method: "bearer-access-token",
  scopes: AuthStandardClientScopes,
};
const publisherOf = (environmentId: EnvironmentId): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`publisher-${environmentId}`),
  subject: `loom-host:${environmentId}`,
  method: "bearer-access-token",
  scopes: [AuthLibraryPublishScope],
});

interface Member {
  ownerSubject: string;
  state: "active" | "removing" | "removed";
  authorityEpoch: number;
  features: ReadonlyArray<string>;
}

const fixture = (authority = true) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(AccountLinksMigrations);
    const members = new Map<EnvironmentId, Member>([
      [
        A,
        {
          ownerSubject: OWNER,
          state: "active",
          authorityEpoch: 1,
          features: [ACCOUNT_LINKS_FEATURE],
        },
      ],
      [
        B,
        {
          ownerSubject: OWNER,
          state: "active",
          authorityEpoch: 1,
          features: [ACCOUNT_LINKS_FEATURE],
        },
      ],
      [OLD, { ownerSubject: OWNER, state: "active", authorityEpoch: 1, features: [] }],
      [
        STRANGER,
        {
          ownerSubject: "identity-owner:other",
          state: "active",
          authorityEpoch: 1,
          features: [ACCOUNT_LINKS_FEATURE],
        },
      ],
      [
        LEFT,
        {
          ownerSubject: OWNER,
          state: "removed",
          authorityEpoch: 1,
          features: [ACCOUNT_LINKS_FEATURE],
        },
      ],
    ]);
    const active = new Set([...members.keys()].map((id) => publisherOf(id).sessionId));
    const service = yield* AccountLinkAuthority.pipe(
      Effect.provide(
        layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                ConfigProvider.ConfigProvider,
                ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: String(authority) } }),
              ),
              SecureRandom.layerWebCrypto,
              PlatformCrypto.layer,
              Layer.mock(LibraryStore.LibraryStore)({
                authority: Effect.succeed('{"id":"library-authority","epoch":1}'),
              }),
              Layer.mock(LibraryManagement)({
                authorizeEnrollment: (session) =>
                  session.subject === OWNER
                    ? Effect.void
                    : Effect.fail(new LibraryError({ reason: "blocked" })),
              }),
              Layer.mock(SessionStore.SessionStore)({
                cookieName: "test",
                legacyCookieName: undefined,
                listActive: () =>
                  Effect.sync(() =>
                    [...active].map((sessionId) => ({ sessionId }) as unknown as AuthClientSession),
                  ),
              }),
              Layer.mock(Directory.DirectoryService)({
                list: Effect.sync(() => ({
                  environments: [...members].map(
                    ([environmentId, member]) =>
                      ({
                        environmentId,
                        label: `Computer ${environmentId.slice("computer-".length)}`,
                        loomFeatures: member.features,
                        routes: [{ kind: "public", url: `https://${environmentId}.example.test` }],
                      }) as unknown as DirectoryListing["environments"][number],
                  ),
                  machines: [],
                  generatedAt: "2026-01-01T00:00:00Z",
                })),
                pinned: (environmentId) =>
                  Effect.succeed(
                    members.has(environmentId)
                      ? {
                          publicKey: directoryPublicKeyFromPem(
                            (environmentId === A ? KEY_A : OTHER_KEY).publicKey,
                          )!,
                          keyFingerprint: environmentId === B ? KEY_B : "f".repeat(64),
                          label: null,
                        }
                      : null,
                  ),
              }),
              Layer.mock(ReachStore.ReachStore)({
                read: Effect.sync(() => ({
                  ...ReachStore.emptyReachLibraryState,
                  computers: Object.fromEntries(
                    [...members].map(([environmentId, member]) => [
                      environmentId,
                      {
                        ...ReachStore.freshComputer("2026-01-01T00:00:00Z"),
                        account: {
                          authorityId: "library-authority",
                          authorityEpoch: member.authorityEpoch,
                          label: `Computer ${environmentId}`,
                          ownerSubject: member.ownerSubject,
                          requestId: "enrollment",
                          approvedAt: 0,
                          epoch: 0,
                          removedAt: null,
                          removalRequestId: null,
                          state: member.state,
                          publishingEnded: false,
                          routeRemoved: false,
                          directoryRemoved: false,
                          detail: null,
                        },
                      },
                    ]),
                  ),
                })),
              }),
            ),
          ),
        ),
      ),
    );
    const reason = <A>(effect: Effect.Effect<A, { readonly reason: string }>) =>
      effect.pipe(
        Effect.flip,
        Effect.map((error) => error.reason),
      );
    const grantFor = (target: EnvironmentId) =>
      service.grant(publisherOf(A), { environmentId: target }).pipe(Effect.map((g) => g.grant));
    const signature = yield* Signature.Signature;
    /** What `source` signs when it presents `grant` to `target`. */
    const proofFor = (
      grant: string,
      { privateKey = KEY_A.privateKey, source = A, target = B } = {},
    ) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          signAccountLinkProof({ privateKey, source, target, grant, nowEpochSeconds: now / 1000 }),
        ),
        Effect.provideService(Signature.Signature, signature),
        Effect.orDie,
      );
    const redeem = (grant: string, by = B, keyFingerprint = KEY_B, source = A, proof?: string) =>
      Effect.gen(function* () {
        return yield* service.verify(publisherOf(by), {
          grant,
          source,
          keyFingerprint,
          proof: proof ?? (yield* proofFor(grant)),
        });
      });
    return { service, members, active, reason, grantFor, proofFor, redeem };
  });

const layers = Layer.mergeAll(SqlitePersistenceMemory, PlatformCrypto.layer);

it.effect("lists a computer its owner's other active computers and admits each link once", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const roster = yield* f.service.roster(publisherOf(A));
    expect(roster.account).toEqual({ authorityId: "library-authority", authorityEpoch: 1 });
    expect(roster.policy).toEqual({ enabled: true, access: "full-access" });
    expect(roster.members.map((m) => [m.environmentId, m.linkable])).toEqual([
      [B, true],
      [OLD, false],
    ]);
    expect(yield* f.reason(f.grantFor(OLD))).toBe("denied");
    expect(yield* f.reason(f.grantFor(STRANGER))).toBe("denied");

    const grant = yield* f.grantFor(B);
    expect(yield* f.redeem(grant)).toEqual({
      source: A,
      label: "Computer a",
      access: "full-access",
      account: roster.account,
    });
    expect(yield* f.reason(f.redeem(grant))).toBe("denied");
  }).pipe(Effect.provide(layers)),
);

it.effect("redeems a grant only for its target, while fresh, current and still a member", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const grant = yield* f.grantFor(B);
    // A wrong presentation leaves the grant for its target, so no other computer can burn it.
    expect(yield* f.reason(f.redeem(grant, OLD))).toBe("denied");
    expect(yield* f.reason(f.redeem(grant, B, "c".repeat(64)))).toBe("denied");
    expect(yield* f.reason(f.redeem(grant, B, KEY_B, OLD))).toBe("denied");
    expect((yield* f.redeem(grant)).source).toBe(A);

    const stale = yield* f.grantFor(B);
    yield* TestClock.adjust("61 seconds");
    expect(yield* f.reason(f.redeem(stale))).toBe("denied");

    const lowered = yield* f.grantFor(B);
    yield* f.service.setPolicy(owner, { enabled: true, access: "read-only" });
    expect(yield* f.reason(f.redeem(lowered))).toBe("denied");

    const revoked = yield* f.grantFor(B);
    f.active.delete(publisherOf(B).sessionId);
    expect(yield* f.reason(f.redeem(revoked))).toBe("denied");
    f.active.add(publisherOf(B).sessionId);

    const leaving = yield* f.grantFor(B);
    f.members.set(B, { ...f.members.get(B)!, state: "removing" });
    expect(yield* f.reason(f.redeem(leaving))).toBe("denied");
    expect(yield* f.reason(f.service.roster(publisherOf(B)))).toBe("denied");

    f.members.set(A, { ...f.members.get(A)!, authorityEpoch: 2 });
    expect(yield* f.reason(f.service.roster(publisherOf(A)))).toBe("denied");
  }).pipe(Effect.provide(layers)),
);

it.effect("keeps the policy for the owner, and gives nothing to other sessions", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    expect(yield* f.service.policy(owner)).toEqual({ enabled: true, access: "full-access" });
    expect(
      yield* f.reason(f.service.setPolicy(publisherOf(A), { enabled: false, access: "read-only" })),
    ).toBe("blocked");
    yield* f.service.setPolicy(owner, { enabled: false, access: "approval-required" });
    expect(yield* f.service.policy(owner)).toEqual({ enabled: false, access: "approval-required" });
    expect((yield* f.service.roster(publisherOf(A))).policy.enabled).toBe(false);
    expect(yield* f.reason(f.grantFor(B))).toBe("denied");

    expect(yield* f.reason(f.service.roster(owner))).toBe("denied");
    expect(
      yield* f.reason(f.service.roster({ ...publisherOf(A), scopes: AuthStandardClientScopes })),
    ).toBe("denied");
    const off = yield* fixture(false);
    expect(yield* f.reason(off.service.roster(publisherOf(A)))).toBe("disabled");
  }).pipe(Effect.provide(layers)),
);

it.effect("redeems a grant only with its source's own proof for the computer redeeming it", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const grant = yield* f.grantFor(B);
    // Each refusal leaves the grant for the real presentation.
    for (const proof of [
      yield* f.proofFor(grant, { privateKey: OTHER_KEY.privateKey }),
      yield* f.proofFor(grant, { target: OLD }),
      yield* f.proofFor(grant, { source: OLD }),
      yield* f.proofFor("0".repeat(64)),
      "not-a-proof",
    ])
      expect(yield* f.reason(f.redeem(grant, B, KEY_B, A, proof))).toBe("denied");
    expect((yield* f.redeem(grant)).source).toBe(A);
  }).pipe(Effect.provide(layers)),
);
