import { AuthLibraryPublishScope, EnvironmentId } from "@t3tools/contracts";
import {
  SWITCHBOARD_HUB_FEATURE,
  SwitchboardTicketRequest,
  type SwitchboardMembership,
  type SwitchboardRedemption,
  type SwitchboardTicket,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { AccountWorkloads } from "../account-access/AccountWorkloads.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { accountAllowsAccess, ReachStore } from "../reach/library/ReachStore.ts";
import { SwitchboardAccountError } from "./SwitchboardAccountError.ts";

const TICKET_MS = 60_000;
const MAX_TICKETS = 256;
const decodeTicketRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SwitchboardTicketRequest),
);
const denied = () => new SwitchboardAccountError({ reason: "denied" });
const unavailable = () => new SwitchboardAccountError({ reason: "unavailable" });

interface Pending {
  readonly hubEnvironmentId: EnvironmentId;
  readonly label: string;
  readonly membership: SwitchboardMembership;
  readonly expiresAt: number;
}

/**
 * On the Library: lets an account computer obtain its own credential from the account's
 * Switchboard hub. The computer proves itself to the Library and gets a one-use ticket bound to
 * one hub; the hub redeems it through its own Library connection, so neither trusts the other's
 * word about membership. The hub later asks which memberships still hold.
 */
export class SwitchboardIssuer extends Context.Service<
  SwitchboardIssuer,
  {
    readonly ticket: (
      envelope: { readonly payload: string; readonly proof: string },
      publisher: AuthenticatedSession,
    ) => Effect.Effect<SwitchboardTicket, SwitchboardAccountError>;
    readonly redeem: (
      ticket: string,
      publisher: AuthenticatedSession,
    ) => Effect.Effect<SwitchboardRedemption, SwitchboardAccountError>;
    readonly members: (
      memberships: ReadonlyArray<SwitchboardMembership>,
      publisher: AuthenticatedSession,
    ) => Effect.Effect<ReadonlyArray<EnvironmentId>, SwitchboardAccountError>;
  }
>()("t3/fork/switchboard/SwitchboardIssuer") {}

/** The computer behind a Library publisher session, or null for any other session. */
const publisherComputer = (publisher: AuthenticatedSession) =>
  publisher.subject.startsWith("loom-host:") &&
  publisher.scopes.length === 1 &&
  publisher.scopes[0] === AuthLibraryPublishScope
    ? EnvironmentId.make(publisher.subject.slice("loom-host:".length))
    : null;

const make = Effect.gen(function* () {
  const workloads = yield* AccountWorkloads;
  const directory = yield* DirectoryService;
  const reach = yield* ReachStore;
  const library = yield* LibraryPublisher;
  const random = yield* SecureRandom.SecureRandom;
  const pending = new Map<string, Pending>();

  const authority = Effect.gen(function* () {
    const info = yield* library.info.pipe(Effect.mapError(unavailable));
    if (!info.isAuthority) return yield* new SwitchboardAccountError({ reason: "not-authority" });
    return info;
  });

  /** A hub is a computer the directory lists as sharing its Switchboard, still in the account. */
  const hub = Effect.fn("SwitchboardIssuer.hub")(function* (environmentId: EnvironmentId) {
    const listing = yield* directory.computers.pipe(Effect.mapError(unavailable));
    const entry = listing.environments.find((entry) => entry.environmentId === environmentId);
    const computer = (yield* reach.read.pipe(Effect.mapError(unavailable))).computers[
      environmentId
    ];
    if (!entry?.loomFeatures.includes(SWITCHBOARD_HUB_FEATURE) || !accountAllowsAccess(computer))
      return yield* denied();
  });

  const active = Effect.fn("SwitchboardIssuer.active")(function* (
    membership: SwitchboardMembership,
  ) {
    const info = yield* authority;
    if (
      info.authorityId !== membership.authorityId ||
      info.authorityEpoch !== membership.authorityEpoch
    )
      return false;
    const pin = yield* directory
      .pinned(membership.environmentId)
      .pipe(Effect.mapError(unavailable));
    const computer = (yield* reach.read.pipe(Effect.mapError(unavailable))).computers[
      membership.environmentId
    ];
    // Unlike `AccountWorkloads.revalidate`, the publisher session is not part of membership: it
    // renews with no lasting record, and a lasting credential must survive that.
    return (
      pin?.keyFingerprint === membership.keyFingerprint &&
      computer?.keyFingerprint === membership.keyFingerprint &&
      computer.account?.state === "active" &&
      computer.account.approvedAt === membership.membershipRevision &&
      computer.account.epoch === membership.membershipEpoch &&
      computer.account.ownerSubject === membership.ownerSubject &&
      computer.account.authorityId === membership.authorityId &&
      computer.account.authorityEpoch === membership.authorityEpoch
    );
  });

  const ticket = Effect.fn("SwitchboardIssuer.ticket")(function* (
    envelope: { readonly payload: string; readonly proof: string },
    publisher: AuthenticatedSession,
  ) {
    yield* authority;
    const lease = yield* workloads
      .acceptProvider(envelope.payload, envelope.proof, publisher)
      .pipe(
        Effect.mapError((error) =>
          error.reason === "denied"
            ? denied()
            : error.reason === "unavailable"
              ? unavailable()
              : new SwitchboardAccountError({ reason: "invalid" }),
        ),
      );
    const { hubEnvironmentId } = yield* decodeTicketRequest(envelope.payload).pipe(
      Effect.mapError(() => new SwitchboardAccountError({ reason: "invalid" })),
    );
    if (hubEnvironmentId === lease.sourceEnvironmentId) return yield* denied();
    yield* hub(hubEnvironmentId);
    const pin = yield* directory
      .pinned(lease.sourceEnvironmentId)
      .pipe(Effect.mapError(unavailable));
    const now = yield* Clock.currentTimeMillis;
    for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
    if (pending.size >= MAX_TICKETS) return yield* unavailable();
    const value = Hex.encode(yield* random.randomBytes(32).pipe(Effect.mapError(unavailable)));
    const expiresAt = now + TICKET_MS;
    pending.set(value, {
      hubEnvironmentId,
      label: pin?.label ?? lease.sourceEnvironmentId,
      membership: {
        environmentId: lease.sourceEnvironmentId,
        keyFingerprint: lease.keyFingerprint,
        authorityId: lease.authorityId,
        authorityEpoch: lease.authorityEpoch,
        membershipRevision: lease.membershipRevision,
        membershipEpoch: lease.membershipEpoch,
        ownerSubject: lease.ownerSubject,
      },
      expiresAt,
    });
    return { ticket: value, expiresAt };
  });

  const redeem = Effect.fn("SwitchboardIssuer.redeem")(function* (
    value: string,
    publisher: AuthenticatedSession,
  ) {
    yield* authority;
    const hubEnvironmentId = publisherComputer(publisher);
    const entry = pending.get(value);
    // One use, even by the wrong hub, so a ticket seen elsewhere cannot be raced.
    pending.delete(value);
    if (
      hubEnvironmentId === null ||
      entry === undefined ||
      entry.hubEnvironmentId !== hubEnvironmentId ||
      entry.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* denied();
    yield* hub(hubEnvironmentId);
    if (!(yield* active(entry.membership))) return yield* denied();
    return { label: entry.label, membership: entry.membership };
  });

  const members = Effect.fn("SwitchboardIssuer.members")(function* (
    memberships: ReadonlyArray<SwitchboardMembership>,
    publisher: AuthenticatedSession,
  ) {
    yield* authority;
    const hubEnvironmentId = publisherComputer(publisher);
    if (hubEnvironmentId === null) return yield* denied();
    yield* hub(hubEnvironmentId);
    const results = yield* Effect.forEach(memberships, (membership) =>
      active(membership).pipe(Effect.map((ok) => (ok ? [membership.environmentId] : []))),
    );
    return results.flat();
  });

  return SwitchboardIssuer.of({ ticket, redeem, members });
});

export const layer = Layer.effect(SwitchboardIssuer, make);
