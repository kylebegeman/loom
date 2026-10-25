import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { type ReachAction, ReachRequestBody, type ReachStatus } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { verifyReachRequest } from "@t3tools/shared/fork/reach";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import type { CloudflaredStatus } from "../cloudflared/connector.ts";
import { ReachPublicRoute } from "./publicRoute.ts";
import { makeReachService, type ReachService, reachIngressOrigin } from "./ReachService.ts";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const LIBRARY = "https://library.example.com";
const REMOTE = { LOOM_LIBRARY_URL: LIBRARY, LOOM_LIBRARY_TOKEN: "computer-token" };
const STUDIO = EnvironmentId.make("environment-studio");
const ORIGIN = "http://127.0.0.1:3773";
const HOSTNAME = "studio-loom.example.com";
const URL_ = `https://${HOSTNAME}/`;
const MINUTE = 60_000;
/** The Library connection's request timeout, which races each request instead of pacing retries. */
const LIBRARY_TIMEOUT_MS = 3 * MINUTE;
const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(ReachRequestBody));

const ensureReply = (origin: string, connectorToken: string, overrides: object = {}) => ({
  hostname: HOSTNAME,
  url: URL_,
  origin,
  connectorToken,
  edge: { allowlist: "ready", rateLimit: "ready" },
  identity: { state: "not-configured" },
  ...overrides,
});
const refusal = (status: number, reason: string, extra: object = {}) =>
  Response.json({ reason, ...extra }, { status });
const page = (status: number) =>
  new Response("<html>Library</html>", { status, headers: { "content-type": "text/html" } });

/** What the fake Library and the fake connector saw, and when the service went to sleep. */
type Event =
  | {
      readonly kind: "request";
      readonly action: ReachAction;
      readonly seq: number;
      readonly origin: string | undefined;
      readonly tokenFileExists: boolean;
    }
  | { readonly kind: "start"; readonly token: string; readonly tokenFile: string | undefined }
  | {
      readonly kind: "stop";
      readonly token: string;
      /** The sidecar's `enabled` when the connector began to close. */
      readonly enabledOnDisk: boolean | null;
    }
  | { readonly kind: "sleep"; readonly millis: number };

interface Options {
  readonly env?: Record<string, string>;
  /** The process environment Identity warnings come from. */
  readonly identityEnv?: Record<string, string>;
  /** A sidecar left by an earlier run. */
  readonly sidecar?: object;
  /** A connector token file a hard crash of an earlier run left behind. */
  readonly leftoverTokenFile?: true;
  /** Signs the computer in to the Library with a sign-in that has already expired. */
  readonly expiredSignIn?: true;
  readonly answers?: ReadonlyArray<Response>;
}

interface Harness {
  readonly service: ReachService["Service"];
  /** Answers for the next requests, before the default success. */
  readonly answers: Array<Response>;
  /** While set, the Library holds every request until it completes. */
  readonly hold: Ref.Ref<Deferred.Deferred<void> | null>;
  readonly origin: Ref.Ref<string | null>;
  readonly route: Ref.Ref<Option.Option<string>>;
  readonly next: Effect.Effect<Event>;
  /** Reports a status from the newest connector, as cloudflared's output would. */
  readonly connectorStatus: (status: CloudflaredStatus) => Effect.Effect<void>;
  /** The newest connector's runner giving up on a token the edge keeps refusing. */
  readonly refuseToken: Effect.Effect<void>;
  /** The same from the connector this run started `index`th, from 0, even once it stopped. */
  readonly refuseTokenOf: (index: number) => Effect.Effect<void>;
  /** Nothing the Library, the connector or a sleep did is waiting to be read. */
  readonly settled: Effect.Effect<boolean>;
  readonly waitFor: (predicate: (status: ReachStatus) => boolean) => Effect.Effect<ReachStatus>;
  readonly sidecar: Effect.Effect<unknown>;
  readonly sidecarText: Effect.Effect<string | null>;
  readonly tokenFile: string;
  readonly tokenFileExists: Effect.Effect<boolean>;
  readonly logs: ReadonlyArray<string>;
  readonly adjust: (millis: number) => Effect.Effect<void>;
}

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
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(NOW - 1_000)),
    }),
    { mode: 0o600 },
  );
  return file;
});

const withReach = <A, E>(options: Options, use: (harness: Harness) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const directory = path.join(config.stateDir, "fork", "reach");
    const sidecarPath = path.join(directory, "state.json");
    const tokenFile = path.join(directory, "connector-token");
    if (options.sidecar !== undefined) {
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFileString(sidecarPath, JSON.stringify(options.sidecar));
    }
    if (options.leftoverTokenFile) {
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFileString(tokenFile, "crashed-run-token", { mode: 0o600 });
    }
    const sidecarText = fs
      .readFileString(sidecarPath)
      .pipe(Effect.option, Effect.map(Option.getOrNull));
    const sidecar = Effect.map(sidecarText, (text) => (text === null ? null : JSON.parse(text)));

    const events = yield* Queue.unbounded<Event>();
    const answers = [...(options.answers ?? [])];
    const hold = yield* Ref.make<Deferred.Deferred<void> | null>(null);
    const origin = yield* Ref.make<string | null>(ORIGIN);
    const route = yield* Ref.make(Option.none<string>());
    const logs: Array<string> = [];
    let ensures = 0;

    const http = HttpClient.make((request) =>
      Effect.gen(function* () {
        const posted = decodeBody(
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        );
        const action: ReachAction = new URL(request.url).pathname.endsWith("/ensure")
          ? "ensure"
          : "remove";
        expect(request.url).toBe(`${LIBRARY}/api/loom/reach/${action}`);
        const claims = yield* verifyReachRequest({
          publicKey: posted.publicKey,
          token: posted.token,
          environmentId: STUDIO,
          audience: LIBRARY,
          action,
          nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000,
        });
        yield* Queue.offer(events, {
          kind: "request",
          action,
          seq: claims.seq,
          origin: claims.origin,
          tokenFileExists: yield* fs.exists(tokenFile),
        });
        const held = yield* Ref.get(hold);
        if (held !== null) yield* Deferred.await(held);
        const answer =
          answers.shift() ??
          (action === "ensure"
            ? Response.json(ensureReply(claims.origin ?? "", `token-${(ensures += 1)}`))
            : Response.json({ removed: true }));
        return HttpClientResponse.fromWeb(request, answer);
      }).pipe(Effect.orDie),
    );

    const connectors: Array<(status: CloudflaredStatus) => Effect.Effect<void>> = [];
    const refusals: Array<Effect.Effect<void>> = [];
    const runTunnel = (
      runOptions: Parameters<Parameters<typeof makeReachService>[0]["runTunnel"]>[0],
    ) =>
      Effect.gen(function* () {
        // The real runner writes the token file owner-only before it starts the child.
        if (runOptions.tokenFile !== undefined) {
          yield* fs.makeDirectory(path.dirname(runOptions.tokenFile), { recursive: true });
          yield* fs.writeFileString(runOptions.tokenFile, runOptions.token, { mode: 0o600 });
        }
        connectors.push(runOptions.onStatus);
        refusals.push(runOptions.onTokenRefused ?? Effect.die(new Error("no refusal handler")));
        yield* runOptions.onStatus({
          state: "connected",
          message: null,
          metricsPort: 20_240 + connectors.length,
        });
        yield* Queue.offer(events, {
          kind: "start",
          token: runOptions.token,
          tokenFile: runOptions.tokenFile,
        });
        return yield* Effect.never;
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            const enabledOnDisk = yield* Effect.map(sidecar, (value) =>
              value === null ? null : (value as { enabled: boolean }).enabled,
            );
            if (runOptions.tokenFile !== undefined) yield* fs.remove(runOptions.tokenFile);
            yield* Queue.offer(events, { kind: "stop", token: runOptions.token, enabledOnDisk });
          }).pipe(Effect.orDie),
        ),
        Effect.orDie,
      );

    // The service's sleeps join the event stream, so each step waits for it to settle instead of
    // for time to pass.
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
    const env = options.expiredSignIn
      ? { LOOM_LIBRARY_URL: LIBRARY, LOOM_LIBRARY_CREDENTIAL_FILE: yield* writeExpiredSignIn }
      : (options.env ?? REMOTE);

    const next: Effect.Effect<Event> = Queue.take(events).pipe(
      Effect.flatMap((event) =>
        event.kind === "sleep" && event.millis === LIBRARY_TIMEOUT_MS
          ? next
          : Effect.succeed(event),
      ),
    );

    // The real runner reports a last error and then hands over, from the connector's fiber.
    const refuseTokenOf = (index: number) =>
      Effect.suspend(() =>
        connectors[index]!({
          state: "error",
          message:
            'Register tunnel error from server side error="Unauthorized: Invalid tunnel secret"',
          metricsPort: null,
        }).pipe(Effect.andThen(refusals[index]!)),
      );

    return yield* Effect.gen(function* () {
      const service = yield* makeReachService({ runTunnel, ingressOrigin: Ref.get(origin) });
      return yield* use({
        service,
        answers,
        hold,
        origin,
        route,
        next,
        connectorStatus: (status) => connectors.at(-1)!(status),
        refuseToken: Effect.suspend(() => refuseTokenOf(connectors.length - 1)),
        refuseTokenOf,
        settled: Effect.map(Queue.size(events), (size) => size === 0),
        waitFor: (predicate) =>
          service.changes.pipe(
            Stream.filter(predicate),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
          ),
        sidecar,
        sidecarText,
        tokenFile,
        tokenFileExists: fs.exists(tokenFile).pipe(Effect.orDie),
        logs,
        adjust: (millis) => testClock.adjust(millis),
      });
    }).pipe(
      Effect.provideService(Clock.Clock, clock),
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      Effect.provideService(ReachPublicRoute, ReachPublicRoute.of({ url: route })),
      Effect.provideService(HostProcess.Environment, options.identityEnv ?? {}),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    );
  }).pipe(
    Effect.provideService(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(STUDIO) }),
    Effect.provide(ServerSecretStore.layer),
    // No enrolled computer lives here, so the Library comes from the env.
    Effect.provideServiceEffect(
      HostProcess.HomeDirectory,
      Effect.map(ServerConfig.ServerConfig, (config) => config.baseDir),
    ),
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "reach-service-test-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );

const expectEvent = (h: Harness, expected: Partial<Event>) =>
  Effect.map(h.next, (event) => {
    expect(event).toMatchObject(expected);
    return event;
  });

/** Turns reach on and waits for its first connector, which uses `token-1`. */
const turnOn = (h: Harness) =>
  Effect.gen(function* () {
    yield* h.service.setEnabled(true);
    yield* expectEvent(h, { kind: "request", action: "ensure" });
    yield* expectEvent(h, { kind: "start", token: "token-1" });
  });

describe("reachIngressOrigin", () => {
  it("names the loopback form of the address the server bound", () => {
    expect(reachIngressOrigin(NetAddress.inetAddressFromIpStringUnsafe("::1", 3773))).toBe(
      "http://[::1]:3773",
    );
    expect(reachIngressOrigin(NetAddress.inetAddressFromIpStringUnsafe("0.0.0.0", 3773))).toBe(
      "http://127.0.0.1:3773",
    );
    expect(reachIngressOrigin(NetAddress.inetAddressFromIpStringUnsafe("::", 3773))).toBe(
      "http://127.0.0.1:3773",
    );
    expect(reachIngressOrigin(NetAddress.unixPathAddress("/tmp/t3.sock"))).toBeNull();
  });

  it("names nothing for a server bound to one address that is not that loopback", () => {
    for (const ip of ["192.168.1.5", "100.64.0.5", "127.0.0.2", "fd7a:115c:a1e0::1"]) {
      expect(reachIngressOrigin(NetAddress.inetAddressFromIpStringUnsafe(ip, 3773)), ip).toBeNull();
    }
  });
});

describe("ReachService", () => {
  it.effect(
    "starts the connector only once the Library confirms, keeping its token out of sight",
    () =>
      withReach({}, (h) =>
        Effect.gen(function* () {
          expect(yield* h.service.status).toMatchObject({
            state: "off",
            enabled: false,
            url: null,
          });
          const answered = yield* h.service.setEnabled(true);
          expect(answered).toMatchObject({ state: "provisioning", enabled: true, blocked: null });
          expect(yield* h.sidecar).toMatchObject({ enabled: true, removing: false });
          expect(h.service.guardState()).toEqual({ hostname: null, serving: false });

          yield* expectEvent(h, {
            kind: "request",
            action: "ensure",
            seq: NOW,
            origin: ORIGIN,
            tokenFileExists: false,
          });
          yield* expectEvent(h, { kind: "start", token: "token-1", tokenFile: h.tokenFile });

          const status = yield* h.service.status;
          expect(status).toEqual({
            state: "connected",
            enabled: true,
            blocked: null,
            url: URL_,
            message: null,
            warnings: ["identity-off"],
            prepared: null,
          });
          expect(yield* Ref.get(h.route)).toEqual(Option.some(URL_));
          expect(h.service.guardState()).toEqual({ hostname: HOSTNAME, serving: true });
          expect(h.service.ownPorts()).toEqual([20_241]);
          expect(yield* h.sidecar).toEqual({
            version: 1,
            enabled: true,
            removing: false,
            hostname: HOSTNAME,
            lastSeq: NOW,
            prepared: null,
          });
          expect(JSON.stringify(status)).not.toContain("token-1");
          expect(yield* h.sidecarText).not.toContain("token-1");
          expect(h.logs.join("\n")).not.toContain("token-1");
        }),
      ),
  );

  it.effect("sends the [::1] origin when the server bound IPv6 loopback", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        yield* Ref.set(h.origin, "http://[::1]:3773");
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", origin: "http://[::1]:3773" });
        yield* expectEvent(h, { kind: "start", token: "token-1" });
      }),
    ),
  );

  it.effect("asks the Library for nothing while the server does not listen on loopback", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        yield* Ref.set(h.origin, null);
        yield* h.service.setEnabled(true);
        expect(yield* h.waitFor((status) => status.state === "error")).toMatchObject({
          enabled: true,
          message:
            "Reach needs Loom's server to listen on 127.0.0.1, ::1 or every address on this computer.",
        });
        yield* Ref.set(h.origin, ORIGIN);
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", origin: ORIGIN });
        yield* expectEvent(h, { kind: "start", token: "token-1" });
      }),
    ),
  );

  it.effect("restarts the connector with each fresh token, after the old one is gone", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        yield* turnOn(h);
        // An ensure that is already connected has nothing to do.
        expect(yield* h.service.setEnabled(true)).toMatchObject({ state: "connected" });

        yield* h.connectorStatus({
          state: "error",
          message: "cloudflared exited",
          metricsPort: null,
        });
        expect(yield* h.service.status).toMatchObject({
          state: "error",
          message: "cloudflared exited",
        });
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", action: "ensure", seq: NOW + 1 });
        yield* expectEvent(h, { kind: "stop", token: "token-1" });
        yield* expectEvent(h, { kind: "start", token: "token-2" });
        expect(yield* h.service.status).toMatchObject({ state: "connected", message: null });
      }),
    ),
  );

  it.effect("removes a token file a crashed run left behind before anything starts", () =>
    withReach({ leftoverTokenFile: true }, (h) =>
      Effect.gen(function* () {
        expect(yield* h.tokenFileExists).toBe(false);
        expect(yield* h.service.status).toMatchObject({ state: "off" });
        // A first run has no record, which is normal and not worth a warning.
        expect(h.logs.join("\n")).not.toContain("unreadable reach state");
      }),
    ),
  );

  it.effect("starts off from a record it cannot read, without printing the record", () =>
    withReach({ sidecar: { version: 2, hostname: "kept-out-of-logs.example.com" } }, (h) =>
      Effect.gen(function* () {
        expect(yield* h.service.status).toMatchObject({ state: "off", enabled: false, url: null });
        expect(h.service.guardState()).toEqual({ hostname: null, serving: false });
        const logs = h.logs.join("\n");
        expect(logs).toContain("Ignoring unreadable reach state; reach starts off");
        expect(logs).not.toContain("kept-out-of-logs");
      }),
    ),
  );

  it.effect(
    "explains a failed retry over the down connector, and stops it when the Library refuses",
    () =>
      withReach({}, (h) =>
        Effect.gen(function* () {
          yield* turnOn(h);
          yield* h.connectorStatus({
            state: "error",
            message: "cloudflared exited",
            metricsPort: null,
          });
          h.answers.push(page(502));
          yield* h.service.setEnabled(true);
          yield* expectEvent(h, { kind: "request", action: "ensure" });
          yield* expectEvent(h, { kind: "sleep", millis: 30_000 });
          expect(yield* h.service.status).toMatchObject({
            state: "error",
            enabled: true,
            message: "Your Library could not be reached. Loom keeps trying.",
          });

          h.answers.push(refusal(409, "not-configured"));
          yield* h.adjust(30_000);
          yield* expectEvent(h, { kind: "request", action: "ensure" });
          yield* expectEvent(h, { kind: "stop", token: "token-1", enabledOnDisk: false });
          expect(yield* h.service.status).toMatchObject({
            state: "unavailable",
            enabled: false,
            blocked: "library-not-ready",
          });
          expect(h.service.guardState().serving).toBe(false);
          expect(yield* Ref.get(h.route)).toEqual(Option.none());
        }),
      ),
  );

  it.effect("treats a reply pointing at another origin as an error and tries again", () =>
    withReach({ answers: [Response.json(ensureReply("http://127.0.0.1:9999", "token-x"))] }, (h) =>
      Effect.gen(function* () {
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", origin: ORIGIN });
        yield* expectEvent(h, { kind: "sleep", millis: 30_000 });
        expect(yield* h.service.status).toMatchObject({ state: "error", enabled: true });
        expect(h.service.guardState().serving).toBe(false);
        expect(h.logs.join("\n")).not.toContain("token-x");

        yield* h.adjust(30_000);
        yield* expectEvent(h, { kind: "request", origin: ORIGIN });
        yield* expectEvent(h, { kind: "start", token: "token-1" });
      }),
    ),
  );

  it.effect("backs off from 30 seconds to 10 minutes while the Library cannot be reached", () =>
    withReach({ answers: Array.from({ length: 7 }, () => page(502)) }, (h) =>
      Effect.gen(function* () {
        yield* h.service.setEnabled(true);
        for (const millis of [0.5, 1, 2, 4, 8, 10, 10].map((minutes) => minutes * MINUTE)) {
          yield* expectEvent(h, { kind: "request", action: "ensure" });
          yield* expectEvent(h, { kind: "sleep", millis });
          expect(yield* h.service.status).toMatchObject({
            state: "error",
            enabled: true,
            message: "Your Library could not be reached. Loom keeps trying.",
            warnings: ["library-unreachable", "identity-off"],
          });
          yield* h.adjust(millis);
        }
        yield* expectEvent(h, { kind: "request", action: "ensure" });
        yield* expectEvent(h, { kind: "start", token: "token-1" });
        expect((yield* h.service.status).warnings).toEqual(["identity-off"]);
        // One warning for the whole outage.
        expect(h.logs.filter((line) => line.includes("Retrying"))).toHaveLength(1);
      }),
    ),
  );

  it.effect("asks again every 15 minutes while the Library refuses the sign-in", () =>
    withReach({ answers: [page(401), page(403)] }, (h) =>
      Effect.gen(function* () {
        yield* h.service.setEnabled(true);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          yield* expectEvent(h, { kind: "request" });
          yield* expectEvent(h, { kind: "sleep", millis: 15 * MINUTE });
          expect(yield* h.service.status).toMatchObject({
            state: "error",
            warnings: ["library-signed-out", "identity-off"],
          });
          yield* h.adjust(15 * MINUTE);
        }
        yield* expectEvent(h, { kind: "request" });
        yield* expectEvent(h, { kind: "start" });
      }),
    ),
  );

  it.effect("waits for the directory, and honors a busy Library's retry time", () =>
    withReach(
      {
        answers: [
          refusal(404, "not-in-directory"),
          refusal(429, "too-many-requests", { retryAfterSeconds: 300 }),
        ],
      },
      (h) =>
        Effect.gen(function* () {
          yield* h.service.setEnabled(true);
          yield* expectEvent(h, { kind: "request" });
          yield* expectEvent(h, { kind: "sleep", millis: 30_000 });
          expect((yield* h.service.status).message).toBe(
            "Waiting for this computer to appear in your Library's directory.",
          );
          yield* h.adjust(30_000);
          yield* expectEvent(h, { kind: "request" });
          yield* expectEvent(h, { kind: "sleep", millis: 300_000 });
          yield* h.adjust(300_000);
          yield* expectEvent(h, { kind: "request" });
          yield* expectEvent(h, { kind: "start" });
        }),
    ),
  );

  it.effect("signs a fresh seq once when the Library calls a request stale", () =>
    withReach({ answers: [refusal(409, "stale-request")] }, (h) =>
      Effect.gen(function* () {
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", seq: NOW });
        yield* expectEvent(h, { kind: "request", seq: NOW + 1 });
        yield* expectEvent(h, { kind: "start" });
      }),
    ),
  );

  it.effect(
    "turns back off when the Library is not set up for reach, and asks again on request",
    () =>
      withReach({ answers: [refusal(409, "not-configured")] }, (h) =>
        Effect.gen(function* () {
          yield* h.service.setEnabled(true);
          yield* expectEvent(h, { kind: "request" });
          const refused = yield* h.waitFor((status) => status.state === "unavailable");
          expect(refused).toMatchObject({ enabled: false, blocked: "library-not-ready" });
          expect(yield* h.sidecar).toMatchObject({ enabled: false });
          expect(h.service.guardState().serving).toBe(false);

          yield* h.service.setEnabled(true);
          yield* expectEvent(h, { kind: "request" });
          yield* expectEvent(h, { kind: "start" });
          expect(yield* h.service.status).toMatchObject({ state: "connected", blocked: null });
        }),
      ),
  );

  it.effect("reports a Library without reach routes as outdated", () =>
    withReach({ answers: [page(404)] }, (h) =>
      Effect.gen(function* () {
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request" });
        expect(yield* h.waitFor((status) => status.state === "unavailable")).toMatchObject({
          enabled: false,
          blocked: "library-outdated",
        });
      }),
    ),
  );

  it.effect("cannot run on the Library itself or without one, and stores nothing", () =>
    Effect.gen(function* () {
      for (const [env, blocked] of [
        [{ LOOM_LIBRARY_AUTHORITY: "true" }, "is-library"],
        [{}, "no-library"],
      ] as const) {
        yield* withReach({ env }, (h) =>
          Effect.gen(function* () {
            expect(yield* h.service.status).toMatchObject({ state: "unavailable", blocked });
            const error = yield* Effect.flip(h.service.setEnabled(true));
            expect(error.reason).toBe("unavailable");
            expect(yield* h.sidecarText).toBeNull();
          }),
        );
      }
    }),
  );

  it.effect("keeps a stored intent while the sign-in is gone and starts nothing", () =>
    withReach(
      {
        expiredSignIn: true,
        sidecar: {
          version: 1,
          enabled: true,
          removing: false,
          hostname: HOSTNAME,
          lastSeq: NOW - 5,
          prepared: null,
        },
      },
      (h) =>
        Effect.gen(function* () {
          expect(yield* h.service.status).toMatchObject({
            state: "unavailable",
            enabled: true,
            blocked: "library-signed-out",
            url: URL_,
          });
          expect((yield* h.service.status).warnings).toContain("library-signed-out");
          expect(h.service.guardState()).toEqual({ hostname: HOSTNAME, serving: false });
        }),
    ),
  );

  it.effect("waits for a Library that is down at start before starting any connector", () =>
    withReach(
      {
        answers: [page(503)],
        sidecar: {
          version: 1,
          enabled: true,
          removing: false,
          hostname: HOSTNAME,
          lastSeq: NOW - 5,
          prepared: null,
        },
      },
      (h) =>
        Effect.gen(function* () {
          yield* expectEvent(h, { kind: "request", action: "ensure", seq: NOW });
          yield* expectEvent(h, { kind: "sleep", millis: 30_000 });
          expect(yield* h.service.status).toMatchObject({ state: "error", enabled: true });
          expect(h.service.guardState()).toEqual({ hostname: HOSTNAME, serving: false });
          expect(yield* Ref.get(h.route)).toEqual(Option.none());
          yield* h.adjust(30_000);
          yield* expectEvent(h, { kind: "request", action: "ensure" });
          yield* expectEvent(h, { kind: "start", token: "token-1" });
        }),
    ),
  );

  it.effect(
    "keeps the Identity values the Library prepared and warns where this computer differs",
    () =>
      withReach(
        {
          identityEnv: {
            LOOM_IDENTITY_ISSUER: "https://id.example.com",
            LOOM_IDENTITY_AUDIENCE: "https://studio.example.com",
            LOOM_IDENTITY_ALLOWED_SUBJECTS: "kyle",
          },
          answers: [
            Response.json(
              ensureReply(ORIGIN, "token-1", {
                identity: {
                  state: "ready",
                  issuer: "https://id.example.com",
                  nativeClientId: "native-client",
                  resource: "https://studio-loom.example.com",
                },
              }),
            ),
          ],
        },
        (h) =>
          Effect.gen(function* () {
            yield* turnOn(h);
            const prepared = {
              issuer: "https://id.example.com",
              nativeClientId: "native-client",
              resource: "https://studio-loom.example.com",
            };
            expect(yield* h.service.status).toMatchObject({
              prepared,
              warnings: ["identity-resource-differs", "passkey-not-required"],
            });
            expect(yield* h.sidecar).toMatchObject({ prepared });
          }),
      ),
  );

  it.effect("turns off by storing the intent first, then withdrawing the route and connector", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        yield* turnOn(h);
        const off = yield* h.service.setEnabled(false);
        expect(off).toMatchObject({ state: "off", enabled: false, url: URL_ });
        expect(yield* Ref.get(h.route)).toEqual(Option.none());
        expect(h.service.guardState()).toEqual({ hostname: HOSTNAME, serving: false });
        yield* expectEvent(h, { kind: "stop", token: "token-1", enabledOnDisk: false });
        expect(yield* h.tokenFileExists).toBe(false);
      }),
    ),
  );

  it.effect("never starts a connector for an ensure that turning off interrupted", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        yield* Ref.set(h.hold, release);
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", action: "ensure" });
        yield* h.service.setEnabled(false);
        yield* Ref.set(h.hold, null);
        yield* Deferred.succeed(release, undefined);

        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", action: "ensure" });
        // The first ensure was never answered, so this connector's token is the first one handed out.
        yield* expectEvent(h, { kind: "start", token: "token-1" });
      }),
    ),
  );

  it.effect("removes by stopping the connector and its token file before asking the Library", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        yield* turnOn(h);
        const removing = yield* h.service.remove();
        expect(removing).toMatchObject({ state: "removing", enabled: false });
        expect(yield* h.sidecar).toMatchObject({ enabled: false, removing: true });
        yield* expectEvent(h, { kind: "stop", token: "token-1" });
        yield* expectEvent(h, { kind: "request", action: "remove", tokenFileExists: false });
        const removed = yield* h.waitFor((status) => status.state === "off");
        expect(removed).toMatchObject({ enabled: false, url: null });
        expect(yield* h.sidecar).toEqual({
          version: 1,
          enabled: false,
          removing: false,
          hostname: null,
          lastSeq: NOW + 1,
          prepared: null,
        });
        expect(h.service.guardState()).toEqual({ hostname: null, serving: false });
      }),
    ),
  );

  it.effect("resumes a stored removal after a restart and refuses to turn on until it ends", () =>
    withReach(
      {
        answers: [page(401)],
        sidecar: {
          version: 1,
          enabled: false,
          removing: true,
          hostname: HOSTNAME,
          lastSeq: NOW - 5,
          prepared: null,
        },
      },
      (h) =>
        Effect.gen(function* () {
          yield* expectEvent(h, { kind: "request", action: "remove", seq: NOW });
          yield* expectEvent(h, { kind: "sleep", millis: 15 * MINUTE });
          expect(yield* h.service.status).toMatchObject({
            state: "removing",
            message:
              "Sign this computer in to its Library again, then restart Loom to finish removing reach.",
            warnings: ["library-signed-out"],
          });
          const busy = yield* Effect.flip(h.service.setEnabled(true));
          expect(busy.reason).toBe("busy");

          yield* h.adjust(15 * MINUTE);
          yield* expectEvent(h, { kind: "request", action: "remove" });
          expect(yield* h.waitFor((status) => status.state === "off")).toMatchObject({
            url: null,
            message: null,
          });
        }),
    ),
  );

  it.effect("forgets a removal the Library cannot confirm, and turns on again normally", () =>
    withReach(
      {
        answers: [page(404)],
        sidecar: {
          version: 1,
          enabled: false,
          removing: true,
          hostname: HOSTNAME,
          lastSeq: NOW - 5,
          prepared: null,
        },
      },
      (h) =>
        Effect.gen(function* () {
          yield* expectEvent(h, { kind: "request", action: "remove", seq: NOW });
          yield* expectEvent(h, { kind: "sleep", millis: 15 * MINUTE });
          expect(yield* h.service.status).toMatchObject({
            state: "removing",
            message: "Update Loom on your Library to finish removing reach.",
          });

          const forgotten = yield* h.service.forget();
          expect(forgotten).toEqual({
            state: "off",
            enabled: false,
            blocked: null,
            url: null,
            message: null,
            warnings: [],
            prepared: null,
          });
          // The signed seq survives, so the Library never sees a replayed one.
          expect(yield* h.sidecar).toEqual({
            version: 1,
            enabled: false,
            removing: false,
            hostname: null,
            lastSeq: NOW,
            prepared: null,
          });
          expect(h.service.guardState()).toEqual({ hostname: null, serving: false });
          // The removal's retry was interrupted, so the Library is never asked again.
          yield* h.adjust(15 * MINUTE);
          expect(yield* h.settled).toBe(true);

          yield* h.service.setEnabled(true);
          const ensure = yield* expectEvent(h, { kind: "request", action: "ensure" });
          expect(ensure.kind === "request" && ensure.seq > NOW).toBe(true);
          yield* expectEvent(h, { kind: "start", token: "token-1" });
          expect(yield* h.service.status).toMatchObject({ state: "connected", url: URL_ });
        }),
    ),
  );

  it.effect("forgets a removal with no Library left to ask, which stays forgotten", () =>
    Effect.gen(function* () {
      const removing = {
        version: 1,
        enabled: false,
        removing: true,
        hostname: HOSTNAME,
        lastSeq: NOW - 5,
        prepared: null,
      };
      yield* withReach({ env: {}, sidecar: removing }, (h) =>
        Effect.gen(function* () {
          expect(yield* h.service.status).toMatchObject({ state: "removing", url: URL_ });
          expect((yield* Effect.flip(h.service.setEnabled(true))).reason).toBe("busy");
          expect(yield* h.service.forget()).toMatchObject({
            state: "unavailable",
            enabled: false,
            blocked: "no-library",
            url: null,
          });
          expect(yield* h.sidecar).toMatchObject({ removing: false, hostname: null });
        }),
      );
    }),
  );

  it.effect(
    "turns reach off for good when the edge keeps refusing the token, until it is turned on",
    () =>
      withReach({}, (h) =>
        Effect.gen(function* () {
          yield* turnOn(h);
          yield* h.refuseToken;
          yield* expectEvent(h, { kind: "stop", token: "token-1", enabledOnDisk: false });
          const retired = yield* h.service.status;
          expect(retired).toEqual({
            state: "off",
            enabled: false,
            blocked: null,
            url: null,
            message:
              "Your Library retired this computer's address, or another copy of this computer took it over. Turn reach on to get an address again.",
            warnings: ["retired"],
            prepared: null,
          });
          expect(yield* h.sidecar).toMatchObject({
            enabled: false,
            hostname: null,
            retired: true,
          });
          expect(yield* Ref.get(h.route)).toEqual(Option.none());
          expect(h.service.guardState()).toEqual({ hostname: null, serving: false });
          // Nothing asks the Library again by itself, since that would undo a Retire.
          yield* h.adjust(60 * MINUTE);
          expect(yield* h.settled).toBe(true);

          yield* h.service.setEnabled(true);
          yield* expectEvent(h, { kind: "request", action: "ensure" });
          yield* expectEvent(h, { kind: "start", token: "token-2" });
          expect(yield* h.service.status).toMatchObject({ state: "connected", url: URL_ });
          expect((yield* h.service.status).warnings).not.toContain("retired");
          expect(yield* h.sidecar).not.toHaveProperty("retired");
        }),
      ),
  );

  it.effect("keeps a retired address off after a restart, and turning off clears its notice", () =>
    withReach(
      {
        sidecar: {
          version: 1,
          enabled: false,
          removing: false,
          hostname: null,
          lastSeq: NOW - 5,
          prepared: null,
          retired: true,
        },
      },
      (h) =>
        Effect.gen(function* () {
          expect(yield* h.service.status).toMatchObject({ state: "off", warnings: ["retired"] });
          yield* h.adjust(60 * MINUTE);
          expect(yield* h.settled).toBe(true);
          expect(yield* h.service.setEnabled(false)).toMatchObject({
            state: "off",
            message: null,
            warnings: [],
          });
          expect(yield* h.sidecar).not.toHaveProperty("retired");
        }),
    ),
  );

  it.effect("lets a fresh ensure replace a refused connector instead of turning reach off", () =>
    withReach({}, (h) =>
      Effect.gen(function* () {
        yield* turnOn(h);
        yield* h.connectorStatus({ state: "error", message: "Unauthorized", metricsPort: null });
        const release = yield* Deferred.make<void>();
        yield* Ref.set(h.hold, release);
        yield* h.service.setEnabled(true);
        yield* expectEvent(h, { kind: "request", action: "ensure" });
        yield* h.refuseToken;
        expect(yield* h.service.status).toMatchObject({ enabled: true });
        expect(yield* h.sidecar).not.toHaveProperty("retired");

        yield* Ref.set(h.hold, null);
        yield* Deferred.succeed(release, undefined);
        yield* expectEvent(h, { kind: "stop", token: "token-1" });
        yield* expectEvent(h, { kind: "start", token: "token-2" });
        expect(yield* h.service.status).toMatchObject({
          state: "connected",
          warnings: ["identity-off"],
        });

        // The replaced connector's refusal arrives late, and only that old token is dead.
        yield* h.refuseTokenOf(0);
        expect(yield* h.service.status).toMatchObject({
          state: "connected",
          enabled: true,
          url: URL_,
          warnings: ["identity-off"],
        });
        expect(yield* h.sidecar).toMatchObject({ enabled: true, hostname: HOSTNAME });
        expect(yield* h.sidecar).not.toHaveProperty("retired");
        expect(yield* h.settled).toBe(true);
      }),
    ),
  );
});
