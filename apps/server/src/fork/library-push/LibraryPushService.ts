// @effect-diagnostics-next-line nodeBuiltinImport:off -- APNs signs with an ES256 KeyObject, which Effect's Crypto cannot import from a .p8.
import * as NodeCrypto from "node:crypto";

import {
  type AuthEnvironmentScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  type LibraryPushActivityReply,
  type LibraryPushActivityRequest,
  type LibraryPushDeliveryReason,
  type LibraryPushDevice,
  LibraryPushError,
  type LibraryPushErrorReason,
  type LibraryPushKeySummary,
  type LibraryPushLastDelivery,
  type LibraryPushRegisterRequest,
  type LibraryPushStatus,
  type LibraryPushStatusReason,
  type LibraryPushTestDelivery,
  type LibraryPushTestRequest,
  type LibraryPushTestResult,
  type LibraryPushUnregisterRequest,
  type LibraryPushUnregisterResult,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { identityAccountFromSession } from "../../auth/identityPolicy.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ApnsClient from "./ApnsClient.ts";
import { agentAlertRequest, type ApnsAlertRequest, LIBRARY_PUSH_TEST_ALERT } from "./apnsPayloads.ts";
import { libraryPushActivitySwitchOn, libraryPushConfig } from "./config.ts";
import {
  applyRegistration,
  applyUnregister,
  deviceView,
  EMPTY_LIBRARY_PUSH_REGISTRY,
  isoAt,
  type LibraryPushPolicy,
  type LibraryPushRegistry,
  LibraryPushRegistryDocument,
  type LibraryPushScope,
  liveDevicesFor,
  pruneRegistry,
  removeDeadTokens,
  servesTopic,
  type StoredLibraryPushDevice,
  visibleTo,
} from "./registry.ts";

/** The secret-store document holding every registered device. Its name never carries a token. */
export const LIBRARY_PUSH_DEVICES_SECRET = "loom-push-devices";

const ACCOUNT_TEST_INTERVAL_MS = 10_000;
const DEVICE_TEST_WINDOW_MS = 10 * 60_000;
const DEVICE_TESTS_PER_WINDOW = 3;
// Agent alerts (C04-10) count separately from tests, so a busy hour never blocks a test.
const ALERT_WINDOW_MS = 60 * 60_000;
const ALERTS_PER_COMPUTER = 20;
const ALERTS_PER_DEVICE = 30;
const SEND_CONCURRENCY = 4;
// A .p8 is a few hundred bytes; anything this large is not one.
const KEY_FILE_MAX_BYTES = 16 * 1024;
const APPLE_ID = /^[A-Z0-9]{10}$/;
// Upstream T3's team (scripts/fork/mobileIdentity.ts). Its key cannot sign for Loom's bundles.
const UPSTREAM_TEAM_ID = "ARK85ZXQ4Z";
// The token becomes the APNs request path. Apple treats its length as variable, so only the
// alphabet and an even length are fixed.
const DEVICE_TOKEN = /^(?:[0-9a-fA-F]{2}){8,200}$/;

/**
 * Agents reach the service only through MCP tools that answer on this Library. They act as the
 * operator, and those tools never list devices.
 */
export type LibraryPushCaller =
  | {
      readonly _tag: "Session";
      readonly subject: string;
      readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
    }
  | { readonly _tag: "Agent" };

export const sessionCaller = (session: {
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
}): LibraryPushCaller => ({ _tag: "Session", subject: session.subject, scopes: session.scopes });

export const AGENT_CALLER: LibraryPushCaller = { _tag: "Agent" };

export class LibraryPushService extends Context.Service<
  LibraryPushService,
  {
    /** Read-only: rows that no longer qualify are left out, never deleted here. */
    readonly status: (caller: LibraryPushCaller) => Effect.Effect<LibraryPushStatus>;
    /** Only an Identity account registers, and the row belongs to that account. */
    readonly register: (
      caller: LibraryPushCaller,
      request: LibraryPushRegisterRequest,
    ) => Effect.Effect<LibraryPushDevice, LibraryPushError>;
    /** Answers `removed: false` while push is off, so a phone can always back out. */
    readonly unregister: (
      caller: LibraryPushCaller,
      request: LibraryPushUnregisterRequest,
    ) => Effect.Effect<LibraryPushUnregisterResult, LibraryPushError>;
    /** An Identity caller without an id tests all of its own devices; an operator names one. */
    readonly test: (
      caller: LibraryPushCaller,
      request: LibraryPushTestRequest,
    ) => Effect.Effect<LibraryPushTestResult, LibraryPushError>;
    /** Agent alerts run here, as `library-push-activity` advertises. */
    readonly alerts: boolean;
    /**
     * Sends one agent alert from a computer to the alert recipients' devices. The caller has
     * already established which computer it is. Fails `off` while alerts are off and
     * `rate-limited` past the computer's hourly limit; a device past its own limit is skipped.
     */
    readonly alert: (
      environmentId: EnvironmentId,
      request: LibraryPushActivityRequest,
    ) => Effect.Effect<LibraryPushActivityReply, LibraryPushError>;
  }
>()("t3/fork/library-push/LibraryPushService") {}

type ResolvedScope = LibraryPushScope | { readonly _tag: "Denied" };

const OPERATOR: ResolvedScope = { _tag: "Operator" };
const NONE: ResolvedScope = { _tag: "None" };
const DENIED: ResolvedScope = { _tag: "Denied" };

const refuse = (reason: LibraryPushErrorReason) => new LibraryPushError({ reason });

const disabled = (reason: "not-library" | null) =>
  LibraryPushService.of({
    status: Effect.fn("LibraryPushService.status")(() =>
      Effect.succeed({ state: "off", reason, key: null, devices: [] } satisfies LibraryPushStatus),
    ),
    register: Effect.fn("LibraryPushService.register")(function* () {
      return yield* refuse("off");
    }),
    unregister: Effect.fn("LibraryPushService.unregister")(() =>
      Effect.succeed({ removed: false }),
    ),
    test: Effect.fn("LibraryPushService.test")(function* () {
      return yield* refuse("off");
    }),
    alerts: false,
    alert: Effect.fn("LibraryPushService.alert")(function* () {
      return yield* refuse("off");
    }),
  });

type KeyLoad =
  | { readonly _tag: "Loaded"; readonly key: Redacted.Redacted<NodeCrypto.KeyObject> }
  | { readonly _tag: "Problem"; readonly reason: "key-unreadable" | "key-invalid" };

const KEY_INVALID: KeyLoad = { _tag: "Problem", reason: "key-invalid" };
const KEY_UNREADABLE: KeyLoad = { _tag: "Problem", reason: "key-unreadable" };

const parseSigningKey = (pem: string): KeyLoad => {
  try {
    const key = NodeCrypto.createPrivateKey(pem);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
      ? { _tag: "Loaded", key: Redacted.make(key) }
      : KEY_INVALID;
  } catch {
    return KEY_INVALID;
  }
};

/** Read once at startup. Errors carry the path, so only the fixed reason survives. */
const loadSigningKey = Effect.fn("LibraryPushService.loadSigningKey")(function* (config: {
  readonly teamId: string;
  readonly keyId: string;
  readonly keyFile: string;
}) {
  if (
    !APPLE_ID.test(config.teamId) ||
    !APPLE_ID.test(config.keyId) ||
    config.teamId === UPSTREAM_TEAM_ID
  ) {
    return KEY_INVALID;
  }
  const fs = yield* FileSystem.FileSystem;
  const pem = yield* Effect.gen(function* () {
    const info = yield* fs.stat(config.keyFile);
    // Same rule as the Library credential file (project-library/enrollment.ts).
    if (
      info.type !== "File" ||
      (info.mode & 0o077) !== 0 ||
      Number(info.size) > KEY_FILE_MAX_BYTES
    ) {
      return null;
    }
    return yield* fs.readFileString(config.keyFile);
  }).pipe(Effect.orElseSucceed(() => null));
  return pem === null ? KEY_UNREADABLE : parseSigningKey(pem);
});

const RegistryJson = Schema.fromJsonString(LibraryPushRegistryDocument);
const decodeRegistry = Schema.decodeUnknownOption(RegistryJson);
const encodeRegistry = Schema.encodeEffect(RegistryJson);

const deliveryReasonOf = (outcome: ApnsClient.ApnsOutcome): LibraryPushDeliveryReason | null =>
  outcome === "sent" ? null : outcome;

/** `sends` are the targets that still had a rate-limit slot. */
interface SendPlan {
  readonly targets: ReadonlyArray<StoredLibraryPushDevice>;
  readonly sends: ReadonlyArray<StoredLibraryPushDevice>;
}

/** Drops slots older than the window and keys left without one. */
const pruneSlots = (
  slots: Map<string, ReadonlyArray<number>>,
  nowMs: number,
  windowMs: number,
) => {
  for (const [key, times] of slots) {
    const recent = times.filter((at) => nowMs - at < windowMs);
    if (recent.length === 0) slots.delete(key);
    else slots.set(key, recent);
  }
};

/** Takes one of the key's slots when it has one left in the pruned window. */
const takeSlot = (
  slots: Map<string, ReadonlyArray<number>>,
  key: string,
  nowMs: number,
  limit: number,
) => {
  const recent = slots.get(key) ?? [];
  if (recent.length >= limit) return false;
  slots.set(key, [...recent, nowMs]);
  return true;
};

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const config = libraryPushConfig(env);

  if (config._tag === "Off") {
    // Off means nothing is held; phones register again once push is back on.
    yield* secrets
      .remove(LIBRARY_PUSH_DEVICES_SECRET)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Library push could not clear its device list", { error: error._tag }),
        ),
      );
    return disabled(config.reason);
  }

  const keySummary: LibraryPushKeySummary | null =
    APPLE_ID.test(config.teamId) && APPLE_ID.test(config.keyId)
      ? { teamId: config.teamId, keyId: config.keyId }
      : null;
  const key = yield* loadSigningKey(config);
  const problem: LibraryPushStatusReason | null = key._tag === "Problem" ? key.reason : null;
  if (problem !== null) {
    yield* Effect.logWarning("Library push is misconfigured", { reason: problem });
  }
  if (config.topics.length === 0) {
    yield* Effect.logWarning(
      "LOOM_LIBRARY_PUSH_TOPICS names no supported bundle and environment, so no device can register",
    );
  }
  const recipients = config.alertRecipients;
  if (recipients === null && libraryPushActivitySwitchOn(env)) {
    yield* Effect.logWarning(
      "LOOM_LIBRARY_PUSH_ACTIVITY is on, but no account is set to receive agent alerts: with more than one allowed Identity subject, name them in LOOM_LIBRARY_PUSH_RECIPIENTS",
    );
  }
  const sender =
    key._tag === "Loaded"
      ? yield* Effect.flatMap(ApnsClient.ApnsClient, (apns) =>
          apns.open({
            teamId: config.teamId,
            keyId: config.keyId,
            privateKey: Redacted.value(key.key),
          }),
        )
      : null;

  const policyAt = (nowMs: number): LibraryPushPolicy => ({
    nowMs,
    issuer: config.issuer,
    allowedSubjects: config.allowedSubjects,
    topics: config.topics,
  });

  const stored = yield* secrets.get(LIBRARY_PUSH_DEVICES_SECRET).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Library push could not read its device list", {
        error: error._tag,
      }).pipe(Effect.as(Option.none<Uint8Array>())),
    ),
  );
  const decoded = Option.flatMap(stored, (bytes) =>
    decodeRegistry(new TextDecoder().decode(bytes)),
  );
  if (Option.isSome(stored) && Option.isNone(decoded)) {
    // Its contents stay out of the log because they hold push tokens. Phones register again.
    yield* Effect.logWarning("Library push discarded an unreadable device list");
  }
  const loaded = Option.getOrElse(decoded, () => EMPTY_LIBRARY_PUSH_REGISTRY);

  const registryRef = yield* Ref.make<LibraryPushRegistry>(loaded);
  // Delivery results live in memory only; a restart forgets them along with `failing`.
  const deliveriesRef = yield* Ref.make<ReadonlyMap<string, LibraryPushLastDelivery>>(new Map());
  const failingRef = yield* Ref.make(false);
  const lock = yield* Semaphore.make(1);
  // Mutated only while holding `lock`.
  const accountTests = new Map<string, number>();
  const deviceTests = new Map<string, ReadonlyArray<number>>();
  const computerAlerts = new Map<string, ReadonlyArray<number>>();
  const deviceAlerts = new Map<string, ReadonlyArray<number>>();

  /** The store is written first; memory follows only a successful write. */
  const commit = (next: LibraryPushRegistry) =>
    encodeRegistry(next).pipe(
      Effect.flatMap((json) =>
        secrets.set(LIBRARY_PUSH_DEVICES_SECRET, new TextEncoder().encode(json)),
      ),
      Effect.tapError((error) =>
        Effect.logWarning("Library push could not save its device list", { error: error._tag }),
      ),
      Effect.mapError(() => refuse("storage")),
      Effect.andThen(Ref.set(registryRef, next)),
      Effect.andThen(
        Ref.update(deliveriesRef, (deliveries) => {
          const ids = new Set(next.devices.map((row) => row.id));
          return new Map([...deliveries].filter(([id]) => ids.has(id)));
        }),
      ),
    );

  // Expired rows are filtered from every view, so a failed prune write loses nothing.
  const commitPrune = (pruned: {
    readonly registry: LibraryPushRegistry;
    readonly changed: boolean;
  }) => (pruned.changed ? commit(pruned.registry).pipe(Effect.ignore) : Effect.void);

  yield* commitPrune(pruneRegistry(loaded, policyAt(yield* Clock.currentTimeMillis)));

  const scopeOf = (caller: LibraryPushCaller): ResolvedScope => {
    if (caller._tag === "Agent") return OPERATOR;
    // An Identity-shaped subject that no longer decodes to an account is refused outright rather
    // than treated as an operator: its policy changed or it was never an Identity session.
    if (caller.subject.startsWith("identity:") || caller.subject.startsWith("pocket-id:")) {
      const account = identityAccountFromSession(caller.subject, env);
      return account === undefined ? DENIED : { _tag: "Account", account };
    }
    return caller.scopes.includes(AuthSettingsWriteScope) ? OPERATOR : NONE;
  };

  const status = Effect.fn("LibraryPushService.status")(function* (caller: LibraryPushCaller) {
    const scope = scopeOf(caller);
    const nowMs = yield* Clock.currentTimeMillis;
    const registry = yield* Ref.get(registryRef);
    const deliveries = yield* Ref.get(deliveriesRef);
    const failing = yield* Ref.get(failingRef);
    const devices =
      scope._tag === "Denied"
        ? []
        : liveDevicesFor(registry, scope, policyAt(nowMs)).map((row) =>
            deviceView(row, scope, deliveries.get(row.id)),
          );
    return {
      state: problem !== null ? "misconfigured" : failing ? "failing" : "ready",
      reason: problem ?? (failing ? "key-rejected" : null),
      key: keySummary,
      devices,
      topics: config.topics,
    } satisfies LibraryPushStatus;
  });

  const register = Effect.fn("LibraryPushService.register")(function* (
    caller: LibraryPushCaller,
    request: LibraryPushRegisterRequest,
  ) {
    if (problem !== null) return yield* refuse("misconfigured");
    const scope = scopeOf(caller);
    if (scope._tag !== "Account") return yield* refuse("identity-required");
    const token = Redacted.value(request.token);
    if (!DEVICE_TOKEN.test(token)) return yield* refuse("invalid");
    // Refused here so no row exists that the key cannot deliver to.
    if (!servesTopic(config.topics, request)) return yield* refuse("unsupported-app");
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const outcome = applyRegistration(
          yield* Ref.get(registryRef),
          {
            account: scope.account,
            deviceId: request.deviceId,
            label: request.label,
            bundleId: request.bundleId,
            apsEnvironment: request.apsEnvironment,
            appVersion: request.appVersion ?? null,
            // Apple prints tokens in either case; one form makes the latest-wins check exact.
            token: Redacted.make(token.toLowerCase()),
          },
          policyAt(nowMs),
          config.ttlSeconds,
        );
        if (outcome._tag === "Limit") return yield* refuse("limit");
        if (outcome._tag === "Changed") yield* commit(outcome.registry);
        return deviceView(outcome.row, scope, (yield* Ref.get(deliveriesRef)).get(outcome.row.id));
      }),
    );
  });

  const unregister = Effect.fn("LibraryPushService.unregister")(function* (
    caller: LibraryPushCaller,
    request: LibraryPushUnregisterRequest,
  ) {
    const scope = scopeOf(caller);
    if (scope._tag === "Denied" || scope._tag === "None") {
      return yield* refuse("identity-required");
    }
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const result = applyUnregister(
          yield* Ref.get(registryRef),
          request.id,
          scope,
          policyAt(nowMs),
        );
        if (result.removed) yield* commit(result.registry);
        else yield* commitPrune(result);
        return { removed: result.removed };
      }),
    );
  });

  /** Picks the targets and takes their rate-limit slots, all under the lock. */
  const planTest = (scope: LibraryPushScope, id: string | undefined) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const pruned = pruneRegistry(yield* Ref.get(registryRef), policyAt(nowMs));
        yield* commitPrune(pruned);
        const targets = pruned.registry.devices.filter(
          (row) => visibleTo(scope, row) && (id === undefined || row.id === id),
        );
        if (targets.length === 0) return { targets, sends: [] } satisfies SendPlan;

        for (const [key, at] of accountTests) {
          if (nowMs - at >= ACCOUNT_TEST_INTERVAL_MS) accountTests.delete(key);
        }
        pruneSlots(deviceTests, nowMs, DEVICE_TEST_WINDOW_MS);
        if (scope._tag === "Account") {
          const accountKey = `${scope.account.issuer}\0${scope.account.subject}`;
          if (accountTests.has(accountKey)) return yield* refuse("rate-limited");
          accountTests.set(accountKey, nowMs);
        }
        const sends = targets.filter((row) =>
          takeSlot(deviceTests, row.id, nowMs, DEVICE_TESTS_PER_WINDOW),
        );
        return { targets, sends } satisfies SendPlan;
      }),
    );

  /**
   * Picks the alert recipients' live devices and takes the computer's slot and each device's,
   * all under the lock. Every accepted alert counts against the computer, sent or not.
   */
  const planAlert = (alertRecipients: ReadonlyArray<string>, environmentId: EnvironmentId) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        pruneSlots(computerAlerts, nowMs, ALERT_WINDOW_MS);
        pruneSlots(deviceAlerts, nowMs, ALERT_WINDOW_MS);
        if (!takeSlot(computerAlerts, environmentId, nowMs, ALERTS_PER_COMPUTER)) {
          return yield* refuse("rate-limited");
        }
        const pruned = pruneRegistry(yield* Ref.get(registryRef), policyAt(nowMs));
        yield* commitPrune(pruned);
        const targets = pruned.registry.devices.filter((row) =>
          alertRecipients.includes(row.subject),
        );
        const sends = targets.filter((row) =>
          takeSlot(deviceAlerts, row.id, nowMs, ALERTS_PER_DEVICE),
        );
        return { targets, sends } satisfies SendPlan;
      }),
    );

  /** Sent outside the lock: a slow Apple reply must not hold up registrations. */
  const sendAll = (
    send: ApnsClient.ApnsSender["send"],
    rows: ReadonlyArray<StoredLibraryPushDevice>,
    request: ApnsAlertRequest,
  ) =>
    Effect.forEach(
      rows,
      (row) =>
        send({
          deviceId: row.id,
          token: row.token,
          bundleId: row.bundleId,
          apsEnvironment: row.apsEnvironment,
          request,
        }).pipe(Effect.map((delivery) => ({ row, delivery }))),
      { concurrency: SEND_CONCURRENCY },
    );

  /** Applies what Apple said: dead tokens go, results are remembered, `failing` follows the key. */
  const settle = (
    plan: SendPlan,
    results: ReadonlyArray<{
      readonly row: StoredLibraryPushDevice;
      readonly delivery: ApnsClient.ApnsDelivery;
    }>,
  ) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const at = isoAt(yield* Clock.currentTimeMillis);
        const dead = results
          .filter((result) => result.delivery.outcome === "bad-token")
          .map((result) => result.row);
        let removed = new Set<string>();
        if (dead.length > 0) {
          const pruned = removeDeadTokens(yield* Ref.get(registryRef), dead);
          if (pruned.removed.size > 0) {
            // A row that could not be removed reports a failed delivery and is retried next time.
            removed = yield* commit(pruned.registry).pipe(
              Effect.as(pruned.removed),
              Effect.orElseSucceed(() => new Set<string>()),
            );
          }
        }
        const present = new Set((yield* Ref.get(registryRef)).devices.map((row) => row.id));
        yield* Ref.update(deliveriesRef, (deliveries) => {
          const next = new Map(deliveries);
          for (const { row, delivery } of results) {
            if (!present.has(row.id)) continue;
            next.set(row.id, {
              at,
              outcome: delivery.outcome === "sent" ? "sent" : "failed",
              reason: deliveryReasonOf(delivery.outcome),
            });
          }
          return next;
        });
        // Only a refusal of the key itself, for a pair the key is meant to serve, is Library-wide.
        // Any success in the same batch proves the key works, so it wins.
        if (results.some((result) => result.delivery.outcome === "sent")) {
          yield* Ref.set(failingRef, false);
        } else if (
          results.some(
            (result) =>
              result.delivery.outcome === "key-rejected" && servesTopic(config.topics, result.row),
          )
        ) {
          yield* Ref.set(failingRef, true);
        }
        const byId = new Map(results.map((result) => [result.row.id, result.delivery]));
        return {
          deliveries: plan.targets.map((row): LibraryPushTestDelivery => {
            const delivery = byId.get(row.id);
            if (delivery === undefined) {
              return { id: row.id, label: row.label, outcome: "failed", reason: "rate-limited" };
            }
            return {
              id: row.id,
              label: row.label,
              outcome:
                delivery.outcome === "sent"
                  ? "sent"
                  : delivery.outcome === "bad-token" && removed.has(row.id)
                    ? "removed"
                    : "failed",
              reason: deliveryReasonOf(delivery.outcome),
            };
          }),
        } satisfies LibraryPushTestResult;
      }),
    );

  const test = Effect.fn("LibraryPushService.test")(function* (
    caller: LibraryPushCaller,
    request: LibraryPushTestRequest,
  ) {
    if (sender === null) return yield* refuse("misconfigured");
    const scope = scopeOf(caller);
    if (scope._tag === "Denied" || scope._tag === "None") {
      return yield* refuse("identity-required");
    }
    // An operator reaches every account's devices, so it names exactly one.
    if (scope._tag === "Operator" && request.id === undefined) return yield* refuse("invalid");
    const plan = yield* planTest(scope, request.id);
    if (plan.targets.length === 0) return { deliveries: [] };
    const results = yield* sendAll(sender.send, plan.sends, LIBRARY_PUSH_TEST_ALERT);
    return yield* settle(plan, results);
  });

  const alert = Effect.fn("LibraryPushService.alert")(function* (
    environmentId: EnvironmentId,
    request: LibraryPushActivityRequest,
  ) {
    if (recipients === null) return yield* refuse("off");
    if (sender === null) return yield* refuse("misconfigured");
    const plan = yield* planAlert(recipients, environmentId);
    if (plan.sends.length === 0) return { sent: 0 } satisfies LibraryPushActivityReply;
    const results = yield* sendAll(
      sender.send,
      plan.sends,
      agentAlertRequest({ environmentId, threadId: request.threadId, kind: request.kind }),
    );
    yield* settle(plan, results);
    return {
      sent: results.filter((result) => result.delivery.outcome === "sent").length,
    } satisfies LibraryPushActivityReply;
  });

  return LibraryPushService.of({
    status,
    register,
    unregister,
    test,
    alerts: recipients !== null,
    alert,
  });
});

/** Needs an `ApnsClient`; `LibraryPushLive` supplies the real one. */
export const layer = Layer.effect(LibraryPushService, make);

export const LibraryPushLive = layer.pipe(Layer.provide(ApnsClient.layer));
