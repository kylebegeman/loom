import type { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import type {
  AccountLinkAdmission,
  AccountLinkAdmitRequest,
  AccountLinkStatus,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class AccountLinkError extends Schema.TaggedError<AccountLinkError>()("AccountLinkError", {
  reason: Schema.Literals(["disabled", "denied", "unavailable", "capacity"]),
}) {
  override get message(): string {
    return this.reason === "unavailable"
      ? "Your Library could not be reached to check this account link. Loom retries."
      : "This account link was not admitted.";
  }
}

/**
 * Links between the computers of one account. Each computer holds an ordinary peer link to every
 * other one the Library lists, admitted with a grant the Library issues, and renews or removes
 * them as the Library's roster and policy change. They do not depend on the Linked environments
 * Labs switch, which keeps governing links made with a pairing code.
 */
export class AccountLinks extends Context.Service<
  AccountLinks,
  {
    /** Brings links in line with the Library's roster once. Never fails. */
    readonly reconcile: Effect.Effect<AccountLinkStatus>;
    readonly status: Effect.Effect<AccountLinkStatus>;
    /** Where another computer of the account presents its grant. */
    readonly admit: (
      request: AccountLinkAdmitRequest,
    ) => Effect.Effect<AccountLinkAdmission, AccountLinkError>;
    /** Whether this computer holds an account link to any other computer. */
    readonly holdsAny: Effect.Effect<boolean>;
    /** Whether the link to `environmentId` is an account link. */
    readonly holds: (environmentId: EnvironmentId) => Effect.Effect<boolean>;
    /** Whether a peer-link session here was issued to another computer of the account. */
    readonly admits: (sessionId: AuthSessionId) => Effect.Effect<boolean>;
    /** The computer such a session was issued to, which stays the same across its renewals. */
    readonly admittedFrom: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<Option.Option<EnvironmentId>>;
    /** Whether a bearer token is one of those sessions. */
    readonly admitsToken: (token: string) => Effect.Effect<boolean>;
  }
>()("t3/fork/account-links/AccountLinks") {}
