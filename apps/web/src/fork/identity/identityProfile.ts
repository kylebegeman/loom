import { connectionRoutes, type ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
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
