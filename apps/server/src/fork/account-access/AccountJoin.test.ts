// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no Ed25519 key generation.
import * as NodeCrypto from "node:crypto";
import * as PlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import { LibraryError, type AccountJoinRequest } from "@t3tools/contracts/fork";
import { directoryPublicKeyFromPem, signDirectoryReport } from "@t3tools/shared/fork/directory";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
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
  const issued: string[] = [];
  const authorized = Effect.suspend(() =>
    ownerAllowed ? Effect.void : Effect.fail(new LibraryError({ reason: "blocked" })),
  );
  const open = Join.AccountJoin.pipe(
    Effect.provide(
      Join.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(LIBRARY) }),
            Layer.mock(LibraryManagement)({ authorizeEnrollment: () => authorized }),
            Layer.mock(AccountEnrollment)({
              approve: (proof) =>
                authorized.pipe(
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
    ),
  );
  return {
    open,
    request,
    issued,
    denyOwner: () => {
      ownerAllowed = false;
    },
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
