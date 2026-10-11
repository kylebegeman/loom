import {
  WsRpcGroup,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { ForkRpcGroup, MODEL_PREVIEW_3D_WS_METHODS as M } from "@t3tools/contracts/fork";
import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { FORK_RPC_REQUIRED_SCOPES, makeForkRpcAuth } from "./rpcAuthorization.ts";

const forkTags = [...ForkRpcGroup.requests.keys()];

describe("fork RPC authorization", () => {
  it("declares exactly one scope for every fork RPC", () => {
    expect(new Set(Object.keys(FORK_RPC_REQUIRED_SCOPES))).toEqual(new Set(forkTags));
  });

  it("never reuses an upstream tag, which RpcGroup.merge would silently replace", () => {
    const upstreamTags = new Set(WsRpcGroup.requests.keys());
    expect(forkTags.filter((tag) => upstreamTags.has(tag))).toEqual([]);
  });

  it("prefixes every fork tag with loom.", () => {
    expect(forkTags.filter((tag) => !tag.startsWith("loom."))).toEqual([]);
  });
});

it.effect(
  "authorizes turn-model queries and subscriptions as reads and denies missing grants",
  () =>
    Effect.gen(function* () {
      const auth = (scopes: readonly AuthEnvironmentScope[]) =>
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("turn-models-test"),
          subject: "test",
          method: "bearer-access-token",
          scopes,
        });
      const read = auth([AuthOrchestrationReadScope]);
      expect(yield* read.effect(M.turnModels, Effect.succeed("read"))).toBe("read");
      expect(
        yield* Stream.runCollect(read.stream(M.turnModelEvents, Stream.make("event"))),
      ).toEqual(["event"]);
      let invoked = false;
      const deniedQuery = yield* Effect.flip(
        auth([]).effect(
          M.turnModels,
          Effect.sync(() => {
            invoked = true;
          }),
        ),
      );
      expect(deniedQuery.requiredScope).toBe(AuthOrchestrationReadScope);
      const deniedStream = yield* Effect.flip(
        Stream.runCollect(auth([]).stream(M.turnModelEvents, Stream.make("event"))),
      );
      expect(deniedStream.requiredScope).toBe(AuthOrchestrationReadScope);
      expect(invoked).toBe(false);
    }),
);
