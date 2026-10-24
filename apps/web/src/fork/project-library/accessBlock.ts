import {
  sessionGrantsScope,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";

export interface AccessTarget {
  readonly label: string;
  readonly phase: EnvironmentConnectionPhase | null;
  readonly connectionError: string | null;
  /** Identity connections recover by signing in; paired ones need a new pairing. */
  readonly identity: boolean;
  readonly session: AuthSessionState | null;
  readonly sessionFailed: boolean;
  readonly requiredScopes: ReadonlyArray<AuthEnvironmentScope>;
}

export interface AccessBlock {
  readonly label: string;
  readonly message: string;
  /** Whether Settings > Connections can repair it, and whether that repair is signing in. */
  readonly repair: "sign-in" | "connection" | null;
}

/**
 * A disabled guarded action must say what to do. Identity access lasts an hour, and an
 * expired session leaves the socket connected while the server stops granting scopes.
 */
export function accessBlock(target: AccessTarget): AccessBlock | null {
  const block = explain(target);
  return block && { label: target.label, ...block };
}

function explain(target: AccessTarget): Omit<AccessBlock, "label"> | null {
  if (target.phase !== "connected") {
    const signIn = target.identity && target.phase === "error";
    return {
      message: signIn
        ? `Your sign-in to ${target.label} expired. Sign in again to continue.`
        : `${target.label} is not connected.${target.connectionError ? ` ${target.connectionError}` : " Reconnect it to continue."}`,
      repair: signIn ? "sign-in" : "connection",
    };
  }
  if (target.sessionFailed)
    return {
      message: `Could not check this device's permissions on ${target.label}. Reconnect it and try again.`,
      repair: "connection",
    };
  if (target.session === null)
    return { message: `Checking this device's permissions on ${target.label}...`, repair: null };
  if (!target.session.authenticated)
    return target.identity
      ? {
          message: `Your sign-in to ${target.label} expired. Sign in again to continue.`,
          repair: "sign-in",
        }
      : {
          message: `${target.label} no longer accepts this device's pairing. Pair it again to continue.`,
          repair: "connection",
        };
  const missing = target.requiredScopes
    .filter((scope) => !sessionGrantsScope(target.session!, scope))
    .map((scope) => AUTH_SCOPE_OPTIONS.find((option) => option.scope === scope)?.title ?? scope);
  if (missing.length === 0) return null;
  return {
    message: `This device's access to ${target.label} does not include ${missing.join(" or ")}. ${target.identity ? "Sign in again" : "Pair it again"} with that permission.`,
    repair: target.identity ? "sign-in" : "connection",
  };
}
