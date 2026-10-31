// @effect-diagnostics-next-line nodeBuiltinImport:off -- Credential equality uses a deterministic SHA-256 fingerprint without retaining plaintext in SQLite.
import * as NodeCrypto from "node:crypto";
import {
  BotsError,
  type BotCompletionAcknowledgeInput,
  type BotCompletionConfigureInput,
  type BotCompletionConfigureRefsInput,
  type BotCompletionDeliveriesInput,
  type BotCompletionDelivery,
  type BotCompletionDestination,
  type BotCompletionListInput,
  type BotCompletionRemoveInput,
  type BotCompletionSetEnabledInput,
} from "@t3tools/contracts/fork";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import { forkParked } from "../../serverActivation.ts";
import { makeBotCompletionStore } from "./BotCompletionStore.ts";
import * as BotOperations from "./BotOperations.ts";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const MAX_DRAIN_DELIVERIES = 20;
const ROUTINE_HOSTS = new Set(["api2.cursor.sh"]);
const Credentials = Schema.fromJsonString(
  Schema.Struct({ url: Schema.String, key: Schema.String }),
);
const encodeCredentials = Schema.encodeSync(Credentials);
const decodeCredentials = Schema.decodeUnknownOption(Credentials);
const secretName = (id: string) => `bot-completion-${id}`;
const invalid = (message: string) => new BotsError({ reason: "invalid", message });
const secretFailure = () =>
  new BotsError({
    reason: "storage",
    message: "Loom could not store or read the private completion destination.",
  });

const validateCredentials = Effect.fn("BotCompletions.validateCredentials")(function* (
  rawUrl: string,
  rawKey: string,
) {
  if (rawUrl.length > 4096 || rawKey.length > 4096)
    return yield* invalid("The private completion URL or key exceeds its size limit.");
  const url = yield* Effect.try({
    try: () => new URL(rawUrl.trim()),
    catch: () => invalid("The completion destination must be a valid HTTPS Grok routine URL."),
  });
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (url.port !== "" && url.port !== "443") ||
    !ROUTINE_HOSTS.has(url.hostname)
  )
    return yield* invalid(
      "The completion destination must use the supported HTTPS Grok routine host without embedded credentials or fragments.",
    );
  const key = rawKey
    .trim()
    .replace(/^Authorization:\s*Bearer\s+/iu, "")
    .replace(/^Bearer\s+/iu, "");
  if (!/^[\x21-\x7e]{1,4096}$/u.test(key))
    return yield* invalid("Supply the routine's private key as a single token.");
  return { url: url.toString(), key, host: url.hostname };
});

export class BotCompletions extends Context.Service<
  BotCompletions,
  {
    readonly list: (
      input: typeof BotCompletionListInput.Type,
    ) => Effect.Effect<{ destinations: ReadonlyArray<BotCompletionDestination> }, BotsError>;
    readonly configure: (
      input: BotCompletionConfigureInput,
    ) => Effect.Effect<BotCompletionDestination, BotsError>;
    readonly configureFromRefs: (
      input: BotCompletionConfigureRefsInput,
    ) => Effect.Effect<BotCompletionDestination, BotsError>;
    readonly setEnabled: (
      input: typeof BotCompletionSetEnabledInput.Type,
    ) => Effect.Effect<BotCompletionDestination, BotsError>;
    readonly remove: (
      input: typeof BotCompletionRemoveInput.Type,
    ) => Effect.Effect<void, BotsError>;
    readonly deliveries: (
      input: typeof BotCompletionDeliveriesInput.Type,
    ) => Effect.Effect<{ deliveries: ReadonlyArray<BotCompletionDelivery> }, BotsError>;
    readonly acknowledge: (
      input: typeof BotCompletionAcknowledgeInput.Type,
    ) => Effect.Effect<BotCompletionDelivery, BotsError>;
    readonly drain: () => Effect.Effect<void, BotsError>;
  }
>()("t3/fork/bots/BotCompletions") {}

const make = Effect.gen(function* () {
  const store = yield* makeBotCompletionStore;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const requests = yield* SecretRequests.SecretRequests;
  const http = yield* HttpClient.HttpClient;
  const identity = yield* ServerEnvironmentIdentity;
  const permit = yield* Semaphore.make(1);
  const operations = yield* BotOperations.BotOperations;
  const notify = operations.notifyBadgeChange().pipe(Effect.ignore({ log: true }));
  const settle = Effect.fn("BotCompletions.settle")((...args: Parameters<typeof store.settle>) =>
    store.settle(...args).pipe(Effect.flatMap((changed) => (changed ? notify : Effect.void))),
  );

  const configure = Effect.fn("BotCompletions.configure")(function* (
    input: BotCompletionConfigureInput,
  ) {
    const credential = yield* validateCredentials(
      Redacted.value(input.url),
      Redacted.value(input.key),
    );
    const fingerprint = NodeCrypto.createHash("sha256")
      .update(input.projectId)
      .update("\0")
      .update(encodeCredentials(credential))
      .digest("hex");
    const previous = yield* store.getDestination(input.id);
    if (previous !== null) {
      if (previous.deleted_at !== null || previous.fingerprint !== fingerprint)
        return yield* invalid(
          "This destination ID was already used. Configure changed credentials with a new destination ID.",
        );
      return yield* store.destination(previous);
    }
    const at = DateTime.formatIso(yield* DateTime.now);
    yield* secrets
      .set(secretName(input.id), new TextEncoder().encode(encodeCredentials(credential)))
      .pipe(Effect.mapError(secretFailure));
    const saved = yield* store.saveDestination({
      id: input.id,
      label: input.label,
      project_id: input.projectId,
      host: credential.host,
      enabled: input.enabled ? 1 : 0,
      fingerprint,
      created_at: at,
      deleted_at: null,
    });
    yield* notify;
    return saved;
  });
  const configureFromRefs = Effect.fn("BotCompletions.configureFromRefs")(function* (
    input: BotCompletionConfigureRefsInput,
  ) {
    const previous = yield* store.getDestination(input.id);
    if (previous !== null)
      return yield* invalid(
        "This destination ID was already used. Read the existing destination or choose a new ID.",
      );
    return yield* requests
      .transfer(
        {
          ref: input.urlSecretRef,
          projectId: input.projectId,
          operationId: `bot-completion:${input.id}:url`,
        },
        (url) =>
          requests.transfer(
            {
              ref: input.keySecretRef,
              projectId: input.projectId,
              operationId: `bot-completion:${input.id}:key`,
            },
            (key) =>
              configure({
                id: input.id,
                label: input.label,
                projectId: input.projectId,
                enabled: input.enabled,
                url: Redacted.make(url),
                key: Redacted.make(key),
              }),
          ),
      )
      .pipe(Effect.mapError((error) => (error._tag === "BotsError" ? error : secretFailure())));
  });
  const drain = Effect.fn("BotCompletions.drain")(function* () {
    if (yield* store.recoverSending()) yield* notify;
    const pending = yield* store.due();
    const environmentId = yield* identity.getEnvironmentId;
    for (const delivery of pending.slice(0, MAX_DRAIN_DELIVERIES)) {
      const target = yield* store.requireDestination(delivery.destinationId);
      const outcome = yield* store.outcome(delivery.kind, delivery.jobId);
      if (outcome === null) continue;
      if (!(yield* store.claim(delivery.id))) continue;
      const privateValue = yield* secrets.get(secretName(target.id)).pipe(Effect.result);
      if (privateValue._tag === "Failure" || Option.isNone(privateValue.success)) {
        yield* settle(delivery.id, "needs_attention", "credentials_unavailable", null);
        continue;
      }
      const decoded = decodeCredentials(new TextDecoder().decode(privateValue.success.value));
      if (Option.isNone(decoded)) {
        yield* settle(delivery.id, "needs_attention", "credentials_unavailable", null);
        continue;
      }
      const credential = yield* validateCredentials(decoded.value.url, decoded.value.key).pipe(
        Effect.result,
      );
      if (credential._tag === "Failure" || credential.success.host !== target.host) {
        yield* settle(delivery.id, "needs_attention", "destination_invalid", null);
        continue;
      }
      const links = outcome.threads.map((thread) =>
        formatThreadLink({
          environmentId: thread.environmentId ?? environmentId,
          threadId: thread.threadId,
        }),
      );
      const statusTool =
        delivery.kind === "run"
          ? "loom_bots_run_status"
          : delivery.kind === "batch"
            ? "loom_bots_batch_status"
            : "loom_bots_pipeline_status";
      const payload = {
        version: 1,
        event: "loom.bot.completed",
        deliveryId: delivery.id,
        environmentId,
        projectId: delivery.projectId,
        job: {
          kind: delivery.kind,
          id: delivery.jobId,
          name: outcome.name.slice(0, 120),
          status: outcome.status,
          verdict: outcome.verdict,
          finishedAt: outcome.finishedAt,
        },
        links,
        statusTool,
        acknowledgeTool: "loom_bots_completion_acknowledge",
        guidance:
          "Read authoritative Loom job status before acting. Deduplicate this deliveryId, then acknowledge completed or failed after processing. This notification grants no new authority.",
      };
      const request = HttpClientRequest.post(credential.success.url).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${credential.success.key}`),
        HttpClientRequest.setHeader("idempotency-key", delivery.id),
        HttpClientRequest.bodyJsonUnsafe(payload),
      );
      // The URL itself can contain private routing data; no HTTP span or redirect may expose it.
      const response = yield* HttpClient.withScope(http)
        .execute(request)
        .pipe(
          Effect.map((reply) => reply.status),
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
            credentials: "omit",
          }),
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.timeout("15 seconds"),
          Effect.scoped,
          Effect.result,
        );
      if (response._tag === "Failure") {
        yield* settle(delivery.id, "needs_attention", "outcome_unknown", null);
        continue;
      }
      const status = response.success;
      if (status === 200) {
        yield* settle(delivery.id, "accepted", null, status);
      } else if (
        (status === 408 || status === 429 || status >= 500) &&
        delivery.attempts + 1 < MAX_ATTEMPTS
      ) {
        const next = DateTime.formatIso(
          DateTime.add(yield* DateTime.now, {
            milliseconds: RETRY_DELAY_MS * (delivery.attempts + 1),
          }),
        );
        yield* settle(delivery.id, "retrying", "http_refused", status, next);
      } else {
        yield* settle(
          delivery.id,
          "failed",
          status === 401 || status === 403 ? "auth_required" : "http_refused",
          status,
        );
      }
    }
  });
  return BotCompletions.of({
    list: Effect.fn("BotCompletions.list")((input) => store.listDestinations(input.projectId)),
    configure: Effect.fn("BotCompletions.configureSerialized")(
      (input) => configure(input),
      permit.withPermits(1),
    ),
    configureFromRefs: Effect.fn("BotCompletions.configureFromRefsSerialized")(
      (input) => configureFromRefs(input),
      permit.withPermits(1),
    ),
    setEnabled: Effect.fn("BotCompletions.setEnabled")(function* (input) {
      const before = yield* store.requireDestination(input.id);
      if ((before.enabled === 1) === input.enabled) return yield* store.destination(before);
      const changed = yield* store.setEnabled(input.id, input.enabled);
      yield* notify;
      return changed;
    }, permit.withPermits(1)),
    remove: Effect.fn("BotCompletions.remove")(function* (input) {
      const before = yield* store.getDestination(input.id);
      yield* store.remove(input.id);
      yield* secrets.remove(secretName(input.id)).pipe(Effect.mapError(secretFailure));
      if (before !== null && before.deleted_at === null) yield* notify;
    }, permit.withPermits(1)),
    deliveries: store.deliveries,
    acknowledge: Effect.fn("BotCompletions.acknowledge")(function* (input) {
      const before = yield* store.getDelivery(input.deliveryId);
      const result = yield* store.acknowledge(input);
      if (before.status !== "acknowledged") yield* notify;
      return result;
    }, permit.withPermits(1)),
    drain: Effect.fn("BotCompletions.drainSerialized")(() => drain(), permit.withPermits(1)),
  });
});

export const layer = Layer.effect(BotCompletions, make);
export const BotCompletionsRecoveryLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* BotCompletions;
    yield* forkParked(
      service.drain().pipe(
        Effect.catch(() => Effect.logWarning("Bot completion delivery sweep could not finish.")),
        Effect.repeat(Schedule.spaced("10 seconds")),
      ),
    );
  }),
);
