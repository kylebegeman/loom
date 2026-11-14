import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import { AuthMcpClientAccess, EnvironmentAuthorizationError } from "../auth.ts";
import { EnvironmentId, IsoDateTime } from "../baseSchemas.ts";
import { AccountComputerBinding } from "./account-access.ts";
import { DirectoryRoute } from "./directory.ts";
import { LibraryError } from "./project-library.ts";

/** Advertised by a computer that links to the account's other computers and admits their links. */
export const ACCOUNT_LINKS_FEATURE = "account-links";
/** Advertised by a Library that keeps the account's link policy and hands out link grants. */
export const ACCOUNT_LINKS_LIBRARY_FEATURE = "account-links-library";

/** On the Library, for a computer's publisher session. */
export const ACCOUNT_LINKS_ROSTER = "/api/loom/account/links/roster";
export const ACCOUNT_LINKS_GRANT = "/api/loom/account/links/grant";
export const ACCOUNT_LINKS_VERIFY = "/api/loom/account/links/verify";
/** On every computer, reachable on its Loomhost address: where another computer presents a grant. */
export const ACCOUNT_LINKS_ADMIT = "/api/loom/account/links/admit";

const Grant = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Label = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(160));
/** The presenting computer's signature over the grant and the computer it presents to. */
const Proof = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2048));

/** Whether agents on the owner's computers may work on each other, and with what access. */
export const AccountLinkPolicy = Schema.Struct({
  enabled: Schema.Boolean,
  access: AuthMcpClientAccess,
});
export type AccountLinkPolicy = typeof AccountLinkPolicy.Type;

export const DEFAULT_ACCOUNT_LINK_POLICY: AccountLinkPolicy = {
  enabled: true,
  access: "full-access",
};

/** One active computer of the account, as the Library knows it. */
export const AccountLinkMember = Schema.Struct({
  environmentId: EnvironmentId,
  label: Label,
  /** Its public route when Loomhost is ready, then its tailnet routes, from its signed report. */
  routes: Schema.Array(DirectoryRoute),
  /** Whether it runs a version that admits account links. */
  linkable: Schema.Boolean,
});
export type AccountLinkMember = typeof AccountLinkMember.Type;

/** What the Library answers a computer of the account. It never lists the computer itself. */
export const AccountLinkRoster = Schema.Struct({
  account: AccountComputerBinding,
  policy: AccountLinkPolicy,
  members: Schema.Array(AccountLinkMember),
});
export type AccountLinkRoster = typeof AccountLinkRoster.Type;

export const AccountLinkGrantRequest = Schema.Struct({ environmentId: EnvironmentId });
export type AccountLinkGrantRequest = typeof AccountLinkGrantRequest.Type;

/** One use, for one target, and only redeemable by that target's own Library connection. */
export const AccountLinkGrant = Schema.Struct({
  grant: Grant,
  access: AuthMcpClientAccess,
  expiresAt: Schema.Number,
});
export type AccountLinkGrant = typeof AccountLinkGrant.Type;

/**
 * What a computer presents to another. `environmentId` names the computer presenting it, and
 * `proof` is its directory key's signature over the grant and the computer it presents to.
 */
export const AccountLinkAdmitRequest = Schema.Struct({
  grant: Grant,
  proof: Proof,
  environmentId: EnvironmentId,
});
export type AccountLinkAdmitRequest = typeof AccountLinkAdmitRequest.Type;

/** The admitting computer's peer-link session for the presenting one. Never log or persist it. */
export const AccountLinkAdmission = Schema.Struct({
  environmentId: EnvironmentId,
  access: AuthMcpClientAccess,
  accessToken: Schema.RedactedFromValue(Schema.String.check(Schema.isNonEmpty())),
  expiresAt: IsoDateTime,
});
export type AccountLinkAdmission = typeof AccountLinkAdmission.Type;

/** The admitting computer asks the Library whether the grant names it, with its key. */
export const AccountLinkVerifyRequest = Schema.Struct({
  grant: Grant,
  proof: Proof,
  source: EnvironmentId,
  keyFingerprint: Schema.String.check(Schema.isMaxLength(256)),
});
export type AccountLinkVerifyRequest = typeof AccountLinkVerifyRequest.Type;

export const AccountLinkVerification = Schema.Struct({
  source: EnvironmentId,
  label: Label,
  access: AuthMcpClientAccess,
  account: AccountComputerBinding,
});
export type AccountLinkVerification = typeof AccountLinkVerification.Type;

/** One computer of the account. `expiresAt` is null while no link to or from it is held. */
export const AccountLinkEntry = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  access: AuthMcpClientAccess,
  expiresAt: Schema.NullOr(IsoDateTime),
  /** Why the last attempt to link to it failed. Loom keeps retrying. */
  lastError: Schema.NullOr(Schema.String),
});
export type AccountLinkEntry = typeof AccountLinkEntry.Type;

/**
 * This computer's account links. `outbound` lists every computer it should link to, with the link
 * it holds there; `inbound` the sessions it issued them. `policy` is the one the Library last
 * answered, null before that. `retrying` means the Library could not be asked; held links keep
 * working meanwhile.
 */
export const AccountLinkStatus = Schema.Struct({
  state: Schema.Literals(["off", "linked", "retrying"]),
  policy: Schema.NullOr(AccountLinkPolicy),
  outbound: Schema.Array(AccountLinkEntry),
  inbound: Schema.Array(AccountLinkEntry),
  checkedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
});
export type AccountLinkStatus = typeof AccountLinkStatus.Type;

export const ACCOUNT_LINK_WS_METHODS = {
  policy: "loom.accountLinks.policy",
  setPolicy: "loom.accountLinks.setPolicy",
  status: "loom.accountLinks.status",
} as const;

export const AccountLinksRpcGroup = RpcGroup.make(
  /** On the Library, for its owner. */
  Rpc.make(ACCOUNT_LINK_WS_METHODS.policy, {
    payload: Schema.Struct({}),
    success: AccountLinkPolicy,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(ACCOUNT_LINK_WS_METHODS.setPolicy, {
    payload: AccountLinkPolicy,
    success: AccountLinkPolicy,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
  /** On any computer. */
  Rpc.make(ACCOUNT_LINK_WS_METHODS.status, {
    payload: Schema.Struct({}),
    success: AccountLinkStatus,
    error: EnvironmentAuthorizationError,
  }),
);
