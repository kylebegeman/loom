import { type ThreadId, SecretRequestError } from "@t3tools/contracts";
import { VaultError, VaultPrivateSave, type VaultItemSummary } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import { readOpenBaoSettings } from "./OpenBaoSettings.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultCore from "./VaultCore.ts";

export class VaultPrivateInput extends Context.Service<
  VaultPrivateInput,
  {
    readonly store: (
      input: VaultPrivateSave,
      threadId: ThreadId,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultItemSummary, VaultError | SecretRequestError>;
  }
>()("t3/fork/vault/VaultPrivateInput") {}
const encodeOperation = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      input: VaultPrivateSave,
      environmentId: Schema.String,
      origin: Schema.String,
      mount: Schema.String,
    }),
  ),
);
const make = Effect.gen(function* () {
  const vault = yield* VaultCore.VaultCore;
  const access = yield* VaultAccess.VaultAccess;
  const secrets = yield* SecretRequests.SecretRequests;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const identity = yield* ServerEnvironmentIdentity;
  const { mount } = yield* readOpenBaoSettings();
  const crypto = yield* Crypto.Crypto;
  return VaultPrivateInput.of({
    store: Effect.fn("VaultPrivateInput.store")(function* (input, threadId, authorize) {
      const check = authorize.pipe(
        Effect.andThen(access.require(threadId, input.id, "manage", null)),
      );
      yield* check;
      const thread = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => new VaultError({ reason: "denied" })));
      if (thread === null) return yield* new VaultError({ reason: "denied" });
      const actorId = `thread:${threadId}`;
      const committed = yield* vault.savedPrivate(input, actorId);
      if (committed !== null) return committed;
      const status = yield* vault.status;
      if (status.state !== "ready" || status.origin === null) {
        return yield* new VaultError({
          reason:
            status.state === "locked"
              ? "locked"
              : status.state === "denied"
                ? "denied"
                : "unavailable",
        });
      }
      const encoded = yield* encodeOperation({
        input,
        environmentId: yield* identity.getEnvironmentId,
        origin: status.origin,
        mount,
      }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
      const operationId = Hex.encode(
        yield* crypto
          .digest("SHA-256", new TextEncoder().encode(encoded))
          .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
      );
      return yield* secrets.transfer(
        { ref: input.secretRef, projectId: thread.projectId, operationId: `vault:${operationId}` },
        (value) =>
          vault.save(
            {
              id: input.id,
              operationId: input.operationId,
              expectedVersion: input.expectedVersion,
              label: input.label,
              kind: input.kind,
              value: Redacted.make(value),
            },
            actorId,
            check,
            input.secretRef,
          ),
      );
    }),
  });
});
export const layer = Layer.effect(VaultPrivateInput, make);
