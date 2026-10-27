import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_LIBRARY_ROUTE,
  BOTS_ANYWHERE_FEATURE,
  BotLibraryAckRequest,
  BotLibraryCancelRequest,
  BotLibraryCancelResult,
  BotLibraryDeliveries,
  BotLibraryError,
  BotLibraryListRequest,
  BotLibraryListResult,
  BotLibraryPublishRequest,
  BotLibraryRecord,
  BotLibraryRefusal,
  BotLibraryResultAck,
  BotLibraryResultPost,
  BotLibraryResults,
  BotLibraryStatusReport,
  BotLibrarySubmitRequest,
  BotLibraryTargets,
  BotLibraryUnpublishRequest,
  BotLibraryWaitRequest,
  type BotLibraryAvailability,
  type BotLibraryDelivery,
  type BotLibraryTargetStatus,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClientRequest, type HttpClientResponse } from "effect/http";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import { resolveLibraryConnection } from "../project-library/LibraryConnection.ts";
import { BotLibraryService } from "./BotLibraryService.ts";

const AVAILABILITY_TTL_MS = 5 * 60_000;

const decodeRefusal = Schema.decodeUnknownEffect(BotLibraryRefusal);
const decodeInfo = Schema.decodeUnknownEffect(
  Schema.Struct({ features: Schema.optional(Schema.Array(Schema.String)) }),
);
const decodeRecord = Schema.decodeUnknownEffect(BotLibraryRecord);
const decodeList = Schema.decodeUnknownEffect(BotLibraryListResult);
const decodeTargets = Schema.decodeUnknownEffect(BotLibraryTargets);
const decodeDeliveries = Schema.decodeUnknownEffect(BotLibraryDeliveries);
const decodeResults = Schema.decodeUnknownEffect(BotLibraryResults);
const bodyOf = <S extends Schema.Top>(schema: S) =>
  Schema.encodeEffect(Schema.fromJsonString(schema));
const encodePublish = bodyOf(BotLibraryPublishRequest);
const encodeUnpublish = bodyOf(
  Schema.Struct({ ...BotLibraryUnpublishRequest.fields, label: Schema.String }),
);
const encodeList = bodyOf(BotLibraryListRequest);
const encodeStatus = bodyOf(BotLibraryStatusReport);
const encodeSubmit = bodyOf(BotLibrarySubmitRequest);
const encodeWait = bodyOf(BotLibraryWaitRequest);
const encodeAck = bodyOf(BotLibraryAckRequest);
const encodeCancel = bodyOf(BotLibraryCancelRequest);
const decodeCancelResult = Schema.decodeUnknownEffect(BotLibraryCancelResult);
const encodeResult = bodyOf(BotLibraryResultPost);
const encodeResultAck = bodyOf(BotLibraryResultAck);

const noLibrary = () =>
  new BotLibraryError({
    reason: "unavailable",
    message: "This computer is not connected to a Library that shares bots.",
  });
const unreachable = () =>
  new BotLibraryError({ reason: "io", message: "The Library could not be reached." });

/** How this computer reaches the Library's shared bots, in-process when it is the Library. */
export class BotLibraryClient extends Context.Service<
  BotLibraryClient,
  {
    readonly environmentId: EnvironmentId;
    readonly label: Effect.Effect<string>;
    /** Cached for a few minutes; `refresh` asks again. */
    readonly availability: (options?: {
      readonly refresh?: boolean;
    }) => Effect.Effect<BotLibraryAvailability>;
    readonly publish: (
      request: BotLibraryPublishRequest,
    ) => Effect.Effect<BotLibraryRecord, BotLibraryError>;
    readonly unpublish: (libraryBotId: string) => Effect.Effect<void, BotLibraryError>;
    readonly list: (after: number) => Effect.Effect<BotLibraryListResult, BotLibraryError>;
    readonly reportStatus: (report: BotLibraryStatusReport) => Effect.Effect<void, BotLibraryError>;
    readonly targets: Effect.Effect<ReadonlyArray<BotLibraryTargetStatus>, BotLibraryError>;
    readonly submit: (request: BotLibrarySubmitRequest) => Effect.Effect<void, BotLibraryError>;
    readonly nextRequests: (
      waitMs: number,
    ) => Effect.Effect<ReadonlyArray<BotLibraryDelivery>, BotLibraryError>;
    readonly ack: (ack: BotLibraryAckRequest) => Effect.Effect<void, BotLibraryError>;
    /** Whether the Library withdrew the run before any computer took it. */
    readonly cancel: (requestId: string) => Effect.Effect<boolean, BotLibraryError>;
    readonly postResult: (post: BotLibraryResultPost) => Effect.Effect<void, BotLibraryError>;
    readonly nextResults: (
      waitMs: number,
    ) => Effect.Effect<ReadonlyArray<BotLibraryResultPost>, BotLibraryError>;
    readonly ackResult: (ack: BotLibraryResultAck) => Effect.Effect<void, BotLibraryError>;
  }
>()("t3/fork/bots/BotLibraryClient") {}

/** The Library computer's own client, which calls the store without a network hop. */
export const inProcessClient = (
  library: BotLibraryService["Service"],
  environmentId: EnvironmentId,
  label: Effect.Effect<string>,
) =>
  BotLibraryClient.of({
    environmentId,
    label,
    availability: Effect.fn("BotLibraryClient.availability")(function () {
      return Effect.succeed<BotLibraryAvailability>(library.enabled ? "available" : "none");
    }),
    publish: Effect.fn("BotLibraryClient.publish")(function (request) {
      return library.publish(environmentId, request);
    }),
    unpublish: Effect.fn("BotLibraryClient.unpublish")(function (id) {
      return label.pipe(Effect.flatMap((name) => library.unpublish(environmentId, id, name)));
    }),
    list: library.list,
    reportStatus: Effect.fn("BotLibraryClient.reportStatus")(function (report) {
      return library.reportStatus(environmentId, report);
    }),
    targets: library.targets,
    submit: Effect.fn("BotLibraryClient.submit")(function (request) {
      return library.submit(environmentId, request);
    }),
    nextRequests: Effect.fn("BotLibraryClient.nextRequests")(function (waitMs) {
      return library.nextRequests(environmentId, waitMs);
    }),
    ack: Effect.fn("BotLibraryClient.ack")(function (input) {
      return library.ack(environmentId, input);
    }),
    cancel: Effect.fn("BotLibraryClient.cancel")(function (requestId) {
      return library.cancel(environmentId, requestId);
    }),
    postResult: Effect.fn("BotLibraryClient.postResult")(function (post) {
      return library.postResult(environmentId, post);
    }),
    nextResults: Effect.fn("BotLibraryClient.nextResults")(function (waitMs) {
      return library.nextResults(environmentId, waitMs);
    }),
    ackResult: Effect.fn("BotLibraryClient.ackResult")(function (input) {
      return library.ackResult(environmentId, input);
    }),
  });

const make = Effect.gen(function* () {
  const libraryConnection = yield* LibraryConnection.LibraryConnectionService;
  const connection = yield* resolveLibraryConnection.pipe(
    Effect.orElseSucceed(() => ({ kind: "unavailable" }) as const),
  );
  const environment = yield* ServerEnvironment;
  const environmentId = (yield* environment.getDescriptor).environmentId;
  const label = environment.getDescriptor.pipe(
    Effect.map((descriptor) => descriptor.label.slice(0, 160).trim() || "This computer"),
  );

  if (connection.kind === "authority")
    return inProcessClient(yield* BotLibraryService, environmentId, label);

  if (connection.kind === "none") {
    const none = Effect.fail(noLibrary());
    return BotLibraryClient.of({
      environmentId,
      label,
      availability: Effect.fn("BotLibraryClient.availability")(function () {
        return Effect.succeed("none" as const);
      }),
      publish: Effect.fn("BotLibraryClient.publish")(function () {
        return none;
      }),
      unpublish: Effect.fn("BotLibraryClient.unpublish")(function () {
        return none;
      }),
      list: Effect.fn("BotLibraryClient.list")(function () {
        return none;
      }),
      reportStatus: Effect.fn("BotLibraryClient.reportStatus")(function () {
        return none;
      }),
      targets: none,
      submit: Effect.fn("BotLibraryClient.submit")(function () {
        return none;
      }),
      nextRequests: Effect.fn("BotLibraryClient.nextRequests")(function () {
        return none;
      }),
      ack: Effect.fn("BotLibraryClient.ack")(function () {
        return none;
      }),
      cancel: Effect.fn("BotLibraryClient.cancel")(function () {
        return none;
      }),
      postResult: Effect.fn("BotLibraryClient.postResult")(function () {
        return none;
      }),
      nextResults: Effect.fn("BotLibraryClient.nextResults")(function () {
        return none;
      }),
      ackResult: Effect.fn("BotLibraryClient.ackResult")(function () {
        return none;
      }),
    });
  }

  const endpoint = (route: string) => route;
  const send = libraryConnection.send;
  /** A Library without shared bots answers 404; it explains every other refusal in a 409. */
  const execute = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
    const response = yield* send(request).pipe(
      Effect.mapError((error) =>
        error.reason === "blocked"
          ? new BotLibraryError({
              reason: "unavailable",
              message: "This computer's Library sign-in is missing or expired.",
            })
          : unreachable(),
      ),
    );
    if (response.status === 404) return yield* noLibrary();
    if (response.status === 409) {
      const refused = yield* response.json.pipe(Effect.flatMap(decodeRefusal), Effect.option);
      if (Option.isSome(refused)) return yield* new BotLibraryError(refused.value);
    }
    if (response.status < 200 || response.status >= 300) return yield* unreachable();
    // A Library older than shared bots answers a route it does not know with its web app.
    if (/^text\/html\b/i.test(response.headers["content-type"] ?? "")) return yield* noLibrary();
    return response;
  });
  const post = (path: string, body: string) =>
    execute(
      HttpClientRequest.post(endpoint(`${BOT_LIBRARY_ROUTE}${path}`)).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
    );
  const readJson = <A, E>(
    response: HttpClientResponse.HttpClientResponse,
    decode: (input: unknown) => Effect.Effect<A, E>,
  ) => response.json.pipe(Effect.flatMap(decode), Effect.mapError(unreachable));
  const encoded = <A>(effect: Effect.Effect<A, Schema.SchemaError>) =>
    effect.pipe(
      Effect.mapError(
        () => new BotLibraryError({ reason: "invalid", message: "The request is malformed." }),
      ),
    );

  const cached = yield* Ref.make<{ value: BotLibraryAvailability; at: number } | null>(null);
  const probe = Effect.gen(function* () {
    const response = yield* send(HttpClientRequest.get(endpoint("/api/loom/library/info")));
    if (response.status < 200 || response.status >= 300) return "none" as const;
    const info = yield* response.json.pipe(Effect.flatMap(decodeInfo));
    return info.features?.includes(BOTS_ANYWHERE_FEATURE) === true
      ? ("available" as const)
      : ("unsupported" as const);
  }).pipe(Effect.orElseSucceed(() => "none" as const));
  const availability = Effect.fnUntraced(function* (options?: { readonly refresh?: boolean }) {
    const now = yield* Clock.currentTimeMillis;
    const last = yield* Ref.get(cached);
    if (options?.refresh !== true && last !== null && now - last.at < AVAILABILITY_TTL_MS)
      return last.value;
    const value = yield* probe;
    yield* Ref.set(cached, { value, at: now });
    return value;
  });

  return BotLibraryClient.of({
    environmentId,
    label,
    availability,
    publish: Effect.fn("BotLibraryClient.publish")(function (request) {
      return encoded(encodePublish(request)).pipe(
        Effect.flatMap((body) => post("/publish", body)),
        Effect.flatMap((response) => readJson(response, decodeRecord)),
      );
    }),
    unpublish: Effect.fn("BotLibraryClient.unpublish")(function (libraryBotId) {
      return label.pipe(
        Effect.flatMap((name) => encoded(encodeUnpublish({ libraryBotId, label: name }))),
        Effect.flatMap((body) => post("/unpublish", body)),
        Effect.asVoid,
      );
    }),
    list: Effect.fn("BotLibraryClient.list")(function (after) {
      return encoded(encodeList({ after })).pipe(
        Effect.flatMap((body) => post("/list", body)),
        Effect.flatMap((response) => readJson(response, decodeList)),
      );
    }),
    reportStatus: Effect.fn("BotLibraryClient.reportStatus")(function (report) {
      return encoded(encodeStatus(report)).pipe(
        Effect.flatMap((body) => post("/status", body)),
        Effect.asVoid,
      );
    }),
    targets: execute(HttpClientRequest.get(endpoint(`${BOT_LIBRARY_ROUTE}/targets`))).pipe(
      Effect.flatMap((response) => readJson(response, decodeTargets)),
      Effect.map((result) => result.targets),
    ),
    submit: Effect.fn("BotLibraryClient.submit")(function (request) {
      return encoded(encodeSubmit(request)).pipe(
        Effect.flatMap((body) => post("/requests/submit", body)),
        Effect.asVoid,
      );
    }),
    nextRequests: Effect.fn("BotLibraryClient.nextRequests")(function (waitMs) {
      return encoded(encodeWait({ waitMs })).pipe(
        Effect.flatMap((body) => post("/requests/next", body)),
        Effect.flatMap((response) => readJson(response, decodeDeliveries)),
        Effect.map((result) => result.deliveries),
      );
    }),
    ack: Effect.fn("BotLibraryClient.ack")(function (input) {
      return encoded(encodeAck(input)).pipe(
        Effect.flatMap((body) => post("/requests/ack", body)),
        Effect.asVoid,
      );
    }),
    cancel: Effect.fn("BotLibraryClient.cancel")(function (requestId) {
      return encoded(encodeCancel({ requestId })).pipe(
        Effect.flatMap((body) => post("/requests/cancel", body)),
        // A Library from before the answer existed sends none; the target may have the run then.
        Effect.flatMap((response) =>
          response.status === 204
            ? Effect.succeed(false)
            : readJson(response, decodeCancelResult).pipe(Effect.map((result) => result.withdrawn)),
        ),
      );
    }),
    postResult: Effect.fn("BotLibraryClient.postResult")(function (input) {
      return encoded(encodeResult(input)).pipe(
        Effect.flatMap((body) => post("/results/post", body)),
        Effect.asVoid,
      );
    }),
    nextResults: Effect.fn("BotLibraryClient.nextResults")(function (waitMs) {
      return encoded(encodeWait({ waitMs })).pipe(
        Effect.flatMap((body) => post("/results/next", body)),
        Effect.flatMap((response) => readJson(response, decodeResults)),
        Effect.map((result) => result.results),
      );
    }),
    ackResult: Effect.fn("BotLibraryClient.ackResult")(function (input) {
      return encoded(encodeResultAck(input)).pipe(
        Effect.flatMap((body) => post("/results/ack", body)),
        Effect.asVoid,
      );
    }),
  });
});

export const layer = Layer.effect(BotLibraryClient, make).pipe(
  Layer.provide(LibraryConnection.layer),
);
