import { SecretRequestError } from "@t3tools/contracts";
import {
  VaultError,
  VaultSecretError,
  VaultSecretAnswer,
  VaultFileContent,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  ThreadManagementService,
  isTerminalRunStatus,
} from "../../orchestration-v2/ThreadManagementService.ts";
import { SecretRequests } from "../../secrets/SecretRequests.ts";
import { VaultCore } from "./VaultCore.ts";
import { VaultAccess } from "./VaultAccess.ts";

export class VaultSecretRequests extends Context.Service<
  VaultSecretRequests,
  {
    readonly answerFromItem: (
      input: VaultSecretAnswer,
      actor: string,
    ) => Effect.Effect<void, VaultError | VaultSecretError | SecretRequestError>;
  }
>()("t3/fork/vault/VaultSecretRequests") {}

const decodeInput = Schema.decodeUnknownEffect(VaultSecretAnswer);
const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(VaultFileContent));
const MAX_FILE_BYTES = 512 * 1024;
const make = Effect.gen(function* () {
  const core = yield* VaultCore;
  const access = yield* VaultAccess;
  const requests = yield* SecretRequests;
  const threads = yield* ThreadManagementService;
  return VaultSecretRequests.of({
    answerFromItem: Effect.fn("VaultSecretRequests.answerFromItem")(function* (raw, actor) {
      const input = yield* decodeInput(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const records = yield* threads
        .getThreadRecords(input.threadId, ["turnItems", "runs"], {
          turnItemTypes: ["secret_request"],
          messageRoles: [],
        })
        .pipe(Effect.mapError(() => new SecretRequestError({ reason: "load_failed" })));
      const request = records.turnItems.find((entry) => entry.id === input.turnItemId);
      if (request?.type !== "secret_request" || request.runId === null || request.nodeId === null)
        return yield* new SecretRequestError({ reason: "not_found" });
      if (request.secretStatus !== "pending")
        return yield* new SecretRequestError({ reason: "already_answered" });
      const run = records.runs.find((entry) => entry.id === request.runId);
      if (!run || isTerminalRunStatus(run.status))
        return yield* new SecretRequestError({ reason: "agent_stopped" });
      const item = yield* core.inspect(input.itemId);
      if (!item || item.state !== "active") return yield* new VaultError({ reason: "not-found" });
      if (item.version !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      if (item.kind === "ssh-key") return yield* new VaultSecretError({ reason: "secret-ssh-key" });
      if (item.kind === "service-connection")
        return yield* new VaultSecretError({ reason: "secret-service-connection" });
      if (item.kind === "secure-file" && request.delivery !== "file")
        return yield* new VaultSecretError({ reason: "secret-file-required" });
      const revealed = yield* access.reveal(
        { id: item.id, expectedVersion: input.expectedVersion },
        actor,
        input.threadId,
      );
      const value = Redacted.value(revealed.value);
      if (item.kind === "secure-file") {
        const file = yield* decodeFile(value).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
        const bytes = Buffer.from(file.base64, "base64");
        if (bytes.length > MAX_FILE_BYTES || bytes.toString("base64") !== file.base64)
          return yield* new VaultError({ reason: "invalid-input" });
        yield* requests.answer(
          { ...input, answer: { type: "save", secret: file.base64 || "empty file" } },
          bytes,
        );
      } else {
        yield* requests.answer({ ...input, answer: { type: "save", secret: value } });
      }
    }),
  });
});
export const layer = Layer.effect(VaultSecretRequests, make);
