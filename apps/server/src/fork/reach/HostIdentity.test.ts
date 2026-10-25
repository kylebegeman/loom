import { it, expect } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";
import { applyHostIdentity, HostIdentityRestart, withHostIdentity } from "./HostIdentity.ts";

const prepared = {
  issuer: "https://identity.example.test",
  resource: "https://studio-loom.example.test",
  nativeClientId: "native-client",
};
const layer = ServerConfig.layerTest(process.cwd(), { prefix: "host-identity-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const decode = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

it.effect(
  "saves prepared values privately before restart and respects server environment overrides at startup",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const file = `${config.secretsDir}/reach-identity.json`;
      let requested = false;
      yield* applyHostIdentity(prepared, {
        allowedSubjects: "owner-id",
        requirePasskey: true,
      }).pipe(
        Effect.provideService(HostIdentityRestart, {
          request: Effect.gen(function* () {
            expect(decode(yield* fs.readFileString(file))).toMatchObject({
              prepared,
              allowedSubjects: "owner-id",
              requirePasskey: true,
            });
            expect((yield* fs.stat(file)).mode & 0o777).toBe(0o600);
            requested = true;
          }),
        }),
      );
      expect(requested).toBe(true);
      yield* withHostIdentity(
        Effect.gen(function* () {
          const env = yield* HostProcess.Environment;
          expect(env.LOOM_IDENTITY_RESOURCE).toBe("https://override.example.test");
          expect(env.LOOM_IDENTITY_ALLOWED_SUBJECTS).toBe("owner-id");
          expect(yield* Config.String("LOOM_IDENTITY_ISSUER")).toBe(prepared.issuer);
          expect(yield* Config.Boolean("LOOM_IDENTITY_REQUIRE_PASSKEY")).toBe(true);
        }),
      );
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(HostProcess.Environment, {
        LOOM_IDENTITY_RESOURCE: "https://override.example.test",
      }),
    ),
);
it.effect("requires an explicit account allowlist and never writes or restarts after refusal", () =>
  Effect.gen(function* () {
    let restarted = false;
    for (const allowedSubjects of [undefined, "*"])
      expect(
        (yield* applyHostIdentity(prepared, {
          requirePasskey: true,
          ...(allowedSubjects ? { allowedSubjects } : {}),
        }).pipe(
          Effect.provideService(HostIdentityRestart, {
            request: Effect.sync(() => {
              restarted = true;
            }),
          }),
          Effect.flip,
        )).reason,
      ).toBe("identity-allowlist");
    expect(restarted).toBe(false);
    const fs = yield* FileSystem.FileSystem;
    expect(
      yield* fs.exists(`${(yield* ServerConfig.ServerConfig).secretsDir}/reach-identity.json`),
    ).toBe(false);
  }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);

it.effect(
  "can turn the passkey requirement back off without invalidating the host configuration",
  () =>
    Effect.gen(function* () {
      yield* applyHostIdentity(prepared, {
        allowedSubjects: "owner-id",
        requirePasskey: false,
      }).pipe(Effect.provideService(HostIdentityRestart, { request: Effect.void }));
      yield* withHostIdentity(
        Effect.gen(function* () {
          expect((yield* HostProcess.Environment).LOOM_IDENTITY_REQUIRE_PASSKEY).toBeUndefined();
          expect(yield* Config.String("LOOM_IDENTITY_ALLOWED_SUBJECTS")).toBe("owner-id");
        }),
      );
    }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);

it.effect("finishes the previous backend before starting with the saved Identity values", () =>
  Effect.gen(function* () {
    const requested = yield* Deferred.make<void>();
    const lifecycle: string[] = [];
    let generation = 0;
    const backend = Effect.scoped(
      Effect.gen(function* () {
        const current = ++generation;
        lifecycle.push(`start:${current}`);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            lifecycle.push(`stop:${current}`);
          }),
        );
        if (current === 1) {
          expect((yield* HostProcess.Environment).LOOM_IDENTITY_ISSUER).toBeUndefined();
          yield* applyHostIdentity(prepared, { allowedSubjects: "owner-id", requirePasskey: true });
          yield* Deferred.succeed(requested, undefined);
          return yield* Effect.never;
        } else {
          expect((yield* HostProcess.Environment).LOOM_IDENTITY_ISSUER).toBe(prepared.issuer);
          expect(yield* Config.Boolean("LOOM_IDENTITY_REQUIRE_PASSKEY")).toBe(true);
        }
      }),
    );
    const running = yield* withHostIdentity(backend).pipe(Effect.forkChild);
    yield* Deferred.await(requested);
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(running);
    expect(lifecycle).toEqual(["start:1", "stop:1", "start:2", "stop:2"]);
  }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Environment, {})),
);
