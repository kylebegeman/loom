// @effect-diagnostics nodeBuiltinImport:off -- the test generates throwaway P-256 and P-384 keys.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type AuthEnvironmentScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import type { LibraryPushRegisterRequest } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import { identitySessionPrefix } from "../../auth/identityPolicy.ts";
import {
  SecretStorePersistError,
  SecretStoreReadError,
  ServerSecretStore,
} from "../../auth/ServerSecretStore.ts";
import * as ApnsClient from "./ApnsClient.ts";
import * as LibraryPush from "./LibraryPushService.ts";
import { libraryPushRowId } from "./registry.ts";

const ISSUER = "https://id.example.test";
const TEAM_ID = "TEAM123456";
const KEY_ID = "KEY1234567";
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
// Hex with letters, so either case showing up in any output is no accident.
const TOKEN = "5e471e1a".repeat(8);
const BOB_TOKEN = "b0b0cafe".repeat(8);
const SECRET = LibraryPush.LIBRARY_PUSH_DEVICES_SECRET;
const APP_STORE = { bundleId: "com.kylebegeman.loom", apsEnvironment: "production" } as const;

const pemOf = (key: NodeCrypto.KeyObject) =>
  key.export({ type: "pkcs8", format: "pem" }).toString();
// Throwaway keys for this test run only.
const P256_PEM = pemOf(
  NodeCrypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey,
);
const P384_PEM = pemOf(
  NodeCrypto.generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey,
);

const writeKeyFile = Effect.fn("test.writeKeyFile")(function* (contents = P256_PEM, mode = 0o600) {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-push-test-" });
  const file = `${directory}/AuthKey.p8`;
  yield* fs.writeFileString(file, contents);
  yield* fs.chmod(file, mode);
  return file;
});

const libraryEnv = (keyFile: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  LOOM_LIBRARY_AUTHORITY: "true",
  LOOM_IDENTITY_ISSUER: ISSUER,
  LOOM_IDENTITY_AUDIENCE: "loom-library",
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "alice,bob",
  LOOM_LIBRARY_PUSH_ENABLED: "true",
  LOOM_LIBRARY_PUSH_APNS_TEAM_ID: TEAM_ID,
  LOOM_LIBRARY_PUSH_APNS_KEY_ID: KEY_ID,
  LOOM_LIBRARY_PUSH_APNS_KEY_FILE: keyFile,
  ...extra,
});

const FULL_SCOPES: ReadonlyArray<AuthEnvironmentScope> = [
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
];

const session = (
  subject: string,
  scopes: ReadonlyArray<AuthEnvironmentScope> = FULL_SCOPES,
): LibraryPush.LibraryPushCaller => ({ _tag: "Session", subject, scopes });

const encodedSubject = (sub: string) => Buffer.from(sub, "utf8").toString("base64url");

/** Identity sessions carry `settings:write` too, which must not widen them to every account. */
const identity = (env: NodeJS.ProcessEnv, sub: string) =>
  session(`${identitySessionPrefix(env)}${encodedSubject(sub)}`);

const OPERATOR = session("owner");
const READ_ONLY_PAIRING = session("pairing-session", [AuthOrchestrationReadScope]);

const rowId = (sub: string, deviceId = "phone-1") =>
  libraryPushRowId({ issuer: ISSUER, subject: sub }, deviceId);

const registration = (
  overrides: Partial<Omit<LibraryPushRegisterRequest, "token">> & { readonly token?: string } = {},
): LibraryPushRegisterRequest => ({
  deviceId: "phone-1",
  label: "Kyle's iPhone",
  platform: "ios",
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.2.3",
  ...overrides,
  token: Redacted.make(overrides.token ?? TOKEN),
});

const memorySecrets = (initial: ReadonlyArray<readonly [string, string]> = []) => {
  const values = new Map<string, Uint8Array>(
    initial.map(([name, value]) => [name, new TextEncoder().encode(value)] as const),
  );
  const state = { failWrites: false, failReads: false, writeAttempts: 0, removed: [] as string[] };
  const store = ServerSecretStore.of({
    get: (name) =>
      state.failReads
        ? Effect.fail(new SecretStoreReadError({ resource: name, cause: new Error("offline") }))
        : Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) =>
      Effect.suspend(() => {
        state.writeAttempts++;
        return state.failWrites
          ? Effect.fail(new SecretStorePersistError({ resource: name, cause: new Error("full") }))
          : Effect.sync(() => void values.set(name, value));
      }),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: (_name, bytes) => Effect.succeed(new Uint8Array(bytes)),
    remove: (name) =>
      Effect.sync(() => {
        state.removed.push(name);
        values.delete(name);
      }),
  });
  const storedSubjects = () => {
    const bytes = values.get(SECRET);
    if (bytes === undefined) return null;
    const document = JSON.parse(new TextDecoder().decode(bytes)) as {
      readonly devices: ReadonlyArray<{ readonly subject: string }>;
    };
    return document.devices.map((device) => device.subject);
  };
  return { store, values, state, storedSubjects };
};
type MemorySecrets = ReturnType<typeof memorySecrets>;

/** Stands in for Apple: `respond` decides each send's outcome. */
const fakeApns = () => {
  const opened: Array<ApnsClient.ApnsClientConfig> = [];
  const sent: Array<ApnsClient.ApnsSendInput> = [];
  const control: { respond: (input: ApnsClient.ApnsSendInput) => ApnsClient.ApnsOutcome } = {
    respond: () => "sent",
  };
  const client = ApnsClient.ApnsClient.of({
    open: (config) =>
      Effect.sync(() => {
        opened.push(config);
        return {
          send: (input) =>
            Effect.sync(() => {
              sent.push(input);
              const outcome = control.respond(input);
              return {
                outcome,
                status: outcome === "sent" ? 200 : 400,
                reason: null,
                apnsId: null,
              } satisfies ApnsClient.ApnsDelivery;
            }),
        };
      }),
  });
  return { client, opened, sent, control };
};
type FakeApns = ReturnType<typeof fakeApns>;

const start = Effect.fn("test.start")(function* (
  env: NodeJS.ProcessEnv,
  options: { readonly secrets?: MemorySecrets; readonly apns?: FakeApns } = {},
) {
  const secrets = options.secrets ?? memorySecrets();
  const apns = options.apns ?? fakeApns();
  const context = yield* Layer.build(
    LibraryPush.layer.pipe(
      Layer.provide(Layer.succeed(ServerSecretStore, secrets.store)),
      Layer.provide(Layer.succeed(ApnsClient.ApnsClient, apns.client)),
    ),
  ).pipe(Effect.provideService(HostProcess.Environment, env));
  return { push: Context.get(context, LibraryPush.LibraryPushService), secrets, apns };
});

const ready = Effect.fn("test.ready")(function* (extra: Record<string, string> = {}) {
  yield* TestClock.setTime(NOW);
  const env = libraryEnv(yield* writeKeyFile(), extra);
  return { env, ...(yield* start(env)) };
});

describe("LibraryPushService", () => {
  it.effect("is off on a computer and drops any device list it held", () =>
    Effect.gen(function* () {
      const secrets = memorySecrets([[SECRET, '{"version":1,"devices":[]}']]);
      const { push, apns } = yield* start({}, { secrets });
      expect(yield* push.status(OPERATOR)).toEqual({
        state: "off",
        reason: "not-library",
        key: null,
        devices: [],
      });
      expect((yield* push.register(OPERATOR, registration()).pipe(Effect.flip)).reason).toBe("off");
      expect(yield* push.unregister(OPERATOR, { id: rowId("alice") })).toEqual({ removed: false });
      expect((yield* push.test(OPERATOR, {}).pipe(Effect.flip)).reason).toBe("off");
      expect(secrets.state.removed).toEqual([SECRET]);
      expect(secrets.values.size).toBe(0);
      expect(secrets.state.writeAttempts).toBe(0);
      expect(apns.opened).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("is off without a reason on a Library whose switch is off", () =>
    Effect.gen(function* () {
      const env = libraryEnv(yield* writeKeyFile(), { LOOM_LIBRARY_PUSH_ENABLED: "false" });
      const { push, apns } = yield* start(env);
      expect(yield* push.status(identity(env, "alice"))).toMatchObject({
        state: "off",
        reason: null,
      });
      expect(apns.opened).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each<{
    readonly name: string;
    readonly keyFile: Effect.Effect<
      string,
      PlatformError.PlatformError,
      FileSystem.FileSystem | Scope.Scope
    >;
    readonly teamId?: string;
    readonly reason: "key-unreadable" | "key-invalid";
    readonly key: { readonly teamId: string; readonly keyId: string } | null;
  }>([
    {
      name: "a missing key file",
      keyFile: writeKeyFile().pipe(Effect.map((file) => `${file}.missing`)),
      reason: "key-unreadable",
      key: { teamId: TEAM_ID, keyId: KEY_ID },
    },
    {
      name: "a key file others can read",
      keyFile: writeKeyFile(P256_PEM, 0o644),
      reason: "key-unreadable",
      key: { teamId: TEAM_ID, keyId: KEY_ID },
    },
    {
      name: "a key on another curve",
      keyFile: writeKeyFile(P384_PEM),
      reason: "key-invalid",
      key: { teamId: TEAM_ID, keyId: KEY_ID },
    },
    {
      name: "a file that holds no key",
      keyFile: writeKeyFile("not a key"),
      reason: "key-invalid",
      key: { teamId: TEAM_ID, keyId: KEY_ID },
    },
    {
      name: "upstream T3's team",
      keyFile: writeKeyFile(),
      teamId: "ARK85ZXQ4Z",
      reason: "key-invalid",
      key: { teamId: "ARK85ZXQ4Z", keyId: KEY_ID },
    },
    {
      name: "a malformed Team ID",
      keyFile: writeKeyFile(),
      teamId: "team-1",
      reason: "key-invalid",
      key: null,
    },
  ])("is misconfigured with $name and refuses to register or test", (testCase) =>
    Effect.gen(function* () {
      const env = libraryEnv(
        yield* testCase.keyFile,
        testCase.teamId === undefined ? {} : { LOOM_LIBRARY_PUSH_APNS_TEAM_ID: testCase.teamId },
      );
      const { push, apns } = yield* start(env);
      const alice = identity(env, "alice");
      expect(yield* push.status(alice)).toEqual({
        state: "misconfigured",
        reason: testCase.reason,
        key: testCase.key,
        devices: [],
        topics: [APP_STORE],
      });
      expect((yield* push.register(alice, registration()).pipe(Effect.flip)).reason).toBe(
        "misconfigured",
      );
      expect((yield* push.test(alice, {}).pipe(Effect.flip)).reason).toBe("misconfigured");
      expect(apns.opened).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("opens one sender with the Library's key and reports it ready", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready();
      expect(yield* push.status(identity(env, "alice"))).toEqual({
        state: "ready",
        reason: null,
        key: { teamId: TEAM_ID, keyId: KEY_ID },
        devices: [],
        topics: [APP_STORE],
      });
      expect(apns.opened).toHaveLength(1);
      expect(apns.opened[0]).toMatchObject({ teamId: TEAM_ID, keyId: KEY_ID });
      expect(apns.opened[0]?.privateKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("registers only a current Identity account, which owns the row", () =>
    Effect.gen(function* () {
      const { env, push, secrets } = yield* ready();
      const refused = [
        OPERATOR,
        READ_ONLY_PAIRING,
        session("mcp-client:agent", [AuthOrchestrationReadScope]),
        session("loom-host:computer-1"),
        session(`identity:stale-policy:${encodedSubject("alice")}`),
        session("pocket-id:alice"),
        LibraryPush.AGENT_CALLER,
      ];
      for (const caller of refused) {
        expect((yield* push.register(caller, registration()).pipe(Effect.flip)).reason).toBe(
          "identity-required",
        );
      }
      expect(secrets.state.writeAttempts).toBe(0);

      const device = yield* push.register(identity(env, "alice"), registration());
      expect(device).toEqual({
        id: rowId("alice"),
        deviceId: "phone-1",
        label: "Kyle's iPhone",
        bundleId: "com.kylebegeman.loom",
        apsEnvironment: "production",
        appVersion: "1.2.3",
        registeredAt: "2026-10-24T12:00:00.000Z",
        refreshedAt: "2026-10-24T12:00:00.000Z",
        expiresAt: "2026-11-23T12:00:00.000Z",
        mine: true,
        lastDelivery: null,
      });
      expect(secrets.storedSubjects()).toEqual(["alice"]);
      expect([...secrets.values.keys()]).toEqual([SECRET]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("accepts only the app builds the Library's key serves", () =>
    Effect.gen(function* () {
      const { env, push } = yield* ready();
      const alice = identity(env, "alice");
      for (const build of [
        { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" },
        { bundleId: "com.kylebegeman.loom", apsEnvironment: "sandbox" },
        { bundleId: "com.kylebegeman.loom.preview", apsEnvironment: "production" },
      ] as const) {
        expect((yield* push.register(alice, registration(build)).pipe(Effect.flip)).reason).toBe(
          "unsupported-app",
        );
      }

      const widened = yield* start(
        libraryEnv(env.LOOM_LIBRARY_PUSH_APNS_KEY_FILE!, {
          LOOM_LIBRARY_PUSH_TOPICS: "com.kylebegeman.loom.dev:sandbox",
        }),
      );
      const dev = registration({ bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" });
      expect(yield* widened.push.register(alice, dev)).toMatchObject({ mine: true });
      // The list replaces the default rather than adding to it.
      expect((yield* widened.push.register(alice, registration()).pipe(Effect.flip)).reason).toBe(
        "unsupported-app",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("lists the builds its push settings name, so phones and web can tell", () =>
    Effect.gen(function* () {
      const { env, push } = yield* ready({
        LOOM_LIBRARY_PUSH_TOPICS:
          "com.kylebegeman.loom.dev:sandbox, com.example.other:production, com.kylebegeman.loom:production",
      });
      expect((yield* push.status(identity(env, "alice"))).topics).toEqual([
        { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" },
        APP_STORE,
      ]);
      // Agents and paired operators see the same list as an Identity session.
      expect((yield* push.status(LibraryPush.AGENT_CALLER)).topics).toHaveLength(2);
      expect((yield* push.status(READ_ONLY_PAIRING)).topics).toHaveLength(2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports an empty list when the settings name no usable build", () =>
    Effect.gen(function* () {
      const { env, push } = yield* ready({
        LOOM_LIBRARY_PUSH_TOPICS: "com.example.other:production",
      });
      const alice = identity(env, "alice");
      expect(yield* push.status(alice)).toMatchObject({ state: "ready", topics: [] });
      // Register keeps its refusal, so a phone that never read the list still learns why.
      expect((yield* push.register(alice, registration()).pipe(Effect.flip)).reason).toBe(
        "unsupported-app",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("accepts even-length hex tokens of 16 to 400 characters", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready();
      const alice = identity(env, "alice");
      for (const token of [
        "ab".repeat(7),
        "ab".repeat(201),
        "abc".repeat(7),
        "zz".repeat(16),
        "",
      ]) {
        expect(
          (yield* push.register(alice, registration({ token })).pipe(Effect.flip)).reason,
        ).toBe("invalid");
      }
      for (const [index, token] of ["ab".repeat(8), "cd".repeat(200)].entries()) {
        yield* push.register(alice, registration({ deviceId: `phone-${index}`, token }));
      }
      // Stored lower-case, so a re-registration in the other case lands on the same token.
      yield* push.register(
        alice,
        registration({ deviceId: "phone-upper", token: TOKEN.toUpperCase() }),
      );
      yield* push.test(alice, {});
      expect(apns.sent.map((input) => Redacted.value(input.token))).toContain(TOKEN);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves the device list untouched when it cannot be saved", () =>
    Effect.gen(function* () {
      const { env, push, secrets } = yield* ready();
      const alice = identity(env, "alice");
      secrets.state.failWrites = true;
      expect((yield* push.register(alice, registration()).pipe(Effect.flip)).reason).toBe(
        "storage",
      );
      expect((yield* push.status(alice)).devices).toEqual([]);
      secrets.state.failWrites = false;
      yield* push.register(alice, registration());
      expect((yield* push.status(alice)).devices).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writes an identical re-registration only once it is 12 hours old", () =>
    Effect.gen(function* () {
      const { env, push, secrets } = yield* ready();
      const alice = identity(env, "alice");
      yield* push.register(alice, registration());
      yield* TestClock.adjust("11 hours");
      yield* push.register(alice, registration());
      expect(secrets.state.writeAttempts).toBe(1);
      yield* TestClock.adjust("1 hour");
      const refreshed = yield* push.register(alice, registration());
      expect(secrets.state.writeAttempts).toBe(2);
      expect(refreshed.registeredAt).toBe("2026-10-24T12:00:00.000Z");
      expect(refreshed.expiresAt).toBe("2026-11-24T00:00:00.000Z");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("answers status without writing, even while the store fails", () =>
    Effect.gen(function* () {
      const { env, push, secrets } = yield* ready();
      const alice = identity(env, "alice");
      yield* push.register(alice, registration());
      secrets.state.failWrites = true;
      secrets.state.failReads = true;
      yield* TestClock.adjust("30 days");
      expect(yield* push.status(alice)).toMatchObject({ state: "ready", devices: [] });
      expect((yield* push.status(OPERATOR)).devices).toEqual([]);
      expect(secrets.state.writeAttempts).toBe(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps each account to its own devices", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready();
      const alice = identity(env, "alice");
      const bob = identity(env, "bob");
      yield* push.register(alice, registration({ label: "Alice's iPhone" }));
      // Same per-install id under another account: a second row, not a takeover.
      yield* push.register(bob, registration({ label: "Bob's iPhone", token: BOB_TOKEN }));

      const labels = (devices: ReadonlyArray<{ readonly label: string; readonly mine: boolean }>) =>
        devices.map((device) => [device.label, device.mine]);
      expect(labels((yield* push.status(alice)).devices)).toEqual([["Alice's iPhone", true]]);
      expect(labels((yield* push.status(bob)).devices)).toEqual([["Bob's iPhone", true]]);
      expect(labels((yield* push.status(OPERATOR)).devices)).toEqual([
        ["Alice's iPhone", false],
        ["Bob's iPhone", false],
      ]);
      expect((yield* push.status(READ_ONLY_PAIRING)).devices).toEqual([]);
      expect(
        (yield* push.status(session(`identity:stale:${encodedSubject("alice")}`))).devices,
      ).toEqual([]);

      expect(yield* push.unregister(bob, { id: rowId("alice") })).toEqual({ removed: false });
      expect(yield* push.test(bob, { id: rowId("alice") })).toEqual({ deliveries: [] });
      expect(apns.sent).toEqual([]);
      expect(
        (yield* push.unregister(READ_ONLY_PAIRING, { id: rowId("alice") }).pipe(Effect.flip))
          .reason,
      ).toBe("identity-required");
      expect(
        (yield* push.test(READ_ONLY_PAIRING, { id: rowId("alice") }).pipe(Effect.flip)).reason,
      ).toBe("identity-required");
      expect((yield* push.test(OPERATOR, {}).pipe(Effect.flip)).reason).toBe("invalid");

      expect(yield* push.unregister(OPERATOR, { id: rowId("alice") })).toEqual({ removed: true });
      expect(labels((yield* push.status(OPERATOR)).devices)).toEqual([["Bob's iPhone", false]]);
      expect((yield* push.status(alice)).devices).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("drops a device whose token Apple reports dead", () =>
    Effect.gen(function* () {
      const { env, push, secrets, apns } = yield* ready();
      const alice = identity(env, "alice");
      yield* push.register(alice, registration());
      apns.control.respond = () => "bad-token";
      expect(yield* push.test(alice, {})).toEqual({
        deliveries: [
          { id: rowId("alice"), label: "Kyle's iPhone", outcome: "removed", reason: "bad-token" },
        ],
      });
      expect((yield* push.status(alice)).devices).toEqual([]);
      expect(secrets.storedSubjects()).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a dead token's device when the removal cannot be saved", () =>
    Effect.gen(function* () {
      const { env, push, secrets, apns } = yield* ready();
      const alice = identity(env, "alice");
      yield* push.register(alice, registration());
      apns.control.respond = () => "bad-token";
      secrets.state.failWrites = true;
      expect((yield* push.test(alice, {})).deliveries).toMatchObject([
        { outcome: "failed", reason: "bad-token" },
      ]);
      expect((yield* push.status(alice)).devices[0]?.lastDelivery).toMatchObject({
        outcome: "failed",
        reason: "bad-token",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reports the Library failing on a rejected key until a send succeeds", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready();
      const alice = identity(env, "alice");
      yield* push.register(alice, registration());
      apns.control.respond = () => "key-rejected";
      expect((yield* push.test(alice, {})).deliveries).toMatchObject([
        { outcome: "failed", reason: "key-rejected" },
      ]);
      const failing = yield* push.status(alice);
      expect(failing).toMatchObject({ state: "failing", reason: "key-rejected" });
      expect(failing.devices[0]?.lastDelivery).toEqual({
        at: "2026-10-24T12:00:00.000Z",
        outcome: "failed",
        reason: "key-rejected",
      });

      yield* TestClock.adjust("10 seconds");
      apns.control.respond = () => "sent";
      yield* push.test(alice, {});
      const recovered = yield* push.status(alice);
      expect(recovered).toMatchObject({ state: "ready", reason: null });
      expect(recovered.devices[0]?.lastDelivery).toMatchObject({ outcome: "sent", reason: null });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("records a refused topic on the device without failing the Library", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready();
      const alice = identity(env, "alice");
      yield* push.register(alice, registration());
      apns.control.respond = () => "topic-disallowed";
      yield* push.test(alice, {});
      const status = yield* push.status(alice);
      expect(status).toMatchObject({ state: "ready", reason: null });
      expect(status.devices[0]?.lastDelivery).toMatchObject({
        outcome: "failed",
        reason: "topic-disallowed",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "allows one test per account every 10 seconds and three per device every 10 minutes",
    () =>
      Effect.gen(function* () {
        const { env, push, apns } = yield* ready();
        const alice = identity(env, "alice");
        const bob = identity(env, "bob");
        yield* push.register(alice, registration());
        yield* push.register(bob, registration({ token: BOB_TOKEN }));
        const outcomes = (result: {
          readonly deliveries: ReadonlyArray<{ readonly outcome: string }>;
        }) => result.deliveries.map((delivery) => delivery.outcome);

        expect(outcomes(yield* push.test(alice, {}))).toEqual(["sent"]);
        expect((yield* push.test(alice, {}).pipe(Effect.flip)).reason).toBe("rate-limited");
        // The limit is per account, not Library-wide.
        expect(outcomes(yield* push.test(bob, {}))).toEqual(["sent"]);

        yield* TestClock.adjust("10 seconds");
        expect(outcomes(yield* push.test(alice, {}))).toEqual(["sent"]);
        yield* TestClock.adjust("10 seconds");
        expect(outcomes(yield* push.test(alice, {}))).toEqual(["sent"]);
        yield* TestClock.adjust("10 seconds");
        expect((yield* push.test(alice, {})).deliveries).toEqual([
          { id: rowId("alice"), label: "Kyle's iPhone", outcome: "failed", reason: "rate-limited" },
        ]);
        // An operator naming the device is held to the same per-device limit.
        expect(outcomes(yield* push.test(OPERATOR, { id: rowId("alice") }))).toEqual(["failed"]);
        expect(apns.sent.filter((input) => Redacted.value(input.token) === TOKEN)).toHaveLength(3);

        yield* TestClock.adjust("10 minutes");
        expect(outcomes(yield* push.test(alice, {}))).toEqual(["sent"]);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("persists the prune of expired devices at startup", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const env = libraryEnv(yield* writeKeyFile(), { LOOM_IDENTITY_MAX_SESSION_AGE: "1h" });
      const secrets = memorySecrets();
      const first = yield* start(env, { secrets });
      yield* first.push.register(identity(env, "alice"), registration());
      yield* TestClock.adjust("30 minutes");
      yield* first.push.register(identity(env, "bob"), registration({ token: BOB_TOKEN }));
      yield* TestClock.adjust("31 minutes");
      expect(secrets.state.writeAttempts).toBe(2);

      const restarted = yield* start(env, { secrets });
      expect(secrets.state.writeAttempts).toBe(3);
      expect(secrets.storedSubjects()).toEqual(["bob"]);
      expect((yield* restarted.push.status(OPERATOR)).devices.map((device) => device.id)).toEqual([
        rowId("bob"),
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("starts empty from an unreadable device list", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const env = libraryEnv(yield* writeKeyFile());
      const { push } = yield* start(env, { secrets: memorySecrets([[SECRET, "{not json"]]) });
      expect((yield* push.status(OPERATOR)).devices).toEqual([]);
      expect(yield* push.register(identity(env, "alice"), registration())).toMatchObject({
        mine: true,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps push tokens out of results, errors and logs", () =>
    Effect.gen(function* () {
      const logs: Array<string> = [];
      const logger = Logger.make(({ message, cause, fiber }) => {
        logs.push(
          JSON.stringify({
            message,
            annotations: fiber.getRef(References.CurrentLogAnnotations),
            cause: Cause.pretty(cause),
          }),
        );
      });
      const recorded: Array<string> = [];
      const record = (value: unknown) => {
        recorded.push(JSON.stringify(value), String(value));
        if (value instanceof Error) recorded.push(value.message);
      };

      yield* Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const env = libraryEnv(yield* writeKeyFile());
        const secrets = memorySecrets([[SECRET, `{"version":1,"devices":"${TOKEN}"`]]);
        const { push, apns } = yield* start(env, { secrets });
        const alice = identity(env, "alice");
        const upper = registration({ token: TOKEN.toUpperCase() });
        record(upper);
        record(yield* push.register(alice, upper));
        record(yield* push.register(alice, registration({ token: `${TOKEN}0` })).pipe(Effect.flip));
        secrets.state.failWrites = true;
        record(
          yield* push
            .register(alice, registration({ deviceId: "phone-2", token: BOB_TOKEN }))
            .pipe(Effect.flip),
        );
        apns.control.respond = () => "bad-token";
        record(yield* push.test(alice, {}));
        record(yield* push.status(alice));
        record(yield* push.status(OPERATOR));
        recorded.push(...secrets.values.keys());
      }).pipe(
        Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
        Effect.provideService(References.MinimumLogLevel, "All"),
      );

      expect(logs.length).toBeGreaterThan(0);
      const output = [...recorded, ...logs].join("\n").toLowerCase();
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain(BOB_TOKEN);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("LibraryPushService agent alerts", () => {
  const STUDIO = EnvironmentId.make("environment-studio");
  const LAPTOP = EnvironmentId.make("environment-laptop");
  const THREAD = ThreadId.make("thread-1");
  const ALERTS_FOR_ALICE = {
    LOOM_LIBRARY_PUSH_ACTIVITY: "true",
    LOOM_LIBRARY_PUSH_RECIPIENTS: "alice",
  };

  it.effect("runs only with its switch on and someone named to receive alerts", () =>
    Effect.gen(function* () {
      const off = yield* ready();
      expect(off.push.alerts).toBe(false);
      expect(
        (yield* off.push.alert(STUDIO, { threadId: THREAD, kind: "completed" }).pipe(Effect.flip))
          .reason,
      ).toBe("off");

      // Two accounts can sign in, so the Library cannot tell whose computer this is.
      const unnamed = yield* ready({ LOOM_LIBRARY_PUSH_ACTIVITY: "true" });
      expect(unnamed.push.alerts).toBe(false);

      expect((yield* ready(ALERTS_FOR_ALICE)).push.alerts).toBe(true);

      const keyFile = yield* writeKeyFile();
      const { push } = yield* start(libraryEnv(`${keyFile}.missing`, ALERTS_FOR_ALICE));
      expect(push.alerts).toBe(true);
      expect(
        (yield* push.alert(STUDIO, { threadId: THREAD, kind: "completed" }).pipe(Effect.flip))
          .reason,
      ).toBe("misconfigured");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("sends generic text to the recipients' devices, one notification per thread", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready(ALERTS_FOR_ALICE);
      yield* push.register(identity(env, "alice"), registration());
      yield* push.register(identity(env, "bob"), registration({ token: BOB_TOKEN }));

      expect(yield* push.alert(STUDIO, { threadId: THREAD, kind: "approval" })).toEqual({
        sent: 1,
        devices: 1,
      });
      yield* push.alert(STUDIO, { threadId: THREAD, kind: "completed" });
      yield* push.alert(STUDIO, { threadId: ThreadId.make("thread-2"), kind: "completed" });

      expect(apns.sent.map((send) => send.deviceId)).toEqual([
        rowId("alice"),
        rowId("alice"),
        rowId("alice"),
      ]);
      const [approval, completed, other] = apns.sent.map((send) => send.request);
      expect(approval?.payload).toEqual({
        aps: {
          alert: { title: "Loom", body: "An agent needs your approval." },
          sound: "default",
          "thread-id": `${STUDIO}/${THREAD}`,
        },
        body: {
          environmentId: STUDIO,
          threadId: THREAD,
          deepLink: `/threads/${STUDIO}/${THREAD}`,
        },
      });
      expect(completed?.payload.aps.alert.body).toBe("An agent finished.");
      expect(completed?.collapseId).toBe(approval?.collapseId);
      expect(other?.collapseId).not.toBe(approval?.collapseId);
      expect((yield* push.status(identity(env, "alice"))).devices[0]?.lastDelivery).toMatchObject({
        outcome: "sent",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("tells the computer when no recipient has an iPhone registered", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready(ALERTS_FOR_ALICE);
      yield* push.register(identity(env, "bob"), registration({ token: BOB_TOKEN }));
      expect(yield* push.alert(STUDIO, { threadId: THREAD, kind: "approval" })).toEqual({
        sent: 0,
        devices: 0,
      });
      expect(apns.sent).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("holds each computer to 20 alerts an hour and each device to 30", () =>
    Effect.gen(function* () {
      const { env, push, apns } = yield* ready(ALERTS_FOR_ALICE);
      yield* push.register(identity(env, "alice"), registration());
      const send = (computer: EnvironmentId) =>
        push.alert(computer, { threadId: THREAD, kind: "completed" });

      for (let count = 0; count < 20; count++) yield* send(STUDIO);
      expect((yield* send(STUDIO).pipe(Effect.flip)).reason).toBe("rate-limited");

      for (let count = 0; count < 10; count++) yield* send(LAPTOP);
      // The laptop is under its own limit, but the phone has heard enough this hour.
      expect(yield* send(LAPTOP)).toEqual({ sent: 0, devices: 1 });
      expect(apns.sent).toHaveLength(30);

      yield* TestClock.adjust("1 hour");
      expect(yield* send(STUDIO)).toEqual({ sent: 1, devices: 1 });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("drops a device whose token Apple reports dead", () =>
    Effect.gen(function* () {
      const { env, push, secrets, apns } = yield* ready(ALERTS_FOR_ALICE);
      yield* push.register(identity(env, "alice"), registration());
      apns.control.respond = () => "bad-token";
      expect(yield* push.alert(STUDIO, { threadId: THREAD, kind: "failed" })).toEqual({
        sent: 0,
        devices: 1,
      });
      expect((yield* push.status(identity(env, "alice"))).devices).toEqual([]);
      expect(secrets.storedSubjects()).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
