import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  type AuthEnvironmentScope,
  type EnvironmentAuthorizationError,
} from "@t3tools/contracts";
import {
  LIBRARY_PUSH_WS_METHODS as PUSH,
  type LibraryPushDevice,
  type LibraryPushError,
  type LibraryPushRegisterRequest,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { PocketIdStandardScopes } from "../../auth/PocketId.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { type LibraryPushCaller, LibraryPushService } from "./LibraryPushService.ts";
import { makeLibraryPushRpcHandlers } from "./rpc.ts";
import { libraryPushRowId } from "./registry.ts";

const ROW_ID = libraryPushRowId({ issuer: "https://id.example.test", subject: "alice" }, "phone-1");
const REGISTER: LibraryPushRegisterRequest = {
  deviceId: "per-install-device-id",
  label: "Alice's iPhone",
  platform: "ios",
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  token: Redacted.make("ab".repeat(32)),
};
const DEVICE: LibraryPushDevice = {
  id: ROW_ID,
  deviceId: REGISTER.deviceId,
  label: REGISTER.label,
  bundleId: REGISTER.bundleId,
  apsEnvironment: REGISTER.apsEnvironment,
  appVersion: null,
  registeredAt: "2026-10-24T12:00:00.000Z",
  refreshedAt: "2026-10-24T12:00:00.000Z",
  expiresAt: "2026-11-23T12:00:00.000Z",
  mine: true,
  lastDelivery: null,
};

type Call = Effect.Effect<object, EnvironmentAuthorizationError | LibraryPushError>;

const setup = (scopes: readonly AuthEnvironmentScope[]) => {
  const calls: Array<{ readonly method: string; readonly caller: LibraryPushCaller }> = [];
  const record = <A>(method: string, caller: LibraryPushCaller, value: A) =>
    Effect.sync(() => {
      calls.push({ method, caller });
      return value;
    });
  const service = Layer.succeed(
    LibraryPushService,
    LibraryPushService.of({
      status: (caller) =>
        record(PUSH.status, caller, { state: "ready", reason: null, key: null, devices: [] }),
      register: (caller) => record(PUSH.register, caller, DEVICE),
      unregister: (caller) => record(PUSH.unregister, caller, { removed: true }),
      test: (caller) => record(PUSH.test, caller, { deliveries: [] }),
    }),
  );
  const session: AuthenticatedSession = {
    sessionId: AuthSessionId.make("library-push-rpc"),
    subject: "pocket-id:alice",
    method: "browser-session-cookie",
    scopes,
  };
  const calling = Effect.map(
    makeLibraryPushRpcHandlers(makeForkRpcAuth(session), session).pipe(Effect.provide(service)),
    (handlers): ReadonlyArray<readonly [string, Call]> => [
      [PUSH.status, handlers[PUSH.status]()],
      [PUSH.register, handlers[PUSH.register](REGISTER)],
      [PUSH.unregister, handlers[PUSH.unregister]({ id: ROW_ID })],
      [PUSH.test, handlers[PUSH.test]({})],
    ],
  );
  return { calls, session, calling };
};

it.effect("refuses each push method to a session missing its grant before the service runs", () =>
  Effect.gen(function* () {
    const reader = setup([AuthOrchestrationReadScope]);
    for (const [method, operation] of yield* reader.calling) {
      if (method === PUSH.status) continue;
      const denied = yield* operation.pipe(Effect.flip);
      expect([method, denied._tag]).toEqual([method, "EnvironmentAuthorizationError"]);
      expect("requiredScope" in denied && denied.requiredScope).toBe(AuthSettingsWriteScope);
    }
    expect(reader.calls).toEqual([]);

    const writer = setup([AuthSettingsWriteScope]);
    const [status] = yield* writer.calling;
    const denied = yield* status![1].pipe(Effect.flip);
    expect("requiredScope" in denied && denied.requiredScope).toBe(AuthOrchestrationReadScope);
    expect(writer.calls).toEqual([]);
  }),
);

it.effect("lets a standard Identity session reach every push method as itself", () =>
  Effect.gen(function* () {
    const { calls, calling, session } = setup(PocketIdStandardScopes);
    for (const [, operation] of yield* calling) yield* operation;
    expect(calls.map(({ method }) => method)).toEqual(Object.values(PUSH));
    // The account comes from the session, never from the request body.
    for (const { caller } of calls) {
      expect(caller).toEqual({ _tag: "Session", subject: session.subject, scopes: session.scopes });
    }
  }),
);
