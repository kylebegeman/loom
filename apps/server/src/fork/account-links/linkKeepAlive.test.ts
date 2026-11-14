import { expect, it } from "@effect/vitest";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { keepLinkAlive } from "./linkKeepAlive.ts";

const call = (method: string) =>
  HttpServerRequest.fromWeb(
    new Request("http://computer-b.example.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
    }),
  );
const later = <A>(after: Duration.Input, value: A) => Effect.sleep(after).pipe(Effect.as(value));

/** What a link receives for `answer`, with time running on until it is all sent. */
const received = (
  request: HttpServerRequest.HttpServerRequest,
  answer: Effect.Effect<HttpServerResponse.HttpServerResponse>,
) =>
  Effect.gen(function* () {
    // The body arrives as a promise, which the test clock does not wait on; it is cached after.
    yield* Effect.orDie(request.text);
    const sending = yield* Effect.forkChild(
      Effect.gen(function* () {
        const response = yield* keepLinkAlive(request, answer);
        const text =
          response.body._tag === "Stream"
            ? (yield* Stream.runCollect(
                response.body.stream.pipe(Stream.orDie, Stream.decodeText),
              )).join("")
            : response.body._tag === "Uint8Array"
              ? new TextDecoder().decode(response.body.body)
              : "";
        return { status: response.status, headers: response.headers, text };
      }),
    );
    yield* TestClock.adjust("2 minutes");
    return yield* Fiber.join(sending);
  }).pipe(Effect.scoped);

it.effect("keeps only a slow tool call sending, and never inside its answer", () =>
  Effect.gen(function* () {
    // An event stream whose event arrives in two parts, far apart.
    const streamed = HttpServerResponse.stream(
      Stream.make('data: {"id":').pipe(
        Stream.concat(Stream.fromEffect(later("25 seconds", "1}\n\n"))),
        Stream.encodeText,
      ),
      { contentType: "text/event-stream" },
    );
    const tool = yield* received(call("tools/call"), later("15 seconds", streamed));
    expect(tool.text).toBe(': keepalive\n\ndata: {"id":1}\n\n');

    // Anything else answers as it is, with its status and headers.
    const opened = HttpServerResponse.jsonUnsafe(
      { jsonrpc: "2.0", id: 1, result: {} },
      { status: 200, headers: { "mcp-session-id": "session-1" } },
    );
    const initialize = yield* received(call("initialize"), later("15 seconds", opened));
    expect(initialize).toMatchObject({
      status: 200,
      headers: { "mcp-session-id": "session-1" },
      text: '{"jsonrpc":"2.0","id":1,"result":{}}',
    });
    const gone = HttpServerResponse.empty({ status: 404 });
    expect((yield* received(call("tools/list"), later("15 seconds", gone))).status).toBe(404);
  }),
);
