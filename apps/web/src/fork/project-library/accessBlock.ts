import {
  sessionGrantsScope,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import type {
  EnvironmentConnectionPhase,
  EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { AUTH_SCOPE_OPTIONS } from "@t3tools/shared/authScopeOptions";
import type { LibraryAccessRepairDestination } from "@t3tools/client-runtime/fork";
import type { SettingsSearchItemId } from "~/components/settings/settingsSearch";

/** The Library block in Settings > Computers, also reachable from the command palette. */
export const LIBRARY_SIGN_IN_TARGET = "library-sign-in" satisfies SettingsSearchItemId;

export interface AccessTarget {
  readonly label: string;
  readonly phase: EnvironmentConnectionPhase | null;
  readonly blockedReason?: EnvironmentConnectionPresentation["blockedReason"];
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
  /**
   * How to repair it: signing in again with the saved Identity route, or Settings > Computers.
   * Null while nothing is known to be wrong yet.
   */
  readonly repair: "sign-in" | "permission" | "connection" | null;
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
  // A first attempt with nothing failed yet, such as right after signing in, needs no repair.
  if (target.phase === "connecting")
    return { message: `Connecting to ${target.label}...`, repair: null };
  if (target.phase !== "connected") {
    const signIn = target.identity && target.blockedReason === "authentication";
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
    message: `This device's access to ${target.label} does not include ${missing.join(" or ")}. Review this computer's permissions in Settings > Computers.`,
    repair: "permission",
  };
}

/**
 * Where a block's repair lives: the Library block when the Library's own sign-in lapsed or this
 * device no longer saves the Library, otherwise the computer's place in Connections.
 */
export function accessRepairTarget(
  block: Pick<AccessBlock, "repair"> & { readonly environmentId: string },
  libraryId: string | null,
  saved: boolean,
): typeof LIBRARY_SIGN_IN_TARGET | null {
  return block.environmentId === libraryId && (block.repair === "sign-in" || !saved)
    ? LIBRARY_SIGN_IN_TARGET
    : null;
}

export function libraryAccessRepairLink(
  destination: LibraryAccessRepairDestination,
  connection?: { readonly libraryId: string | null; readonly saved: boolean },
) {
  const search = {
    machine: destination.environmentId ?? undefined,
    project: undefined,
    checkout: undefined,
  };
  if (destination.kind === "vault-github") {
    const params = new URLSearchParams({
      connection: destination.id,
      repository: destination.repository,
      version: String(destination.expectedVersion),
    });
    return { to: "/settings/vault" as const, search, hash: `loom-vault-github?${params}` };
  }
  return {
    to: "/settings/connections" as const,
    search,
    hash:
      destination.kind === "library-sign-in" &&
      (!connection ||
        destination.environmentId === null ||
        destination.environmentId === connection.libraryId)
        ? LIBRARY_SIGN_IN_TARGET
        : ((connection && destination.environmentId
            ? accessRepairTarget(
                {
                  repair: destination.kind === "computer-sign-in" ? "sign-in" : "connection",
                  environmentId: destination.environmentId,
                },
                connection.libraryId,
                connection.saved,
              )
            : null) ?? "remote-environments"),
  };
}
