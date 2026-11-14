import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpServerResponse } from "effect/http";

/**
 * Cloudflare drops a request that sends nothing for 100 s, and a tailnet path has dropped a
 * linked environment's wait after 30 to 50 s, so a link's call never stays silent this long.
 */
export const LINK_KEEP_ALIVE_INTERVAL = Duration.seconds(10);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const comment = encoder.encode(": keepalive\n\n");

/** The answer as server-sent events: an event stream as it is, JSON as one event. */
const asEvents = ({ body }: HttpServerResponse.HttpServerResponse): Stream.Stream<Uint8Array> => {
  // MCP streams only event streams; its JSON answers are whole bodies.
  if (body._tag === "Stream") return body.stream.pipe(Stream.orDie);
  if (body._tag !== "Uint8Array") return Stream.empty;
  if (body.contentType.includes("text/event-stream")) return Stream.succeed(body.body);
  const lines = decoder.decode(body.body).trimEnd().split("\n");
  return Stream.succeed(encoder.encode(`${lines.map((line) => `data: ${line}\n`).join("")}\n`));
};

/**
 * A linked environment's call still running after one interval answers as an event stream, with
 * a comment each interval until its result goes out as the stream's event. Links read only the
 * `data:` lines of an event stream, so callers of any version decode the same answer.
 */
// Untraced: it runs for every linked request, inside that request's own span.
export const keepLinkAlive = Effect.fnUntraced(function* <E, R>(
  answer: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) {
  // In the request's scope, which stays open until a streamed body ends.
  const fiber = yield* Effect.forkScoped(answer);
  const early = yield* Fiber.join(fiber).pipe(Effect.timeoutOption(LINK_KEEP_ALIVE_INTERVAL));
  if (Option.isSome(early)) return early.value;
  const result = Stream.fromEffect(Fiber.join(fiber).pipe(Effect.orDie)).pipe(
    Stream.flatMap(asEvents),
  );
  return HttpServerResponse.stream(
    Stream.merge(Stream.tick(LINK_KEEP_ALIVE_INTERVAL).pipe(Stream.map(() => comment)), result, {
      haltStrategy: "right",
    }),
    { contentType: "text/event-stream", headers: { "cache-control": "no-store" } },
  );
});
