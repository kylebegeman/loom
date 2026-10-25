import {
  AuthLibraryPublishScope,
  WsRpcGroup,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthSessionId,
  AuthEnvironmentMaintainScope,
  AuthSettingsWriteScope,
  AuthPreviewOperateScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  type ForkRpcMethod,
  LIBRARY_WS_METHODS as LIB,
  ForkRpcGroup,
  COMPUTER_NAMING_WS_METHODS as N,
  GITHUB_HOST_SETUP_WS_METHODS as GH,
  WORKSPACE_HANDOFF_WS_METHODS as H,
  MINI_OFFLOAD_WS_METHODS as O,
  MODEL_PREVIEW_3D_WS_METHODS as M,
  PCB_PREVIEW_WS_METHODS as P,
  PROJECT_CHECKOUT_WS_METHODS as C,
  PREVIEW_LINKS_WS_METHODS as PL,
  REACH_WS_METHODS as REACH,
  LIBRARY_PUSH_WS_METHODS as PUSH,
  FORK_CLIENT_GUARDED_RPC_SCOPES,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { PocketIdStandardScopes } from "../auth/PocketId.ts";
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

it.effect(
  "GitHub setup requires terminal permission for mutations and approval-code subscriptions",
  () =>
    Effect.gen(function* () {
      const auth = (scopes: readonly AuthEnvironmentScope[]) =>
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("github-setup-test"),
          subject: "test",
          method: "bearer-access-token",
          scopes,
        });
      const read = auth([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
      let invoked = false;
      const work = Effect.sync(() => {
        invoked = true;
        return "accepted";
      });
      for (const method of [GH.start, GH.cancel]) {
        const denied = yield* read.effect(method, work).pipe(Effect.flip);
        expect(denied.requiredScope).toBe(AuthTerminalOperateScope);
      }
      const denied = yield* Stream.runCollect(read.stream(GH.watch, Stream.fromEffect(work))).pipe(
        Effect.flip,
      );
      expect(denied.requiredScope).toBe(AuthTerminalOperateScope);
      expect(invoked).toBe(false);
      const terminal = auth([AuthTerminalOperateScope]);
      expect(yield* terminal.effect(GH.start, work)).toBe("accepted");
      expect(yield* Stream.runCollect(terminal.stream(GH.watch, Stream.make("ABCD-EFGH")))).toEqual(
        ["ABCD-EFGH"],
      );
    }),
);

it.effect("Mini workers require admin maintenance and job dispatch requires terminal access", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("mini-permission-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    let invoked = false;
    const work = Effect.sync(() => {
      invoked = true;
      return "executed";
    });
    for (const method of [O.register, O.setEnabled, O.prepare, O.updateWorker, O.removeWorker]) {
      const error = yield* auth([AuthOrchestrationReadScope, AuthTerminalOperateScope])
        .effect(method, work)
        .pipe(Effect.flip);
      expect(error.requiredScope).toBe(AuthEnvironmentMaintainScope);
      expect(invoked).toBe(false);
      expect(yield* auth([AuthEnvironmentMaintainScope]).effect(method, work)).toBe("executed");
      invoked = false;
    }
    for (const method of [O.submit, O.recover, O.cancel]) {
      const error = yield* auth([AuthOrchestrationReadScope, AuthOrchestrationOperateScope])
        .effect(method, work)
        .pipe(Effect.flip);
      expect(error.requiredScope).toBe(AuthTerminalOperateScope);
      expect(invoked).toBe(false);
      expect(yield* auth([AuthTerminalOperateScope]).effect(method, work)).toBe("executed");
      invoked = false;
    }
    for (const method of [O.workers, O.list, O.inspect, O.patch, O.artifacts, O.check]) {
      const error = yield* auth([]).effect(method, work).pipe(Effect.flip);
      expect(error.requiredScope).toBe(AuthOrchestrationReadScope);
      expect(invoked).toBe(false);
      expect(yield* auth([AuthOrchestrationReadScope]).effect(method, work)).toBe("executed");
      invoked = false;
    }
  }),
);

it.effect("computer renaming requires settings write without mutating on a denied grant", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("computer-naming-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    let changed = false;
    const rename = Effect.sync(() => {
      changed = true;
      return "Renamed";
    });
    const denied = yield* auth([AuthOrchestrationReadScope, AuthOrchestrationOperateScope])
      .effect(N.rename, rename)
      .pipe(Effect.flip);
    expect(denied.requiredScope).toBe(AuthSettingsWriteScope);
    expect(changed).toBe(false);
    expect(yield* auth([AuthSettingsWriteScope]).effect(N.rename, rename)).toBe("Renamed");
    expect(yield* auth([AuthOrchestrationReadScope]).effect(N.get, Effect.succeed("Current"))).toBe(
      "Current",
    );
  }),
);

it.effect("checkout previews require read access and never start without it", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("checkout-preview-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    let inspected = false;
    const inspect = Effect.sync(() => {
      inspected = true;
      return "preview";
    });
    const denied = yield* auth([]).effect(C.preview, inspect).pipe(Effect.flip);
    expect(denied.requiredScope).toBe(AuthOrchestrationReadScope);
    expect(inspected).toBe(false);
    expect(yield* auth([AuthOrchestrationReadScope]).effect(C.preview, inspect)).toBe("preview");
    expect(inspected).toBe(true);
  }),
);

it.effect.each([C.adopt, C.setRetention])(
  "checkout %s requires settings write before any ownership or policy mutation",
  (method) =>
    Effect.gen(function* () {
      const auth = (scopes: readonly AuthEnvironmentScope[]) =>
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("checkout-mutation-test"),
          subject: "test",
          method: "bearer-access-token",
          scopes,
        });
      let changed = false;
      const update = Effect.sync(() => {
        changed = true;
        return "saved";
      });
      const denied = yield* auth([
        AuthOrchestrationReadScope,
        AuthOrchestrationOperateScope,
        AuthTerminalOperateScope,
      ])
        .effect(method, update)
        .pipe(Effect.flip);
      expect(denied.requiredScope).toBe(AuthSettingsWriteScope);
      expect(changed).toBe(false);
      expect(yield* auth([AuthSettingsWriteScope]).effect(method, update)).toBe("saved");
      expect(changed).toBe(true);
    }),
);

it.effect("a host publishing credential grants no ordinary RPC operations", () =>
  Effect.gen(function* () {
    const auth = makeForkRpcAuth({
      sessionId: AuthSessionId.make("publisher-test"),
      subject: "loom-host:fixture-source",
      method: "bearer-access-token",
      scopes: [AuthLibraryPublishScope],
    });
    for (const tag of forkTags) {
      let invoked = false;
      const denied = yield* auth
        .effect(
          tag as ForkRpcMethod,
          Effect.sync(() => {
            invoked = true;
          }),
        )
        .pipe(Effect.flip);
      expect(denied._tag).toBe("EnvironmentAuthorizationError");
      expect(invoked).toBe(false);
    }
  }),
);

it.effect("Library refresh subscriptions require read access before observing changes", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("library-refresh-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    let subscribed = false;
    const stream = Stream.fromEffect(
      Effect.sync(() => {
        subscribed = true;
        return 1;
      }),
    );
    const denied = yield* Stream.runCollect(auth([]).stream(LIB.subscribeRefreshes, stream)).pipe(
      Effect.flip,
    );
    expect(denied.requiredScope).toBe(AuthOrchestrationReadScope);
    expect(subscribed).toBe(false);
    expect(
      yield* Stream.runCollect(
        auth([AuthOrchestrationReadScope]).stream(LIB.subscribeRefreshes, stream),
      ),
    ).toEqual([1]);
    expect(subscribed).toBe(true);
  }),
);

it.effect("reads published pages with read access and changes them only with preview access", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("preview-pages-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    const read = auth([AuthOrchestrationReadScope]);
    expect(yield* read.effect(PL.pagesList, Effect.succeed("pages"))).toBe("pages");
    let changed = false;
    const change = Effect.sync(() => {
      changed = true;
      return "kept";
    });
    const denied = yield* read.effect(PL.pagesUpdate, change).pipe(Effect.flip);
    expect(denied.requiredScope).toBe(AuthPreviewOperateScope);
    expect(changed).toBe(false);
    expect(
      yield* auth([AuthOrchestrationReadScope, AuthPreviewOperateScope]).effect(
        PL.pagesUpdate,
        change,
      ),
    ).toBe("kept");
    // Clients read the list through a query atom, and query atoms refuse guarded tags.
    expect(FORK_CLIENT_GUARDED_RPC_SCOPES).not.toHaveProperty(PL.pagesList);
    expect(FORK_CLIENT_GUARDED_RPC_SCOPES[PL.pagesUpdate]).toBe(AuthPreviewOperateScope);
  }),
);

const sessionAuth = (scopes: readonly AuthEnvironmentScope[]) =>
  makeForkRpcAuth({
    sessionId: AuthSessionId.make("reach-push-test"),
    subject: "test",
    method: "bearer-access-token",
    scopes,
  });

const REACH_AND_PUSH_SCOPES = [
  [REACH.set, AuthRelayWriteScope],
  [REACH.remove, AuthRelayWriteScope],
  [REACH.libraryList, AuthOrchestrationReadScope],
  [REACH.libraryRetire, AuthSettingsWriteScope],
  [PUSH.status, AuthOrchestrationReadScope],
  [PUSH.register, AuthSettingsWriteScope],
  [PUSH.unregister, AuthSettingsWriteScope],
  [PUSH.test, AuthSettingsWriteScope],
] as const;

it.effect.each(REACH_AND_PUSH_SCOPES)("%s needs %s before any work starts", ([method, scope]) =>
  Effect.gen(function* () {
    let invoked = false;
    const work = Effect.sync(() => {
      invoked = true;
      return "done";
    });
    // Every other standard grant, so only the one the method names is missing.
    const others = sessionAuth(
      [...PocketIdStandardScopes, AuthRelayWriteScope].filter((granted) => granted !== scope),
    );
    const denied = yield* others.effect(method, work).pipe(Effect.flip);
    expect(denied.requiredScope).toBe(scope);
    expect(invoked).toBe(false);
    expect(yield* sessionAuth([scope]).effect(method, work)).toBe("done");
    expect(invoked).toBe(true);
  }),
);

it.effect("reach status streams only with relay read", () =>
  Effect.gen(function* () {
    let subscribed = false;
    const stream = Stream.fromEffect(
      Effect.sync(() => {
        subscribed = true;
        return "status";
      }),
    );
    const denied = yield* Stream.runCollect(
      sessionAuth([AuthOrchestrationReadScope, AuthSettingsWriteScope]).stream(REACH.watch, stream),
    ).pipe(Effect.flip);
    expect(denied.requiredScope).toBe(AuthRelayReadScope);
    expect(subscribed).toBe(false);
    expect(
      yield* Stream.runCollect(sessionAuth([AuthRelayReadScope]).stream(REACH.watch, stream)),
    ).toEqual(["status"]);
  }),
);

it.effect(
  "a standard Identity session can retire computers and use push but cannot switch reach",
  () =>
    Effect.gen(function* () {
      const identity = sessionAuth(PocketIdStandardScopes);
      for (const method of [REACH.set, REACH.remove]) {
        const denied = yield* identity.effect(method, Effect.void).pipe(Effect.flip);
        expect(denied.requiredScope).toBe(AuthRelayWriteScope);
      }
      for (const method of [
        REACH.libraryList,
        REACH.libraryRetire,
        PUSH.status,
        PUSH.register,
        PUSH.unregister,
        PUSH.test,
      ]) {
        expect(yield* identity.effect(method, Effect.succeed(method))).toBe(method);
      }
      expect(yield* Stream.runCollect(identity.stream(REACH.watch, Stream.make("status")))).toEqual(
        ["status"],
      );
    }),
);

it("guards reach and push changes in the client and leaves their reads to query atoms", () => {
  expect(FORK_CLIENT_GUARDED_RPC_SCOPES[REACH.set]).toBe(AuthRelayWriteScope);
  expect(FORK_CLIENT_GUARDED_RPC_SCOPES[REACH.remove]).toBe(AuthRelayWriteScope);
  expect(FORK_CLIENT_GUARDED_RPC_SCOPES[REACH.libraryRetire]).toBe(AuthSettingsWriteScope);
  expect(FORK_CLIENT_GUARDED_RPC_SCOPES[PUSH.register]).toBe(AuthSettingsWriteScope);
  expect(FORK_CLIENT_GUARDED_RPC_SCOPES[PUSH.unregister]).toBe(AuthSettingsWriteScope);
  expect(FORK_CLIENT_GUARDED_RPC_SCOPES[PUSH.test]).toBe(AuthSettingsWriteScope);
  for (const read of [REACH.watch, REACH.libraryList, PUSH.status]) {
    expect(FORK_CLIENT_GUARDED_RPC_SCOPES).not.toHaveProperty(read);
  }
});
