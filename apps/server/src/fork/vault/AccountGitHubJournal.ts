import {
  VaultError,
  VaultGitHubError,
  VaultGitHubResult,
  VaultItemId,
  VaultConnectionSelector,
  VaultGitHubOperation,
  VaultGitHubRepository,
  type VaultGitHubRunInput,
  type VaultConnectionError,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const RETENTION_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 512;
const MAX_CACHED_RESULT_BYTES = 1024;
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const isId = Schema.is(VaultItemId);
const Scope = Schema.Struct({
  sourceEnvironmentId: Schema.String,
  keyFingerprint: Schema.String,
  authorityId: Schema.String,
  ownerSubject: Schema.String,
  threadId: Schema.String,
  projectId: Schema.String,
});
const Proposal = Schema.Struct({
  connection: VaultConnectionSelector,
  repository: VaultGitHubRepository,
  operation: VaultGitHubOperation,
});
const Entry = Schema.Struct({
  id: VaultItemId,
  scope: Hash,
  fingerprint: Hash,
  createdAt: Schema.Number,
  state: Schema.Literals(["pending", "completed", "unknown"]),
  result: Schema.NullOr(VaultGitHubResult),
});
type Entry = typeof Entry.Type;
const Journal = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Schema.String,
  entries: Schema.Array(Entry).check(Schema.isMaxLength(MAX_ENTRIES)),
});
const decode = Schema.decodeUnknownEffect(Journal, { onExcessProperty: "error" });
const encode = Schema.encodeEffect(Journal);
const encodeScope = Schema.encodeEffect(Schema.fromJsonString(Scope));
const encodeProposal = Schema.encodeEffect(Schema.fromJsonString(Proposal));
const encodeResult = Schema.encodeEffect(Schema.fromJsonString(VaultGitHubResult));
type Failure = VaultError | VaultGitHubError | VaultConnectionError;

export class AccountGitHubJournal extends Context.Service<
  AccountGitHubJournal,
  {
    readonly run: (
      input: {
        readonly operationId: string;
        readonly mode: "start" | "recover";
        readonly scope: typeof Scope.Type;
        readonly proposal: VaultGitHubRunInput;
      },
      authorize: Effect.Effect<void, VaultError>,
      operation: Effect.Effect<VaultGitHubResult, Failure>,
    ) => Effect.Effect<VaultGitHubResult, Failure>;
  }
>()("t3/fork/vault/AccountGitHubJournal") {}

const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Digest.Digest;
  const environmentId = store.inventoryEnvironmentId ?? (yield* identity.getEnvironmentId);
  const hash = Effect.fn("AccountGitHubJournal.hash")(function* (text: string) {
    return Hex.encode(
      yield* crypto
        .digest(Digest.sha256, new TextEncoder().encode(text))
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
    );
  });
  const path = `environments/${yield* hash(environmentId)}/profiles/_operations/account-github-v1`;
  const load = Effect.fn("AccountGitHubJournal.load")(function* () {
    const stored = yield* store.read(path);
    if (stored === null) return { version: 0, entries: [] as Entry[] };
    const value = yield* decode(Redacted.value(stored.value)).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-response" })),
    );
    if (
      value.environmentId !== environmentId ||
      new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return { version: stored.version, entries: value.entries };
  });
  const save = Effect.fn("AccountGitHubJournal.save")(function* (
    entries: readonly Entry[],
    version: number,
  ) {
    const value = yield* encode({ schemaVersion: 1, environmentId, entries }).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-response" })),
    );
    yield* store.write(path, Redacted.make(value), version);
  });
  const uncertain = (operationId: string) =>
    new VaultGitHubError({ reason: "failed", operationId });
  const retained = (entries: readonly Entry[], now: number) =>
    entries.filter((entry) => entry.createdAt + RETENTION_MS > now);
  const update = Effect.fn("AccountGitHubJournal.finish")(function* (completed: Entry) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = yield* load();
      const found = current.entries.find((entry) => entry.id === completed.id);
      if (
        !found ||
        found.scope !== completed.scope ||
        found.fingerprint !== completed.fingerprint ||
        found.state !== "pending"
      )
        return yield* new VaultError({ reason: "conflict" });
      const written = yield* save(
        current.entries.map((entry) => (entry.id === completed.id ? completed : entry)),
        current.version,
      ).pipe(Effect.result);
      if (written._tag === "Success") return;
      if (written.failure.reason !== "conflict") return yield* written.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  return AccountGitHubJournal.of({
    run: Effect.fn("AccountGitHubJournal.run")(function* (input, authorize, operation) {
      if (!isId(input.operationId)) return yield* new VaultError({ reason: "invalid-input" });
      yield* authorize;
      const scope = yield* encodeScope(input.scope).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        Effect.flatMap(hash),
      );
      const proposal = input.proposal;
      const fingerprint = yield* encodeProposal({
        connection:
          "connection" in proposal
            ? proposal.connection
            : { id: proposal.id, expectedVersion: proposal.expectedVersion },
        repository: proposal.repository.toLowerCase(),
        operation: proposal.operation,
      }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        Effect.flatMap(hash),
      );
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          let reserved: Entry | undefined;
          for (let attempt = 0; attempt < 4; attempt++) {
            yield* authorize;
            const now = yield* Clock.currentTimeMillis;
            const current = yield* load();
            const entries = retained(current.entries, now);
            const existing = entries.find((entry) => entry.id === input.operationId);
            if (existing) {
              if (existing.scope !== scope) return yield* new VaultError({ reason: "denied" });
              if (existing.fingerprint !== fingerprint)
                return yield* new VaultError({ reason: "conflict" });
              yield* authorize;
              if (existing.state === "completed") {
                if (existing.result) return { ...existing.result, operationId: existing.id };
                return yield* new VaultGitHubError({
                  reason: "receipt-only",
                  operationId: existing.id,
                });
              }
              return yield* uncertain(existing.id);
            }
            if (input.mode === "recover")
              return yield* new VaultGitHubError({
                reason: "receipt-unavailable",
                operationId: input.operationId,
              });
            if (entries.length >= MAX_ENTRIES)
              return yield* new VaultError({ reason: "unavailable" });
            const entry: Entry = {
              id: input.operationId,
              scope,
              fingerprint,
              createdAt: now,
              state: "pending",
              result: null,
            };
            const written = yield* save([...entries, entry], current.version).pipe(Effect.result);
            if (written._tag === "Success") {
              reserved = entry;
              break;
            }
            if (written.failure.reason !== "conflict") return yield* uncertain(input.operationId);
          }
          if (!reserved) return yield* new VaultError({ reason: "conflict" });
          // Once reserved, cancellation or a lost write reply must never trigger another execution.
          const result = yield* restore(authorize.pipe(Effect.andThen(operation))).pipe(
            Effect.exit,
          );
          let cached: VaultGitHubResult | null = null;
          if (Exit.isSuccess(result)) {
            const encoded = yield* encodeResult(result.value).pipe(Effect.result);
            if (
              encoded._tag === "Success" &&
              new TextEncoder().encode(encoded.success).byteLength <= MAX_CACHED_RESULT_BYTES
            )
              cached = result.value;
          }
          const completed: Entry = {
            ...reserved,
            state: Exit.isSuccess(result) ? "completed" : "unknown",
            result: cached,
          };
          yield* update(completed).pipe(Effect.mapError(() => uncertain(input.operationId)));
          if (Exit.isFailure(result)) return yield* uncertain(input.operationId);
          yield* authorize;
          return { ...result.value, operationId: input.operationId };
        }),
      );
    }),
  });
});
export const layer = Layer.effect(AccountGitHubJournal, make);
