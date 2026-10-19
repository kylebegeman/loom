import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { readVaultPrompt, vaultPromptEnvironmentMatches } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultReferences from "./VaultReferences.ts";

export class VaultPromptError extends Schema.TaggedError<VaultPromptError>()("VaultPromptError", {
  reason: Schema.Literals([
    "invalid-links",
    "wrong-environment",
    "unavailable",
    "profile-changed",
    "profile-blocked",
    "reference-blocked",
  ]),
}) {
  override get message() {
    return {
      "invalid-links": "Vault attachments are invalid or duplicated. Remove them and attach again.",
      "wrong-environment":
        "These Vault attachments belong to another computer. Replace them for this computer.",
      unavailable:
        "Vault launch checks are unavailable. Restore the Vault connection or remove the attachments.",
      "profile-changed":
        "The reviewed Vault profile changed. Review and attach its current version before retrying.",
      "profile-blocked":
        "The Vault profile is not ready for this thread. Check required keys, host trust and use grants.",
      "reference-blocked":
        "A Vault reference is archived, missing or not inspect-granted to this thread. Repair or remove it before retrying.",
    }[this.reason];
  }
}
type Input = { readonly threadId: ThreadId; readonly runId: RunId; readonly text: string };
type Guard = (input: Input) => Effect.Effect<void, VaultPromptError>;
// Runtime workers are constructed before ForkLayer. Scoped registration avoids a layer cycle.
const guards = new Map<EnvironmentId, Guard>();
export const applyVaultPromptContext = Effect.fn("VaultPromptContext.apply")(function* (
  input: Input,
) {
  const parsed = readVaultPrompt(input.text);
  if (!parsed.valid) return yield* new VaultPromptError({ reason: "invalid-links" });
  if (parsed.attachments.length === 0) return;
  const identity = yield* Effect.serviceOption(ServerEnvironmentIdentity);
  if (Option.isNone(identity)) return yield* new VaultPromptError({ reason: "unavailable" });
  const guard = guards.get(yield* identity.value.getEnvironmentId);
  if (!guard) return yield* new VaultPromptError({ reason: "unavailable" });
  yield* guard(input);
});
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const identity = yield* ServerEnvironmentIdentity,
      profiles = yield* VaultProfiles.VaultProfiles,
      references = yield* VaultReferences.VaultReferences;
    const environmentId = yield* identity.getEnvironmentId;
    const guard: Guard = Effect.fn("VaultPromptContext.prepare")(function* (input) {
      const parsed = readVaultPrompt(input.text);
      if (!parsed.valid || input.text.trimStart().startsWith("/"))
        return yield* new VaultPromptError({ reason: "invalid-links" });
      if (!vaultPromptEnvironmentMatches(parsed.attachments, environmentId))
        return yield* new VaultPromptError({ reason: "wrong-environment" });
      for (const link of parsed.attachments) {
        if (link.kind === "profile") {
          yield* profiles.prepare(input.threadId, link.id, link.version, input.runId).pipe(
            Effect.mapError(
              (error) =>
                new VaultPromptError({
                  reason:
                    error._tag === "VaultError" && error.reason === "conflict"
                      ? "profile-changed"
                      : error._tag === "VaultError" &&
                          [
                            "unavailable",
                            "sealed",
                            "locked",
                            "unconfigured",
                            "invalid-response",
                          ].includes(error.reason)
                        ? "unavailable"
                        : "profile-blocked",
                }),
            ),
          );
        } else {
          const reference = yield* references
            .describe(link.id, input.threadId)
            .pipe(Effect.mapError(() => new VaultPromptError({ reason: "unavailable" })));
          if (!reference || reference.item.state !== "active")
            return yield* new VaultPromptError({ reason: "reference-blocked" });
        }
      }
    });
    yield* Effect.acquireRelease(
      Effect.sync(() => guards.set(environmentId, guard)),
      () =>
        Effect.sync(() => {
          if (guards.get(environmentId) === guard) guards.delete(environmentId);
        }),
    );
  }),
);
