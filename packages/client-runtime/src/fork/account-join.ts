import type { EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_PASSKEY_FEATURE,
  type LoomDesktopApprovalRequest,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { connectionRoutes } from "../connection/routes.ts";
import { savedIdentitySignIn } from "./directory-computers-connect.ts";
import type { DirectorySignInSurface } from "./directory.ts";

export function accountJoinCode(input: string) {
  const code = input.trim().toUpperCase().replace(/[\s-]/gu, "");
  return /^[A-F0-9]{10}$/u.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : null;
}

/** Null where the Library approves without a passkey; `target` is null where this device cannot ask. */
export type JoinPasskey = { readonly target: LoomDesktopApprovalRequest | null } | null;

/**
 * Where this device confirms the owner's passkey for its Library: the saved Loom Identity route,
 * else `httpBaseUrl` (the Library this app runs on), else any saved address of it.
 */
export function joinPasskey(input: {
  readonly authorityId: EnvironmentId;
  readonly features: ReadonlyArray<string> | undefined;
  readonly entry: ConnectionCatalogEntry | undefined;
  readonly surface: DirectorySignInSurface;
  readonly httpBaseUrl?: string | undefined;
}): JoinPasskey {
  if (!input.features?.includes(ACCOUNT_JOIN_PASSKEY_FEATURE)) return null;
  const saved = input.entry === undefined ? null : savedIdentitySignIn(input.entry, input.surface);
  if (saved !== null)
    return {
      target: {
        httpBaseUrl: saved.httpBaseUrl,
        expectedEnvironmentId: input.authorityId,
        expectedIdentity: saved.expectedIdentity,
      },
    };
  const httpBaseUrl =
    input.httpBaseUrl ??
    (input.entry === undefined ? [] : connectionRoutes(input.entry))
      .map((route) => Option.getOrNull(route.profile))
      .find((profile) => profile?._tag === "BearerConnectionProfile")?.httpBaseUrl;
  return {
    target:
      httpBaseUrl === undefined ? null : { httpBaseUrl, expectedEnvironmentId: input.authorityId },
  };
}
