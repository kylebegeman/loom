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
    if (
      existing?.enabled === false ||
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
