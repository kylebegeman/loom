import type { EnvironmentAuthorizationError } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_WS_METHODS as PUSH,
  type LibraryPushRegisterRequest,
  LibraryPushRpcGroup,
  type LibraryPushTestRequest,
  type LibraryPushUnregisterRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { LibraryPushService, sessionCaller } from "./LibraryPushService.ts";

type LibraryPushRpcMethod = (typeof PUSH)[keyof typeof PUSH];

/** The part of `ForkRpcAuth` these handlers use, so they depend only on their own tags. */
export interface LibraryPushRpcAuth {
  readonly effect: <A, E, R>(
    method: LibraryPushRpcMethod,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
}

/** The caller's scope comes from the session alone; request bodies never name an account. */
export const makeLibraryPushRpcHandlers = Effect.fn("LibraryPush.makeRpcHandlers")(function* (
  auth: LibraryPushRpcAuth,
  session: AuthenticatedSession,
) {
  const service = yield* LibraryPushService;
  const caller = sessionCaller(session);
  return LibraryPushRpcGroup.of({
    [PUSH.status]: () => auth.effect(PUSH.status, service.status(caller)),
    [PUSH.register]: (input: LibraryPushRegisterRequest) =>
      auth.effect(PUSH.register, service.register(caller, input)),
    [PUSH.unregister]: (input: LibraryPushUnregisterRequest) =>
      auth.effect(PUSH.unregister, service.unregister(caller, input)),
    [PUSH.test]: (input: LibraryPushTestRequest) =>
      auth.effect(PUSH.test, service.test(caller, input)),
  });
});
