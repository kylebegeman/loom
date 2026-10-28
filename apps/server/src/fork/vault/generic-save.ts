import { VaultError, type VaultItemKind } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { VaultCore } from "./VaultCore.ts";

export const guardGenericVaultSave = Effect.fn("VaultCore.guardGenericSave")(function* (
  vault: VaultCore["Service"],
  input: { readonly id: string; readonly kind: VaultItemKind },
  replacesValue: boolean,
) {
  const current = yield* vault.inspect(input.id);
  const managedKind =
    current?.kind === "ssh-key" || current?.kind === "service-connection"
      ? current.kind
      : input.kind === "ssh-key" || input.kind === "service-connection"
        ? input.kind
        : null;
  if (managedKind !== null && (replacesValue || current?.kind !== input.kind)) {
    return yield* new VaultError({
      reason: managedKind === "ssh-key" ? "managed-ssh-key" : "managed-service-connection",
    });
  }
});
