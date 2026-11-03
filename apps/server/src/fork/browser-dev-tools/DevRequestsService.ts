// @effect-diagnostics nodeBuiltinImport:off -- Request receipts store a digest rather than credential-bearing inputs.
import * as NodeCrypto from "node:crypto";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import {
  DevHttpError,
  DevHttpBaseline,
  type DevHttpBaselineAction,
  type DevHttpBaselines,
  DevHttpExchange,
  type DevHttpSend,
  type DevHttpHistory,
  type DevHttpHistoryTarget,
  type DevTarget,
  type DevEnvironmentError,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, FetchHttpClient } from "effect/http";
import { ServerConfig } from "../../config.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { checkoutKey } from "./servers.ts";
import {
  HTTP_BODY_LIMIT,
  redactExchangeSecrets,
  HTTP_HISTORY_LIMIT,
  redactHeaders,
  redactRequest,
  textContent,
  validRequest,
} from "./requests.ts";
const Receipt = Schema.Struct({
  id: Schema.String,
  fingerprint: Schema.String,
  state: Schema.Literals(["pending", "complete", "cleared"]),
  exchange: Schema.NullOr(DevHttpExchange),
});
const Store = Schema.Struct({
  version: Schema.Literal(1),
  receipts: Schema.Array(Receipt),
  baselines: Schema.optionalKey(Schema.Array(DevHttpBaseline)),
});
const decode = Schema.decodeEffect(Schema.fromJsonString(Store));
const encode = Schema.encodeEffect(Schema.fromJsonString(Store));
type Store = typeof Store.Type;
type Failure = DevHttpError | DevEnvironmentError;
export class DevRequestsService extends Context.Service<
  DevRequestsService,
  {
    readonly send: (input: DevHttpSend) => Effect.Effect<DevHttpExchange, Failure>;
    readonly sendForWorkflow: (
      input: DevHttpSend,
      sensitiveValues?: readonly string[],
    ) => Effect.Effect<DevHttpExchange, Failure>;
    readonly history: (input: DevHttpHistoryTarget) => Effect.Effect<DevHttpHistory, Failure>;
    readonly baseline: (input: DevHttpBaselineAction) => Effect.Effect<DevHttpBaselines, Failure>;
    readonly clear: (input: DevTarget) => Effect.Effect<DevHttpHistory, Failure>;
  }
>()("t3/fork/browser-dev-tools/DevRequestsService") {}
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const dev = yield* DevEnvironmentService;
  const client = yield* HttpClient.HttpClient;
  const gate = yield* Semaphore.make(1);
  const fileFor = (root: string) =>
    path.join(
      config.stateDir,
      "fork",
      "browser-dev-tools",
      "requests",
      `${checkoutKey(root)}.json`,
    );
  const load = Effect.fn("DevRequests.load")(
    function* (root: string) {
      const text = yield* fs.readFileString(fileFor(root)).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed('{"version":1,"receipts":[]}'),
        ),
      );
      return yield* decode(text);
    },
    Effect.mapError((cause) => new DevHttpError({ reason: "history-unavailable", cause })),
  );
  const save = Effect.fn("DevRequests.save")(function* (root: string, state: Store) {
    const file = fileFor(root);
    yield* Effect.gen(function* () {
      const contents = yield* encode(state);
      yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
      yield* writeFileStringAtomically({ filePath: file, contents });
      yield* fs.chmod(file, 0o600);
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new DevHttpError({ reason: "history-unavailable", cause })),
    );
  });
  const history = Effect.fn("DevRequests.history")(function* (input: DevHttpHistoryTarget) {
    const { root } = yield* dev.snapshot(input);
    const state = yield* load(root);
    const exchanges = state.receipts
      .flatMap((entry) => (entry.exchange ? [entry.exchange] : []))
      .toReversed();
    return {
      exchanges: exchanges.map(({ id, request, startedAt, durationMs, status, error }) => ({
        id,
        request: { method: request.method, url: request.url },
        startedAt,
        durationMs,
        status,
        error,
      })),
      selected: exchanges.find((entry) => entry.id === input.exchangeId) ?? null,
    };
  });
  const baseline = Effect.fn("DevRequests.baseline")(function* (input: DevHttpBaselineAction) {
    const { root } = yield* dev.snapshot(input);
    const state = yield* load(root);
    const baselines = state.baselines ?? [];
    const revisionOf = (rows: typeof baselines) =>
      NodeCrypto.createHash("sha256").update(stableStringify(rows)).digest("hex");
    const revision = revisionOf(baselines);
    if (input.action === "read") return { revision, baselines };
    const existing = baselines.find((b) => b.id === input.id);
    if (
      input.action === "pin" &&
      existing &&
      existing.exchange.id === input.exchangeId &&
      existing.name === input.name &&
      stableStringify(existing.ignoredPaths) === stableStringify(input.ignoredPaths ?? [])
    )
      return { revision, baselines };
    if (!input.id || input.expectedRevision !== revision)
      return yield* new DevHttpError({ reason: "revision-conflict" });
    let next = baselines.filter((b) => b.id !== input.id);
    if (input.action === "pin") {
      const exchange = state.receipts.find((r) => r.exchange?.id === input.exchangeId)?.exchange;
      if (!exchange || exchange.error || exchange.truncated || exchange.binary || !input.name)
        return yield* new DevHttpError({ reason: "invalid-request" });
      next = [
        ...next,
        { id: input.id, name: input.name, exchange, ignoredPaths: input.ignoredPaths ?? [] },
      ];
      if (next.length > 30) return yield* new DevHttpError({ reason: "invalid-request" });
    }
    yield* save(root, { ...state, baselines: next });
    return { revision: revisionOf(next), baselines: next };
  }, gate.withPermit);
  const clear = Effect.fn("DevRequests.clear")(function* (input: DevTarget) {
    const { root } = yield* dev.snapshot(input);
    const state = yield* load(root);
    yield* save(root, {
      ...state,
      receipts: state.receipts.map((entry) => ({ ...entry, state: "cleared", exchange: null })),
    });
    return { exchanges: [], selected: null };
  }, gate.withPermit);
  const reserve = Effect.fn("DevRequests.reserve")(function* (root: string, input: DevHttpSend) {
    const state = yield* load(root);
    const fingerprint = NodeCrypto.createHash("sha256")
      .update(stableStringify(input.request))
      .digest("hex");
    const prior = state.receipts.find((entry) => entry.id === input.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        return yield* new DevHttpError({ reason: "request-conflict" });
      if (prior.exchange) return prior.exchange;
      return yield* new DevHttpError({
        reason: prior.state === "pending" ? "request-incomplete" : "history-pruned",
      });
    }
    const retained = state.receipts.filter(
      (entry, index) => entry.state === "pending" || index >= state.receipts.length - 1999,
    );
    yield* save(root, {
      ...state,
      receipts: [
        ...retained,
        { id: input.requestId, fingerprint, state: "pending", exchange: null },
      ],
    });
    return null;
  }, gate.withPermit);
  const execute = Effect.fn("DevRequests.execute")(
    function* (input: DevHttpSend) {
      const request = input.request;
      let outgoing = HttpClientRequest.make(request.method)(request.url).pipe(
        HttpClientRequest.setHeaders(request.headers),
      );
      if (request.body)
        outgoing = outgoing.pipe(
          request.bodyEncoding === "base64"
            ? HttpClientRequest.bodyUint8Array(
                Buffer.from(request.body, "base64"),
                outgoing.headers["content-type"] ?? "application/octet-stream",
              )
            : HttpClientRequest.bodyText(
                request.body,
                outgoing.headers["content-type"] ?? "text/plain",
              ),
        );
      const response = yield* client.execute(outgoing);
      let seen = 0;
      let truncated = false;
      const chunks = yield* response.stream.pipe(
        Stream.map((chunk) => {
          const remaining = Math.max(0, HTTP_BODY_LIMIT - seen);
          seen += chunk.length;
          truncated ||= seen > HTTP_BODY_LIMIT;
          return chunk.subarray(0, remaining);
        }),
        Stream.takeUntil(() => truncated),
        Stream.runCollect,
      );
      const bytes = Buffer.concat(chunks);
      const binary = !textContent(response.headers["content-type"] ?? "") && bytes.length > 0;
      return {
        status: response.status,
        headers: { ...response.headers },
        body: binary ? "" : new TextDecoder().decode(bytes),
        byteLength: bytes.length,
        truncated,
        binary,
        error: null,
      };
    },
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual", credentials: "omit" }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  );
  const dispatch = Effect.fn("DevRequests.dispatch")(function* (
    input: DevHttpSend,
    workflow: boolean,
    sensitiveValues: readonly string[] = [],
  ) {
    const { root } = yield* dev.snapshot(input);
    if (!validRequest(input.request)) return yield* new DevHttpError({ reason: "invalid-request" });
    const prior = yield* reserve(root, input);
    if (prior) {
      if (workflow) return yield* new DevHttpError({ reason: "request-incomplete" });
      return prior;
    }
    const started = yield* Clock.currentTimeMillis;
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const failed = (error: "timeout" | "network") => ({
      status: null,
      headers: {},
      body: "",
      byteLength: 0,
      truncated: false,
      binary: false,
      error,
    });
    const result = yield* execute(input).pipe(
      Effect.orElseSucceed(() => failed("network")),
      Effect.timeoutOption(`${input.request.timeoutMs} millis`),
      Effect.map(Option.getOrElse(() => failed("timeout"))),
    );
    const exchange: DevHttpExchange = redactExchangeSecrets(
      {
        ...result,
        headers: redactHeaders(result.headers),
        id: input.requestId,
        request: redactRequest(input.request),
        startedAt,
        durationMs: (yield* Clock.currentTimeMillis) - started,
      },
      sensitiveValues,
    );
    yield* Effect.gen(function* () {
      const state = yield* load(root);
      let retained = 0;
      const receipts = state.receipts
        .map((entry) =>
          entry.id === input.requestId && entry.state === "pending"
            ? { ...entry, state: "complete" as const, exchange }
            : entry,
        )
        .toReversed()
        .map((entry) => {
          if (!entry.exchange || ++retained <= HTTP_HISTORY_LIMIT) return entry;
          return { ...entry, exchange: null };
        })
        .toReversed();
      yield* save(root, { ...state, receipts });
    }).pipe(
      gate.withPermit,
      Effect.mapError((cause) => new DevHttpError({ reason: "request-incomplete", cause })),
    );
    return workflow ? { ...exchange, headers: result.headers, body: result.body } : exchange;
  });
  const send = Effect.fn("DevRequests.send")((input: DevHttpSend) => dispatch(input, false));
  const sendForWorkflow = Effect.fn("DevRequests.sendForWorkflow")(
    (input: DevHttpSend, sensitiveValues: readonly string[] = []) =>
      dispatch(input, true, sensitiveValues),
  );
  return DevRequestsService.of({ send, sendForWorkflow, history, baseline, clear });
});
export const layer = Layer.effect(DevRequestsService, make);
