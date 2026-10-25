import { reachChangeErrorText } from "@t3tools/client-runtime/fork";
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import { ReachError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const isReachError = Schema.is(ReachError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

/** True when this device reaches the computer through its reach address right now. */
export function connectedThroughAddress(activeRouteUrl: string | null, addressUrl: string | null) {
  if (activeRouteUrl === null || addressUrl === null) return false;
  try {
    return new URL(activeRouteUrl).origin === new URL(addressUrl).origin;
  } catch {
    return false;
  }
}

/**
 * The line for a failed turn on, turn off or remove, or null when there is nothing to report.
 * `dropsRoute` is set after the user confirmed turning reach off or removing it while connected
 * through its address. The computer answers before it stops the tunnel, but the reply can still be
 * lost with the route, so only a refusal the computer actually sent counts as a failure then.
 */
export function reachChangeFailureText(
  cause: Cause.Cause<unknown>,
  dropsRoute: boolean,
): string | null {
  if (Cause.hasInterruptsOnly(cause)) return null;
  if (dropsRoute) {
    const error = Option.getOrNull(Cause.findErrorOption(cause));
    if (!isReachError(error) && !isAuthorizationError(error)) return null;
  }
  return reachChangeErrorText(cause);
}

/** Splits a confirm line after its question, the way the shared confirm dialog titles one. */
export function confirmCopy(text: string): {
  readonly title: string;
  readonly description: string | null;
} {
  const end = text.indexOf("?");
  if (end < 0) return { title: text, description: null };
  const description = text.slice(end + 1).trim();
  return { title: text.slice(0, end + 1), description: description === "" ? null : description };
}
