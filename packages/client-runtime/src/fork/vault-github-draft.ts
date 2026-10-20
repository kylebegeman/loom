import { VaultGitHubSave } from "@t3tools/contracts/fork";
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
const decodeSave = Schema.decodeUnknownOption(Schema.toType(VaultGitHubSave));
export const makeVaultGitHubSave = (draft: VaultGitHubDraft, operationId: string) =>
  Option.getOrNull(
    decodeSave({
      id: draft.id,
      operationId,
      expectedVersion: draft.expectedVersion,
      label: draft.label.trim(),
      repositories: draft.repositories
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((r) => r.toLowerCase()),
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
  );
