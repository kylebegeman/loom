import { NonNegativeInt } from "@t3tools/contracts";
import {
  ReachAllowlistState,
  ReachFailureReason,
  ReachIdentityFailure,
  ReachLibraryRecordState,
  ReachRateLimitState,
} from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../../../config.ts";

const Id = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256));

const ReachStoredIdentity = Schema.Struct({
  /** Null until Pocket ID created the resource; only then does the Library attest it. */
  apiId: Schema.NullOr(Id),
  resource: Schema.String,
  state: Schema.Literals(["ready", "failed"]),
  lastError: Schema.NullOr(ReachIdentityFailure),
});
export type ReachStoredIdentity = typeof ReachStoredIdentity.Type;

const ReachStoredZone = Schema.Struct({ name: Schema.String, zoneId: Id, accountId: Id });
export type ReachStoredZone = typeof ReachStoredZone.Type;

/** See `ReachLeftoverZone`. The zone keeps its ids, so a later Retire can try again. */
const ReachStoredLeftoverZone = Schema.Struct({
  zone: ReachStoredZone,
  hostname: Schema.NullOr(Schema.String),
  dnsRecordId: Schema.NullOr(Id),
  /** The computer's tunnel there, kept after its removal to tell the CNAME naming it is ours. */
  tunnelId: Schema.NullOr(Id),
  tunnelLeft: Schema.Boolean,
});
export type ReachStoredLeftoverZone = typeof ReachStoredLeftoverZone.Type;

export const ReachStoredComputer = Schema.Struct({
  /** Only grows, and is never deleted, so a captured request cannot replay after a remove. */
  seq: NonNegativeInt,
  /** The key that first ensured; any other key is refused until an admin retires the record. */
  keyFingerprint: Schema.NullOr(Schema.String),
  /** Sticky within its zone, and kept after a remove as a tombstone no other computer is given. */
  hostname: Schema.NullOr(Schema.String),
  tunnelId: Schema.NullOr(Id),
  dnsRecordId: Schema.NullOr(Id),
  /** The ingress origin last written to the tunnel, so an unchanged port skips the PUT. */
  origin: Schema.NullOr(Schema.String),
  state: ReachLibraryRecordState,
  lastError: Schema.NullOr(ReachFailureReason),
  leftoverDnsRecordId: Schema.NullOr(Id),
  publisherSessionId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  lastEnsuredAt: Schema.NullOr(Schema.String),
  identity: Schema.NullOr(ReachStoredIdentity),
  /**
   * The zone its hostname, tunnel and DNS record belong to. Records written before the field
   * carry none and are given the Library's `zone` on load when their hostname is in it.
   */
  zone: Schema.NullOr(ReachStoredZone).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  leftoverZones: Schema.Array(ReachStoredLeftoverZone).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});
export type ReachStoredComputer = typeof ReachStoredComputer.Type;

const ReachStoredEdge = Schema.Struct({
  zoneId: Id,
  rulesetId: Schema.NullOr(Id),
  allowlistRuleId: Schema.NullOr(Id),
  rateLimitRulesetId: Schema.NullOr(Id),
  rateLimitRuleId: Schema.NullOr(Id),
  allowlist: ReachAllowlistState,
  rateLimit: ReachRateLimitState,
  checkedAt: Schema.String,
});
export type ReachStoredEdge = typeof ReachStoredEdge.Type;

/** No secret lives here: the connector token is fetched per ensure and never kept. */
export const ReachLibraryState = Schema.Struct({
  version: Schema.Literal(1),
  zone: Schema.NullOr(ReachStoredZone),
  edge: Schema.NullOr(ReachStoredEdge),
  computers: Schema.Record(Schema.String, ReachStoredComputer),
});
export type ReachLibraryState = typeof ReachLibraryState.Type;

export const emptyReachLibraryState: ReachLibraryState = {
  version: 1,
  zone: null,
  edge: null,
  computers: {},
};

/** The hostname a computer may publish as its `public` route right now. */
export const readyHostname = (computer: ReachStoredComputer | undefined) =>
  computer?.state === "ready" ? computer.hostname : null;

/**
 * A record whose tunnel may still exist. Removed records stay out because their key pin
 * outlives removal until Retire, so forgetting the computer cannot hand the hostname to a new
 * key, and a leftover DNS record no longer matches anything the Library owns.
 */
export const isReachActive = (computer: ReachStoredComputer | undefined) =>
  computer !== undefined &&
  computer.state !== "removed" &&
  computer.state !== "removed-with-leftover";

export class ReachStoreError extends Schema.TaggedError<ReachStoreError>()("ReachStoreError", {
  operation: Schema.Literals(["read", "write"]),
}) {
  override get message(): string {
    return `Failed to ${this.operation} the Library's reach records.`;
  }
}

export class ReachStore extends Context.Service<
  ReachStore,
  {
    readonly read: Effect.Effect<ReachLibraryState, ReachStoreError>;
    /** Writes the file before the copy in memory changes, so a failed write changes nothing. */
    readonly update: (
      change: (state: ReachLibraryState) => ReachLibraryState,
    ) => Effect.Effect<ReachLibraryState, ReachStoreError>;
  }
>()("t3/fork/reach/library/ReachStore") {}

export const isInZone = (hostname: string, zone: string) => hostname.endsWith(`.${zone}`);

/** A hostname from before per-record zones belongs to the zone the Library last resolved. */
const withRecordZones = (state: ReachLibraryState): ReachLibraryState => {
  const zone = state.zone;
  if (zone === null) return state;
  return {
    ...state,
    computers: Object.fromEntries(
      Object.entries(state.computers).map(([id, computer]) => [
        id,
        computer.zone === null &&
        computer.hostname !== null &&
        isInZone(computer.hostname, zone.name)
          ? { ...computer, zone }
          : computer,
      ]),
    ),
  };
};

const StateJson = Schema.fromJsonString(ReachLibraryState);
const decodeStateJson = Schema.decodeUnknownOption(StateJson);
const decodeState = (text: string) => Option.map(decodeStateJson(text), withRecordZones);
const encodeState = Schema.encodeEffect(StateJson);

const makeAt = Effect.fn("ReachStore.make")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeLock = yield* Semaphore.make(1);
  // Null until a read succeeds. An unreadable file stays unloaded, so pins, seqs and tombstones
  // are never replaced by an empty state, and a repaired file is picked up without a restart.
  const loaded = yield* Ref.make<ReachLibraryState | null>(null);

  const load = Effect.gen(function* () {
    const current = yield* Ref.get(loaded);
    if (current !== null) return current;
    const exists = yield* fs
      .exists(filePath)
      .pipe(Effect.mapError(() => new ReachStoreError({ operation: "read" })));
    if (!exists) {
      yield* Ref.set(loaded, emptyReachLibraryState);
      return emptyReachLibraryState;
    }
    const text = yield* fs
      .readFileString(filePath)
      .pipe(Effect.mapError(() => new ReachStoreError({ operation: "read" })));
    const decoded = decodeState(text);
    if (Option.isNone(decoded)) {
      yield* Effect.logWarning("The Library's reach records could not be read; reach is paused.", {
        file: path.basename(filePath),
      });
      return yield* new ReachStoreError({ operation: "read" });
    }
    yield* Ref.set(loaded, decoded.value);
    return decoded.value;
  });

  const update = (change: (state: ReachLibraryState) => ReachLibraryState) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const next = change(yield* load);
        const contents = yield* encodeState(next).pipe(
          Effect.mapError(() => new ReachStoreError({ operation: "write" })),
        );
        yield* writeFileStringAtomically({ filePath, contents: `${contents}\n` }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(() => new ReachStoreError({ operation: "write" })),
        );
        yield* Ref.set(loaded, next);
        return next;
      }),
    );

  return ReachStore.of({ read: load, update });
});

/** For tests and tools that keep the file somewhere other than the state directory. */
export const layerAt = (filePath: string) => Layer.effect(ReachStore, makeAt(filePath));

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return layerAt(path.join(config.stateDir, "fork", "reach", "library.json"));
  }),
);
