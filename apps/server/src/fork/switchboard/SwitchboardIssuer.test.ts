import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { AuthLibraryPublishScope, AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import {
  SWITCHBOARD_HUB_FEATURE,
  VaultError,
  type DirectoryEnvironment,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { AccountWorkloads } from "../account-access/AccountWorkloads.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { freshComputer, ReachStore, type ReachLibraryState } from "../reach/library/ReachStore.ts";
import * as Issuer from "./SwitchboardIssuer.ts";

const AIR = EnvironmentId.make("air");
const HUB = EnvironmentId.make("dorothy");
const OTHER = EnvironmentId.make("other");
const FINGERPRINT = "f".repeat(64);
const publisher = (id: EnvironmentId): AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${id}`),
  subject: `loom-host:${id}`,
  method: "bearer-access-token",
  scopes: [AuthLibraryPublishScope],
});
const member = (approvedAt = 10) => ({
  ...freshComputer("2026-11-01T00:00:00.000Z"),
  keyFingerprint: FINGERPRINT,
  account: {
    authorityId: "authority",
    authorityEpoch: 1,
    label: "Kyle's MacBook Air",
    ownerSubject: "kyle",
    requestId: "request",
    approvedAt,
    epoch: 0,
    removedAt: null,
    removalRequestId: null,
    state: "active" as const,
    publishingEnded: false,
    routeRemoved: false,
    directoryRemoved: false,
    detail: null,
  },
});
const entry = (environmentId: EnvironmentId, features: ReadonlyArray<string>) =>
  ({
    environmentId,
    loomFeatures: features,
  }) as unknown as DirectoryEnvironment;

const fixture = Effect.gen(function* () {
  const state = {
    authority: true,
    accepted: true,
    reach: {
      version: 1,
      zone: null,
      edge: null,
      computers: { [AIR]: member(), [HUB]: member(), [OTHER]: member() },
    } as ReachLibraryState,
    hubFeatures: [SWITCHBOARD_HUB_FEATURE] as ReadonlyArray<string>,
  };
  const issuer = yield* Issuer.SwitchboardIssuer.pipe(
    Effect.provide(
      Issuer.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeCrypto.layer,
            Layer.mock(AccountWorkloads)({
              acceptProvider: (_payload, _proof, session) =>
                state.accepted
                  ? Effect.succeed({
                      sourceEnvironmentId: EnvironmentId.make(
                        session.subject.slice("loom-host:".length),
                      ),
                      publisherSessionId: session.sessionId,
                      authorityId: "authority",
                      authorityEpoch: 1,
                      keyFingerprint: FINGERPRINT,
                      membershipRevision: 10,
                      membershipEpoch: 0,
                      ownerSubject: "kyle",
                      expiresAt: Number.MAX_SAFE_INTEGER,
                    })
                  : Effect.fail(new VaultError({ reason: "denied" })),
            }),
            Layer.mock(DirectoryService)({
              computers: Effect.sync(() => ({
                environments: [entry(HUB, state.hubFeatures), entry(OTHER, [])],
                machines: [],
                generatedAt: "2026-11-14T00:00:00.000Z",
              })),
              pinned: (id) =>
                Effect.succeed({
                  publicKey: "key",
                  keyFingerprint: FINGERPRINT,
                  label: id === AIR ? "Kyle's MacBook Air" : null,
                }),
            }),
            Layer.mock(ReachStore)({ read: Effect.sync(() => state.reach) }),
            Layer.mock(LibraryPublisher)({
              enabled: true,
              info: Effect.sync(() => ({
                environmentId: EnvironmentId.make("library"),
                isAuthority: state.authority,
                authorityId: "authority",
                authorityEpoch: 1,
                assets: "local" as const,
              })),
            }),
          ),
        ),
      ),
    ),
  );
  const ticket = (hub = HUB) =>
    issuer.ticket(
      { payload: JSON.stringify({ hubEnvironmentId: hub }), proof: "proof" },
      publisher(AIR),
    );
  return { state, issuer, ticket };
});

it.effect("trades a computer's proof for a one-use ticket only the named hub redeems", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const issued = yield* f.ticket();
    expect(yield* f.issuer.redeem(issued.ticket, publisher(HUB))).toEqual({
      label: "Kyle's MacBook Air",
      membership: {
        environmentId: AIR,
        keyFingerprint: FINGERPRINT,
        authorityId: "authority",
        authorityEpoch: 1,
        membershipRevision: 10,
        membershipEpoch: 0,
        ownerSubject: "kyle",
      },
    });
    expect((yield* f.issuer.redeem(issued.ticket, publisher(HUB)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    // A wrong hub burns the ticket, so a leaked one cannot be raced to the right hub.
    const leaked = yield* f.ticket();
    expect((yield* f.issuer.redeem(leaked.ticket, publisher(OTHER)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    expect((yield* f.issuer.redeem(leaked.ticket, publisher(HUB)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    const expired = yield* f.ticket();
    yield* TestClock.adjust("61 seconds");
    expect((yield* f.issuer.redeem(expired.ticket, publisher(HUB)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
  }),
);

it.effect("refuses non-hubs, self tickets, refused proofs and memberships that changed", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    expect((yield* f.ticket(OTHER).pipe(Effect.flip)).reason).toBe("denied");
    expect((yield* f.ticket(AIR).pipe(Effect.flip)).reason).toBe("denied");
    f.state.accepted = false;
    expect((yield* f.ticket().pipe(Effect.flip)).reason).toBe("denied");
    f.state.accepted = true;
    const pending = yield* f.ticket();
    f.state.reach = {
      ...f.state.reach,
      computers: { ...f.state.reach.computers, [AIR]: member(11) },
    };
    expect((yield* f.issuer.redeem(pending.ticket, publisher(HUB)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    f.state.authority = false;
    expect((yield* f.ticket().pipe(Effect.flip)).reason).toBe("not-authority");
  }),
);

it.effect("tells a hub which of its computers are still members, and only a hub", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const issued = yield* f.ticket();
    const { membership } = yield* f.issuer.redeem(issued.ticket, publisher(HUB));
    expect(yield* f.issuer.members([membership], publisher(HUB))).toEqual([AIR]);
    expect((yield* f.issuer.members([membership], publisher(OTHER)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    const removed = member();
    f.state.reach = {
      ...f.state.reach,
      computers: {
        ...f.state.reach.computers,
        [AIR]: { ...removed, account: { ...removed.account, state: "removed" } },
      },
    };
    expect(yield* f.issuer.members([membership], publisher(HUB))).toEqual([]);
    f.state.hubFeatures = [];
    expect((yield* f.issuer.members([membership], publisher(HUB)).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
  }),
);
