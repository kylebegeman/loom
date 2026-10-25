import {
  connectionRoutes,
  routeHttpBaseUrl,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { identityAddressOrigin } from "@t3tools/shared/fork/identity-grant";
import * as Option from "effect/Option";

/** The saved route that signs in with Identity, if this computer uses one. */
export function identityProfile(entry?: ConnectionCatalogEntry) {
  return entry
    ? connectionRoutes(entry).flatMap((route) => {
        const profile = Option.getOrNull(route.profile);
        return profile?._tag === "BearerConnectionProfile" && profile.identity ? [profile] : [];
      })[0]
    : undefined;
}

/**
 * Whether `address` is one this device already saved for the computer, which then skips the
 * Library's address check as on iPhone. That address already receives the computer's credentials,
 * and the Library may never list it, such as a home network address.
 */
export function isSavedComputerAddress(entry: ConnectionCatalogEntry | undefined, address: string) {
  const typed = identityAddressOrigin(address);
  if (entry === undefined || typed === null) return false;
  return connectionRoutes(entry).some((route) => {
    const saved = routeHttpBaseUrl(route);
    return saved !== null && identityAddressOrigin(saved) === typed;
  });
}
