import { it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthLibraryPublishScope, AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing"; // fork: project-library
import { expect } from "vite-plus/test";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SessionStore from "./SessionStore.ts";
import * as Credential from "./LibraryPublishingCredential.ts";

const issued: Array<NonNullable<Parameters<SessionStore.SessionStore["Service"]["issue"]>[0]>> = [];
const revocations: string[] = [];
const sessions = Layer.mock(SessionStore.SessionStore)({
  cookieName: "session",
  legacyCookieName: undefined,
  // fork: project-library
  verify: (token) => {
    const id =
      token === "current-publisher"
        ? "current-session"
        : token === "test-publisher-token"
          ? "publisher-session"
          : null;
    return id !== null && !revocations.includes(id)
      ? Effect.succeed({
          sessionId: AuthSessionId.make(id),
          token,
          subject: "loom-host:source-host",
          method: "bearer-access-token" as const,
          client: { deviceType: "bot" as const },
          scopes: [AuthLibraryPublishScope],
          expiresAt: DateTime.makeUnsafe("2030-01-01T00:00:00Z"),
        })
      : Effect.fail(new SessionStore.MalformedSessionTokenError());
  },
  issue: (input) =>
    Effect.gen(function* () {
      if (input === undefined) return yield* Effect.die("Expected source grant");
      issued.push(input);
      return {
        token: "test-publisher-token",
        sessionId: AuthSessionId.make("publisher-session"),
        method: "bearer-access-token" as const,
        client: { deviceType: "bot" as const },
        scopes: input.scopes ?? [],
        expiresAt: DateTime.add(yield* DateTime.now, {
          milliseconds: Duration.toMillis(input.ttl ?? Duration.days(30)),
        }),
      };
    }),
  listActive: () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      return [
        ["current-session", "loom-host:source-host", -1000],
        ["publisher-session", "loom-host:source-host", 0],
        ["pending-newer", "loom-host:source-host", 1000],
        ["other-computer", "loom-host:other-host", -1000],
      ]
        .filter(([id]) => id !== "pending-newer" || issued.length > 1)
        .map(([id, subject, offset]) => ({
          sessionId: AuthSessionId.make(String(id)),
          subject: String(subject),
          method: "bearer-access-token" as const,
          client: { deviceType: "bot" as const },
          scopes: [AuthLibraryPublishScope],
          issuedAt: DateTime.add(now, { milliseconds: Number(offset) }),
          expiresAt: DateTime.add(now, { milliseconds: 86400000 }),
          lastConnectedAt: null,
          connected: false,
          current: false,
        }));
    }),
  revoke: (id) =>
    Effect.sync(() => {
      revocations.push(id);
      return true;
    }),
});
const config = ServerConfig.layerTest(process.cwd(), { prefix: "library-publisher-credential-" });
const layer = Credential.layer.pipe(
  Layer.provideMerge(sessions),
  Layer.provideMerge(config),
  Layer.provideMerge(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("library-authority")),
    }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
it.layer(layer)("LibraryPublishingCredential", (it) => {
  it.effect(
    "writes a private source-specific publishing credential with no execution or administrative grants",
    () =>
      Effect.gen(function* () {
        const service = yield* Credential.LibraryPublishingCredential;
        const fs = yield* FileSystem.FileSystem;
        const result = yield* service.issue({
          sourceEnvironmentId: EnvironmentId.make("source-host"),
          libraryUrl: "https://library.example.test",
          ttl: Duration.days(7),
        });
        expect(issued.at(-1)).toMatchObject({
          subject: "loom-host:source-host",
          scopes: [AuthLibraryPublishScope],
          method: "bearer-access-token",
        });
        const content = yield* decodeJson(yield* fs.readFileString(result.credentialFile));
        expect(content).toMatchObject({
          accessToken: "test-publisher-token",
          sourceEnvironmentId: "source-host",
          libraryEnvironmentId: "library-authority",
        });
        const stat = yield* fs.stat(result.credentialFile);
        expect(stat.mode & 0o777).toBe(0o600);
        const before = issued.length;
        expect(
          (yield* Effect.result(
            service.issue({
              sourceEnvironmentId: EnvironmentId.make("source-host"),
              libraryUrl: "https://library.example.test",
            }),
          ))._tag,
        ).toBe("Failure");
        expect(issued).toHaveLength(before);
        const enrollment = {
          sourceEnvironmentId: EnvironmentId.make("source-host"),
          libraryUrl: "https://library.example.test",
          requestId: "owner-enrollment",
        };
        yield* service.checkEnrollment(enrollment);
        expect(issued).toHaveLength(before);
        const installed = yield* service.enroll(enrollment);
        yield* service.checkEnrollment(enrollment);
        expect(installed.sourceEnvironmentId).toBe("source-host");
        expect(Redacted.value(installed.accessToken)).toBe("test-publisher-token");
        expect(issued).toHaveLength(before + 1);
        expect(revocations).not.toContain("current-session");
        const replay = yield* Effect.flatMap(Credential.LibraryPublishingCredential, (restarted) =>
          restarted.enroll(enrollment),
        ).pipe(Effect.provide(Credential.layer));
        expect(Redacted.value(replay.accessToken)).toBe(Redacted.value(installed.accessToken));
        expect(replay.sessionId).toBe(installed.sessionId);
        expect(issued).toHaveLength(before + 1);
        expect(
          (yield* Effect.result(
            service.enroll({ ...enrollment, libraryUrl: "https://other-library.example.test" }),
          ))._tag,
        ).toBe("Failure");
        expect(issued).toHaveLength(before + 1);
        expect(
          (yield* Effect.result(
            service.activate({
              requestId: "wrong-request",
              token: Redacted.value(installed.accessToken),
            }),
          ))._tag,
        ).toBe("Failure");
        expect(revocations).not.toContain("current-session");
        yield* service.activate({
          requestId: enrollment.requestId,
          token: Redacted.value(installed.accessToken),
        });
        expect(revocations).toContain("current-session");
        expect(revocations).not.toContain("pending-newer");
        expect(revocations).not.toContain("other-computer");
        yield* service.activate({
          requestId: enrollment.requestId,
          token: Redacted.value(installed.accessToken),
        });
        expect(revocations).not.toContain(installed.sessionId);
        yield* service.revokeForComputer(enrollment.sourceEnvironmentId);
        expect(revocations).toContain(installed.sessionId);
        expect(revocations).toContain("pending-newer");
        expect(revocations).not.toContain("other-computer");
        expect((yield* service.checkEnrollment(enrollment).pipe(Effect.flip)).reason).toBe(
          "invalid",
        );
        expect((yield* service.enroll(enrollment).pipe(Effect.result))._tag).toBe("Failure");
      }),
  );
  // fork: project-library
  it.effect(
    "renews a live publisher with the same scope, revokes it and replays a lost reply",
    () =>
      Effect.gen(function* () {
        const service = yield* Credential.LibraryPublishingCredential;
        revocations.length = 0;
        const renewed = yield* service.renew("current-publisher");
        expect(renewed.sessionId).toBe("publisher-session");
        expect(renewed.issuedAt).toBeDefined();
        expect(issued.at(-1)).toMatchObject({
          subject: "loom-host:source-host",
          scopes: [AuthLibraryPublishScope],
        });
        expect(revocations).toContain("current-session");
        const before = issued.length;
        expect(
          yield* Effect.flatMap(Credential.LibraryPublishingCredential, (restarted) =>
            restarted.renew("current-publisher"),
          ).pipe(Effect.provide(Credential.layer)),
        ).toEqual(renewed);
        expect(issued).toHaveLength(before);
        expect((yield* Effect.result(service.renew("invalid-publisher")))._tag).toBe("Failure");
        yield* (yield* SessionStore.SessionStore).revoke(AuthSessionId.make(renewed.sessionId));
        expect((yield* Effect.result(service.renew("current-publisher")))._tag).toBe("Failure");
        yield* TestClock.adjust("16 minutes");
        expect((yield* Effect.result(service.renew("current-publisher")))._tag).toBe("Failure");
        expect(issued).toHaveLength(before);
      }),
  );
  it.effect("refuses unsafe endpoints and unbounded lifetimes before creating a session", () =>
    Effect.gen(function* () {
      const service = yield* Credential.LibraryPublishingCredential;
      const before = issued.length;
      for (const request of [
        {
          sourceEnvironmentId: EnvironmentId.make("unsafe-host"),
          libraryUrl: "https://user:password@library.example.test",
        },
        {
          sourceEnvironmentId: EnvironmentId.make("unsafe-host"),
          libraryUrl: "https://library.example.test",
          ttl: Duration.days(91),
        },
      ])
        expect((yield* Effect.result(service.issue(request)))._tag).toBe("Failure");
      expect(issued).toHaveLength(before);
    }),
  );
});
