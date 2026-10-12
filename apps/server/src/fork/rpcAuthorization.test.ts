import {
  WsRpcGroup,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  ForkRpcGroup,
  WORKSPACE_HANDOFF_WS_METHODS as H,
  MODEL_PREVIEW_3D_WS_METHODS as M,
  PCB_PREVIEW_WS_METHODS as P,
} from "@t3tools/contracts/fork";
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

it.effect("print checks and cancellation require the operate grant before work starts", () =>
  Effect.gen(function* () {
    const auth = makeForkRpcAuth({
      sessionId: AuthSessionId.make("check-test"),
      subject: "test",
      method: "bearer-access-token",
      scopes: [AuthOrchestrationReadScope],
    });
    let started = false;
    for (const method of [M.checkPrint, M.cancelPrintCheck]) {
      const denied = yield* Effect.flip(
        auth.effect(
          method,
          Effect.sync(() => {
            started = true;
          }),
        ),
      );
      expect(denied.requiredScope).toBe("orchestration:operate");
    }
    expect(started).toBe(false);
  }),
);

it.effect("PCB printing requires the terminal grant before host work or workspace saves", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("pcb-print-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    let started = false;
    const work = Effect.sync(() => {
      started = true;
      return "printed";
    });
    const denied = yield* auth([AuthOrchestrationReadScope, AuthOrchestrationOperateScope])
      .effect(P.print, work)
      .pipe(Effect.flip);
    expect(denied.requiredScope).toBe(AuthTerminalOperateScope);
    expect(started).toBe(false);
    expect(yield* auth([AuthTerminalOperateScope]).effect(P.print, work)).toBe("printed");
    expect(started).toBe(true);
  }),
);

it.effect.each(Object.values(H))(
  "handoff %s requires its host's operate grant before work starts",
  (method) =>
    Effect.gen(function* () {
      const auth = (scopes: readonly AuthEnvironmentScope[]) =>
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("handoff-test"),
          subject: "test",
          method: "bearer-access-token",
          scopes,
        });
      let invoked = false;
      const work = Effect.sync(() => {
        invoked = true;
        return "accepted";
      });
      const denied = yield* auth([AuthOrchestrationReadScope])
        .effect(method, work)
        .pipe(Effect.flip);
      expect(denied.requiredScope).toBe(AuthOrchestrationOperateScope);
      expect(invoked).toBe(false);
      expect(yield* auth([AuthOrchestrationOperateScope]).effect(method, work)).toBe("accepted");
      expect(invoked).toBe(true);
    }),
);
