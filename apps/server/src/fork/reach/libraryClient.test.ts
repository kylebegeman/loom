import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  LibraryError,
  type ReachAction,
  ReachError,
  ReachRequestBody,
  type ReachRequestClaims,
} from "@t3tools/contracts/fork";
import { verifyReachRequest } from "@t3tools/shared/fork/reach";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { type HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { makeReachLibraryClient, type RemoteLibrary } from "./libraryClient.ts";

const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const LIBRARY = "https://library.example.com";
const STUDIO = "environment-studio";
const ORIGIN = "http://127.0.0.1:3773";
const TOKEN = "connector-token-secret";
const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(ReachRequestBody));
const isLibraryError = Schema.is(LibraryError);

const ensureReply = (origin = ORIGIN, hostname = "studio-loom.example.com") => ({
  hostname,
  url: `https://${hostname}/`,
  origin,
  connectorToken: TOKEN,
  edge: { allowlist: "ready", rateLimit: "ready" },
  identity: { state: "not-configured" },
});

interface Sent {
  readonly path: string;
  readonly claims: ReachRequestClaims;
  /** The `seq` saved when this request left. */
  readonly savedSeq: number;
}

type Answer = Response | LibraryError;

const withClient = <A, E>(
  answers: ReadonlyArray<Answer>,
  use: (harness: {
    readonly client: ReturnType<typeof makeReachLibraryClient>;
    readonly sent: ReadonlyArray<Sent>;
    readonly logs: ReadonlyArray<string>;
    readonly failSave: (fail: boolean) => void;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const queue = [...answers];
    const sent: Array<Sent> = [];
    const logs: Array<string> = [];
    let lastSeq = 0;
    let saveFails = false;
    const send = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const posted = decodeBody(
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        );
        const path = new URL(request.url).pathname;
        const claims = yield* verifyReachRequest({
          publicKey: posted.publicKey,
          token: posted.token,
          environmentId: STUDIO,
          audience: LIBRARY,
          action: (path.endsWith("/ensure") ? "ensure" : "remove") satisfies ReachAction,
          nowEpochSeconds: (yield* Clock.currentTimeMillis) / 1000,
        }).pipe(Effect.orDie);
        sent.push({ path, claims, savedSeq: lastSeq });
        const answer = queue.shift() ?? Response.json(ensureReply());
        if (isLibraryError(answer)) return yield* answer;
        return HttpClientResponse.fromWeb(request, answer);
      });
    const library: RemoteLibrary = {
      kind: "remote",
      credential: null,
      origin: LIBRARY,
      endpoint: (path) => new URL(path, LIBRARY).toString(),
      send,
    };
    const client = makeReachLibraryClient({
      library,
      environmentId: STUDIO,
      secrets,
      lastSeq: () => lastSeq,
      saveSeq: (seq) =>
        saveFails
          ? Effect.fail(new ReachError({ reason: "storage" }))
          : Effect.sync(() => {
              lastSeq = seq;
            }),
    });
    const logger = Logger.make(({ message }) => {
      logs.push(JSON.stringify(message));
    });
    return yield* use({
      client,
      sent,
      logs,
      failSave: (fail) => {
        saveFails = fail;
      },
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  }).pipe(
    Effect.provide(
      ServerSecretStore.layer.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "reach-library-client-test-" }),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const html = (status: number) =>
  new Response("<html>Library</html>", { status, headers: { "content-type": "text/html" } });

describe("makeReachLibraryClient", () => {
  it.effect("signs action, seq and origin, saving each strictly larger seq before it leaves", () =>
    withClient([], (h) =>
      Effect.gen(function* () {
        const first = yield* h.client.ensure(ORIGIN);
        expect(first).toMatchObject({ kind: "ok", reply: { connectorToken: TOKEN } });
        // Same clock reading: the next seq still grows.
        yield* h.client.ensure(ORIGIN);
        yield* h.client.remove();
        expect(h.sent.map(({ path, claims, savedSeq }) => ({ path, claims, savedSeq }))).toEqual([
          {
            path: "/api/loom/reach/ensure",
            claims: { action: "ensure", seq: NOW, origin: ORIGIN },
            savedSeq: NOW,
          },
          {
            path: "/api/loom/reach/ensure",
            claims: { action: "ensure", seq: NOW + 1, origin: ORIGIN },
            savedSeq: NOW + 1,
          },
          {
            path: "/api/loom/reach/remove",
            claims: { action: "remove", seq: NOW + 2 },
            savedSeq: NOW + 2,
          },
        ]);
      }),
    ),
  );

  it.effect("sends nothing when the seq cannot be saved", () =>
    withClient([], (h) =>
      Effect.gen(function* () {
        h.failSave(true);
        expect(yield* h.client.ensure(ORIGIN)).toEqual({ kind: "storage" });
        expect(h.sent).toEqual([]);
      }),
    ),
  );

  it.effect("retries a stale-request refusal once, with a fresh seq", () =>
    withClient(
      [
        Response.json({ reason: "stale-request" }, { status: 409 }),
        Response.json({ removed: true }),
        Response.json({ reason: "stale-request" }, { status: 409 }),
        Response.json({ reason: "stale-request" }, { status: 409 }),
      ],
      (h) =>
        Effect.gen(function* () {
          expect(yield* h.client.remove()).toEqual({ kind: "ok", reply: { removed: true } });
          expect(h.sent.map((sent) => sent.claims.seq)).toEqual([NOW, NOW + 1]);
          expect(yield* h.client.remove()).toEqual({
            kind: "refused",
            reason: "stale-request",
            retryAfterSeconds: null,
          });
          expect(h.sent).toHaveLength(4);
        }),
    ),
  );

  it.effect("tells refusals, an older Library, a lost sign-in and transport failures apart", () =>
    withClient(
      [
        Response.json({ reason: "not-in-directory" }, { status: 404 }),
        html(404),
        Response.json({ reason: "too-many-requests", retryAfterSeconds: 90 }, { status: 429 }),
        html(401),
        new LibraryError({ reason: "blocked" }),
        new LibraryError({ reason: "io" }),
        html(502),
        html(200),
        Response.json({ hostname: "studio-loom.example.com" }),
        Response.json(ensureReply("http://127.0.0.1:9999")),
        Response.json(ensureReply(ORIGIN, "studio-loom")),
      ],
      (h) =>
        Effect.gen(function* () {
          const outcomes = [];
          for (let index = 0; index < 11; index += 1) {
            outcomes.push(yield* h.client.ensure(ORIGIN));
          }
          expect(outcomes).toEqual([
            { kind: "refused", reason: "not-in-directory", retryAfterSeconds: null },
            { kind: "outdated" },
            { kind: "refused", reason: "too-many-requests", retryAfterSeconds: 90 },
            { kind: "signed-out" },
            { kind: "signed-out" },
            { kind: "io" },
            { kind: "io" },
            { kind: "io" },
            { kind: "invalid" },
            // The Library pointed the tunnel somewhere this server does not listen.
            { kind: "invalid" },
            { kind: "invalid" },
          ]);
          expect(h.logs.join("\n")).toContain("http://127.0.0.1:9999");
          expect(h.logs.join("\n")).not.toContain(TOKEN);
        }),
    ),
  );
});
