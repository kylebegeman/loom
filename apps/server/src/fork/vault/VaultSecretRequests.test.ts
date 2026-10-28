import { expect, it } from "@effect/vitest";
import { ThreadId, TurnItemId } from "@t3tools/contracts";
import type { VaultItemKind, VaultItemSummary } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { SecretRequests } from "../../secrets/SecretRequests.ts";
import { VaultCore } from "./VaultCore.ts";
import { VaultAccess } from "./VaultAccess.ts";
import * as VaultSecret from "./VaultSecretRequests.ts";

const input = {
  threadId: ThreadId.make("thread-1"),
  turnItemId: TurnItemId.make("secret-1"),
  itemId: "a".repeat(32),
  expectedVersion: 2,
};
const fixture = (
  options: {
    kind?: VaultItemKind;
    value?: string;
    delivery?: "file";
    version?: number;
    status?: string;
    runStatus?: string;
  } = {},
) => {
  const item: VaultItemSummary = {
    id: input.itemId,
    label: "Example key",
    kind: options.kind ?? "secret",
    state: "active",
    version: options.version ?? 2,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
  };
  const reveals: string[] = [];
  const answers: Array<{ secret: string; file: Uint8Array | undefined }> = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(VaultCore)({ inspect: () => Effect.succeed(item) }),
    Layer.mock(VaultAccess)({
      reveal: (_input, _actor, destination) =>
        Effect.sync(() => {
          reveals.push(destination!);
          return { item, value: Redacted.make(options.value ?? "synthetic-private-value") };
        }),
    }),
    Layer.mock(SecretRequests)({
      answer: (answer, file) =>
        Effect.sync(() => {
          if (answer.answer.type === "save") answers.push({ secret: answer.answer.secret, file });
        }),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadRecords: () =>
        Effect.succeed({
          runs: [{ id: "run-1", status: options.runStatus ?? "running" }],
          turnItems: [
            {
              id: input.turnItemId,
              type: "secret_request",
              runId: "run-1",
              nodeId: "node-1",
              secretStatus: options.status ?? "pending",
              delivery: options.delivery,
            },
          ],
        } as never),
    }),
  );
  return { reveals, answers, layer: VaultSecret.layer.pipe(Layer.provide(dependencies)) };
};

it.effect.each(["secret", "account", "secure-note"] as const)(
  "answers from %s without returning its value",
  (kind) => {
    const f = fixture({ kind });
    return Effect.gen(function* () {
      const service = yield* VaultSecret.VaultSecretRequests;
      expect(yield* service.answerFromItem(input, "owner")).toBeUndefined();
      expect(f.reveals).toEqual([input.threadId]);
      expect(f.answers).toEqual([{ secret: "synthetic-private-value", file: undefined }]);
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect("decodes a secure file only for a file request", () => {
  const f = fixture({
    kind: "secure-file",
    delivery: "file",
    value: JSON.stringify({
      name: "key.bin",
      mediaType: "application/octet-stream",
      base64: "AP+ACg==",
    }),
  });
  return Effect.gen(function* () {
    const service = yield* VaultSecret.VaultSecretRequests;
    yield* service.answerFromItem(input, "owner");
    expect(Array.from(f.answers[0]!.file!)).toEqual([0, 255, 128, 10]);
  }).pipe(Effect.provide(f.layer));
});
it.effect.each([
  [{ kind: "ssh-key" }, "secret-ssh-key"],
  [{ kind: "service-connection" }, "secret-service-connection"],
  [{ kind: "secure-file" }, "secret-file-required"],
  [{ version: 3 }, "conflict"],
  [{ status: "saved" }, "already_answered"],
  [{ status: "expired" }, "already_answered"],
  [{ runStatus: "completed" }, "agent_stopped"],
] as const)("refuses %j before reading a value", ([options, reason]) => {
  const f = fixture(options);
  return Effect.gen(function* () {
    const service = yield* VaultSecret.VaultSecretRequests;
    expect((yield* service.answerFromItem(input, "owner").pipe(Effect.flip)).reason).toBe(reason);
    expect(f.reveals).toEqual([]);
    expect(f.answers).toEqual([]);
  }).pipe(Effect.provide(f.layer));
});
it.effect("rejects malformed file envelopes without answering", () => {
  const f = fixture({ kind: "secure-file", delivery: "file", value: "not JSON" });
  return Effect.gen(function* () {
    const service = yield* VaultSecret.VaultSecretRequests;
    expect((yield* service.answerFromItem(input, "owner").pipe(Effect.flip)).reason).toBe(
      "invalid-input",
    );
    expect(f.answers).toEqual([]);
  }).pipe(Effect.provide(f.layer));
});
