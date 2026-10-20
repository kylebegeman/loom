import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_LIBRARY_ROUTE,
  BOTS_ANYWHERE_FEATURE,
  BotLibraryAckRequest,
  BotLibraryCancelRequest,
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
    readonly cancel: (requestId: string) => Effect.Effect<void, BotLibraryError>;
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
    availability: () => Effect.succeed(library.enabled ? "available" : "none"),
    publish: (request) => library.publish(environmentId, request),
    unpublish: (id) =>
      label.pipe(Effect.flatMap((name) => library.unpublish(environmentId, id, name))),
    list: library.list,
    reportStatus: (report) => library.reportStatus(environmentId, report),
    targets: library.targets,
    submit: (request) => library.submit(environmentId, request),
    nextRequests: (waitMs) => library.nextRequests(environmentId, waitMs),
    ack: (input) => library.ack(environmentId, input),
    cancel: (requestId) => library.cancel(environmentId, requestId),
    postResult: (post) => library.postResult(environmentId, post),
    nextResults: (waitMs) => library.nextResults(environmentId, waitMs),
    ackResult: (input) => library.ackResult(environmentId, input),
  });

const make = Effect.gen(function* () {
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

  if (connection.kind !== "remote") {
    const none = Effect.fail(noLibrary());
    return BotLibraryClient.of({
      environmentId,
      label,
      availability: () => Effect.succeed("none"),
      publish: () => none,
      unpublish: () => none,
      list: () => none,
      reportStatus: () => none,
      targets: none,
      submit: () => none,
      nextRequests: () => none,
      ack: () => none,
      cancel: () => none,
      postResult: () => none,
      nextResults: () => none,
      ackResult: () => none,
    });
  }

  const { endpoint, send } = connection;
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
    publish: (request) =>
      encoded(encodePublish(request)).pipe(
        Effect.flatMap((body) => post("/publish", body)),
        Effect.flatMap((response) => readJson(response, decodeRecord)),
      ),
    unpublish: (libraryBotId) =>
      label.pipe(
        Effect.flatMap((name) => encoded(encodeUnpublish({ libraryBotId, label: name }))),
        Effect.flatMap((body) => post("/unpublish", body)),
        Effect.asVoid,
      ),
    list: (after) =>
      encoded(encodeList({ after })).pipe(
        Effect.flatMap((body) => post("/list", body)),
        Effect.flatMap((response) => readJson(response, decodeList)),
      ),
    reportStatus: (report) =>
      encoded(encodeStatus(report)).pipe(
        Effect.flatMap((body) => post("/status", body)),
        Effect.asVoid,
      ),
    targets: execute(HttpClientRequest.get(endpoint(`${BOT_LIBRARY_ROUTE}/targets`))).pipe(
      Effect.flatMap((response) => readJson(response, decodeTargets)),
      Effect.map((result) => result.targets),
    ),
    submit: (request) =>
      encoded(encodeSubmit(request)).pipe(
        Effect.flatMap((body) => post("/requests/submit", body)),
        Effect.asVoid,
      ),
    nextRequests: (waitMs) =>
      encoded(encodeWait({ waitMs })).pipe(
        Effect.flatMap((body) => post("/requests/next", body)),
        Effect.flatMap((response) => readJson(response, decodeDeliveries)),
        Effect.map((result) => result.deliveries),
      ),
    ack: (input) =>
      encoded(encodeAck(input)).pipe(
        Effect.flatMap((body) => post("/requests/ack", body)),
        Effect.asVoid,
      ),
    cancel: (requestId) =>
      encoded(encodeCancel({ requestId })).pipe(
        Effect.flatMap((body) => post("/requests/cancel", body)),
        Effect.asVoid,
      ),
    postResult: (input) =>
      encoded(encodeResult(input)).pipe(
        Effect.flatMap((body) => post("/results/post", body)),
        Effect.asVoid,
      ),
    nextResults: (waitMs) =>
      encoded(encodeWait({ waitMs })).pipe(
        Effect.flatMap((body) => post("/results/next", body)),
        Effect.flatMap((response) => readJson(response, decodeResults)),
        Effect.map((result) => result.results),
      ),
    ackResult: (input) =>
      encoded(encodeResultAck(input)).pipe(
        Effect.flatMap((body) => post("/results/ack", body)),
        Effect.asVoid,
      ),
  });
});

export const layer = Layer.effect(BotLibraryClient, make);
