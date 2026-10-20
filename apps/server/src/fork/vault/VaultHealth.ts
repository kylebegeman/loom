import {
  VaultError,
  VaultHealthIssue,
  VaultHealthRule,
  VaultHealthMutation,
  type VaultHealthSnapshot,
  type VaultHealthClass,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";

export class VaultHealth extends Context.Service<
  VaultHealth,
  {
    readonly snapshot: Effect.Effect<VaultHealthSnapshot, VaultError>;
    readonly apply: (
      input: VaultHealthMutation,
      actor: string,
    ) => Effect.Effect<VaultHealthSnapshot, VaultError>;
    readonly report: (input: {
      itemId: string;
      itemVersion: number;
      category: VaultHealthClass;
      healthy: boolean;
      observedAt?: number;
      checkDeadline?: number;
    }) => Effect.Effect<void, VaultError>;
    readonly claim: (
      itemId: string,
      force?: boolean,
    ) => Effect.Effect<{ rule: VaultHealthRule; itemVersion: number } | null, VaultError>;
  }
>()("t3/fork/vault/VaultHealth") {}
const Receipt = Schema.Struct({ id: Schema.String, fingerprint: Schema.String });
const State = Schema.Struct({
  protocol: Schema.Literal(1),
  rules: Schema.Array(VaultHealthRule).check(Schema.isMaxLength(128)),
  issues: Schema.Array(VaultHealthIssue).check(Schema.isMaxLength(256)),
  receipts: Schema.Array(Receipt).check(Schema.isMaxLength(32)),
  omittedIssues: Schema.Int,
});
type State = typeof State.Type;
const empty: State = { protocol: 1, rules: [], issues: [], receipts: [], omittedIssues: 0 };
const decode = Schema.decodeUnknownOption(State),
  encode = Schema.encodeEffect(State);
const encodeMutation = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ input: VaultHealthMutation, actor: Schema.String })),
);
const invalid = () => new VaultError({ reason: "invalid-input" }),
  conflict = () => new VaultError({ reason: "conflict" });
const CHECK_INTERVAL_MS = 15 * 60_000;
const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore,
    core = yield* VaultCore.VaultCore,
    identity = yield* ServerEnvironmentIdentity,
    crypto = yield* Crypto.Crypto;
  const hash = (s: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(s)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const path = `environments/${yield* hash(yield* identity.getEnvironmentId)}/health`;
  const lock = yield* Semaphore.make(1);
  const load = Effect.gen(function* () {
    const record = yield* store.read(path);
    if (!record) return { state: empty, version: 0 };
    const parsed = decode(Redacted.value(record.value));
    if (Option.isNone(parsed)) return yield* new VaultError({ reason: "invalid-response" });
    return { state: parsed.value, version: record.version };
  });
  const save = (state: State, version: number) =>
    encode(state).pipe(
      Effect.mapError(invalid),
      Effect.flatMap((value) => store.write(path, Redacted.make(value), version)),
    );
  const view = (state: State, revision: number, now: number): VaultHealthSnapshot => ({
    revision,
    checkedAt: now,
    rules: state.rules,
    omittedIssues: state.omittedIssues,
    issues: state.issues.map((issue) =>
      issue.state === "snoozed" && issue.snoozedUntil !== null && issue.snoozedUntil <= now
        ? { ...issue, state: "open", snoozedUntil: null }
        : issue,
    ),
  });
  const snapshot = Effect.gen(function* () {
    const { state, version } = yield* load;
    return view(state, version, yield* Clock.currentTimeMillis);
  });
  const mutate = <A>(
    f: (s: State, now: number) => Effect.Effect<{ state: State; result: A }, VaultError>,
  ) =>
    lock.withPermit(
      Effect.gen(function* () {
        const loaded = yield* load,
          now = yield* Clock.currentTimeMillis;
        const next = yield* f(loaded.state, now);
        if (next.state !== loaded.state) yield* save(next.state, loaded.version);
        return next.result;
      }),
    );
  return VaultHealth.of({
    snapshot,
    apply: (input, actor) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!Schema.is(VaultHealthMutation)(input)) return yield* invalid();
          const fingerprint = yield* hash(
            yield* encodeMutation({ input, actor }).pipe(Effect.mapError(invalid)),
          );
          const { state, version } = yield* load,
            now = yield* Clock.currentTimeMillis;
          const receipt = state.receipts.find((r) => r.id === input.operationId);
          if (receipt) {
            if (receipt.fingerprint !== fingerprint) return yield* conflict();
            return view(state, version, now);
          }
          if (version !== input.expectedRevision) return yield* conflict();
          let rules = [...state.rules],
            issues = [...state.issues];
          const change = input.change;
          if (change.action === "configure") {
            const item = yield* core.inspect(change.rule.itemId);
            if (!item || item.state !== "active") return yield* invalid();
            if (!rules.some((r) => r.itemId === item.id) && rules.length >= 128)
              return yield* new VaultError({ reason: "invalid-input" });
            rules = [
              ...rules.filter((r) => r.itemId !== item.id),
              { ...change.rule, nextCheckAt: 0 },
            ];
          } else if (change.action === "remove-rule") {
            rules = rules.filter((r) => r.itemId !== change.itemId);
          } else {
            const index = issues.findIndex((i) => i.id === change.issueId);
            if (index < 0) return yield* invalid();
            if (
              change.action === "snooze" &&
              (change.until === null || change.until <= now || change.until > now + 90 * 86400_000)
            )
              return yield* invalid();
            issues[index] = {
              ...issues[index]!,
              state:
                change.action === "snooze"
                  ? "snoozed"
                  : change.action === "dismiss"
                    ? "dismissed"
                    : "open",
              snoozedUntil: change.action === "snooze" ? change.until : null,
              resolvedAt: null,
            };
          }
          const next = {
            ...state,
            rules,
            issues,
            receipts: [...state.receipts.slice(-31), { id: input.operationId, fingerprint }],
          };
          const revision = yield* save(next, version);
          return view(next, revision, now);
        }),
      ),
    claim: (itemId, force = false) =>
      mutate((state, now) =>
        Effect.gen(function* () {
          const rule = state.rules.find((r) => r.itemId === itemId);
          if (!rule || (!force && (!rule.automatic || rule.nextCheckAt > now)))
            return { state, result: null };
          // Explicit rechecks are rate limited too, so reconnect/retry cannot flood the provider.
          if (force && rule.nextCheckAt > now + CHECK_INTERVAL_MS - 30_000)
            return { state, result: null };
          const item = yield* core.inspect(itemId);
          if (!item || item.state !== "active")
            return {
              state: { ...state, rules: state.rules.filter((r) => r.itemId !== itemId) },
              result: null,
            };
          return {
            state: {
              ...state,
              rules: state.rules.map((r) =>
                r.itemId === itemId ? { ...r, nextCheckAt: now + CHECK_INTERVAL_MS } : r,
              ),
            },
            result: {
              rule,
              itemVersion: item.version,
              observedAt: now,
              checkDeadline: now + CHECK_INTERVAL_MS,
            },
          };
        }),
      ),
    report: (input) =>
      mutate((state, now) =>
        Effect.gen(function* () {
          const item = yield* core.inspect(input.itemId);
          if (!item || item.state !== "active" || item.version !== input.itemVersion)
            return { state, result: undefined };
          const id = `${input.itemId}:${input.category}`,
            prior = state.issues.find((i) => i.id === id);
          if (
            input.checkDeadline !== undefined &&
            state.rules.find((r) => r.itemId === input.itemId)?.nextCheckAt !== input.checkDeadline
          )
            return { state, result: undefined };
          if (input.observedAt !== undefined && prior && prior.lastSeenAt > input.observedAt)
            return { state, result: undefined };
          if (input.healthy && !prior) return { state, result: undefined };
          const issue: VaultHealthIssue = input.healthy
            ? { ...prior!, state: "resolved", snoozedUntil: null, resolvedAt: now, lastSeenAt: now }
            : {
                id,
                itemId: input.itemId,
                itemVersion: item.version,
                category: input.category,
                state:
                  prior?.itemVersion === item.version &&
                  ["snoozed", "dismissed"].includes(prior.state)
                    ? prior.state
                    : "open",
                firstSeenAt: prior?.firstSeenAt ?? now,
                lastSeenAt: now,
                resolvedAt: null,
                occurrences: Math.min(Number.MAX_SAFE_INTEGER, (prior?.occurrences ?? 0) + 1),
                snoozedUntil: prior?.snoozedUntil ?? null,
              };
          const all = [...state.issues.filter((i) => i.id !== id), issue];
          // Keep active issues before resolved history. The omission count makes bounded retention visible.
          const ranked = all.sort(
            (a, b) =>
              Number(a.state === "resolved") - Number(b.state === "resolved") ||
              b.lastSeenAt - a.lastSeenAt,
          );
          return {
            state: {
              ...state,
              issues: ranked.slice(0, 256),
              omittedIssues: state.omittedIssues + Math.max(0, ranked.length - 256),
            },
            result: undefined,
          };
        }),
      ),
  });
});
export const layer = Layer.effect(VaultHealth, make);
