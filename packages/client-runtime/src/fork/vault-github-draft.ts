import {
  VaultGitHubSave,
  VaultGitHubRepository,
  VAULT_GITHUB_REPOSITORY_LIMIT,
  VAULT_GITHUB_OWNER_REPOSITORY_LIMIT,
} from "@t3tools/contracts/fork";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
export type VaultGitHubDraft = {
  id: string;
  expectedVersion: number;
  label: string;
  repositories: string;
  type: "app" | "token";
  appId: string;
  installationId: string;
  secret: string;
};
const isRepository = Schema.is(VaultGitHubRepository);
export const parseVaultGitHubRepositories = (input: string): string[] | null => {
  const repositories: string[] = [];
  for (const entry of input.split(/[\s,]+/).filter(Boolean)) {
    const url =
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+?)\/?$/i.exec(
        entry,
      );
    const repository = (url ? url[1]!.replace(/\.git$/i, "") : entry).toLowerCase();
    if (!isRepository(repository)) return null;
    if (!repositories.includes(repository)) repositories.push(repository);
  }
  return repositories;
};
const decodeSave = Schema.decodeUnknownOption(Schema.toType(VaultGitHubSave));
export const makeVaultGitHubSave = (
  draft: VaultGitHubDraft,
  operationId: string,
  ownerTrusted = false,
) => {
  const repositories = parseVaultGitHubRepositories(draft.repositories);
  if (
    !repositories ||
    repositories.length >
      (ownerTrusted ? VAULT_GITHUB_OWNER_REPOSITORY_LIMIT : VAULT_GITHUB_REPOSITORY_LIMIT)
  )
    return null;
  return Option.getOrNull(
    decodeSave({
      id: draft.id,
      operationId,
      expectedVersion: draft.expectedVersion,
      label: draft.label.trim(),
      repositories,
      ...(draft.expectedVersion > 0 && !draft.secret.trim()
        ? {}
        : {
            credential:
              draft.type === "token"
                ? { type: "token", token: Redacted.make(draft.secret.trim()) }
                : {
                    type: "app",
                    appId: draft.appId.trim(),
                    installationId: draft.installationId.trim(),
                    privateKey: Redacted.make(draft.secret.trim().replaceAll("\\n", "\n")),
                  },
          }),
    }),
  );
};
