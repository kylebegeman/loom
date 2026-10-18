import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const privateToken = "synthetic-service-token";
const privateValue = "synthetic-account-password";
const withStore = <A, E>(
  use: (fixture: {
    store: OpenBaoStore.OpenBaoStore["Service"];
    requests: Array<HttpClientRequest.HttpClientRequest>;
    tokenFile: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
  options: {
    origin?: string;
    mode?: number;
    disabled?: boolean;
    reply?: (request: HttpClientRequest.HttpClientRequest) => readonly [number, unknown];
  } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-vault-store-test-" });
    const tokenFile = directory + "/token";
    yield* fs.writeFileString(tokenFile, privateToken);
    yield* fs.chmod(tokenFile, options.mode ?? 0o600);
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    const http = HttpClient.make((request) => {
      requests.push(request);
      const [status, body] = options.reply?.(request) ?? [
        200,
        request.url.endsWith("/health")
          ? { initialized: true, sealed: false }
          : { data: { cas_required: true } },
      ];
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status })));
    });
    const store = yield* OpenBaoStore.OpenBaoStore.pipe(
      Effect.provide(OpenBaoStore.layer),
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(
        HostProcess.Environment,
        options.disabled
          ? {}
          : {
              LOOM_VAULT_OPENBAO_URL: options.origin ?? "https://vault.example.test",
              LOOM_VAULT_OPENBAO_TOKEN_FILE: tokenFile,
            },
      ),
      Effect.provideService(HostProcess.Platform, "darwin"),
    );
    return yield* use({ store, requests, tokenFile });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("does no backend work until configured", () =>
  withStore(
    ({ store, requests }) =>
      Effect.gen(function* () {
        expect(yield* store.status).toEqual({
          backend: "openbao",
          state: "unconfigured",
          origin: null,
        });
        expect((yield* store.read("items/example").pipe(Effect.flip)).reason).toBe("configuration");
        expect(requests).toHaveLength(0);
      }),
    { disabled: true },
  ),
);

it.effect.each([
  "http://vault.example.test",
  "https://user:password@vault.example.test",
  "https://vault.example.test/path",
  "https://vault.example.test?token=private",
])("rejects unsafe or ambiguous backend origin %s", (origin) =>
  withStore(
    ({ store, requests }) =>
      Effect.gen(function* () {
        expect((yield* store.status).state).toBe("misconfigured");
        expect(requests).toHaveLength(0);
      }),
    { origin },
  ),
);

it.effect("requires a private token file and accepts loopback HTTP for isolated tests", () =>
  withStore(
    ({ store, requests }) =>
      Effect.gen(function* () {
        expect((yield* store.status).state).toBe("misconfigured");
        expect(requests).toHaveLength(0);
      }),
    { origin: "http://127.0.0.1:8200", mode: 0o644 },
  ),
);

it.effect("checks engine seal state and the KV v2 mount", () =>
  withStore(({ store, requests }) =>
    Effect.gen(function* () {
      expect((yield* store.status).state).toBe("ready");
      expect(requests.map((r) => r.url)).toEqual([
        "https://vault.example.test/v1/sys/health",
        "https://vault.example.test/v1/loom/config",
      ]);
      expect(requests.every((r) => r.headers.authorization === `Bearer ${privateToken}`)).toBe(
        true,
      );
      expect(JSON.stringify(requests)).not.toContain(privateToken);
    }),
  ),
);

it.effect("reports sealed and denied backends distinctly", () =>
  Effect.gen(function* () {
    yield* withStore(
      ({ store }) =>
        Effect.gen(function* () {
          expect((yield* store.status).state).toBe("locked");
        }),
      { reply: () => [503, { initialized: true, sealed: true }] },
    );
    yield* withStore(
      ({ store }) =>
        Effect.gen(function* () {
          expect((yield* store.status).state).toBe("denied");
        }),
      { reply: () => [403, { errors: ["permission denied"] }] },
    );
  }),
);

it.effect("keeps secret response data redacted and versions explicit", () =>
  withStore(
    ({ store }) =>
      Effect.gen(function* () {
        const record = yield* store.read("items/example");
        expect(record?.version).toBe(4);
        expect(Redacted.value(record!.value)).toEqual({ password: privateValue });
        expect(JSON.stringify(record)).not.toContain(privateValue);
      }),
    {
      reply: () => [200, { data: { data: { password: privateValue }, metadata: { version: 4 } } }],
    },
  ),
);

it.effect("writes CAS requests without exposing secret bodies to request inspection", () =>
  withStore(
    ({ store, requests }) =>
      Effect.gen(function* () {
        expect(
          yield* store.write("items/example", Redacted.make({ password: privateValue }), 3),
        ).toBe(4);
        const request = requests[0]!;
        expect(JSON.stringify(request)).not.toContain(privateValue);
        expect(JSON.stringify(request)).not.toContain(privateToken);
        expect(request.body._tag).toBe("Stream");
        if (request.body._tag !== "Stream") throw new Error("Expected protected stream body");
        const chunks = yield* Stream.runCollect(request.body.stream.pipe(Stream.orDie));
        const content = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
        expect(JSON.parse(content)).toEqual({
          options: { cas: 3 },
          data: { password: privateValue },
        });
      }),
    { reply: () => [200, { data: { version: 4 } }] },
  ),
);

it.effect("maps stale CAS writes to conflict without returning the provider's response", () =>
  withStore(
    ({ store }) =>
      Effect.gen(function* () {
        const failure = yield* store
          .write("items/example", Redacted.make({ password: privateValue }), 3)
          .pipe(Effect.flip);
        expect(failure.reason).toBe("conflict");
        expect(JSON.stringify(failure)).not.toContain(privateValue);
      }),
    { reply: () => [400, { errors: [`check-and-set parameter did not match; ${privateValue}`] }] },
  ),
);

it.effect("rejects malformed payloads without including their secret values in errors", () =>
  withStore(
    ({ store }) =>
      Effect.gen(function* () {
        const failure = yield* store.read("items/example").pipe(Effect.flip);
        expect(failure.reason).toBe("invalid-response");
        expect(JSON.stringify(failure)).not.toContain(privateValue);
      }),
    {
      reply: () => [
        200,
        { data: { data: { password: privateValue }, metadata: { version: "bad" } } },
      ],
    },
  ),
);

it.effect("bounds metadata enumeration and rejects path traversal before authentication", () =>
  withStore(
    ({ store, requests }) =>
      Effect.gen(function* () {
        expect((yield* store.read("items/../token").pipe(Effect.flip)).reason).toBe(
          "invalid-input",
        );
        expect(requests).toHaveLength(0);
        expect(yield* store.keys("items")).toEqual(["a", "b"]);
      }),
    { reply: () => [200, { data: { keys: ["a", "b"] } }] },
  ),
);

it.effect("re-reads a rotated service token instead of caching expired credentials", () =>
  withStore(
    ({ store, requests, tokenFile }) =>
      Effect.gen(function* () {
        yield* store.read("items/example");
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(tokenFile, "replacement-service-token");
        yield* store.read("items/example");
        expect(requests[1]!.headers.authorization).toBe("Bearer replacement-service-token");
      }),
    { reply: () => [404, {}] },
  ),
);
