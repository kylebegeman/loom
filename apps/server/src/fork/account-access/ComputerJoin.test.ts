import * as PlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_BEGIN,
  ACCOUNT_JOIN_REDEEM,
  ACCOUNT_JOIN_FEATURE,
  AccountJoinRequest,
  AccountJoinRedemption,
  LibraryError,
  type AccountJoinReview,
} from "@t3tools/contracts/fork";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { AccountEnrollment } from "./AccountEnrollment.ts";
import * as Join from "./ComputerJoin.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const SOURCE = EnvironmentId.make("source");
const LIBRARY = EnvironmentId.make("library");
const URL = "https://library.example.test";
const KEY = "MCowBQYDK2VwAyEAQdoliIUulqccKilgyRKYg36Kg2GVgNmG3Tzd+jKU8Ng=";
const FINGERPRINT = keyFingerprint(decodeEd25519PublicKey(KEY)!);
const decodeRequest = Schema.decodeSync(Schema.fromJsonString(AccountJoinRequest));
const encodeRedemption = Schema.encodeSync(AccountJoinRedemption);
const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(NOW);
  const requests: string[] = [],
    began: AccountJoinRequest[] = [];
  const installs: string[] = [];
  let loseBeginReply = true,
    loseInstallReply = true,
    approved = false,
    wrongLibrary = false;
  const open = Join.ComputerJoin.pipe(
    Effect.provide(
      Join.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(SOURCE) }),
            Layer.mock(AccountEnrollment)({
              prepare: (input) =>
                Effect.succeed({
                  ...input,
                  environmentId: SOURCE,
                  request: { token: "fresh-report", publicKey: KEY },
                }),
              install: (input) =>
                Effect.suspend(() => {
                  installs.push(input.requestId);
                  if (loseInstallReply) {
                    loseInstallReply = false;
                    return Effect.fail(new LibraryError({ reason: "io" }));
                  }
                  return Effect.void;
                }),
            }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.sync(() => {
                  requests.push(request.url);
                  if (request.method === "GET")
                    return HttpClientResponse.fromWeb(
                      request,
                      Response.json({
                        environmentId: wrongLibrary ? "different-library" : LIBRARY,
                        label: "Account",
                        serverVersion: "1.0.0",
                        platform: { os: "linux", arch: "x64" },
                        capabilities: {
                          libraryAuthority: true,
                          loomFeatures: [ACCOUNT_JOIN_FEATURE],
                        },
                      }),
                    );
                  if (request.body._tag !== "Uint8Array")
                    throw new Error("Expected a JSON request");
                  const body = decodeRequest(new TextDecoder().decode(request.body.body));
                  const review: AccountJoinReview = {
                    requestId: body.proof.requestId,
                    code: "ABCDE-12345",
                    environmentId: SOURCE,
                    label: "New server",
                    keyFingerprint: FINGERPRINT,
                    expiresAt: NOW + 15 * 60000,
                    state: approved ? "approved" : "pending",
                  };
                  if (request.url.endsWith(ACCOUNT_JOIN_BEGIN)) {
                    began.push(body);
                    if (loseBeginReply) {
                      loseBeginReply = false;
                      return HttpClientResponse.fromWeb(
                        request,
                        new Response(null, { status: 503 }),
                      );
                    }
                    return HttpClientResponse.fromWeb(request, Response.json(review));
                  }
                  expect(request.url).toBe(`${URL}${ACCOUNT_JOIN_REDEEM}`);
                  return HttpClientResponse.fromWeb(
                    request,
                    Response.json(
                      encodeRedemption(
                        approved
                          ? {
                              state: "approved",
                              enrollment: {
                                requestId: `${body.proof.requestId}:${FINGERPRINT}`,
                                credential: {
                                  version: 1,
                                  sourceEnvironmentId: SOURCE,
                                  libraryEnvironmentId: LIBRARY,
                                  libraryUrl: URL,
                                  sessionId: AuthSessionId.make("publisher"),
                                  accessToken: Redacted.make("machine-publisher"),
                                  expiresAt: DateTime.formatIso(
                                    DateTime.makeUnsafe(NOW + 86400000),
                                  ),
                                },
                                management: {
                                  token: "machine-delegation",
                                  sourceEnvironmentId: SOURCE,
                                  libraryEnvironmentId: LIBRARY,
                                  authorityId: "authority",
                                  authorityEpoch: 1,
                                  keyFingerprint: FINGERPRINT,
                                  expiresAt: NOW + 86400000,
                                },
                              },
                            }
                          : { state: "pending" },
                      ),
                    ),
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  return {
    open,
    began,
    requests,
    installs,
    approve: () => {
      approved = true;
    },
    changeLibrary: () => {
      wrongLibrary = true;
    },
  };
});
const run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "computer-join-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        PlatformCrypto.layer,
        NodeServices.layer,
      ),
    ),
    Effect.scoped,
  );

it.effect(
  "resumes the saved code after lost replies and only installs a reviewed machine credential",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const first = yield* f.open;
        expect(
          (yield* first.start({ libraryUrl: URL, restart: false }).pipe(Effect.result))._tag,
        ).toBe("Failure");
        const restarted = yield* f.open;
        const prompt = yield* restarted.start({ libraryUrl: URL, restart: false });
        expect(prompt.review.code).toBe("ABCDE-12345");
        expect(f.began[0]?.proof.requestId).toBe(f.began[1]?.proof.requestId);
        expect(Redacted.value(f.began[0]!.secret)).toBe(Redacted.value(f.began[1]!.secret));
        expect(yield* restarted.step).toBe("pending");
        expect(f.installs).toEqual([]);
        f.approve();
        expect((yield* restarted.step.pipe(Effect.result))._tag).toBe("Failure");
        const final = yield* f.open;
        expect(yield* final.step).toBe("complete");
        expect(f.installs).toHaveLength(2);
        expect(f.installs[0]).toBe(f.installs[1]);
        const count = f.requests.length;
        expect(yield* final.step).toBe("complete");
        expect((yield* final.start({ libraryUrl: URL, restart: false })).review.code).toBe(
          prompt.review.code,
        );
        expect(f.requests).toHaveLength(count);
        expect(
          (yield* final
            .start({ libraryUrl: "https://other.example.test", restart: false })
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(f.requests).toHaveLength(count);
      }),
    ),
);

it.effect(
  "refuses a changed Library identity and expires approval before another network request",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.open;
        yield* service.start({ libraryUrl: URL, restart: false }).pipe(Effect.result);
        yield* service.start({ libraryUrl: URL, restart: false });
        f.changeLibrary();
        expect(
          (yield* service.start({ libraryUrl: URL, restart: false }).pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(f.began).toHaveLength(2);
        yield* TestClock.adjust("16 minutes");
        const count = f.requests.length;
        expect((yield* service.step.pipe(Effect.flip)).reason).toBe("request-conflict");
        expect(f.requests).toHaveLength(count);
        expect(f.installs).toEqual([]);
      }),
    ),
);
