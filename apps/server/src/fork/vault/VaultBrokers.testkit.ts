import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
export const brokerFixture = () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = { failWrites: false, conflictOnce: false };
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    BrokerCrypto.layer,
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("broker-test")),
    }),
    Layer.mock(OpenBaoStore.OpenBaoStore)({
      read: (path) => Effect.sync(() => records.get(path) ?? null),
      write: (path, value, expected) =>
        Effect.suspend(() => {
          if (state.failWrites) return Effect.fail(new VaultError({ reason: "unavailable" }));
          if (state.conflictOnce) {
            state.conflictOnce = false;
            return Effect.fail(new VaultError({ reason: "conflict" }));
          }
          const version = records.get(path)?.version ?? 0;
          if (version !== expected) return Effect.fail(new VaultError({ reason: "conflict" }));
          records.set(path, { value, version: version + 1 });
          return Effect.succeed(version + 1);
        }),
    }),
  );
  return { records, state, layer: VaultBrokers.layer.pipe(Layer.provideMerge(dependencies)) };
};
