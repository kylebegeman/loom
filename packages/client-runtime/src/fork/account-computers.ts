import type { EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_ACCESS_FEATURE,
  ACCOUNT_ACCESS_PREFIX,
  type DirectoryListing,
  type AccountComputerStatus,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  AccountConnectionRegistration,
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
} from "../connection/catalog.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import { connectionRouteId, connectionRoutes } from "../connection/routes.ts";

export function accountComputerEnrollmentReady(input: {
  readonly libraryEnvironmentId: EnvironmentId | null;
  readonly sourceLibraryEnvironmentId: EnvironmentId | null;
  readonly membership: AccountComputerStatus | null;
  readonly signedIn: boolean;
  readonly remoteEnabled: boolean;
}) {
  return (
    input.libraryEnvironmentId !== null &&
    input.sourceLibraryEnvironmentId === input.libraryEnvironmentId &&
    input.signedIn &&
    input.remoteEnabled &&
    input.membership?.state === "active" &&
    input.membership.membershipRevision !== null
  );
}

/**
 * What this device's own computer needs from its Library account. `enroll` runs without a click;
 * a computer the owner removed, or one already in the account, is left alone. Remote access is
 * the owner's switch, so an enrolled computer with it off still counts as enrolled.
 */
export type OwnComputerEnrollment =
  | {
      readonly kind: "waiting";
      readonly reason: "signed-out" | "reconnect" | "permission" | "checking";
    }
  | { readonly kind: "other-library" }
  | { readonly kind: "removed" }
  | { readonly kind: "enrolled" }
  | { readonly kind: "enroll" };

export function ownComputerEnrollment(input: {
  readonly libraryEnvironmentId: EnvironmentId | null;
  readonly libraryConnected: boolean;
  readonly computerConnected: boolean;
  readonly permitted: boolean;
  /** `undefined` while unknown; `null` when the computer publishes to no Library yet. */
  readonly sourceLibraryEnvironmentId: EnvironmentId | null | undefined;
  /** `undefined` while unknown; `null` when the account has no record of the computer. */
  readonly membership: AccountComputerStatus | null | undefined;
  readonly signedIn: boolean;
}): OwnComputerEnrollment {
  if (input.libraryEnvironmentId === null || !input.libraryConnected)
    return { kind: "waiting", reason: "signed-out" };
  if (!input.computerConnected) return { kind: "waiting", reason: "reconnect" };
  if (!input.permitted) return { kind: "waiting", reason: "permission" };
  const { sourceLibraryEnvironmentId, membership } = input;
  if (sourceLibraryEnvironmentId === undefined || membership === undefined)
    return { kind: "waiting", reason: "checking" };
  if (
    sourceLibraryEnvironmentId !== null &&
    sourceLibraryEnvironmentId !== input.libraryEnvironmentId
  )
    return { kind: "other-library" };
  if (membership?.state === "removing" || membership?.state === "removed")
    return { kind: "removed" };
  return accountComputerEnrollmentReady({
    libraryEnvironmentId: input.libraryEnvironmentId,
    sourceLibraryEnvironmentId,
    membership,
    signedIn: input.signedIn,
    remoteEnabled: true,
  })
    ? { kind: "enrolled" }
    : { kind: "enroll" };
}

export function accountComputerRegistration(
  library: ConnectionCatalogEntry,
  computer: { readonly environmentId: EnvironmentId; readonly label: string },
) {
  if (computer.environmentId === library.target.environmentId) return null;
  for (const route of connectionRoutes(library)) {
    const profile = Option.getOrNull(route.profile);
    const primary = route.target._tag === "PrimaryConnectionTarget" ? route.target : null;
    const bearer =
      route.target._tag === "BearerConnectionTarget" &&
      profile?._tag === "BearerConnectionProfile" &&
      profile.identity !== undefined &&
      profile.account === undefined &&
      profile.environmentId === library.target.environmentId
        ? profile
        : null;
    if (primary === null && bearer === null) continue;
    const base = primary?.httpBaseUrl ?? bearer!.httpBaseUrl;
    const connectionId = `account:${encodeURIComponent(library.target.environmentId)}:${encodeURIComponent(computer.environmentId)}`;
    const httpBaseUrl = new URL(
      `${ACCOUNT_ACCESS_PREFIX}${encodeURIComponent(computer.environmentId)}/`,
      base,
    ).href;
    return new AccountConnectionRegistration({
      target: new BearerConnectionTarget({
        environmentId: computer.environmentId,
        label: computer.label,
        connectionId,
      }),
      profile: new BearerConnectionProfile({
        environmentId: computer.environmentId,
        label: computer.label,
        connectionId,
        httpBaseUrl,
        wsBaseUrl: `${httpBaseUrl.replace(/^http/u, "ws")}ws`,
        account: {
          libraryEnvironmentId: library.target.environmentId,
          connectionId: bearer?.connectionId ?? null,
        },
      }),
    });
  }
  return null;
}

export const syncAccountComputers = Effect.fn("AccountComputers.sync")(function* (
  libraryEnvironmentId: EnvironmentId,
  listing: DirectoryListing,
) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const entries = yield* SubscriptionRef.get(registry.entries);
  const library = entries.get(libraryEnvironmentId);
  if (library === undefined || !library.enabled) return;
  for (const computer of listing.environments) {
    const existing = entries.get(computer.environmentId);
    // A switched-off computer still gains the route and stays off, so switching it on uses it.
    if (
      existing?.target._tag === "PrimaryConnectionTarget" ||
      !computer.loomFeatures.includes(ACCOUNT_ACCESS_FEATURE)
    )
      continue;
    const registration = accountComputerRegistration(library, computer);
    if (
      registration === null ||
      (existing !== undefined &&
        connectionRoutes(existing).some(
          (route) => connectionRouteId(route.target) === registration.target.connectionId,
        ))
    )
      continue;
    yield* registry.register(registration).pipe(
      Effect.catch(() =>
        Effect.logWarning("Loom could not save a discovered account computer connection.", {
          environmentId: computer.environmentId,
        }),
      ),
    );
  }
});
