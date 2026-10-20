import type { ServerProvider } from "@t3tools/contracts";
import {
  DIRECTORY_FEATURE,
  DIRECTORY_MAX_PROVIDERS,
  DIRECTORY_MAX_ROUTES,
  DirectoryError,
  type DirectoryEnvironmentReport,
  type DirectoryReporting,
} from "@t3tools/contracts/fork";
import {
  directoryPublicKeyFromPem,
  isDirectoryRouteUrl,
  signDirectoryReport,
} from "@t3tools/shared/fork/directory";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { DirectEndpoints } from "../../environment/DirectEndpoints.ts";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { forkParked } from "../../serverActivation.ts";
import { MiniOffloadService } from "../mini-offload/MiniOffloadService.ts";
import { resolveLibraryConnection } from "../project-library/LibraryConnection.ts";
import { DIRECTORY_REPORT_ROUTE } from "./DirectoryService.ts";

/** Without a change, a computer reports this often, so its entry stays under two minutes old. */
const HEARTBEAT_MS = 60_000;
/** Nothing announces a route change, so routes are read this often. */
const CHECK_MS = 30_000;
/** Providers probe one after another at start, so their changes arrive in a burst. */
const PROVIDER_SETTLE = "5 seconds";
/** A Library without the directory is asked again this often, so its deploy needs no restart. */
const UNSUPPORTED_RECHECK_MS = 10 * 60_000;
/** Forgetting the computer in the directory accepts its new key on the next try. */
const KEY_CHANGED_RETRY_MS = 15 * 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
const DESCRIPTOR_ROUTE = "/.well-known/t3/environment";

type FailureReason = NonNullable<DirectoryReporting["reason"]>;

const FAILURE_REASONS: ReadonlySet<string> = new Set<FailureReason>([
  "io",
  "invalid",
  "unverified",
  "wrong-environment",
  "stale-sequence",
  "signed-out",
]);
const isFailureReason = (value: string): value is FailureReason => FAILURE_REASONS.has(value);

export class DirectoryReporter extends Context.Service<
  DirectoryReporter,
  {
    readonly status: Effect.Effect<DirectoryReporting>;
    /** Reports until interrupted. Returns at once without a Library to report to. */
    readonly run: Effect.Effect<void>;
  }
>()("t3/fork/directory/DirectoryReporter") {}

const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const decodeRefusal = Schema.decodeUnknownEffect(Schema.Struct({ reason: Schema.String }));
const decodeFeatures = Schema.decodeUnknownEffect(
  Schema.Struct({
    capabilities: Schema.Struct({ loomFeatures: Schema.optional(Schema.Array(Schema.String)) }),
  }),
);

/** A comparable form of a report's contents. */
const fingerprintOf = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const providerStatuses = (snapshot: ReadonlyArray<ServerProvider>) =>
  snapshot
    .slice(0, DIRECTORY_MAX_PROVIDERS)
    .map((provider) => ({ id: provider.instanceId, status: provider.status }));

const make = Effect.gen(function* () {
  // Resolved once, as the publisher does. The authority lists itself and reports to no one.
  const connection = yield* resolveLibraryConnection.pipe(
    Effect.orElseSucceed(() => ({ kind: "unavailable" }) as const),
  );
  const environment = yield* ServerEnvironment;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const endpoints = yield* DirectEndpoints;
  const mini = yield* MiniOffloadService;
  const http = yield* HttpClient.HttpClient;
  const status = yield* Ref.make<DirectoryReporting>({ state: "off", lastReportedAt: null });

  /** Everything a report says except its sequence and time. */
  const describe = Effect.gen(function* () {
    const descriptor = yield* environment.getDescriptor;
    const executes = descriptor.capabilities.supportsExecution !== false;
    // Only the MagicDNS HTTPS name passes: LAN routes are plain HTTP on an IP address.
    const routes = (yield* endpoints.resolve())
      .filter(
        (endpoint) => endpoint.kind === "tailnet" && isDirectoryRouteUrl(endpoint.httpBaseUrl),
      )
      .slice(0, DIRECTORY_MAX_ROUTES)
      .map((endpoint) => ({ kind: "tailnet" as const, url: endpoint.httpBaseUrl }));
    const workers = yield* mini.identities.pipe(Effect.orElseSucceed(() => []));
    return {
      environmentId: descriptor.environmentId,
      label: descriptor.label.slice(0, 160).trim(),
      serverVersion: descriptor.serverVersion.slice(0, 160).trim(),
      platform: { os: descriptor.platform.os, arch: descriptor.platform.arch },
      supportsExecution: executes,
      loomFeatures: descriptor.capabilities.loomFeatures ?? [],
      routes,
      providers: executes ? providerStatuses(yield* providers.getProviders) : [],
      ...(workers.length === 0 ? {} : { workers }),
    } satisfies Omit<DirectoryEnvironmentReport, "sequence" | "reportedAt">;
  });

  const run = Effect.gen(function* () {
    if (connection.kind !== "remote") return;
    const library = connection;

    // Asked without the publisher token: the descriptor is public.
    const directorySupported = http
      .execute(HttpClientRequest.get(library.endpoint(DESCRIPTOR_ROUTE)))
      .pipe(
        Effect.flatMap((response) =>
          response.status === 200
            ? response.json.pipe(Effect.flatMap(decodeFeatures), Effect.option)
            : Effect.succeedNone,
        ),
        Effect.map((descriptor) =>
          Option.isSome(descriptor) &&
          (descriptor.value.capabilities.loomFeatures ?? []).includes(DIRECTORY_FEATURE)
            ? ("supported" as const)
            : ("unsupported" as const),
        ),
        Effect.timeout("30 seconds"),
        Effect.orElseSucceed(() => "io" as const),
      );

    const post = (report: DirectoryEnvironmentReport) =>
      Effect.gen(function* () {
        const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets).pipe(
          Effect.option,
        );
        if (Option.isNone(keyPair)) return "io" as const;
        const publicKey = directoryPublicKeyFromPem(keyPair.value.publicKey);
        if (publicKey === null) return "invalid" as const;
        const token = yield* signDirectoryReport({
          privateKey: keyPair.value.privateKey,
          report,
          audience: library.origin,
          nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000,
        }).pipe(Effect.option);
        if (Option.isNone(token)) return "invalid" as const;
        const sent = yield* library
          .send(
            HttpClientRequest.post(library.endpoint(DIRECTORY_REPORT_ROUTE)).pipe(
              HttpClientRequest.bodyJsonUnsafe({ token: token.value, publicKey }),
            ),
          )
          .pipe(Effect.result);
        if (sent._tag === "Failure")
          return sent.failure.reason === "blocked" ? ("signed-out" as const) : ("io" as const);
        const response = sent.success;
        if (response.status >= 200 && response.status < 300) return "sent" as const;
        // A Library older than the directory answers an unknown route 404 or with its web app.
        if (
          response.status === 404 ||
          /^text\/html\b/i.test(response.headers["content-type"] ?? "")
        )
          return "unsupported" as const;
        const refused = yield* response.json.pipe(Effect.flatMap(decodeRefusal), Effect.option);
        const reason = Option.isSome(refused) ? refused.value.reason : null;
        if (reason === "key-changed") return "key-changed" as const;
        if (reason !== null && isFailureReason(reason)) return reason;
        if (response.status === 401 || response.status === 403) return "signed-out" as const;
        return "io" as const;
      });

    // Provider snapshots also change for models and usage, so wake only when a status does.
    const wake = yield* Queue.sliding<void>(1);
    yield* providers.streamChanges.pipe(
      Stream.map((snapshot) => fingerprintOf(providerStatuses(snapshot))),
      Stream.changes,
      Stream.debounce(PROVIDER_SETTLE),
      Stream.runForEach(() => Queue.offer(wake, undefined)),
      Effect.forkScoped,
    );

    let supported = false;
    let keyChanged = false;
    let failures = 0;
    let sequence = 0;
    let lastSent: { readonly fingerprint: string; readonly at: number } | null = null;
    const update = (next: Omit<DirectoryReporting, "lastReportedAt">) =>
      Ref.update(status, (current) => ({ ...next, lastReportedAt: current.lastReportedAt }));

    const unsupported = Effect.gen(function* () {
      supported = false;
      keyChanged = false;
      failures = 0;
      lastSent = null;
      yield* update({ state: "unsupported" });
      return { delay: UNSUPPORTED_RECHECK_MS, wakeable: false };
    });
    const retry = (reason: FailureReason) =>
      Effect.gen(function* () {
        failures += 1;
        if (failures === 1)
          yield* Effect.logWarning("This computer could not report to the directory. Retrying.", {
            reason,
          });
        yield* update({ state: "retrying", reason });
        return {
          delay: Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS),
          wakeable: false,
        };
      });

    const step = Effect.gen(function* () {
      if (!supported) {
        const feature = yield* directorySupported;
        if (feature === "unsupported") return yield* unsupported;
        if (feature !== "supported") return yield* retry(feature);
        supported = true;
      }
      const description = yield* describe;
      // Worker identities are re-issued without changing the machine, so only their keys count.
      const fingerprint = fingerprintOf({
        ...description,
        workers: description.workers?.map((worker) => worker.public_key),
      });
      const now = yield* Clock.currentTimeMillis;
      if (
        !keyChanged &&
        failures === 0 &&
        lastSent !== null &&
        lastSent.fingerprint === fingerprint &&
        now - lastSent.at < HEARTBEAT_MS
      )
        return { delay: Math.min(CHECK_MS, HEARTBEAT_MS - (now - lastSent.at)), wakeable: true };
      sequence = Math.max(now, sequence + 1);
      const outcome = yield* post({ ...description, sequence, reportedAt: isoAt(now) });
      switch (outcome) {
        case "sent":
          if (failures > 0 || keyChanged)
            yield* Effect.logInfo("This computer is reporting to the directory again.");
          keyChanged = false;
          failures = 0;
          lastSent = { fingerprint, at: now };
          yield* Ref.set(status, { state: "reporting", lastReportedAt: isoAt(now) });
          return { delay: CHECK_MS, wakeable: true };
        case "unsupported":
          return yield* unsupported;
        case "key-changed":
          if (!keyChanged)
            yield* Effect.logWarning(new DirectoryError({ reason: "key-changed" }).message);
          keyChanged = true;
          failures = 0;
          yield* update({ state: "key-changed" });
          return { delay: KEY_CHANGED_RETRY_MS, wakeable: false };
        default:
          return yield* retry(outcome);
      }
    });

    return yield* Effect.forever(
      step.pipe(
        Effect.flatMap(({ delay, wakeable }) =>
          wakeable ? Effect.raceFirst(Effect.sleep(delay), Queue.take(wake)) : Effect.sleep(delay),
        ),
      ),
    );
  }).pipe(Effect.scoped);

  return DirectoryReporter.of({ status: Ref.get(status), run });
});

export const layer = Layer.effect(DirectoryReporter, make);

/** Runs the reporter once the server is active. */
export const DirectoryReporterLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const reporter = yield* DirectoryReporter;
    yield* forkParked(
      reporter.run.pipe(
        // No cause: a transport defect can hold the request and its publisher token.
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("Directory reporting stopped. Restart Loom to resume it."),
        ),
      ),
    );
  }),
);
