import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { currentDesktopBootstrapToken } from "@t3tools/shared/desktopBootstrapToken";
import type { DesktopBackendInstance } from "../../backend/DesktopBackendPool.ts";
import {
  makeBackendPost,
  makeOwnedBackendUpdates,
  waitForIdleInstall,
  type BackendPost,
} from "./IdleInstall.ts";

import { config, instance } from "./IdleInstall.testkit.ts";

it.effect("authenticates primary and WSL activity with each backend's own rotating secret", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(0);
    const requests: { url: string; authorization: string | undefined }[] = [];
    const client = HttpClient.make((request) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ waitingAgents: 0, plan: null })),
        ),
      );
    });
    const post = yield* makeBackendPost.pipe(Effect.provideService(HttpClient.HttpClient, client));
    const owned = makeOwnedBackendUpdates({
      instances: Effect.succeed([
        instance("primary", config(3001, "primary-secret")),
        instance("wsl", config(3002, "wsl-secret")),
      ]),
      post,
    });
    assert.equal((yield* owned.read()).waitingAgents, 0);
    assert.deepEqual(requests, [
      {
        url: "http://127.0.0.1:3001/api/loom/updates/activity",
        authorization: `Bearer ${currentDesktopBootstrapToken("primary-secret", 0)}`,
      },
      {
        url: "http://127.0.0.1:3002/api/loom/updates/activity",
        authorization: `Bearer ${currentDesktopBootstrapToken("wsl-secret", 0)}`,
      },
    ]);
  }),
);

it.effect(
  "holds for a desired-running backend with unknown activity but treats stopped and absent backends as idle",
  () =>
    Effect.gen(function* () {
      const post: BackendPost = () =>
        Effect.die("A stopped or unready backend must not be queried");
      const read = (instances: readonly DesktopBackendInstance[]) =>
        makeOwnedBackendUpdates({ instances: Effect.succeed(instances), post }).read();
      assert.equal((yield* read([])).waitingAgents, 0);
      assert.equal((yield* read([instance("stopped", null, false)])).waitingAgents, 0);
      assert.isNull((yield* read([instance("starting", null)])).waitingAgents);
    }),
);

it.effect(
  "reuses installing plan owners and releases every acquired lease after a cross-backend refusal",
  () =>
    Effect.gen(function* () {
      const one = config(3001, "one");
      const two = config(3002, "two");
      const calls: { port: number; body: unknown }[] = [];
      let refuse = true;
      let installs = 0;
      const post: BackendPost = (target, route, body) =>
        Effect.sync(() => {
          const port = target.bootstrap.port;
          if (route.endsWith("activity"))
            return {
              waitingAgents: 0,
              plan:
                port === 3001
                  ? {
                      version: 1,
                      id: "remote-plan",
                      targetVersion: "1.2.4",
                      state: "installing",
                      createdAt: 0,
                      updatedAt: 0,
                      finishedAt: null,
                      error: null,
                    }
                  : null,
            };
          calls.push({ port, body });
          const action = body as { action: string };
          return action.action === "acquire"
            ? {
                leaseId: port === 3002 && refuse ? null : `lease-${port}`,
                waitingAgents: port === 3002 && refuse ? 1 : 0,
                expiresAt: 120000,
              }
            : {};
        });
      const owned = makeOwnedBackendUpdates({
        instances: Effect.succeed([instance("one", one), instance("two", two)]),
        post,
      });
      const install = owned.install(
        "1.2.4",
        "desktop-owner",
        Effect.sync(() => {
          installs++;
          return true;
        }),
      );
      assert.isFalse(yield* install);
      assert.equal(installs, 0);
      assert.deepEqual(calls, [
        { port: 3001, body: { action: "acquire", owner: "remote-plan" } },
        { port: 3002, body: { action: "acquire", owner: "desktop-owner" } },
        { port: 3001, body: { action: "release", leaseId: "lease-3001" } },
      ]);
      calls.length = 0;
      refuse = false;
      assert.isTrue(yield* install);
      assert.equal(installs, 1);
      assert.deepEqual(calls.slice(-2), [
        { port: 3001, body: { action: "release", leaseId: "lease-3001" } },
        { port: 3002, body: { action: "release", leaseId: "lease-3002" } },
      ]);
    }),
);

it.effect(
  "requires a new quiet window after work arrives and checks cancellation before install",
  () =>
    Effect.gen(function* () {
      const ticks = yield* Queue.unbounded<number | null>();
      const installed = yield* Deferred.make<void>();
      let count = 2;
      let armed = true;
      let installs = 0;
      const worker = yield* waitForIdleInstall({
        armed: Effect.sync(() => armed),
        read: Effect.sync(() => ({ waitingAgents: count, backends: [] })),
        message: () => Queue.offer(ticks, count).pipe(Effect.asVoid),
        install: Effect.sync(() => {
          installs++;
          return true;
        }).pipe(Effect.tap(() => Deferred.succeed(installed, undefined))),
      }).pipe(Effect.forkChild);
      assert.equal(yield* Queue.take(ticks), 2);
      count = 0;
      yield* TestClock.adjust("15 seconds");
      assert.equal(yield* Queue.take(ticks), 0);
      yield* TestClock.adjust("15 seconds");
      assert.equal(yield* Queue.take(ticks), 0);
      count = 1;
      yield* TestClock.adjust("15 seconds");
      assert.equal(yield* Queue.take(ticks), 1);
      assert.equal(installs, 0);
      count = 0;
      yield* TestClock.adjust("15 seconds");
      yield* Queue.take(ticks);
      yield* TestClock.adjust("30 seconds");
      yield* Deferred.await(installed);
      assert.isTrue(yield* Fiber.join(worker));
      assert.equal(installs, 1);
      const cancelled = yield* waitForIdleInstall({
        armed: Effect.sync(() => armed),
        read: Effect.succeed({ waitingAgents: null, backends: [] }),
        message: () => Queue.offer(ticks, null).pipe(Effect.asVoid),
        install: Effect.die("cancelled work cannot install"),
      }).pipe(Effect.forkChild);
      yield* Queue.take(ticks);
      yield* Queue.take(ticks);
      yield* Queue.take(ticks);
      armed = false;
      yield* TestClock.adjust("15 seconds");
      assert.isFalse(yield* Fiber.join(cancelled));
    }),
);

it.effect("releases a partially acquired fence when preparing is interrupted", () =>
  Effect.gen(function* () {
    const blocked = yield* Deferred.make<void>();
    const stop = yield* Deferred.make<never>();
    const released = yield* Deferred.make<void>();
    const primary = config(3001, "primary");
    const wsl = config(3002, "wsl");
    const post: BackendPost = (target, route, body) =>
      Effect.gen(function* () {
        if (route.endsWith("activity")) return { waitingAgents: 0, plan: null };
        if ((body as { action: string }).action === "release") {
          assert.equal(target, primary);
          yield* Deferred.succeed(released, undefined);
          return {};
        }
        if (target === wsl) {
          yield* Deferred.succeed(blocked, undefined);
          return yield* Deferred.await(stop);
        }
        return { leaseId: "held", waitingAgents: 0, expiresAt: 120000 };
      });
    const owned = makeOwnedBackendUpdates({
      instances: Effect.succeed([instance("primary", primary), instance("wsl", wsl)]),
      post,
    });
    const preparing = yield* owned.reserve("1.2.4", "owner").pipe(Effect.forkChild);
    yield* Deferred.await(blocked);
    yield* Fiber.interrupt(preparing);
    yield* Deferred.await(released);
  }),
);
