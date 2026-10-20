import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { MessageId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as SshTransport from "./SshTransport.ts";
import * as VaultHealthContext from "./VaultHealthContext.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";

const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const transport = Layer.succeed(SshTransport.SshTransport, {
  execute: () => Effect.die("History inspection must not execute SSH."),
});

it.effect(
  "reads real retained history through failure, recovery and retirement without changing current bindings",
  () =>
    Effect.gen(function* () {
      const f = yield* launchFixture(transport);
      const crypto = yield* Crypto.Crypto;
      const hash = (value: string) =>
        crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(Effect.map(Hex.encode));
      const projectId = f.state.thread.projectId;
      const profile = {
        id: yield* f.id,
        label: "Earlier development",
        bindings: [{ name: "host", kind: "ssh" as const, itemId: f.itemId, repository: null }],
      };
      yield* f.grant(f.key.destination);
      yield* f.profiles.apply(
        {
          projectId,
          operationId: yield* f.id,
          expectedRevision: 0,
          change: { type: "save", profile },
        },
        "admin",
      );
      const resolution = yield* f.profiles.resolve(f.threadId, profile.id);
      const health = yield* VaultHealthContext.VaultHealthContext.pipe(
        Effect.provide(
          VaultHealthContext.layer.pipe(Layer.provide(Layer.succeedContext(f.context))),
        ),
      );
      const input = { itemId: f.itemId, projectId, cursor: null };
      const active = yield* health.retained(input);
      expect(active.items[0]?.canRetire).toBe(false);
      expect(active.items[0]?.runState).toBe("active");
      const runId = f.state.thread.activeRunId!;
      const now = yield* DateTime.now;
      f.state.runs.push({
        id: runId,
        threadId: f.threadId,
        ordinal: 1,
        providerInstanceId: f.state.thread.providerInstanceId!,
        modelSelection: f.state.thread.modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("history-proof"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: null,
        contextHandoffId: null,
      });
      f.state.thread = { ...f.state.thread, activeRunId: null, status: "idle" };
      yield* f.profiles.apply(
        {
          projectId,
          operationId: yield* f.id,
          expectedRevision: 1,
          change: {
            type: "save",
            profile: {
              ...profile,
              label: "Current development",
              bindings: [{ ...profile.bindings[0]!, itemId: null }],
            },
          },
        },
        "admin",
      );
      const matched = yield* health.retained(input);
      expect(matched.items).toHaveLength(1);
      expect(matched.items[0]?.profileLabel).toBe(resolution.label);
      expect(matched.items[0]?.profileVersion).toBe(resolution.profileVersion);
      expect(matched.items[0]?.bindings[0]?.itemVersion).toBe(resolution.bindings[0]?.version);
      expect(matched.items[0]?.canRetire).toBe(true);
      const store = yield* OpenBaoStore.OpenBaoStore;
      const path = `environments/${yield* hash(f.environmentId)}/profiles/${yield* hash(projectId)}/runs/${matched.items[0]!.id}`;
      const saved = (yield* store.read(path))!;
      const invalidVersion = yield* store.write(
        path,
        Redacted.make({ invalid: true }),
        saved.version,
      );
      expect((yield* health.retained(input).pipe(Effect.flip)).reason).toBe("invalid-response");
      yield* store.write(path, saved.value, invalidVersion);
      const recovered = yield* health.retained(input);
      expect(recovered.items.map((pin) => ({ ...pin, version: 1 }))).toEqual(
        matched.items.map((pin) => ({ ...pin, version: 1 })),
      );
      expect(recovered.coverage).toEqual(matched.coverage);
      const pin = recovered.items[0]!;
      yield* f.profiles.retirePin(
        { projectId, id: pin.id, expectedVersion: pin.version, operationId: yield* f.id },
        "admin",
      );
      const retired = yield* health.retained(input);
      expect(retired.items).toEqual([]);
      expect(retired.inspectedSelections).toBe(1);
      expect(retired.unattributableSelections).toBe(1);
      expect(retired.coverage?.externalConsumers).toBe("not-discovered");
      expect(retired.coverage?.providerCopies).toBe("unknown");
      expect(retired.coverage?.authorization).toBe("not-evaluated");
      expect((yield* f.profiles.list(projectId)).profiles[0]?.bindings[0]?.itemId).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
