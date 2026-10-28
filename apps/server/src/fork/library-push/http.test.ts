import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  DirectoryError,
  LIBRARY_PUSH_ACTIVITY_ROUTE,
  LIBRARY_PUSH_READINESS_ROUTE,
  type LibraryPushActivityRequest,
  type LibraryPushDevice,
  LibraryPushError,
  type LibraryPushErrorReason,
} from "@t3tools/contracts/fork";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { LibraryPushHttpRoutes } from "./http.ts";
import { LibraryPushService } from "./LibraryPushService.ts";

const STUDIO = EnvironmentId.make("environment-studio");
const ACTIVITY = JSON.stringify({ threadId: "thread-1", kind: "completed" });
const PHONE = {
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  deviceId: "per-install-device-id",
  label: "Kyle's iPhone",
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: null,
  registeredAt: "2026-10-24T12:00:00.000Z",
  refreshedAt: "2026-10-24T12:00:00.000Z",
  expiresAt: "2026-10-31T12:00:00.000Z",
  mine: false,
  lastDelivery: null,
} satisfies LibraryPushDevice;

const sessionFor = (
  subject: string,
  scopes: EnvironmentAuth.AuthenticatedSession["scopes"] = [AuthLibraryPublishScope],
): EnvironmentAuth.AuthenticatedSession => ({
  sessionId: AuthSessionId.make(`session-${subject}`),
  subject,
  method: "bearer-access-token",
  scopes,
});

const fixture = Effect.fn("test.fixture")(function* (
  options: {
    readonly alerts?: boolean;
    readonly pinned?: Effect.Effect<null, DirectoryError>;
    readonly refuse?: LibraryPushErrorReason;
    readonly devices?: ReadonlyArray<LibraryPushDevice>;
  } = {},
) {
  const sent: Array<{
    readonly environmentId: EnvironmentId;
    readonly request: LibraryPushActivityRequest;
  }> = [];
  const state = {
    caller: sessionFor(`loom-host:${STUDIO}`) as EnvironmentAuth.AuthenticatedSession | null,
  };
  const context = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(LibraryPushService)({
        alerts: options.alerts ?? true,
        status: () =>
          Effect.succeed({
            state: "ready",
            reason: null,
            key: { teamId: "TEAM123456", keyId: "KEY1234567" },
            devices: options.devices ?? [],
            topics: [{ bundleId: "com.kylebegeman.loom", apsEnvironment: "production" }],
          }),
        alert: (environmentId, request) =>
          options.refuse === undefined
            ? Effect.sync(() => {
                sent.push({ environmentId, request });
                return { sent: 1 };
              })
            : Effect.fail(new LibraryPushError({ reason: options.refuse })),
      }),
      Layer.mock(DirectoryService)({
        pinned: () => options.pinned ?? Effect.succeed({} as never),
      }),
    ),
  );
  const app = LibraryPushHttpRoutes.pipe(
    Layer.provide(Layer.succeed(ForkRuntime, context as unknown as Context.Context<ForkServices>)),
    HttpRouter.provideRequest(
      Layer.mergeAll(
        NodeHttpPlatform.layer,
        Layer.mock(EnvironmentAuth.EnvironmentAuth)({
          authenticateHttpRequest: () =>
            state.caller === null
              ? Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError())
              : Effect.succeed(state.caller),
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));

  const post = (body: string, headers: Record<string, string> = {}) =>
    Effect.promise(async () => {
      const response = await web.handler(
        new Request(`http://library.example.test${LIBRARY_PUSH_ACTIVITY_ROUTE}`, {
          method: "POST",
          body,
          headers: { "content-type": "application/json", ...headers },
        }),
      );
      const text = await response.text();
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        json: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null,
      };
    });
  const get = (path: string) =>
    Effect.promise(async () => {
      const response = await web.handler(new Request(`http://library.example.test${path}`));
      const text = await response.text();
      return {
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
        text,
      };
    });
  return { post, get, sent, state };
});

describe("library push activity route", () => {
  it.effect("sends an alert for the computer its publisher session names", () =>
    Effect.gen(function* () {
      const { post, sent } = yield* fixture();
      expect(yield* post(ACTIVITY)).toEqual({
        status: 200,
        cacheControl: "no-store",
        json: { sent: 1 },
      });
      expect(sent).toEqual([
        { environmentId: STUDIO, request: { threadId: "thread-1", kind: "completed" } },
      ]);
      expect(
        (yield* post(JSON.stringify({ kind: "scheduled-failed", taskId: "task-1" }))).status,
      ).toBe(200);
      expect(sent[1]).toEqual({
        environmentId: STUDIO,
        request: { kind: "scheduled-failed", taskId: "task-1" },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("admits only a computer's publisher session", () =>
    Effect.gen(function* () {
      const { post, sent, state } = yield* fixture();
      state.caller = sessionFor("pocket-id:alice");
      expect((yield* post(ACTIVITY)).status).toBe(403);
      state.caller = sessionFor(`loom-host:${STUDIO}`, [AuthOrchestrationReadScope]);
      expect((yield* post(ACTIVITY)).status).toBe(403);
      state.caller = null;
      expect((yield* post(ACTIVITY)).status).toBe(401);
      expect(sent).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect.each<{
    readonly name: string;
    readonly options: Parameters<typeof fixture>[0];
    readonly status: number;
    readonly reason: string;
  }>([
    { name: "alerts are off", options: { alerts: false }, status: 404, reason: "off" },
    {
      name: "the computer has no directory row",
      options: { pinned: Effect.succeed(null) },
      status: 409,
      reason: "not-in-directory",
    },
    {
      name: "the directory is off",
      options: { pinned: Effect.fail(new DirectoryError({ reason: "not-authority" })) },
      status: 409,
      reason: "not-in-directory",
    },
    {
      name: "the directory cannot be read",
      options: { pinned: Effect.fail(new DirectoryError({ reason: "io" })) },
      status: 503,
      reason: "unavailable",
    },
    {
      name: "the computer is over its hourly limit",
      options: { refuse: "rate-limited" },
      status: 429,
      reason: "rate-limited",
    },
    {
      name: "the Library cannot use its key",
      options: { refuse: "misconfigured" },
      status: 503,
      reason: "unavailable",
    },
  ])("answers $status when $name", ({ options, status, reason }) =>
    Effect.gen(function* () {
      const { post } = yield* fixture(options);
      expect(yield* post(ACTIVITY)).toEqual({
        status,
        cacheControl: "no-store",
        json: { reason },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("drops a body it cannot read without sending anything", () =>
    Effect.gen(function* () {
      const { post, sent } = yield* fixture();
      const answers = [
        yield* post(ACTIVITY, { "content-length": "5000" }),
        yield* post("not json"),
        yield* post(JSON.stringify({ threadId: "thread-1", kind: "finished" })),
        yield* post(JSON.stringify({ threadId: "t".repeat(257), kind: "completed" })),
      ];
      expect(answers.map((answer) => [answer.status, answer.json?.reason])).toEqual([
        [413, "too-large"],
        [400, "invalid"],
        [400, "invalid"],
        [400, "invalid"],
      ]);
      expect(sent).toEqual([]);
    }).pipe(Effect.scoped),
  );
});

describe("library push readiness route", () => {
  it.effect("tells a computer how many iPhones are registered, and nothing about them", () =>
    Effect.gen(function* () {
      const { get } = yield* fixture({ devices: [PHONE] });
      const answer = yield* get(LIBRARY_PUSH_READINESS_ROUTE);
      expect(answer).toMatchObject({ status: 200, cacheControl: "no-store" });
      expect(JSON.parse(answer.text)).toEqual({
        state: "ready",
        reason: null,
        alerts: true,
        devices: 1,
      });
      for (const detail of [PHONE.id, PHONE.deviceId, PHONE.label, "TEAM123456"])
        expect(answer.text).not.toContain(detail);
    }).pipe(Effect.scoped),
  );

  it.effect("counts no iPhones and alerts off as they are", () =>
    Effect.gen(function* () {
      const { get } = yield* fixture({ alerts: false });
      expect(JSON.parse((yield* get(LIBRARY_PUSH_READINESS_ROUTE)).text)).toEqual({
        state: "ready",
        reason: null,
        alerts: false,
        devices: 0,
      });
    }).pipe(Effect.scoped),
  );

  it.effect("admits only a computer's publisher session", () =>
    Effect.gen(function* () {
      const { get, state } = yield* fixture({ devices: [PHONE] });
      state.caller = sessionFor("pocket-id:alice");
      expect((yield* get(LIBRARY_PUSH_READINESS_ROUTE)).status).toBe(403);
      state.caller = sessionFor(`loom-host:${STUDIO}`, [AuthOrchestrationReadScope]);
      expect((yield* get(LIBRARY_PUSH_READINESS_ROUTE)).status).toBe(403);
      state.caller = null;
      expect((yield* get(LIBRARY_PUSH_READINESS_ROUTE)).status).toBe(401);
    }).pipe(Effect.scoped),
  );
});
