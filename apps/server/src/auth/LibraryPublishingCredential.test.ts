import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthLibraryPublishScope, AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
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
  Layer.provideMerge(NodeServices.layer),
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
