import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { EnvironmentId } from "../baseSchemas.ts";

export const SWITCHBOARD_WS_METHODS = {
  limits: "loom.switchboard.limits",
  route: "loom.switchboard.route",
  reconnect: "loom.switchboard.reconnect",
  revokeComputer: "loom.switchboard.revokeComputer",
} as const;

/**
 * Advertised by the computer that shares its Switchboard with the account's other computers.
 * Unlike `switchboard-shared-gateway`, which every build lists, it means the gateway is on.
 */
export const SWITCHBOARD_HUB_FEATURE = "switchboard-hub";
/** Library routes. A computer trades a machine proof for a ticket; the hub redeems it. */
export const SWITCHBOARD_TICKET_ROUTE = "/api/loom/account/switchboard/ticket";
export const SWITCHBOARD_REDEEM_ROUTE = "/api/loom/account/switchboard/redeem";
/** The hub asks which of the computers it issued credentials to are still account members. */
export const SWITCHBOARD_MEMBERS_ROUTE = "/api/loom/account/switchboard/members";
/** On the hub's gateway (`/api/loom/switchboard`): a ticket buys that computer's credential. */
export const SWITCHBOARD_ENROLL_PATH = "/enroll";
export const SWITCHBOARD_MAX_COMPUTERS = 256;

const Sha256Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Bounded = (max: number) => Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(max));

/** The machine-proof envelope a computer posts to the Library, as Vault's account routes use. */
export const SwitchboardTicketEnvelope = Schema.Struct({
  payload: Bounded(1024),
  proof: Bounded(16384),
});
export const SwitchboardTicketRequest = Schema.Struct({ hubEnvironmentId: EnvironmentId });
export type SwitchboardTicketRequest = typeof SwitchboardTicketRequest.Type;
export const SwitchboardTicket = Schema.Struct({ ticket: Sha256Hex, expiresAt: Schema.Number });
export type SwitchboardTicket = typeof SwitchboardTicket.Type;
export const SwitchboardRedeemRequest = Schema.Struct({ ticket: Sha256Hex });

/** The account membership a credential was issued under. Any change to it revokes the credential. */
export const SwitchboardMembership = Schema.Struct({
  environmentId: EnvironmentId,
  keyFingerprint: Sha256Hex,
  authorityId: Bounded(128),
  authorityEpoch: Schema.Number,
  membershipRevision: Schema.Number,
  membershipEpoch: Schema.Number,
  ownerSubject: Bounded(512),
});
export type SwitchboardMembership = typeof SwitchboardMembership.Type;
export const SwitchboardRedemption = Schema.Struct({
  label: Bounded(160),
  membership: SwitchboardMembership,
});
export type SwitchboardRedemption = typeof SwitchboardRedemption.Type;
export const SwitchboardMembersRequest = Schema.Struct({
  memberships: Schema.Array(SwitchboardMembership).check(
    Schema.isMaxLength(SWITCHBOARD_MAX_COMPUTERS),
  ),
});
export const SwitchboardMembers = Schema.Struct({ active: Schema.Array(EnvironmentId) });
export const SwitchboardEnrollRequest = SwitchboardRedeemRequest;
export const SwitchboardEnrollment = Schema.Struct({
  credential: Schema.RedactedFromValue(Sha256Hex),
});

const SwitchboardDriver = Schema.Literals(["claudeAgent", "codex"]);

/**
 * A pooled provider with no account that has plan allowance left, as the Switchboard
 * controller last saw it. Providers with allowance are not listed.
 */
export const SwitchboardLimit = Schema.Struct({
  driver: SwitchboardDriver,
  /** Model patterns the hub still serves, on credits. `*` matches any run of characters. */
  servedModels: Schema.Array(Schema.String),
  /** Earliest time, in epoch milliseconds, an account gets plan allowance back. */
  until: Schema.NullOr(Schema.Number),
});
export type SwitchboardLimit = typeof SwitchboardLimit.Type;

/**
 * One model as Switchboard's controller evaluates it. Only `unavailable` is a
 * confirmed block; `unknown` means its readings or policy could not be confirmed.
 */
export const SwitchboardModelAvailability = Schema.Struct({
  driver: SwitchboardDriver,
  /** The model ID the hub routes, matched against the picker's model slug. */
  id: Schema.String,
  state: Schema.Literals(["available", "restricted", "unavailable", "unknown"]),
  /** Switchboard's own explanation of the state. */
  reason: Schema.String,
  /** Earliest future time, in epoch milliseconds, an account for it resets. */
  resetAt: Schema.NullOr(Schema.Number),
});
export type SwitchboardModelAvailability = typeof SwitchboardModelAvailability.Type;

export const SwitchboardLimits = Schema.Struct({
  limits: Schema.Array(SwitchboardLimit),
  /** Per-model states when the controller reported them. Absent from older servers. */
  models: Schema.optionalKey(Schema.Array(SwitchboardModelAvailability)),
  /**
   * Whether the limits reflect a current controller reading. `unavailable`, `stale` and
   * `unconfigured` mean availability is unknown, so nothing is blocked; they never imply allowance
   * is left. `unconfigured` means the server has no usable controller setting for its hub.
   */
  availability: Schema.optionalKey(
    Schema.Literals(["available", "unavailable", "stale", "unconfigured", "disabled"]),
  ),
});
export type SwitchboardLimits = typeof SwitchboardLimits.Type;

/**
 * Where routed launches go: this computer's own hub, the hub `LOOM_SWITCHBOARD_URL` names, or the
 * account's hub found through the Library. `invalid` means the environment settings are unusable.
 */
export const SwitchboardRouteSource = Schema.Literals([
  "local",
  "environment",
  "account",
  "invalid",
]);
export type SwitchboardRouteSource = typeof SwitchboardRouteSource.Type;

/**
 * This computer's place in the account's Switchboard. `hub` shares it; `unavailable` has no
 * account Library connection or platform support; `searching` found no hub in the directory;
 * `connecting` is enrolling or waiting to retry; `connected` holds a credential the hub accepted at
 * the last check; `unreachable` holds one but the hub did not answer.
 */
export const SwitchboardAccountState = Schema.Literals([
  "hub",
  "unavailable",
  "searching",
  "connecting",
  "connected",
  "unreachable",
]);
export type SwitchboardAccountState = typeof SwitchboardAccountState.Type;

export const SwitchboardHub = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
});

/** A computer the hub issued a credential to. */
export const SwitchboardComputer = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  /** The name Switchboard's request ledger shows for it. */
  device: Schema.String,
  issuedAt: Schema.Number,
  lastUsedAt: Schema.NullOr(Schema.Number),
});
export type SwitchboardComputer = typeof SwitchboardComputer.Type;

export const SwitchboardRouteStatus = Schema.Struct({
  enabled: Schema.Boolean,
  source: SwitchboardRouteSource,
  /** The hub endpoint routed launches use. It carries no credential. */
  url: Schema.NullOr(Schema.String),
  account: Schema.Struct({
    state: SwitchboardAccountState,
    hub: Schema.NullOr(SwitchboardHub),
    checkedAt: Schema.NullOr(Schema.Number),
    /** Why the last enrollment or check failed, in plain words. */
    problem: Schema.NullOr(Schema.String),
  }),
  /** Only on the hub. */
  computers: Schema.optionalKey(Schema.Array(SwitchboardComputer)),
});
export type SwitchboardRouteStatus = typeof SwitchboardRouteStatus.Type;

const SwitchboardLimitsRpc = Rpc.make(SWITCHBOARD_WS_METHODS.limits, {
  payload: Schema.Struct({}),
  success: SwitchboardLimits,
  error: EnvironmentAuthorizationError,
});
const SwitchboardRouteRpc = Rpc.make(SWITCHBOARD_WS_METHODS.route, {
  payload: Schema.Struct({}),
  success: SwitchboardRouteStatus,
  error: EnvironmentAuthorizationError,
});
/** Replaces this computer's hub credential with a newly issued one. */
const SwitchboardReconnectRpc = Rpc.make(SWITCHBOARD_WS_METHODS.reconnect, {
  payload: Schema.Struct({}),
  success: SwitchboardRouteStatus,
  error: EnvironmentAuthorizationError,
});
/** On the hub: revokes one computer's credential. It enrolls again only while still a member. */
const SwitchboardRevokeComputerRpc = Rpc.make(SWITCHBOARD_WS_METHODS.revokeComputer, {
  payload: Schema.Struct({ environmentId: EnvironmentId }),
  success: SwitchboardRouteStatus,
  error: EnvironmentAuthorizationError,
});

export const SwitchboardRpcGroup = RpcGroup.make(
  SwitchboardLimitsRpc,
  SwitchboardRouteRpc,
  SwitchboardReconnectRpc,
  SwitchboardRevokeComputerRpc,
);
