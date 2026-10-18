import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const configured = Boolean(
  process.env.LOOM_VAULT_TEST_OPENBAO_URL && process.env.LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE,
);
const restoring = process.env.LOOM_VAULT_TEST_OPENBAO_RESTORE === "1";
const key = "integration/persistent-record";
const secret = "synthetic-backup-recovery-canary";
const layer = OpenBaoStore.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  Layer.provide(
    Layer.succeed(HostProcess.Environment, {
      LOOM_VAULT_OPENBAO_URL: process.env.LOOM_VAULT_TEST_OPENBAO_URL,
      LOOM_VAULT_OPENBAO_TOKEN_FILE: process.env.LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE,
    }),
  ),
);

it.live.skipIf(!configured || restoring)(
  "stores encrypted KV versions and enforces CAS in real OpenBao",
  () =>
    Effect.gen(function* () {
      const store = yield* OpenBaoStore.OpenBaoStore;
      expect((yield* store.status).state).toBe("ready");
      expect(yield* store.write(key, Redacted.make({ value: secret, revision: 1 }), 0)).toBe(1);
      expect(
        (yield* store.write(key, Redacted.make({ value: "stale" }), 0).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(yield* store.write(key, Redacted.make({ value: secret, revision: 2 }), 1)).toBe(2);
      const stored = yield* store.read(key);
      expect(stored?.version).toBe(2);
      expect(Redacted.value(stored!.value)).toEqual({ value: secret, revision: 2 });
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(yield* store.keys("integration")).toContain("persistent-record");
    }).pipe(Effect.provide(layer)),
);

it.live.skipIf(!configured || !restoring)(
  "reads the same encrypted versions after backup, clean restore and unseal",
  () =>
    Effect.gen(function* () {
      const store = yield* OpenBaoStore.OpenBaoStore;
      expect((yield* store.status).state).toBe("ready");
      const record = yield* store.read(key);
      expect(record?.version).toBe(2);
      expect(Redacted.value(record!.value)).toEqual({ value: secret, revision: 2 });
    }).pipe(Effect.provide(layer)),
);
