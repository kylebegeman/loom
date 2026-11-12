import { expect, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  AccountVaultEnvelope,
  AccountVaultRequest,
  LibraryError,
  VaultError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClientRequest, HttpClientResponse } from "effect/http";
import { AccountWorkloads } from "../account-access/AccountWorkloads.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import * as Client from "./AccountVaultClient.ts";

const decodeEnvelope = Schema.decodeUnknownSync(Schema.fromJsonString(AccountVaultEnvelope));
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(AccountVaultRequest));
const THREAD = ThreadId.make("thread");
const request = { kind: "close" as const, input: { sessionId: "a".repeat(32) } };
const fixture = Effect.gen(function* () {
  const state = {
    epoch: 1,
    library: EnvironmentId.make("library"),
    denied: false,
    duringPrepare: () => {},
    status: 200,
    reply: { kind: "close", closed: true } as unknown,
    unavailable: false,
    proofs: 0,
    duringSend: (_envelope: AccountVaultEnvelope) => {},
  };
  const sent: Array<{ payload: string; proof: string }> = [];
  const service = yield* Client.AccountVaultClient.pipe(
    Effect.provide(
      Client.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(AccountWorkloads)({
              prepare: () =>
                Effect.suspend(() => {
                  if (state.denied) return Effect.fail(new VaultError({ reason: "denied" }));
                  state.duringPrepare();
                  return Effect.succeed(`proof-${++state.proofs}`);
                }),
            }),
            Layer.mock(LibraryConnectionService)({
              current: Effect.sync(() => ({
                kind: "remote" as const,
                origin: "https://library.test",
                endpoint: (path: string) => `https://library.test${path}`,
                send: (input: HttpClientRequest.HttpClientRequest) =>
                  Effect.suspend(() => {
                    if (input.body._tag !== "Uint8Array")
                      return Effect.die("Expected a JSON request");
                    const envelope = decodeEnvelope(new TextDecoder().decode(input.body.body));
                    sent.push(envelope);
                    state.duringSend(envelope);
                    if (state.unavailable) return Effect.fail(new LibraryError({ reason: "io" }));
                    return Effect.succeed(
                      HttpClientResponse.fromWeb(
                        input,
                        Response.json(state.reply, { status: state.status }),
                      ),
                    );
                  }),
                credential: {
                  version: 1 as const,
                  sourceEnvironmentId: EnvironmentId.make("source"),
                  libraryEnvironmentId: state.library,
                  libraryUrl: "https://library.test",
                  sessionId: AuthSessionId.make("publisher"),
                  accessToken: Redacted.make("machine-only"),
                  expiresAt: "2027-01-01T00:00:00Z",
                  account: { authorityId: "authority", authorityEpoch: state.epoch },
                },
              })),
            }),
          ),
        ),
      ),
    ),
  );
  return { service, state, sent };
});

it.effect(
  "uses a fresh proof for each account request and preserves broker failures without retry",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.execute(request, THREAD);
      yield* f.service.execute(request, THREAD);
      expect(f.sent[0]?.proof).not.toBe(f.sent[1]?.proof);
      expect(f.sent[0]?.payload).toBe(f.sent[1]?.payload);
      f.state.status = 403;
      f.state.reply = new VaultError({ reason: "denied", detail: "caller-permission" });
      const refusal = yield* f.service.execute(request, THREAD).pipe(Effect.flip);
      expect(refusal).toMatchObject({
        _tag: "VaultError",
        reason: "denied",
        detail: "caller-permission",
      });
      f.state.unavailable = true;
      expect((yield* f.service.execute(request, THREAD).pipe(Effect.flip)).reason).toBe(
        "unavailable",
      );
      expect(f.sent).toHaveLength(4);
    }),
);

it.effect(
  "refuses a changed authority during preparation and malformed or mismatched responses",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.duringPrepare = () => {
        f.state.epoch++;
      };
      expect((yield* f.service.execute(request, THREAD).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.sent).toHaveLength(0);
      f.state.duringPrepare = () => {};
      for (const reply of [
        { kind: "frame", response: "BQ==" },
        { kind: "close", closed: "true" },
      ]) {
        f.state.reply = reply;
        expect((yield* f.service.execute(request, THREAD).pipe(Effect.flip)).reason).toBe(
          "unavailable",
        );
      }
      f.state.denied = true;
      expect((yield* f.service.execute(request, THREAD).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.sent).toHaveLength(2);
    }),
);

it.effect("preserves GitHub results and reports an interrupted write without replaying it", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const input = {
      id: "a".repeat(32),
      expectedVersion: 1,
      repository: "owner/repo",
      operation: { action: "issue-comment" as const, number: 1, body: "Requested comment" },
    };
    const result = {
      account: "loom-bot",
      repository: "owner/repo",
      exitCode: 0,
      stdout: "comment-url",
    };
    f.state.duringSend = ({ payload }) => {
      const request = decodeRequest(payload);
      if (request.kind === "github")
        f.state.reply = { kind: "github", result: { ...result, operationId: request.operationId } };
    };
    expect(yield* f.service.github(input, THREAD)).toMatchObject(result);
    f.state.unavailable = true;
    const interrupted = yield* f.service.github(input, THREAD).pipe(Effect.flip);
    expect(interrupted).toMatchObject({ _tag: "VaultGitHubError", reason: "failed" });
    expect(interrupted).toMatchObject({ operationId: expect.stringMatching(/^[a-f0-9]{32}$/u) });
    expect(interrupted.message).toContain("inspect GitHub before retrying a write");
    expect(f.sent).toHaveLength(2);
    if (interrupted._tag !== "VaultGitHubError" || !interrupted.operationId)
      throw new Error("Missing recovery operation ID");
    f.state.unavailable = false;
    expect(
      yield* f.service.github({ ...input, operationId: interrupted.operationId }, THREAD),
    ).toMatchObject(result);
    const recovery = decodeRequest(f.sent[2]!.payload);
    expect(recovery).toMatchObject({
      kind: "github",
      mode: "recover",
      operationId: interrupted.operationId,
    });
  }),
);
