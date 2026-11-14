// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation.
import * as NodeCrypto from "node:crypto";
import * as PlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import {
  ACCOUNT_JOIN_APPROVAL_REQUIRED,
  ACCOUNT_JOIN_DEVICE_APPROVAL_ENDED,
  LibraryError,
  type AccountJoinRequest,
} from "@t3tools/contracts/fork";
import { directoryPublicKeyFromPem, signDirectoryReport } from "@t3tools/shared/fork/directory";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { PocketId, PocketIdError } from "../../auth/PocketId.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { LibraryPushService } from "../library-push/LibraryPushService.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { AccountEnrollment } from "./AccountEnrollment.ts";
import * as Join from "./AccountJoin.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const LIBRARY = EnvironmentId.make("library");
const SOURCE = EnvironmentId.make("new-server");
const URL = "https://library.example.test";
const owner = {
  sessionId: AuthSessionId.make("human-owner"),
  subject: "owner",
  method: "bearer-access-token" as const,
  scopes: AuthStandardClientScopes,
  expiresAt: DateTime.makeUnsafe(NOW + 86400000),
};
const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(NOW);
  const key = NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const request = (environmentId = SOURCE) =>
    Effect.gen(function* () {
      const token = yield* signDirectoryReport({
        privateKey: key.privateKey,
        audience: URL,
        nowEpochSeconds: (yield* DateTime.now).epochMilliseconds / 1000,
        report: {
          environmentId,
          label: "New server",
          serverVersion: "1.0.0",
          platform: { os: "linux", arch: "x64" },
          supportsExecution: true,
          loomFeatures: ["account-access"],
          routes: [],
          providers: [],
          sequence: NOW,
          reportedAt: DateTime.formatIso(DateTime.makeUnsafe(NOW)),
        },
      });
      return {
        proof: {
          requestId: "join-request",
          libraryEnvironmentId: LIBRARY,
          libraryUrl: URL,
          environmentId,
          request: { token, publicKey: directoryPublicKeyFromPem(key.publicKey)! },
        },
        secret: Redacted.make("a".repeat(64)),
      } satisfies AccountJoinRequest;
    });
  let ownerAllowed = true;
  let identity = false;
  let epoch = 0;
  // Grants a passkey sign-in left, by code, as the Library's identity service would keep them.
  const grants = new Map<string, { subject: string; reason?: PocketIdError["reason"] }>();
  const issued: string[] = [];
  const authorized = Effect.suspend(() =>
    ownerAllowed ? Effect.void : Effect.fail(new LibraryError({ reason: "blocked" })),
  );
  const pushes = yield* Queue.unbounded<string>();
  // Built in the test's scope, which owns the prompt pushes the service forks.
  const open = Layer.build(
    Join.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(LIBRARY) }),
          Layer.mock(LibraryPushService)({
            alerts: false,
            joinPrompt: (input) => Queue.offer(pushes, input.requestId).pipe(Effect.asVoid),
          }),
          Layer.mock(LibraryManagement)({ authorizeEnrollment: () => authorized }),
          // Read when the service is built, so `enableIdentity` before `open` takes effect.
          Layer.suspend(() =>
            Layer.mock(PocketId)({
              enabled: identity,
              cookieName: "unused",
              redeemApproval: (input, subject) =>
                Effect.suspend(() => {
                  const grant = grants.get(input.code);
                  grants.delete(input.code);
                  if (grant === undefined)
                    return Effect.fail(new PocketIdError({ reason: "stale" }));
                  if (grant.reason) return Effect.fail(new PocketIdError({ reason: grant.reason }));
                  return grant.subject === subject
                    ? Effect.void
                    : Effect.fail(new PocketIdError({ reason: "subject" }));
                }),
              verifyDeviceApproval: (token, subject) =>
                token === `phone:${subject}`
                  ? Effect.void
                  : Effect.fail(new PocketIdError({ reason: "expired" })),
            }),
          ),
          Layer.mock(AccountEnrollment)({
            epoch: () => Effect.sync(() => epoch),
            approve: (proof, _owner, expectedEpoch) =>
              Effect.suspend(() =>
                expectedEpoch !== epoch
                  ? Effect.fail(new LibraryError({ reason: "request-conflict" }))
                  : authorized,
              ).pipe(
                Effect.map(() => {
                  issued.push(proof.environmentId);
                  return {
                    requestId: "receipt",
                    credential: {
                      version: 1 as const,
                      sourceEnvironmentId: proof.environmentId,
                      libraryEnvironmentId: LIBRARY,
                      libraryUrl: URL,
                      sessionId: AuthSessionId.make("machine"),
                      accessToken: Redacted.make("machine-only"),
                      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(NOW + 86400000)),
                    },
                    management: {
                      token: "machine-delegation",
                      sourceEnvironmentId: proof.environmentId,
                      libraryEnvironmentId: LIBRARY,
                      authorityId: "authority",
                      authorityEpoch: 1,
                      keyFingerprint: "fingerprint",
                      expiresAt: NOW + 86400000,
                    },
                  };
                }),
              ),
          }),
        ),
      ),
    ),
  ).pipe(Effect.map(Context.get(Join.AccountJoin)));
  return {
    open,
    request,
    pushes,
    issued,
    removeComputer: () => {
      epoch++;
    },
    denyOwner: () => {
      ownerAllowed = false;
    },
    enableIdentity: () => {
      identity = true;
    },
    grants,
    fs: yield* FileSystem.FileSystem,
  };
});
const run = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "account-join-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              LOOM_LIBRARY_AUTHORITY: "true",
              LOOM_IDENTITY_REDIRECT_URI: `${URL}/oauth/callback`,
            },
          }),
        ),
        PlatformCrypto.layer,
        NodeServices.layer,
      ),
    ),
    Effect.scoped,
  );

it.effect(
  "persists a matching-code approval without issuing until the same machine redeems it",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.open;
        const request = yield* f.request();
        const prompt = yield* service.begin(request);
        expect(prompt.state).toBe("pending");
        expect(yield* service.begin(request)).toEqual(prompt);
        expect(f.issued).toEqual([]);
        expect(yield* service.redeem(request)).toEqual({ state: "pending" });
        expect(yield* service.lookup(prompt.code, owner)).toEqual(prompt);
        yield* service.decide({ code: prompt.code, approve: true }, owner);
        expect(f.issued).toEqual([]);
        const restarted = yield* f.open;
        expect(
          (yield* restarted
            .redeem({ ...request, secret: Redacted.make("b".repeat(64)) })
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(
          (yield* restarted
            .redeem(yield* f.request(EnvironmentId.make("other-server")))
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(f.issued).toEqual([]);
        const redeemed = yield* restarted.redeem(request);
        expect(redeemed.state).toBe("approved");
        expect(f.issued).toEqual([SOURCE]);
        f.denyOwner();
        expect((yield* restarted.redeem(request).pipe(Effect.result))._tag).toBe("Failure");
      }),
    ),
);

it.effect("denies expired, declined and incorrectly signed requests without enrollment", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const service = yield* f.open;
      const request = yield* f.request();
      expect(
        (yield* service
          .begin({
            ...request,
            proof: { ...request.proof, request: { ...request.proof.request, token: "forged" } },
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      const prompt = yield* service.begin(request);
      yield* service.decide({ code: prompt.code, approve: false }, owner);
      expect(yield* service.redeem(request)).toEqual({ state: "denied" });
      const replacement = {
        ...request,
        proof: { ...request.proof, requestId: "restarted-request" },
      };
      const restarted = yield* service.begin(replacement);
      expect(restarted.code).not.toBe(prompt.code);
      expect(restarted.state).toBe("pending");
      expect((yield* service.redeem(request).pipe(Effect.result))._tag).toBe("Failure");
      expect((yield* service.lookup(prompt.code, owner).pipe(Effect.result))._tag).toBe("Failure");
      yield* TestClock.adjust("16 minutes");
      expect((yield* service.lookup(prompt.code, owner).pipe(Effect.result))._tag).toBe("Failure");
      expect((yield* service.redeem(yield* f.request()).pipe(Effect.result))._tag).toBe("Failure");
      expect(f.issued).toEqual([]);
    }),
  ),
);

it.effect(
  "does not redeem an earlier approval after computer removal, even with a fresh signed report",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.open;
        const request = yield* f.request();
        const review = yield* service.begin(request);
        yield* service.decide({ code: review.code, approve: true }, owner);
        f.removeComputer();
        const restarted = yield* f.open;
        expect((yield* restarted.redeem(yield* f.request()).pipe(Effect.flip)).reason).toBe(
          "request-conflict",
        );
        const fresh = { ...request, proof: { ...request.proof, requestId: "new-request" } };
        const next = yield* restarted.begin(fresh);
        yield* restarted.decide({ code: next.code, approve: true }, owner);
        expect((yield* restarted.redeem(fresh)).state).toBe("approved");
      }),
    ),
);

it.effect("approves from a prompt only with the terminal's code, and declines on any other", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const service = yield* f.open;
      const request = yield* f.request();
      const review = yield* service.begin(request);
      expect(yield* Queue.take(f.pushes)).toBe(review.requestId);
      const [prompts] = yield* service.prompts(owner).pipe(Stream.take(1), Stream.runCollect);
      expect(prompts).toHaveLength(1);
      const prompt = prompts![0]!;
      expect(prompt).not.toHaveProperty("code");
      expect(prompt.choices).toHaveLength(3);
      expect(new Set(prompt.choices).size).toBe(3);
      expect(prompt.choices).toContain(review.code);
      const wrong = prompt.choices.find((choice) => choice !== review.code)!;
      expect(
        (yield* service.respond({ requestId: review.requestId, code: wrong }, owner)).state,
      ).toBe("denied");
      expect(yield* service.redeem(request)).toEqual({ state: "denied" });
      expect(
        (yield* service
          .respond({ requestId: review.requestId, code: review.code }, owner)
          .pipe(Effect.flip)).reason,
      ).toBe("request-conflict");
      const fresh = { ...request, proof: { ...request.proof, requestId: "second-request" } };
      const next = yield* service.begin(fresh);
      expect(yield* service.begin(fresh)).toEqual(next);
      expect(yield* Queue.take(f.pushes)).toBe("second-request");
      expect(
        (yield* service.respond({ requestId: next.requestId, code: next.code }, owner)).state,
      ).toBe("approved");
      expect(
        (yield* service.respond({ requestId: next.requestId, code: next.code }, owner)).state,
      ).toBe("approved");
      expect((yield* service.redeem(fresh)).state).toBe("approved");
      expect(f.issued).toEqual([SOURCE]);
      expect(yield* Queue.size(f.pushes)).toBe(0);
    }),
  ),
);

it.effect("streams pending prompts to the owner as requests arrive and end", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const service = yield* f.open;
      const subscribed = yield* Deferred.make<void>();
      const seen = yield* service.prompts(owner).pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      const request = yield* f.request();
      const review = yield* service.begin(request);
      yield* service.respond({ requestId: review.requestId, code: null }, owner);
      expect(
        (yield* Fiber.join(seen)).map((prompts) => prompts.map((prompt) => prompt.requestId)),
      ).toEqual([[], [review.requestId], []]);
      f.denyOwner();
      expect((yield* service.prompts(owner).pipe(Stream.runCollect, Effect.result))._tag).toBe(
        "Failure",
      );
      expect(
        (yield* service
          .respond({ requestId: review.requestId, code: review.code }, owner)
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
    }),
  ),
);

it.effect("on a Library with Loom Identity, approves only with fresh passkey or phone proof", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      f.enableIdentity();
      const service = yield* f.open;
      const request = yield* f.request();
      const review = yield* service.begin(request);
      const verifier = "v".repeat(43);
      const passkey = (code: string) => ({ _tag: "passkey" as const, code, verifier });
      const refusal = <A>(answer: Effect.Effect<A, LibraryError>) =>
        answer.pipe(
          Effect.flip,
          Effect.map((error) => error.detail),
        );
      expect(
        yield* refusal(service.respond({ requestId: review.requestId, code: review.code }, owner)),
      ).toBe(ACCOUNT_JOIN_APPROVAL_REQUIRED);
      f.grants.set("a".repeat(43), { subject: owner.subject, reason: "stale" });
      expect(
        yield* refusal(
          service.decide(
            { code: review.code, approve: true, approval: passkey("a".repeat(43)) },
            owner,
          ),
        ),
      ).toContain("expired or was already used");
      f.grants.set("b".repeat(43), { subject: "someone-else" });
      expect(
        yield* refusal(
          service.respond(
            { requestId: review.requestId, code: review.code, approval: passkey("b".repeat(43)) },
            owner,
          ),
        ),
      ).toContain("Loom Identity account");
      expect(
        yield* refusal(
          service.respond(
            {
              requestId: review.requestId,
              code: review.code,
              approval: { _tag: "device", token: "phone:someone-else" },
            },
            owner,
          ),
        ),
      ).toBe(ACCOUNT_JOIN_DEVICE_APPROVAL_ENDED);
      expect(yield* service.redeem(request)).toEqual({ state: "pending" });
      f.grants.set("c".repeat(43), { subject: owner.subject });
      const approval = passkey("c".repeat(43));
      expect(
        (yield* service.respond(
          { requestId: review.requestId, code: review.code, approval },
          owner,
        )).state,
      ).toBe("approved");
      expect((yield* service.redeem(request)).state).toBe("approved");

      const fresh = { ...request, proof: { ...request.proof, requestId: "phone-request" } };
      const next = yield* service.begin(fresh);
      const wrong = (yield* service.prompts(owner).pipe(Stream.take(1), Stream.runCollect))[0]!
        .find((prompt) => prompt.requestId === next.requestId)!
        .choices.find((choice) => choice !== next.code)!;
      // A decline never needs proof: it cannot add a computer.
      expect(
        (yield* service.respond({ requestId: next.requestId, code: wrong }, owner)).state,
      ).toBe("denied");
      const third = { ...request, proof: { ...request.proof, requestId: "third-request" } };
      const last = yield* service.begin(third);
      expect(
        (yield* service.respond(
          {
            requestId: last.requestId,
            code: last.code,
            approval: { _tag: "device", token: `phone:${owner.subject}` },
          },
          owner,
        )).state,
      ).toBe("approved");
    }),
  ),
);
