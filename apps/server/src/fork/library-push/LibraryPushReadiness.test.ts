import { describe, expect, it } from "@effect/vitest";
import {
  LIBRARY_PUSH_READINESS_ROUTE,
  LibraryError,
  type LibraryPushStatus,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { type HttpClientRequest, HttpClientResponse } from "effect/http";

import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import { LibraryPushReadinessService, layer } from "./LibraryPushReadiness.ts";
import { LibraryPushService } from "./LibraryPushService.ts";

type Send = Extract<LibraryConnection.LibraryConnection, { readonly kind: "remote" }>["send"];

const remote = (send: Send): LibraryConnection.LibraryConnection => ({
  kind: "remote",
  credential: null,
  origin: "https://library.example.test",
  endpoint: (path) => new URL(path, "https://library.example.test").toString(),
  send,
});

const answering = (response: () => Response) =>
  remote((outgoing) => Effect.succeed(HttpClientResponse.fromWeb(outgoing, response())));

/** A computer's own push service, which is off because it is not the Library. */
const NOT_LIBRARY: LibraryPushStatus = {
  state: "off",
  reason: "not-library",
  key: null,
  devices: [],
};

const readinessOn = (connection: LibraryConnection.LibraryConnection) =>
  Effect.flatMap(LibraryPushReadinessService, (readiness) => readiness.current).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.mock(LibraryPushService)({
              alerts: false,
              status: () => Effect.succeed(NOT_LIBRARY),
            }),
            Layer.mock(LibraryConnection.LibraryConnectionService)({
              current: Effect.succeed(connection),
            }),
          ),
        ),
      ),
    ),
  );

describe("LibraryPushReadiness on a computer", () => {
  it.effect("asks its Library for the device count over its publisher session", () =>
    Effect.gen(function* () {
      const requests: Array<HttpClientRequest.HttpClientRequest> = [];
      const status = yield* readinessOn(
        remote((outgoing) =>
          Effect.sync(() => {
            requests.push(outgoing);
            return HttpClientResponse.fromWeb(
              outgoing,
              Response.json({ state: "ready", reason: null, alerts: true, devices: 0 }),
            );
          }),
        ),
      );
      expect(status).toEqual({
        state: "ready",
        reason: null,
        key: null,
        deviceCount: 0,
        alerts: true,
      });
      expect(requests.map((request) => [request.method, request.url])).toEqual([
        ["GET", `https://library.example.test${LIBRARY_PUSH_READINESS_ROUTE}`],
      ]);
    }),
  );

  it.effect("answers off without asking anyone when it has no Library", () =>
    Effect.gen(function* () {
      expect(yield* readinessOn({ kind: "none" })).toEqual({
        state: "off",
        reason: "not-library",
        key: null,
        deviceCount: 0,
        alerts: false,
      });
    }),
  );

  it.effect.each<readonly [string, LibraryConnection.LibraryConnection, string, RegExp]>([
    ["an older Library", answering(() => new Response(null, { status: 404 })), "blocked", /Update/],
    [
      "the Library's web app",
      answering(() => new Response("<html></html>", { headers: { "content-type": "text/html" } })),
      "blocked",
      /Update/,
    ],
    [
      "a refused sign-in",
      answering(() => new Response(null, { status: 403 })),
      "blocked",
      /sign-in/,
    ],
    ["an unreadable sign-in", { kind: "unavailable" }, "blocked", /sign-in/],
    [
      "a missing sign-in",
      remote(() =>
        Effect.fail(
          new LibraryError({
            reason: "blocked",
            detail: LibraryConnection.LIBRARY_SIGN_IN_MISSING,
          }),
        ),
      ),
      "blocked",
      /sign-in/,
    ],
    ["a Library that is down", answering(() => new Response(null, { status: 503 })), "io", /reach/],
    ["another JSON shape", answering(() => Response.json({ ok: true })), "io", /reach/],
    [
      "a failed request",
      remote(() => Effect.fail(new LibraryError({ reason: "io" }))),
      "io",
      /reach/,
    ],
  ])("explains %s", ([, connection, reason, message]) =>
    Effect.gen(function* () {
      const error = yield* readinessOn(connection).pipe(Effect.flip);
      expect(error.reason).toBe(reason);
      expect(error.message).toMatch(message);
    }),
  );
});
