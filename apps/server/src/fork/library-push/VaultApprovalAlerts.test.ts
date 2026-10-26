import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_ACTIVITY_ROUTE,
  LibraryError,
  type LibraryPushActivityReply,
  type LibraryPushActivityRequest,
  LibraryPushError,
  type VaultApprovalRequest,
} from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { type HttpClientRequest, HttpClientResponse } from "effect/http";

import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import * as ApprovalNotifications from "../vault/ApprovalNotifications.ts";
import { LibraryPushService } from "./LibraryPushService.ts";
import { type UnheardAlert, UnheardAlertNotices } from "./UnheardAlertNotices.ts";
import * as VaultApprovalAlerts from "./VaultApprovalAlerts.ts";

const ENVIRONMENT_ID = EnvironmentId.make("computer-1");
const THREAD_ID = ThreadId.make("vault-thread");
// Distinct markers, so any of them reaching the Library shows up in the posted body.
const request: VaultApprovalRequest = {
  id: "a".repeat(32),
  threadId: THREAD_ID,
  itemId: "b".repeat(32),
  action: "use",
  destination: "ssh://deploy@private-host.invalid:22",
  projectId: "private-project",
  itemVersion: 1,
  policyRevision: 0,
  revision: 1,
  requestedBy: "thread:vault-thread",
  requestedAt: 0,
  requestExpiresAt: 600_000,
  state: "pending",
  decidedBy: null,
  approvedUntil: null,
  grantId: null,
};
const VAULT_ALERT: LibraryPushActivityRequest = { threadId: THREAD_ID, kind: "vault-approval" };

type Send = Extract<LibraryConnection.LibraryConnection, { readonly kind: "remote" }>["send"];

const remote = (send: Send): LibraryConnection.LibraryConnection => ({
  kind: "remote",
  credential: null,
  origin: "https://library.example.test",
  endpoint: (path) => new URL(path, "https://library.example.test").toString(),
  send,
});

const answering = (response: () => Response): LibraryConnection.LibraryConnection =>
  remote((outgoing) => Effect.succeed(HttpClientResponse.fromWeb(outgoing, response())));

/** The Library's own push service, as the in-process path sees it. */
const libraryPush = (
  alerts: boolean,
  alert: (
    request: LibraryPushActivityRequest,
  ) => Effect.Effect<LibraryPushActivityReply, LibraryPushError> = () => Effect.die("unused"),
) =>
  Layer.mock(LibraryPushService)({
    alerts,
    alert: (environmentId, activity) => {
      expect(environmentId).toBe(ENVIRONMENT_ID);
      return alert(activity);
    },
  });

type Notice = { readonly threadId: ThreadId; readonly alert: UnheardAlert };

/** The real notification service, sending through the adapter over the given channels. */
const alertsLayer = (
  connection: LibraryConnection.LibraryConnection,
  push: Layer.Layer<LibraryPushService> = libraryPush(false),
  notices: Array<Notice> = [],
) =>
  ApprovalNotifications.layer.pipe(
    Layer.provide(VaultApprovalAlerts.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LibraryConnection.LibraryConnectionService)({
          current: Effect.succeed(connection),
        }),
        push,
        Layer.mock(UnheardAlertNotices)({
          post: (threadId, alert) => Effect.sync(() => void notices.push({ threadId, alert })),
        }),
        Layer.succeed(ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
        }),
      ),
    ),
  );

const deliveryOf = (
  connection: LibraryConnection.LibraryConnection,
  push?: Layer.Layer<LibraryPushService>,
  notices?: Array<Notice>,
) =>
  Effect.gen(function* () {
    const notifications = yield* ApprovalNotifications.ApprovalNotifications;
    yield* notifications.pending(request);
    // A replay of the same request never sends again.
    yield* notifications.pending(request);
    return (yield* notifications.outcomes([request]))[0]?.delivery;
  }).pipe(Effect.provide(alertsLayer(connection, push, notices)));

const bodyOf = (outgoing: HttpClientRequest.HttpClientRequest) =>
  outgoing.body._tag === "Uint8Array" ? new TextDecoder().decode(outgoing.body.body) : null;

describe("VaultApprovalAlerts", () => {
  it.effect("posts only the requesting thread to the Library and reports delivery", () =>
    Effect.gen(function* () {
      const posts: Array<HttpClientRequest.HttpClientRequest> = [];
      const delivery = yield* deliveryOf(
        remote((outgoing) =>
          Effect.sync(() => {
            posts.push(outgoing);
            return HttpClientResponse.fromWeb(outgoing, Response.json({ sent: 1 }));
          }),
        ),
      );
      expect(delivery).toBe("delivered");
      expect(posts).toHaveLength(1);
      expect(posts[0]?.url).toBe(`https://library.example.test${LIBRARY_PUSH_ACTIVITY_ROUTE}`);
      const body = bodyOf(posts[0]!);
      expect(JSON.parse(body ?? "null")).toEqual(VAULT_ALERT);
      for (const secret of [
        request.itemId,
        request.destination,
        request.projectId,
        request.id,
        "deploy",
      ]) {
        expect(body).not.toContain(secret);
      }
    }),
  );

  it.effect("sends the Library's own threads through its push service", () =>
    Effect.gen(function* () {
      const alerts: Array<LibraryPushActivityRequest> = [];
      const delivery = yield* deliveryOf(
        { kind: "authority" },
        libraryPush(true, (activity) =>
          Effect.sync(() => {
            alerts.push(activity);
            return { sent: 2 };
          }),
        ),
      );
      expect(delivery).toBe("delivered");
      expect(alerts).toEqual([VAULT_ALERT]);
    }),
  );

  it.effect.each<readonly [string, LibraryConnection.LibraryConnection, boolean]>([
    ["no Library", { kind: "none" }, false],
    ["an unreadable sign-in", { kind: "unavailable" }, false],
    ["a Library with agent alerts off", { kind: "authority" }, false],
    [
      "a Library without the activity route",
      answering(() => new Response(null, { status: 404 })),
      false,
    ],
    ["a sign-in page instead of a reply", answering(() => new Response("<html></html>")), false],
  ])("stays stubbed with %s", ([, connection, alerts]) =>
    Effect.gen(function* () {
      expect(yield* deliveryOf(connection, libraryPush(alerts))).toBe("stubbed");
    }),
  );

  it.effect.each<readonly [string, LibraryConnection.LibraryConnection]>([
    ["the Library is down", answering(() => Response.json({}, { status: 503 }))],
    ["an older Library refuses the kind", answering(() => Response.json({}, { status: 400 }))],
    ["the computer is not in the directory", answering(() => Response.json({}, { status: 409 }))],
    ["no iPhone heard it", answering(() => Response.json({ sent: 0 }))],
    ["the request fails", remote(() => Effect.fail(new LibraryError({ reason: "io" })))],
  ])("is unconfirmed, once, when %s", ([, connection]) =>
    Effect.gen(function* () {
      let posts = 0;
      const counted = remote((outgoing) => {
        posts++;
        return connection.kind === "remote" ? connection.send(outgoing) : Effect.die("unused");
      });
      expect(yield* deliveryOf(counted)).toBe("unconfirmed");
      expect(posts).toBe(1);
    }),
  );

  it.effect.each<readonly [string, Effect.Effect<LibraryPushActivityReply, LibraryPushError>]>([
    ["is over its hourly limit", Effect.fail(new LibraryPushError({ reason: "rate-limited" }))],
    ["cannot use its push key", Effect.fail(new LibraryPushError({ reason: "misconfigured" }))],
    ["has no iPhone to send to", Effect.succeed({ sent: 0 })],
  ])("is unconfirmed when the Library %s", ([, answer]) =>
    Effect.gen(function* () {
      expect(
        yield* deliveryOf(
          { kind: "authority" },
          libraryPush(true, () => answer),
        ),
      ).toBe("unconfirmed");
    }),
  );

  it.effect("tells the requesting thread when the Library has no iPhone registered", () =>
    Effect.gen(function* () {
      const notices: Array<Notice> = [];
      const unheard = answering(() => Response.json({ sent: 0, devices: 0 }));
      expect(yield* deliveryOf(unheard, undefined, notices)).toBe("unconfirmed");
      const own = libraryPush(true, () => Effect.succeed({ sent: 0, devices: 0 }));
      expect(yield* deliveryOf({ kind: "authority" }, own, notices)).toBe("unconfirmed");
      expect(notices).toEqual([
        { threadId: THREAD_ID, alert: "vault" },
        { threadId: THREAD_ID, alert: "vault" },
      ]);
    }),
  );

  it.effect.each<readonly [string, () => Response]>([
    ["an iPhone missed it", () => Response.json({ sent: 0, devices: 1 })],
    ["an older Library does not count iPhones", () => Response.json({ sent: 0 })],
    ["it was delivered", () => Response.json({ sent: 1, devices: 1 })],
  ])("leaves the thread alone when %s", ([, response]) =>
    Effect.gen(function* () {
      const notices: Array<Notice> = [];
      yield* deliveryOf(answering(response), undefined, notices);
      expect(notices).toEqual([]);
    }),
  );

  it.effect("lets a slow post finish after the request stops waiting for it", () =>
    Effect.gen(function* () {
      const posted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const answered = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const notifications = yield* ApprovalNotifications.ApprovalNotifications;
        const pending = yield* notifications.pending(request).pipe(Effect.forkChild);
        yield* Deferred.await(posted);
        yield* TestClock.adjust("2 seconds");
        yield* Fiber.join(pending);
        expect((yield* notifications.outcomes([request]))[0]?.delivery).toBe("unconfirmed");
        // Interrupting the post here would leave `answered` unset and this wait unfinished.
        yield* Deferred.succeed(release, undefined);
        yield* Deferred.await(answered);
      }).pipe(
        Effect.provide(
          alertsLayer(
            remote((outgoing) =>
              Deferred.succeed(posted, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Deferred.succeed(answered, undefined)),
                Effect.as(HttpClientResponse.fromWeb(outgoing, Response.json({ sent: 1 }))),
              ),
            ),
          ),
        ),
      );
    }),
  );
});
