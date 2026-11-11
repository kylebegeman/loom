import type { EnvironmentId } from "@t3tools/contracts";
import {
  type LibraryRepositoryAccess,
  type VaultError,
  VaultGitHubError,
  LibraryError,
} from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { classifyGitFailure } from "../../vcs/GitVcsDriverCore.ts";
export function libraryCloneFailure(input: {
  stderr: string;
  remoteUrl: string;
  environmentId: EnvironmentId;
  computer: string;
  timedOut: boolean;
  repositoryAccess?: LibraryRepositoryAccess | undefined;
}) {
  const reason = classifyGitFailure(input.stderr);
  if (input.repositoryAccess?.kind === "vault-github")
    return libraryVaultRepositoryFailure(
      input.repositoryAccess,
      new VaultGitHubError({
        reason: input.timedOut
          ? "timeout"
          : reason === "authentication_failed"
            ? "unauthorized"
            : reason === "remote_unreachable"
              ? "unavailable"
              : "failed",
      }),
      input.environmentId,
    );
  const github =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/(?:git@)?github\.com(?::[0-9]+)?\/)/i.test(
      input.remoteUrl,
    );
  const ssh = /^(?:git@|ssh:\/\/)/i.test(input.remoteUrl);
  const repository = /^github\.com\/([a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100})$/.exec(
    normalizeGitRemoteUrl(input.remoteUrl),
  )?.[1];
  const repair = github
    ? {
        kind: "github-host-setup" as const,
        ...(repository ? { repository } : {}),
        environmentId: input.environmentId,
        label: input.computer,
        agentTool: "loom_github_host_setup" as const,
        action: "start" as const,
      }
    : undefined;
  if (input.timedOut)
    return new LibraryError({
      reason: "blocked",
      detail: `Git clone timed out on ${input.computer}. Check the network and any pending credential approval on that computer before retrying.`,
      ...(repair ? { repair } : {}),
    });
  const details = {
    authentication_failed: `Git authentication failed on ${input.computer}. ${github ? "Set up GitHub on that computer and check repository access." : "Configure credentials for this repository on that computer."}${ssh ? " This remote uses SSH; configure its SSH key or choose an HTTPS remote after setup." : ""}`,
    host_key_unverified: `The SSH host key is not verified on ${input.computer}. Verify the remote host's fingerprint and add it to that computer's known hosts before retrying.`,
    remote_unreachable: `The repository could not be reached from ${input.computer}. Check the repository address, network and account permissions${github ? ", then set up GitHub on that computer" : ""}.`,
  };
  if (
    reason === "authentication_failed" ||
    reason === "host_key_unverified" ||
    reason === "remote_unreachable"
  )
    return new LibraryError({
      reason: "blocked",
      detail: details[reason],
      ...(repair ? { repair } : {}),
    });
  return new LibraryError({ reason: "io" });
}

export function libraryVaultRepositoryFailure(
  access: Extract<LibraryRepositoryAccess, { readonly kind: "vault-github" }>,
  failure?: VaultError | VaultGitHubError,
  environmentId?: EnvironmentId,
) {
  const { kind: _kind, ...repository } = access;
  return new LibraryError({
    reason: "blocked",
    detail:
      "The selected Vault GitHub connection could not access this repository. Review this computer's selected connection and repository access, then check the saved request before continuing.",
    accessRepair: {
      kind: "permission",
      ...(environmentId ? { environmentId } : {}),
      repository,
      ...(failure ? { vaultReason: failure.reason } : {}),
      ...(failure?._tag === "VaultError" && failure.detail
        ? { vaultDeniedDetail: failure.detail }
        : {}),
    },
  });
}
