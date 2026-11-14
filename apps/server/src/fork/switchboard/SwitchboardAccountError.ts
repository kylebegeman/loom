import * as Schema from "effect/Schema";

/**
 * Issuing and checking account Switchboard credentials. `not-authority` means this computer is
 * not the Library; `disabled` means it does not share its Switchboard.
 */
export class SwitchboardAccountError extends Schema.TaggedError<SwitchboardAccountError>()(
  "SwitchboardAccountError",
  {
    reason: Schema.Literals(["not-authority", "disabled", "denied", "invalid", "unavailable"]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-authority":
        return "This computer does not issue Switchboard credentials.";
      case "disabled":
        return "This computer does not share its Switchboard.";
      case "denied":
        return "The Switchboard credential request was refused.";
      case "invalid":
        return "The Switchboard credential request is invalid.";
      case "unavailable":
        return "Switchboard credentials are unavailable right now.";
    }
  }
}

/** HTTP status for each reason, shared by the Library and hub routes. */
export const switchboardAccountStatus = (error: SwitchboardAccountError) =>
  error.reason === "not-authority" || error.reason === "disabled"
    ? 404
    : error.reason === "denied"
      ? 403
      : error.reason === "invalid"
        ? 400
        : 503;
