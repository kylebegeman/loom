import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { VaultError, type VaultItemSummary } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as VaultCore from "../vault/VaultCore.ts";
import * as VaultAccess from "../vault/VaultAccess.ts";
import * as Credentials from "./DevApiCredentials.ts";
const environmentId = EnvironmentId.make("api-computer");
const threadId = ThreadId.make("api-thread");
const binding = {
  environmentId,
  itemId: "a".repeat(32),
  label: "API key",
  origin: "https://api.example.test",
  version: null,
};
const fixture = () => {
  let item: VaultItemSummary = {
    id: binding.itemId,
    label: "API key",
    kind: "secret",
    state: "active",
    version: 1,
    createdAt: "2026-11-02T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
  };
  const state = {
    allowed: true,
    value: "fixture-private",
    releases: 0,
    required: [] as Array<string | null>,
  };
  const deps = Layer.mergeAll(
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
    Layer.mock(VaultCore.VaultCore)({ inspect: () => Effect.succeed(item) }),
    Layer.mock(VaultAccess.VaultAccess)({
      require: (_thread, _item, _action, destination) =>
        Effect.suspend(() => {
          state.required.push(destination);
          return state.allowed ? Effect.void : Effect.fail(new VaultError({ reason: "denied" }));
        }),
      reveal: () =>
        Effect.sync(() => {
          state.releases++;
          return { item, value: Redacted.make(state.value) };
        }),
    }),
  );
  return {
    state,
    rotate: () => {
      item = { ...item, version: item.version + 1 };
      state.value = "fixture-rotated";
    },
    use: <A, E>(run: (service: Credentials.DevApiCredentials["Service"]) => Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        return yield* run(yield* Credentials.DevApiCredentials);
      }).pipe(Effect.provide(Credentials.layer.pipe(Layer.provide(deps)))),
  };
};
it.effect(
  "resolves latest eligible items privately and rechecks access, version and exact origin before dispatch",
  () => {
    const f = fixture();
    return f.use((service) =>
      Effect.gen(function* () {
        const resolved = yield* service.resolve(
          [{ key: "TOKEN", value: "", secret: true, vault: binding }],
          { kind: "agent", threadId },
        );
        expect(Redacted.value(resolved.values).TOKEN).toBe("fixture-private");
        expect(String(resolved.values)).not.toContain("fixture-private");
        yield* resolved.authorize("https://api.example.test/account");
        expect(f.state.required.every((x) => x === "https://api.example.test")).toBe(true);
        expect(
          (yield* resolved.authorize("https://elsewhere.example.test/account").pipe(Effect.flip))
            .reason,
        ).toBe("vault-destination");
        f.rotate();
        expect(
          (yield* resolved.authorize("https://api.example.test/account").pipe(Effect.flip)).reason,
        ).toBe("conflict");
        const rotated = yield* service.resolve(
          [{ key: "TOKEN", value: "", secret: true, vault: binding }],
          { kind: "agent", threadId },
        );
        expect(Redacted.value(rotated.values).TOKEN).toBe("fixture-rotated");
        f.state.allowed = false;
        expect(
          (yield* rotated.authorize("https://api.example.test/account").pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    );
  },
);
it.effect(
  "denies unavailable authority, mismatched computers, pinned rotations and clients without Vault authority before release",
  () => {
    const f = fixture();
    return f.use((service) =>
      Effect.gen(function* () {
        const variables = [{ key: "TOKEN", value: "", secret: true, vault: binding }];
        expect(
          (yield* service
            .resolve(variables, {
              kind: "client",
              actor: "reader",
              authorize: Effect.fail(new VaultError({ reason: "denied" })),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(f.state.releases).toBe(0);
        expect(
          (yield* service
            .resolve(
              [
                {
                  ...variables[0]!,
                  vault: { ...binding, environmentId: EnvironmentId.make("other") },
                },
              ],
              { kind: "agent", threadId },
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        f.rotate();
        expect(
          (yield* service
            .resolve([{ ...variables[0]!, vault: { ...binding, version: 1 } }], {
              kind: "agent",
              threadId,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(f.state.releases).toBe(0);
      }),
    );
  },
);
