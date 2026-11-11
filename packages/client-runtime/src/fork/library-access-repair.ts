import { EnvironmentAuthorizationError, type EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  VaultError,
  VaultGitHubError,
  vaultDeniedMessage,
  type LibraryAccessRepair,
  type LoomIdentityAccount,
  type VaultGitHubTarget,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { loomIdentityAccountLabel, needsLibrarySignIn } from "./library-sign-in.ts";

export interface LibraryAccessRepairContext {
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly authorityEnvironmentId?: EnvironmentId | null | undefined;
  readonly computerLabel?: string | null | undefined;
  readonly account?: LoomIdentityAccount | undefined;
  readonly originalAccount?: LoomIdentityAccount | undefined;
}

export const LIBRARY_ACCESS_REPAIR_RETURN_TEXT =
  "Returning only refreshes access and reads saved results. It never resumes paused writes. Review the saved request, then explicitly continue.";

export type LibraryAccessRepairDestination =
  | {
      readonly kind: "library-sign-in" | "computer-sign-in" | "connection";
      readonly environmentId: EnvironmentId | null;
    }
  | ({
      readonly kind: "vault-github";
      readonly environmentId: EnvironmentId | null;
    } & VaultGitHubTarget);

const isLibraryError = Schema.is(LibraryError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const isVaultError = Schema.is(VaultError);
const isVaultGitHubError = Schema.is(VaultGitHubError);

/** Carry only safe repair metadata; a Vault failure never selects another credential. */
export function libraryAccessRepairFromFailure(
  failure: unknown,
  environmentId: EnvironmentId | null | undefined,
  repository?: VaultGitHubTarget,
): LibraryAccessRepair | undefined {
  if (isLibraryError(failure)) {
    const repair = failure.accessRepair;
    return repair && !repair.environmentId && environmentId ? { ...repair, environmentId } : repair;
  }
  const computer = environmentId ? { environmentId } : {};
  if (isAuthorizationError(failure)) return { kind: "permission", ...computer };
  if (repository && (isVaultError(failure) || isVaultGitHubError(failure)))
    return {
      kind: "permission",
      ...computer,
      repository,
      vaultReason: failure.reason,
      ...(isVaultError(failure) && failure.detail ? { vaultDeniedDetail: failure.detail } : {}),
    };
  return undefined;
}

const vaultRepairText = (
  reason: LibraryAccessRepair["vaultReason"],
  deniedDetail: LibraryAccessRepair["vaultDeniedDetail"],
) => {
  if (reason === "denied" && deniedDetail) return vaultDeniedMessage(deniedDetail);
  switch (reason) {
    case "unauthorized":
    case "invalid-credential":
      return "Renew GitHub authentication for the selected Vault connection.";
    case "denied":
      return "Ask the computer owner to review inspect and use permissions for this exact selection and repository in Vault > Access.";
    case "not-found":
      return "The selected connection is unavailable or hidden by policy. Ask the computer owner to check its visibility and access.";
    case "locked":
      return "Ask the computer owner to unlock the Vault backend.";
    case "configuration":
      return "Ask the computer owner to repair this computer's Vault backend configuration.";
    case "unavailable":
    case "timeout":
      return "Check this computer's connection to the Vault backend and GitHub, then refresh.";
    case "conflict":
      return "The selected connection changed. Review its current version; the saved request keeps its original credential pin.";
    case "repository-denied":
      return "Review the selected connection's repository allowlist, GitHub permissions and Vault access.";
    case "cli-unavailable":
    case "unsupported":
      return "Review the required Git tools and platform support on this computer.";
    default:
      return "Review the selected connection's state, repository permissions and Vault access.";
  }
};

export function libraryAccessRepairNotice(
  repair: LibraryAccessRepair | undefined,
  context: LibraryAccessRepairContext = {},
  legacyMessage?: string | null,
) {
  const fallback = !repair && needsLibrarySignIn(legacyMessage);
  const access: LibraryAccessRepair | null =
    repair ?? (fallback ? { kind: "sign-in" as const } : null);
  if (!access) return null;
  const environmentId =
    access.environmentId ?? context.environmentId ?? context.authorityEnvironmentId ?? null;
  const computer =
    context.computerLabel &&
    (!access.environmentId || access.environmentId === context.environmentId)
      ? context.computerLabel
      : environmentId === context.authorityEnvironmentId
        ? "your Library computer"
        : "the selected computer";
  const afterReturn = LIBRARY_ACCESS_REPAIR_RETURN_TEXT;
  if (access.repository && access.kind !== "ownership" && access.kind !== "sign-in") {
    const repository = access.repository;
    return {
      title: "Selected Vault repository access needs attention",
      description: `${repository.repository} on ${computer}. ${vaultRepairText(access.vaultReason, access.vaultDeniedDetail)} Keep the selected Vault connection and version ${repository.expectedVersion} while checking the saved request.`,
      actionLabel: "Review selected Vault connection",
      destination: {
        kind: "vault-github",
        environmentId,
        ...repository,
      } satisfies LibraryAccessRepairDestination,
      expectedIdentity: null,
      afterReturn,
    };
  }
  const expectedIdentity =
    context.originalAccount ?? (access.kind === "ownership" ? null : (context.account ?? null));
  const account = expectedIdentity ? loomIdentityAccountLabel(expectedIdentity) : null;
  const signIn =
    environmentId === null || environmentId === context.authorityEnvironmentId
      ? ("library-sign-in" as const)
      : ("computer-sign-in" as const);
  const destination = { kind: signIn, environmentId } satisfies LibraryAccessRepairDestination;
  switch (access.kind) {
    case "sign-in":
      return {
        title: "Loom sign-in needs attention",
        description: `Sign in to Loom on ${computer}${account ? ` as ${account}` : " with the saved human account"}.`,
        actionLabel: "Sign in to Loom",
        destination,
        expectedIdentity,
        afterReturn,
      };
    case "ownership":
      return {
        title: "Original account required",
        description: `Only the original authorized account${account ? ` (${account})` : ""} can continue this request on ${computer}. Sign in with that account; ownership cannot be transferred by repairing access.`,
        actionLabel: "Review original account sign-in",
        destination,
        expectedIdentity,
        afterReturn,
      };
    case "permission":
      return {
        title: "Computer permission required",
        description: `Review this device's permissions in ${computer}'s connection settings. Ask that computer's owner for the required permission.`,
        actionLabel: `Review ${computer} permissions`,
        destination: { kind: "connection", environmentId } satisfies LibraryAccessRepairDestination,
        expectedIdentity: null,
        afterReturn,
      };
    case "connection":
      return {
        title: "Computer connection needs attention",
        description: `Reconnect ${computer} in its connection settings, then refresh its access.`,
        actionLabel: `Open ${computer} connection`,
        destination: { kind: "connection", environmentId } satisfies LibraryAccessRepairDestination,
        expectedIdentity: null,
        afterReturn,
      };
  }
}
