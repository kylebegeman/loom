import type { EnvironmentId } from "@t3tools/contracts";
import {
  SWITCHBOARD_MAX_COMPUTERS,
  SWITCHBOARD_MEMBERS_ROUTE,
  SWITCHBOARD_REDEEM_ROUTE,
  SwitchboardMembers,
  SwitchboardMembership,
  SwitchboardRedemption,
  type SwitchboardComputer,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Duration from "effect/Duration";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { SwitchboardAccountError } from "./SwitchboardAccountError.ts";

const STORE = "switchboard-account-computers";
const CHECK_INTERVAL = "15 minutes";
/** How long the hub honors a credential the Library has not confirmed, as through an outage. */
const LEASE_MS = Duration.toMillis(Duration.hours(24));
const Stored = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    computers: Schema.Array(
      Schema.Struct({
        label: Schema.String,
        device: Schema.String,
        credentialHash: Schema.String,
        membership: SwitchboardMembership,
        issuedAt: Schema.Number,
        /** When the Library last confirmed this computer's membership. */
        confirmedAt: Schema.Number,
      }),
    ),
  }),
);
type StoredComputer = (typeof Stored.Type)["computers"][number];
const leaseEnd = (entry: StoredComputer) => entry.confirmedAt + LEASE_MS;
const decodeStored = Schema.decodeUnknownEffect(Stored);
const encodeStored = Schema.encodeEffect(Stored);
const decodeRedemption = Schema.decodeUnknownEffect(SwitchboardRedemption);
const decodeMembers = Schema.decodeUnknownEffect(SwitchboardMembers);
const unavailable = () => new SwitchboardAccountError({ reason: "unavailable" });

/** Switchboard's ledger names a request's computer with this, `^[a-z0-9][a-z0-9-]{0,62}$`. */
export const switchboardDevice = (label: string, environmentId: string) => {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/gu, "");
  return (
    slug ||
    `computer-${environmentId
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, "")
      .slice(0, 12)}`
  );
};

/**
 * On the hub: the credential issued to each account computer. Only a SHA-256 of each is kept, in
 * the server secret store. A computer's new enrollment replaces its old credential, and one whose
 * membership the Library no longer confirms loses it. A Library that refuses the hub ends every
 * credential, and one that stays unreachable ends each a day after its last confirmation.
 */
export class SwitchboardClients extends Context.Service<
  SwitchboardClients,
  {
    readonly enroll: (
      ticket: string,
    ) => Effect.Effect<Redacted.Redacted<string>, SwitchboardAccountError>;
    /** The computer a gateway credential belongs to, if any. */
    readonly authenticate: (
      credential: string,
    ) => Effect.Effect<Option.Option<{ readonly device: string }>>;
    readonly list: Effect.Effect<ReadonlyArray<SwitchboardComputer>>;
    readonly revoke: (environmentId: EnvironmentId) => Effect.Effect<void, SwitchboardAccountError>;
    /** Drops computers the Library no longer confirms as members, and renews the rest. */
    readonly check: Effect.Effect<void, SwitchboardAccountError>;
  }
>()("t3/fork/switchboard/SwitchboardClients") {}

const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const secrets = yield* ServerSecretStore;
  const connection = yield* LibraryConnectionService;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const ownId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const sharing = environment.LOOM_SWITCHBOARD_SHARE_GATEWAY === "true";
  const lock = yield* Semaphore.make(1);
  const lastUsed = new Map<EnvironmentId, number>();
  const stored = yield* secrets.get(STORE).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed([] as ReadonlyArray<StoredComputer>),
        onSome: (bytes) =>
          decodeStored(new TextDecoder().decode(bytes)).pipe(Effect.map((v) => v.computers)),
      }),
    ),
    // Unreadable records only make each computer enroll again.
    Effect.tapError(() => Effect.logWarning("Switchboard account computers could not be read.")),
    Effect.orElseSucceed(() => [] as ReadonlyArray<StoredComputer>),
  );
  let computers = new Map(stored.map((entry) => [entry.membership.environmentId, entry]));
  let byHash = new Map(stored.map((entry) => [entry.credentialHash, entry]));

  const hash = (value: string) =>
    digest
      .digest(Digest.sha256, new TextEncoder().encode(value))
      .pipe(Effect.map(Hex.encode), Effect.orDie);
  const save = Effect.fn("SwitchboardClients.save")(function* (
    next: ReadonlyMap<EnvironmentId, StoredComputer>,
  ) {
    const text = yield* encodeStored({ version: 1, computers: [...next.values()] });
    yield* secrets.set(STORE, new TextEncoder().encode(text));
    computers = new Map(next);
    byHash = new Map([...next.values()].map((entry) => [entry.credentialHash, entry]));
  }, Effect.mapError(unavailable));

  const library = Effect.gen(function* () {
    const current = yield* connection.current;
    if (current.kind !== "remote") return yield* unavailable();
    return current;
  });
  const post = Effect.fn("SwitchboardClients.post")(function* (route: string, body: unknown) {
    const current = yield* library;
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(current.endpoint(route)),
      body,
    ).pipe(Effect.mapError(unavailable));
    const response = yield* current
      .send(request)
      .pipe(Effect.timeout("15 seconds"), Effect.mapError(unavailable));
    if (response.status === 401 || response.status === 403)
      return yield* new SwitchboardAccountError({ reason: "denied" });
    if (response.status !== 200) return yield* unavailable();
    return yield* response.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(256)),
      Effect.timeout("15 seconds"),
      Effect.mapError(unavailable),
    );
  });

  const enroll = Effect.fn("SwitchboardClients.enroll")(function* (ticket: string) {
    if (!sharing) return yield* new SwitchboardAccountError({ reason: "disabled" });
    const redemption = yield* post(SWITCHBOARD_REDEEM_ROUTE, { ticket }).pipe(
      Effect.flatMap((body) => decodeRedemption(body).pipe(Effect.mapError(unavailable))),
    );
    const environmentId = redemption.membership.environmentId;
    if (environmentId === ownId) return yield* new SwitchboardAccountError({ reason: "denied" });
    const credential = Hex.encode(yield* random.randomBytes(32).pipe(Effect.mapError(unavailable)));
    const issuedAt = yield* Clock.currentTimeMillis;
    const entry: StoredComputer = {
      label: redemption.label,
      device: switchboardDevice(redemption.label, environmentId),
      credentialHash: yield* hash(credential),
      membership: redemption.membership,
      issuedAt,
      confirmedAt: issuedAt,
    };
    yield* lock.withPermit(
      Effect.suspend(() => {
        // The membership check sends every computer at once, and the Library refuses more than this.
        if (!computers.has(environmentId) && computers.size >= SWITCHBOARD_MAX_COMPUTERS)
          return Effect.fail(new SwitchboardAccountError({ reason: "denied" }));
        return save(new Map([...computers, [environmentId, entry]]));
      }),
    );
    return Redacted.make(credential);
  });

  const check = Effect.gen(function* () {
    if (!sharing || computers.size === 0) return;
    const asked = [...computers.values()];
    const checkedAt = yield* Clock.currentTimeMillis;
    const answer = yield* post(SWITCHBOARD_MEMBERS_ROUTE, {
      memberships: asked.map((entry) => entry.membership),
    }).pipe(
      Effect.flatMap((body) => decodeMembers(body).pipe(Effect.mapError(unavailable))),
      Effect.result,
    );
    const active = new Set(Result.isSuccess(answer) ? answer.success.active : []);
    const ends = (entry: StoredComputer) =>
      Result.isSuccess(answer)
        ? !active.has(entry.membership.environmentId)
        : answer.failure.reason === "denied" || checkedAt >= leaseEnd(entry);
    const ended = yield* lock.withPermit(
      Effect.suspend(() => {
        const next = new Map(computers);
        const removed: Array<EnvironmentId> = [];
        for (const entry of asked) {
          const environmentId = entry.membership.environmentId;
          const current = next.get(environmentId);
          if (current?.credentialHash !== entry.credentialHash) continue;
          if (ends(current)) {
            next.delete(environmentId);
            removed.push(environmentId);
          } else if (active.has(environmentId) && current.confirmedAt < checkedAt)
            next.set(environmentId, { ...current, confirmedAt: checkedAt });
        }
        const changed = removed.length > 0 || Result.isSuccess(answer);
        return (changed ? save(next) : Effect.void).pipe(Effect.as(removed));
      }),
    );
    if (ended.length > 0)
      yield* Effect.logInfo("Revoked Switchboard credentials the Library no longer confirms.", {
        computers: ended,
      });
    if (Result.isFailure(answer)) return yield* answer.failure;
  }).pipe(Effect.withSpan("SwitchboardClients.check"));

  if (sharing)
    yield* check.pipe(
      Effect.ignore,
      Effect.repeat(Schedule.spaced(CHECK_INTERVAL)),
      Effect.forkScoped,
    );

  return SwitchboardClients.of({
    enroll,
    authenticate: Effect.fn("SwitchboardClients.authenticate")(function* (credential) {
      const entry = byHash.get(yield* hash(credential));
      const now = yield* Clock.currentTimeMillis;
      if (entry === undefined || now >= leaseEnd(entry)) return Option.none();
      lastUsed.set(entry.membership.environmentId, now);
      return Option.some({ device: entry.device });
    }),
    list: Effect.sync(() =>
      [...computers.values()].map((entry) => ({
        environmentId: entry.membership.environmentId,
        label: entry.label,
        device: entry.device,
        issuedAt: entry.issuedAt,
        lastUsedAt: lastUsed.get(entry.membership.environmentId) ?? null,
      })),
    ),
    revoke: Effect.fn("SwitchboardClients.revoke")(function* (environmentId) {
      yield* lock.withPermit(
        Effect.suspend(() => {
          if (!computers.has(environmentId)) return Effect.void;
          const next = new Map(computers);
          next.delete(environmentId);
          return save(next);
        }),
      );
    }),
    check,
  });
});

export const layer = Layer.effect(SwitchboardClients, make);
