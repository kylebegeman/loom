import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { LIBRARY_PUBLISHER_RENEW_ROUTE } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Connection from "./LibraryConnection.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const DAY = 86400000;
const iso = (time: number) => DateTime.formatIso(DateTime.makeUnsafe(time));
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decode = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const initial = {
  version: 1,
  sourceEnvironmentId: "source",
  libraryEnvironmentId: "library",
  libraryUrl: "https://library.example.test",
  sessionId: "before",
  accessToken: "before-token",
  issuedAt: iso(NOW - 20 * DAY),
  expiresAt: iso(NOW + 10 * DAY),
  computer: {
    environmentId: "source",
    label: "Source",
    platform: { os: "darwin", arch: "arm64" },
    appVersion: "1",
    supportsExecution: true,
    endpoints: [],
  },
};
const successor = {
  sessionId: "after",
  accessToken: "after-token",
  issuedAt: iso(NOW),
  expiresAt: iso(NOW + 30 * DAY),
};

const withConnection = <A, E>(
  response: () => Response,
  test: (h: {
    service: Connection.LibraryConnectionService["Service"];
    file: string;
    requests: HttpClientRequest.HttpClientRequest[];
    replace: (value: unknown) => Effect.Effect<void, PlatformError.PlatformError>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
  credential: unknown = initial,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const file = `${config.baseDir}/publisher.json`;
    yield* fs.writeFileString(file, encode(credential), { mode: 0o600 });
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request);
        return HttpClientResponse.fromWeb(
          request,
          request.url.endsWith(LIBRARY_PUBLISHER_RENEW_ROUTE)
            ? response()
            : Response.json({ ok: true }),
        );
      }),
    );
    return yield* Effect.gen(function* () {
      const service = yield* Connection.LibraryConnectionService;
      return yield* test({
        service,
        file,
        requests,
        replace: (value) => fs.writeFileString(file, encode(value), { mode: 0o600 }),
      });
    }).pipe(
      Effect.provide(Connection.layer),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_CREDENTIAL_FILE: file } }),
      ),
      Effect.provideService(HostProcess.HomeDirectory, config.baseDir),
      Effect.provideService(ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("source")),
      }),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "connection-renewal-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

it.effect(
  "renews at two thirds, saves privately, preserves enrollment and uses the successor without restart",
  () =>
    withConnection(
      () => Response.json(successor),
      (h) =>
        Effect.gen(function* () {
          yield* Effect.all([h.service.current, h.service.current], { concurrency: "unbounded" });
          expect(
            h.requests.filter((r) => r.url.endsWith(LIBRARY_PUBLISHER_RENEW_ROUTE)),
          ).toHaveLength(1);
          const fs = yield* FileSystem.FileSystem;
          expect(decode(yield* fs.readFileString(h.file))).toMatchObject({
            ...successor,
            computer: initial.computer,
          });
          expect((yield* fs.stat(h.file)).mode & 0o777).toBe(0o600);
          yield* h.service.send(HttpClientRequest.post("/api/loom/directory/list"));
          expect(h.requests.at(-1)?.headers.authorization).toBe("Bearer after-token");
          expect(yield* h.service.status).toMatchObject({
            state: "ready",
            renewal: "automatic",
            expiresAt: successor.expiresAt,
          });
        }),
    ),
);
it.effect("keeps an old Library's credential, warns in status and bounds retries", () =>
  withConnection(
    () => new Response("Not found", { status: 404 }),
    (h) =>
      Effect.gen(function* () {
        expect(yield* h.service.status).toMatchObject({
          state: "expiring",
          renewal: "unsupported",
        });
        yield* h.service.send(HttpClientRequest.post("/api/loom/directory/list"));
        expect(h.requests.at(-1)?.headers.authorization).toBe("Bearer before-token");
        expect(
          h.requests.filter((r) => r.url.endsWith(LIBRARY_PUBLISHER_RENEW_ROUTE)),
        ).toHaveLength(1);
      }),
  ),
);
it.effect(
  "reloads an expired sign-in after replacement and refuses another computer's credential",
  () =>
    withConnection(
      () => Response.json(successor),
      (h) =>
        Effect.gen(function* () {
          expect((yield* h.service.status).state).toBe("expired");
          expect((yield* h.service.current).kind).toBe("unavailable");
          expect(h.requests).toHaveLength(0);
          yield* h.replace({ ...initial, ...successor });
          yield* h.service.send(HttpClientRequest.post("/api/loom/directory/list"));
          expect(h.requests.at(-1)?.headers.authorization).toBe("Bearer after-token");
          yield* h.replace({ ...initial, ...successor, sourceEnvironmentId: "someone-else" });
          expect(
            (yield* Effect.result(
              h.service.send(HttpClientRequest.post("/api/loom/directory/list")),
            ))._tag,
          ).toBe("Failure");
          expect(h.requests).toHaveLength(1);
        }),
      { ...initial, expiresAt: iso(NOW - 1) },
    ),
);

it.effect("uses the signed issuance time in older enrollment files", () =>
  withConnection(
    () => Response.json(successor),
    (h) =>
      Effect.gen(function* () {
        expect((yield* h.service.status).state).toBe("ready");
        expect(h.requests).toHaveLength(0);
        yield* TestClock.adjust("1 day");
        expect((yield* h.service.status).expiresAt).toBe(successor.expiresAt);
        expect(h.requests).toHaveLength(1);
      }),
    {
      ...initial,
      issuedAt: undefined,
      expiresAt: iso(NOW + 3 * DAY),
      accessToken: Buffer.from(encode({ iat: NOW - 4 * DAY })).toString("base64url") + ".signature",
    },
  ),
);
