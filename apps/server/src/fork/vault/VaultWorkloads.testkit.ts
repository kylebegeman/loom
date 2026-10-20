import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
export const workloadFixture = Effect.gen(function* () {
  const keys = yield* BrokerCrypto.BrokerCrypto,
    machine = yield* keys.create,
    workload = yield* keys.create;
  const environmentId = EnvironmentId.make("workload-test"),
    threadId = ThreadId.make("workload-owner");
  const state = {
    allow: true,
    hostActive: true,
    leaseUntil: (yield* Clock.currentTimeMillis) + 600_000,
    thread: liveThreadShell(threadId),
    decisions: [] as Array<{
      threadId: ThreadId;
      itemId: string;
      action: string;
      destination: string | null;
    }>,
  };
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    BrokerCrypto.layer,
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: (id) => Effect.sync(() => (id === threadId ? state.thread : null)),
    }),
    Layer.mock(VaultAccess.VaultAccess)({
      require: (threadId, itemId, action, destination) =>
        Effect.suspend(() => {
          state.decisions.push({ threadId, itemId, action, destination });
          return state.allow ? Effect.void : Effect.fail(new VaultError({ reason: "denied" }));
        }),
    }),
    Layer.mock(VaultBrokers.VaultBrokers)({
      snapshot: Effect.sync(() => ({
        environmentId,
        revision: 1,
        enrollments: [],
        events: [],
        omittedEvents: 0,
        machines: [
          {
            id: machine.fingerprint.slice(0, 32),
            label: "Isolated host",
            platform: "linux" as const,
            publicKey: machine.publicKey,
            fingerprint: machine.fingerprint,
            state: state.hostActive ? ("active" as const) : ("disabled" as const),
            revision: 1,
            approvedBy: "admin",
            approvedAt: 0,
            lastSeenAt: 0,
            leaseUntil: state.leaseUntil,
          },
        ],
      })),
    }),
  );
  return {
    environmentId,
    threadId,
    machine,
    workload,
    keys,
    state,
    layer: VaultWorkloads.layer.pipe(Layer.provideMerge(dependencies)),
    input: {
      machineId: machine.fingerprint.slice(0, 32),
      publicKey: workload.publicKey,
      itemId: "a".repeat(32),
      destination: "ssh://git@example.test:22",
    },
  };
});
