import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerDirectEndpoint,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  type DirectoryEnvironmentReport,
  DirectoryReportRequest,
  type LoomOsSignedIdentity,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { verifyDirectoryReport } from "@t3tools/shared/fork/directory";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { DirectEndpoints } from "../../environment/DirectEndpoints.ts";
import {
  ServerEnvironment,
  ServerEnvironmentIdentity,
} from "../../environment/ServerEnvironment.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { MiniOffloadService } from "../mini-offload/MiniOffloadService.ts";
import * as Reporter from "./DirectoryReporter.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const LIBRARY = "https://library.example.com";
const REMOTE = { LOOM_LIBRARY_URL: LIBRARY, LOOM_LIBRARY_TOKEN: "computer-token" };
const STUDIO = EnvironmentId.make("environment-studio");
/** The reporter's descriptor request timeout, which races the request instead of pacing reports. */
const DESCRIPTOR_TIMEOUT_MS = 20_000;
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** Every kind of route DirectEndpoints can hand over. Only the MagicDNS HTTPS name may leave. */
const ROUTES: ReadonlyArray<ServerDirectEndpoint> = [
  { kind: "lan", httpBaseUrl: "http://192.168.1.20:3773/" },
  { kind: "tailnet", httpBaseUrl: "http://computer.example.ts.net/" },
  { kind: "tailnet", httpBaseUrl: "https://100.64.0.7/" },
  { kind: "tailnet", httpBaseUrl: "https://computer.example.ts.net/" },
];

/** Signed the LoomOS way with OpenSSL; copied from the shared directory tests. */
const WORKER: LoomOsSignedIdentity = {
  payload:
    '{"boot_id": "00000000-0000-4000-8000-000000000000", "hostname": "loom-worker", "installation_id": "fdd89fe94a7d2b2f6c8001d393810fb363bfa958f87e755d73186f3b91c4dfe7", "issued_at": "2026-10-18T12:00:00Z", "machine_key": {"algorithm": "ed25519", "fingerprint": "4f9b610da2f63797e91ca40cc68ec3405f055398c7fba8453ba5f8606113ea02", "public_key": "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng="}, "release": {"roles": ["worker"], "runtime_sha256": "1111111111111111111111111111111111111111111111111111111111111111", "runtime_version": "0.1.7", "schema_version": 1, "source_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000", "target": "orangepi5pro", "version": "0.1.7"}, "schema_version": 1, "ssh_host_key_fingerprints": ["SHA256:w4x0WyTLW4nOnsWeMLTOBCl3KFlC8AWI+p1Rj6+Ifzo"], "tailnet_name": "worker.example.ts.net"}\n',
  signature:
    "e0QDlRdh0LU/UGN35Y+llNRK5maJ4rvNGkv8i3fLkZ7RbkoojK+d6hxdec+g9wutzPYIljoxJlN9+FHssVFoDQ==",
  public_key: "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=",
};

const providerOf = (status: ServerProvider["status"]): ServerProvider => ({
  driver: ProviderDriverKind.make("codex"),
  instanceId: ProviderInstanceId.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status,
  checkedAt: "2026-10-20T12:00:00Z",
  auth: { status: "authenticated" },
  models: [],
  skills: [],
  slashCommands: [],
});

const refusal = (status: number, reason: string) => Response.json({ reason }, { status });
/** What a proxy in front of the Library answers while the Library is down or wants a sign-in. */
const page = (status: number) =>
  new Response("<html>Library</html>", { status, headers: { "content-type": "text/html" } });
const decodePosted = Schema.decodeUnknownSync(Schema.fromJsonString(DirectoryReportRequest));

/** What the fake directory saw and when the reporter went to sleep, in order. */
type Event =
  | { readonly kind: "descriptor"; readonly authorization: string | undefined }
  | {
      readonly kind: "post";
      readonly report: DirectoryEnvironmentReport;
      readonly status: number;
      readonly authorization: string | undefined;
    }
  | { readonly kind: "sleep"; readonly millis: number };
type Post = Extract<Event, { readonly kind: "post" }>;

interface Options {
  readonly env?: Record<string, string>;
  readonly features?: ReadonlyArray<string>;
  /** A key the directory already pinned for this computer. */
  readonly pinnedKey?: string;
  /** Signs the computer in to the Library with a sign-in that has already expired. */
  readonly expiredSignIn?: true;
  /** Answers for the first descriptor requests, given before the reporter starts. */
  readonly descriptorAnswers?: ReadonlyArray<Response>;
  /** Answers for the first reports, given before the reporter starts. */
  readonly answers?: ReadonlyArray<Response>;
}

/** A sign-in written the way enrollment writes one, but already expired. Returns its path. */
const writeExpiredSignIn = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join((yield* ServerConfig.ServerConfig).baseDir, "publisher.json");
  yield* fs.writeFileString(
    file,
    JSON.stringify({
      version: 1,
      sourceEnvironmentId: STUDIO,
      libraryEnvironmentId: "environment-library",
      libraryUrl: LIBRARY,
      sessionId: "session-1",
      accessToken: "expired-token",
      expiresAt: iso(NOW - 1_000),
    }),
    { mode: 0o600 },
  );
  return file;
});

const withReporter = <A, E>(
  options: Options,
  use: (harness: {
    readonly reporter: Reporter.DirectoryReporter["Service"];
    readonly fiber: Fiber.Fiber<void>;
    readonly library: {
      features: ReadonlyArray<string>;
      pinnedKey: string | null;
      /** Answers for the next descriptor requests, before the Library's own. */
      readonly descriptorAnswers: Array<Response>;
      /** Answers for the next reports, before the directory stores one. */
      readonly answers: Array<Response>;
    };
    readonly endpoints: Ref.Ref<ReadonlyArray<ServerDirectEndpoint>>;
    readonly workers: Ref.Ref<ReadonlyArray<LoomOsSignedIdentity>>;
    readonly setProviders: (providers: ReadonlyArray<ServerProvider>) => Effect.Effect<void>;
    /** The next report the directory received, skipping the sleeps before it. */
    readonly nextPost: Effect.Effect<Post>;
    /** The next sleep's length, failing on any report before it. */
    readonly nextSleep: Effect.Effect<number>;
    readonly events: Queue.Queue<Event>;
    readonly logs: ReadonlyArray<string>;
    readonly tokens: ReadonlyArray<string>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const events = yield* Queue.unbounded<Event>();
    const library = {
      features: options.features ?? ["core", "directory"],
      pinnedKey: options.pinnedKey ?? null,
      descriptorAnswers: [...(options.descriptorAnswers ?? [])],
      answers: [...(options.answers ?? [])],
    };
    const tokens: Array<string> = [];
    const logs: Array<string> = [];
    const env = options.expiredSignIn
      ? {
          LOOM_LIBRARY_URL: LIBRARY,
          LOOM_LIBRARY_CREDENTIAL_FILE: yield* writeExpiredSignIn,
        }
      : (options.env ?? REMOTE);
    const endpoints = yield* Ref.make(ROUTES);
    const workers = yield* Ref.make<ReadonlyArray<LoomOsSignedIdentity>>([]);
    const providers = yield* Ref.make<ReadonlyArray<ServerProvider>>([providerOf("ready")]);
    const providerChanges = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();

    const http = HttpClient.make((request) =>
      Effect.gen(function* () {
        const authorization = request.headers.authorization;
        if (new URL(request.url).pathname === "/.well-known/t3/environment") {
          yield* Queue.offer(events, { kind: "descriptor", authorization });
          return HttpClientResponse.fromWeb(
            request,
            library.descriptorAnswers.shift() ??
              Response.json({ capabilities: { loomFeatures: library.features } }),
          );
        }
        expect(request.url).toBe(`${LIBRARY}/api/loom/directory/report`);
        const posted = decodePosted(
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        );
        const report = yield* verifyDirectoryReport({
          publicKey: posted.publicKey,
          token: posted.token,
          environmentId: STUDIO,
          audience: LIBRARY,
          nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000,
        });
        tokens.push(posted.token);
        const queued =
          library.pinnedKey !== null && library.pinnedKey !== posted.publicKey
            ? refusal(409, "key-changed")
            : library.answers.shift();
        // Like the real directory, a stored report pins its key and answers with the record.
        if (queued === undefined) library.pinnedKey = posted.publicKey;
        const answer = queued ?? Response.json({ environmentId: STUDIO });
        yield* Queue.offer(events, { kind: "post", report, status: answer.status, authorization });
        return HttpClientResponse.fromWeb(request, answer);
      }).pipe(Effect.orDie),
    );

    // The reporter's sleeps join the event stream, so each step waits for it to settle
    // instead of for time to pass.
    const testClock = yield* TestClock.testClockWith(Effect.succeed);
    const clock: Clock.Clock = {
      ...testClock,
      sleep: (duration) =>
        Queue.offer(events, { kind: "sleep", millis: Duration.toMillis(duration) }).pipe(
          Effect.andThen(testClock.sleep(duration)),
        ),
    };
    const logger = Logger.make(({ message }) => {
      logs.push(JSON.stringify(message));
    });

    const context = yield* Layer.build(
      Reporter.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ServerEnvironment)({
              getDescriptor: Effect.succeed({
                environmentId: STUDIO,
                label: "Studio",
                platform: { os: "darwin", arch: "arm64" },
                serverVersion: "0.0.0-test",
                capabilities: {
                  repositoryIdentity: true,
                  supportsExecution: true,
                  loomFeatures: ["core", "directory-reporting"],
                },
              }),
            }),
            Layer.mock(DirectEndpoints)({ resolve: () => Ref.get(endpoints) }),
            Layer.mock(ProviderRegistry.ProviderRegistry)({
              getProviders: Ref.get(providers),
              streamChanges: Stream.fromQueue(providerChanges),
            }),
            Layer.mock(MiniOffloadService)({ identities: Ref.get(workers) }),
            Layer.succeed(HttpClient.HttpClient, http),
            ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
          ),
        ),
      ),
    );
    const reporter = Context.get(context, Reporter.DirectoryReporter);
    const fiber = yield* reporter.run.pipe(
      Effect.provideService(Clock.Clock, clock),
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      Effect.forkScoped,
    );

    const nextPost: Effect.Effect<Post> = Queue.take(events).pipe(
      Effect.flatMap((event) => (event.kind === "post" ? Effect.succeed(event) : nextPost)),
    );
    const nextSleep: Effect.Effect<number> = Queue.take(events).pipe(
      Effect.flatMap((event) => {
        expect(event.kind).not.toBe("post");
        return event.kind === "sleep" && event.millis !== DESCRIPTOR_TIMEOUT_MS
          ? Effect.succeed(event.millis)
          : nextSleep;
      }),
    );
    const setProviders = (next: ReadonlyArray<ServerProvider>) =>
      Ref.set(providers, next).pipe(Effect.andThen(Queue.offer(providerChanges, next)));

    return yield* use({
      reporter,
      fiber,
      library,
      endpoints,
      workers,
      setProviders,
      nextPost,
      nextSleep,
      events,
      logs,
      tokens,
    });
  }).pipe(
    Effect.provideService(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(STUDIO) }),
    Effect.provide(ServerSecretStore.layer),
    // No enrolled computer lives here, so the Library comes from the env.
    Effect.provideServiceEffect(
      HostProcess.HomeDirectory,
      Effect.map(ServerConfig.ServerConfig, (config) => config.baseDir),
    ),
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "directory-reporter-test-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );

describe("DirectoryReporter", () => {
  it.effect("reports at start, after a route change and once a minute, over HTTPS names only", () =>
    withReporter({}, (h) =>
      Effect.gen(function* () {
        const first = yield* h.nextPost;
        expect(first.authorization).toBe("Bearer computer-token");
        expect(first.report).toMatchObject({
          environmentId: STUDIO,
          label: "Studio",
          supportsExecution: true,
          loomFeatures: ["core", "directory-reporting"],
          routes: [{ kind: "tailnet", url: "https://computer.example.ts.net/" }],
          providers: [{ id: "codex", status: "ready" }],
          sequence: NOW,
          reportedAt: iso(NOW),
        });
        expect(first.report.workers).toBeUndefined();
        expect(yield* h.nextSleep).toBe(30_000);
        expect(yield* h.reporter.status).toEqual({
          state: "reporting",
          lastReportedAt: iso(NOW),
        });

        // Unchanged, the half-minute check sends nothing and the minute's heartbeat does.
        yield* TestClock.adjust("30 seconds");
        expect(yield* h.nextSleep).toBe(30_000);
        yield* TestClock.adjust("30 seconds");
        const heartbeat = yield* h.nextPost;
        expect(heartbeat.report).toMatchObject({
          sequence: NOW + 60_000,
          reportedAt: iso(NOW + 60_000),
        });
        expect(yield* h.nextSleep).toBe(30_000);

        yield* Ref.set(h.endpoints, [
          ...ROUTES,
          { kind: "tailnet", httpBaseUrl: "https://studio.example.ts.net/" },
        ]);
        yield* TestClock.adjust("30 seconds");
        const changed = yield* h.nextPost;
        expect(changed.report.reportedAt).toBe(iso(NOW + 90_000));
        expect(changed.report.routes).toEqual([
          { kind: "tailnet", url: "https://computer.example.ts.net/" },
          { kind: "tailnet", url: "https://studio.example.ts.net/" },
        ]);
        expect(yield* h.nextSleep).toBe(30_000);
      }),
    ),
  );

  it.effect("reports a provider status or worker change without waiting for the minute", () =>
    withReporter({}, (h) =>
      Effect.gen(function* () {
        yield* h.nextPost;
        expect(yield* h.nextSleep).toBe(30_000);

        // Providers settle for five seconds before the change wakes the reporter.
        yield* h.setProviders([providerOf("error")]);
        expect(yield* h.nextSleep).toBe(5_000);
        yield* TestClock.adjust("5 seconds");
        const provider = yield* h.nextPost;
        expect(provider.report).toMatchObject({
          reportedAt: iso(NOW + 5_000),
          providers: [{ id: "codex", status: "error" }],
        });
        expect(yield* h.nextSleep).toBe(30_000);

        yield* Ref.set(h.workers, [WORKER]);
        yield* TestClock.adjust("30 seconds");
        const worker = yield* h.nextPost;
        expect(worker.report.reportedAt).toBe(iso(NOW + 35_000));
        expect(worker.report.workers).toEqual([WORKER]);
      }),
    ),
  );

  it.effect("stops on a changed key with one warning and reports again once forgotten", () =>
    withReporter({ pinnedKey: WORKER.public_key }, (h) =>
      Effect.gen(function* () {
        expect((yield* h.nextPost).status).toBe(409);
        expect(yield* h.nextSleep).toBe(15 * 60_000);
        expect(yield* h.reporter.status).toEqual({ state: "key-changed", lastReportedAt: null });

        yield* TestClock.adjust("15 minutes");
        expect((yield* h.nextPost).status).toBe(409);
        expect(yield* h.nextSleep).toBe(15 * 60_000);

        // Forgetting the computer in the directory drops its pinned key.
        h.library.pinnedKey = null;
        yield* TestClock.adjust("15 minutes");
        expect((yield* h.nextPost).status).toBe(200);
        expect(yield* h.nextSleep).toBe(30_000);
        expect(yield* h.reporter.status).toEqual({
          state: "reporting",
          lastReportedAt: iso(NOW + 30 * 60_000),
        });

        const logged = h.logs.join("\n");
        expect(logged.split("signing key changed")).toHaveLength(2);
        expect(logged).toContain("reporting to the directory again");
        expect(logged).not.toContain("computer-token");
        for (const token of h.tokens) expect(logged).not.toContain(token);
      }),
    ),
  );

  it.effect("retries a failed report with backoff and warns once", () =>
    withReporter({}, (h) =>
      Effect.gen(function* () {
        h.library.answers.push(refusal(503, "io"), refusal(503, "io"));
        expect((yield* h.nextPost).status).toBe(503);
        expect(yield* h.nextSleep).toBe(30_000);
        expect(yield* h.reporter.status).toEqual({
          state: "retrying",
          reason: "io",
          lastReportedAt: null,
        });

        yield* TestClock.adjust("30 seconds");
        expect((yield* h.nextPost).status).toBe(503);
        expect(yield* h.nextSleep).toBe(60_000);

        yield* TestClock.adjust("1 minute");
        expect((yield* h.nextPost).status).toBe(200);
        expect(yield* h.nextSleep).toBe(30_000);
        expect((yield* h.reporter.status).state).toBe("reporting");
        expect(h.logs.join("\n").split("could not report to the directory")).toHaveLength(2);
      }),
    ),
  );

  it.effect("leaves a Library without the directory alone until it gains one", () =>
    withReporter({ features: ["core"] }, (h) =>
      Effect.gen(function* () {
        const descriptor = yield* Queue.take(h.events);
        // The descriptor is public, so the publisher token never goes with it.
        expect(descriptor).toEqual({ kind: "descriptor", authorization: undefined });
        expect(yield* h.nextSleep).toBe(10 * 60_000);
        expect(yield* h.reporter.status).toEqual({ state: "unsupported", lastReportedAt: null });

        h.library.features = ["core", "directory"];
        yield* TestClock.adjust("10 minutes");
        expect((yield* h.nextPost).report.reportedAt).toBe(iso(NOW + 10 * 60_000));
      }),
    ),
  );

  it.effect("retries a Library that is down behind its proxy instead of leaving it alone", () =>
    withReporter({ descriptorAnswers: [page(502)] }, (h) =>
      Effect.gen(function* () {
        expect(yield* Queue.take(h.events)).toEqual({
          kind: "descriptor",
          authorization: undefined,
        });
        expect(yield* h.nextSleep).toBe(30_000);
        expect(yield* h.reporter.status).toEqual({
          state: "retrying",
          reason: "io",
          lastReportedAt: null,
        });

        // The proxy's error page for a report, and a sign-in page it redirects to, store nothing.
        h.library.answers.push(page(502), page(200));
        yield* TestClock.adjust("30 seconds");
        expect((yield* h.nextPost).status).toBe(502);
        expect(yield* h.nextSleep).toBe(60_000);
        yield* TestClock.adjust("1 minute");
        expect((yield* h.nextPost).status).toBe(200);
        expect(yield* h.nextSleep).toBe(120_000);
        expect(yield* h.reporter.status).toEqual({
          state: "retrying",
          reason: "io",
          lastReportedAt: null,
        });

        yield* TestClock.adjust("2 minutes");
        expect((yield* h.nextPost).status).toBe(200);
        expect(yield* h.nextSleep).toBe(30_000);
        expect(yield* h.reporter.status).toEqual({
          state: "reporting",
          lastReportedAt: iso(NOW + 210_000),
        });
        expect(h.logs.join("\n").split("could not report to the directory")).toHaveLength(2);
      }),
    ),
  );

  it.effect("stops while the Library refuses its sign-in and reports again once accepted", () =>
    withReporter(
      {
        answers: [
          new Response("Authentication required", { status: 401 }),
          new Response("Authentication required", { status: 401 }),
        ],
      },
      (h) =>
        Effect.gen(function* () {
          expect((yield* h.nextPost).status).toBe(401);
          expect(yield* h.nextSleep).toBe(15 * 60_000);
          expect(yield* h.reporter.status).toEqual({ state: "signed-out", lastReportedAt: null });

          yield* TestClock.adjust("15 minutes");
          expect((yield* h.nextPost).status).toBe(401);
          expect(yield* h.nextSleep).toBe(15 * 60_000);

          yield* TestClock.adjust("15 minutes");
          expect((yield* h.nextPost).status).toBe(200);
          expect(yield* h.nextSleep).toBe(30_000);
          expect((yield* h.reporter.status).state).toBe("reporting");
          const logged = h.logs.join("\n");
          expect(logged.split("sign-in is missing, expired or refused")).toHaveLength(2);
          expect(logged).toContain("reporting to the directory again");
        }),
    ),
  );

  it.effect("says it is signed out when its Library sign-in expired, and sends nothing", () =>
    withReporter({ expiredSignIn: true }, (h) =>
      Effect.gen(function* () {
        yield* Fiber.join(h.fiber);
        expect(yield* h.reporter.status).toEqual({ state: "signed-out", lastReportedAt: null });
        expect(yield* Queue.size(h.events)).toBe(0);
        const logged = h.logs.join("\n");
        expect(logged.split("sign-in is missing, expired or refused")).toHaveLength(2);
        expect(logged).not.toContain("expired-token");
      }),
    ),
  );

  it.effect("stays off without a Library", () =>
    withReporter({ env: {} }, (h) =>
      Effect.gen(function* () {
        yield* Fiber.join(h.fiber);
        expect(yield* h.reporter.status).toEqual({ state: "off", lastReportedAt: null });
        expect(yield* Queue.size(h.events)).toBe(0);
      }),
    ),
  );
});
